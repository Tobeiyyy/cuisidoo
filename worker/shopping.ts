import { Hono, type Context } from "hono";
import type { Env } from "./index";
import type { RecipeIngredient, Scaling } from "../shared/types";
import { isInformalUnit } from "../shared/types";
import { scaleQuantity } from "../shared/scaling";
import { qAll, getFullRecipe } from "./db";
import { isValidISODate } from "./plan";

export interface Need {
  ingredient_id: number; name: string; category: string; unit: string;
  quantity: number; scaling: Scaling; informal: boolean;
}

interface PlanEntryForAggregation {
  servings: number; servings_base: number;
  ingredients: (RecipeIngredient & { category: string })[];
}

// Groups by ingredient_id, keeping informal rows (e.g. "Prise", "TL") separate from canonical
// (weighable/countable) rows for the same ingredient — informal Needs are presence-only further
// down the pipeline (see subtractPantry), so their summed quantity is never actually used for
// display or arithmetic, only their existence. Canonical rows for one ingredient are assumed to
// share a unit by construction (ingredient normalization enforces one canonical unit per
// ingredient), so summing them directly is safe.
export function aggregateNeeds(entries: PlanEntryForAggregation[]): Need[] {
  const groups = new Map<string, Need>();
  for (const entry of entries) {
    const factor = entry.servings / entry.servings_base;
    for (const ing of entry.ingredients) {
      const informal = isInformalUnit(ing.unit);
      const key = `${ing.ingredient_id}:${informal}`;
      const scaled = scaleQuantity(ing.quantity, ing.scaling, factor, ing.unit);
      const existing = groups.get(key);
      if (existing) {
        existing.quantity += scaled;
      } else {
        groups.set(key, {
          ingredient_id: ing.ingredient_id, name: ing.name, category: ing.category,
          unit: ing.unit, quantity: scaled, scaling: ing.scaling, informal,
        });
      }
    }
  }
  return [...groups.values()];
}

export interface PantryEntry { quantity: number; amountless: boolean }

export function subtractPantry(needs: Need[], pantry: Map<number, PantryEntry>): Need[] {
  const result: Need[] = [];
  for (const need of needs) {
    const entry = pantry.get(need.ingredient_id);
    if (entry?.amountless) continue;
    if (need.informal) {
      if (!entry) result.push(need);
      continue;
    }
    const remainder = need.quantity - (entry?.quantity ?? 0);
    if (remainder > 0) result.push({ ...need, quantity: remainder });
  }
  return result;
}

export interface ShoppingItem {
  id: number; ingredient_id: number | null; label: string;
  quantity: number | null; unit: string | null; category: string;
  checked: boolean; source: "plan" | "manual";
}

async function loadEntriesForRange(db: D1Database, from: string, to: string): Promise<PlanEntryForAggregation[]> {
  const planRows = await qAll<{ recipe_id: number; servings: number; servings_base: number }>(
    db.prepare(
      "SELECT pe.recipe_id, pe.servings, r.servings_base FROM plan_entries pe " +
      "JOIN recipes r ON r.id = pe.recipe_id WHERE pe.date >= ? AND pe.date <= ?",
    ).bind(from, to),
  );
  if (planRows.length === 0) return [];
  const recipeIds = [...new Set(planRows.map((r) => r.recipe_id))];
  const placeholders = recipeIds.map(() => "?").join(",");
  const ingredientRows = await qAll<RecipeIngredient & { category: string; recipe_id: number }>(
    db.prepare(
      "SELECT ri.recipe_id, ri.ingredient_id, i.name, i.category, ri.quantity, ri.unit, ri.scaling, ri.note, ri.section, ri.position " +
      `FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id IN (${placeholders})`,
    ).bind(...recipeIds),
  );
  const byRecipe = new Map<number, (RecipeIngredient & { category: string })[]>();
  for (const row of ingredientRows) {
    if (!byRecipe.has(row.recipe_id)) byRecipe.set(row.recipe_id, []);
    byRecipe.get(row.recipe_id)!.push(row);
  }
  return planRows.map((pe) => ({
    servings: pe.servings, servings_base: pe.servings_base,
    ingredients: byRecipe.get(pe.recipe_id) ?? [],
  }));
}

async function loadPantryMap(db: D1Database): Promise<Map<number, PantryEntry>> {
  const rows = await qAll<{ ingredient_id: number; quantity: number; amountless: number }>(
    db.prepare("SELECT ingredient_id, quantity, amountless FROM pantry"),
  );
  return new Map(rows.map((r) => [r.ingredient_id, { quantity: r.quantity, amountless: !!r.amountless }]));
}

export const shoppingRoutes = new Hono<{ Bindings: Env }>()
  .get("/", async (c) => {
    const rows = await qAll<any>(c.env.DB.prepare(
      "SELECT id, ingredient_id, label, quantity, unit, category, checked, source " +
      "FROM shopping_items ORDER BY category, label",
    ));
    return c.json(rows.map((r) => ({ ...r, checked: !!r.checked })));
  })
  .post("/generate", async (c) => {
    const { from, to } = await c.req.json<{ from: string; to: string }>();
    if (!from || !to || !isValidISODate(from) || !isValidISODate(to)) {
      return c.json({ error: "from and to must be YYYY-MM-DD" }, 400);
    }
    const entries = await loadEntriesForRange(c.env.DB, from, to);
    const pantry = await loadPantryMap(c.env.DB);
    const needs = subtractPantry(aggregateNeeds(entries), pantry);
    const stmts: D1PreparedStatement[] = [
      c.env.DB.prepare("DELETE FROM shopping_items WHERE source='plan'"),
    ];
    for (const need of needs) {
      stmts.push(c.env.DB.prepare(
        "INSERT INTO shopping_items (ingredient_id, label, quantity, unit, category, checked, source) VALUES (?,?,?,?,?,0,'plan')",
      ).bind(need.ingredient_id, need.name, need.quantity, need.unit, need.category));
    }
    await c.env.DB.batch(stmts);
    return c.json({ ok: true, count: needs.length });
  })
  .post("/", async (c) => {
    const { label, quantity, unit, category } = await c.req.json<{
      label: string; quantity?: number | null; unit?: string | null; category: string;
    }>();
    if (!label || !label.trim()) return c.json({ error: "label darf nicht leer sein" }, 400);
    if (!category || !category.trim()) return c.json({ error: "category ist erforderlich" }, 400);
    if (quantity !== undefined && quantity !== null && !Number.isFinite(quantity)) {
      return c.json({ error: "quantity muss eine Zahl sein" }, 400);
    }
    const hasQuantity = quantity !== undefined && quantity !== null;
    const hasUnit = !!(unit && unit.trim());
    if (hasQuantity !== hasUnit) {
      return c.json({ error: "quantity und unit müssen zusammen angegeben werden" }, 400);
    }
    const res = await c.env.DB.prepare(
      "INSERT INTO shopping_items (ingredient_id, label, quantity, unit, category, checked, source) VALUES (NULL,?,?,?,?,0,'manual') RETURNING id",
    ).bind(label.trim(), quantity ?? null, unit ?? null, category.trim()).first<{ id: number }>();
    return c.json({ id: res!.id }, 201);
  })
  .patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    const { checked } = await c.req.json<{ checked: boolean }>();
    await c.env.DB.prepare("UPDATE shopping_items SET checked=? WHERE id=?")
      .bind(checked ? 1 : 0, id).run();
    return c.json({ ok: true });
  })
  .delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    await c.env.DB.prepare("DELETE FROM shopping_items WHERE id=?").bind(id).run();
    return c.json({ ok: true });
  })
  .post("/complete", async (c) => {
    const checkedRows = await qAll<{ id: number; ingredient_id: number | null; quantity: number | null; unit: string | null }>(
      c.env.DB.prepare("SELECT id, ingredient_id, quantity, unit FROM shopping_items WHERE checked=1"),
    );
    const stmts: D1PreparedStatement[] = [];
    for (const row of checkedRows) {
      if (row.ingredient_id == null || row.quantity == null || row.unit == null || isInformalUnit(row.unit)) continue;
      stmts.push(c.env.DB.prepare(
        "INSERT INTO pantry (ingredient_id, quantity, updated_at) VALUES (?,?,datetime('now')) " +
        "ON CONFLICT(ingredient_id) DO UPDATE SET quantity = pantry.quantity + excluded.quantity, updated_at = excluded.updated_at",
      ).bind(row.ingredient_id, row.quantity));
    }
    stmts.push(c.env.DB.prepare("DELETE FROM shopping_items WHERE checked=1"));
    await c.env.DB.batch(stmts);
    return c.json({ ok: true });
  });

// POST /api/recipes/:id/cooked — mounted from worker/recipes.ts (route wiring lives there so it
// stays under the /api/recipes/:id/* prefix); the pantry-subtraction logic lives here alongside
// the rest of the pantry-mutating shopping-list code it shares scaling/informal-unit logic with.
export async function cookedHandler(c: Context<{ Bindings: Env }>) {
  const recipeId = Number(c.req.param("id"));
  const recipe = await getFullRecipe(c.env.DB, recipeId);
  if (!recipe) return c.json({ error: "not found" }, 404);
  const { servings } = await c.req.json<{ servings: number }>();
  if (!Number.isInteger(servings) || servings < 1) {
    return c.json({ error: "servings must be >= 1" }, 400);
  }
  const factor = servings / recipe.servings_base;
  const pantry = await loadPantryMap(c.env.DB);
  const stmts: D1PreparedStatement[] = [];
  for (const ing of recipe.ingredients) {
    if (isInformalUnit(ing.unit)) continue;
    const entry = pantry.get(ing.ingredient_id);
    if (!entry || entry.amountless) continue;
    const scaled = scaleQuantity(ing.quantity, ing.scaling, factor, ing.unit);
    const next = Math.max(0, entry.quantity - scaled);
    if (next <= 0) {
      stmts.push(c.env.DB.prepare("DELETE FROM pantry WHERE ingredient_id=?").bind(ing.ingredient_id));
    } else {
      stmts.push(c.env.DB.prepare("UPDATE pantry SET quantity=?, updated_at=datetime('now') WHERE ingredient_id=?")
        .bind(next, ing.ingredient_id));
    }
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
}

// GET /api/recipes/:id/check-pantry — mounted from worker/recipes.ts (see cookedHandler comment
// above for why the route wiring lives there while the pantry logic lives here). Reports, per
// scaled ingredient, how much is missing from the pantry — used by Kochmodus to warn before
// cooking starts.
export async function checkPantryHandler(c: Context<{ Bindings: Env }>) {
  const recipeId = Number(c.req.param("id"));
  const recipe = await getFullRecipe(c.env.DB, recipeId);
  if (!recipe) return c.json({ error: "not found" }, 404);
  const servings = Number(c.req.query("servings") ?? recipe.servings_base);
  if (!Number.isFinite(servings) || servings < 1) {
    return c.json({ error: "servings must be >= 1" }, 400);
  }
  const factor = servings / recipe.servings_base;
  const pantry = await loadPantryMap(c.env.DB);

  const missing: { ingredient_id: number; name: string; needed: number; available: number; unit: string; category: string }[] = [];
  for (const ing of recipe.ingredients) {
    const entry = pantry.get(ing.ingredient_id);
    if (entry?.amountless) continue;
    if (isInformalUnit(ing.unit)) {
      if (!entry) missing.push({ ingredient_id: ing.ingredient_id, name: ing.name, needed: ing.quantity, available: 0, unit: ing.unit, category: "" });
      continue;
    }
    const scaled = scaleQuantity(ing.quantity, ing.scaling, factor, ing.unit);
    const available = entry?.quantity ?? 0;
    if (available < scaled) {
      missing.push({ ingredient_id: ing.ingredient_id, name: ing.name, needed: scaled, available, unit: ing.unit, category: "" });
    }
  }
  return c.json({ missing });
}
