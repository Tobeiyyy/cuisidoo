import { Hono } from "hono";
import type { Env } from "./index";
import type { Scaling, RecipeStep, UnitDim } from "../shared/types";
import { resolveIngredients, matchIngredient, normalizeName } from "./ingredients";
import { getFullRecipe, qAll } from "./db";
import { scoreHandler } from "./nutrition";
import { cookedHandler } from "./shopping";
import { UNITS } from "./prompt";

export interface RecipeSaveInput {
  title: string; description: string | null; servings_base: number;
  total_time_min: number | null; active_time_min: number | null;
  tags: string[]; equipment: string[];   // device names; matched to equipment table by name (create if missing, owned=0)
  ingredients: { name: string; category: string; unit_dim: UnitDim; grams_per_piece?: number | null;
                 quantity: number; unit: string; scaling: Scaling; note: string | null; section: string | null }[];
  steps: Omit<RecipeStep, "position">[];
}

const SCALINGS = ["linear", "damped", "fixed"];
const STEP_KINDS = ["tm6", "off_device"];

/**
 * Minimal shape validation shared by POST and PUT /api/recipes, run before any database write.
 * Returns a German 400 message on the first violation found, or null if the input is well-formed.
 * This is a structural check only (types/enums/presence) — semantic checks that need the DB
 * (e.g. unit-vs-ingredient-dimension) live in validateUnitDimensions below.
 */
export function validateRecipeInput(input: any): string | null {
  if (typeof input?.title !== "string" || !input.title.trim()) return "Titel ist erforderlich.";
  if (!Number.isInteger(input.servings_base) || input.servings_base < 1) {
    return "Portionen müssen eine ganze Zahl ≥ 1 sein.";
  }
  if (!Array.isArray(input.ingredients) || input.ingredients.length < 1) {
    return "Mindestens eine Zutat wird benötigt.";
  }
  if (!Array.isArray(input.steps) || input.steps.length < 1) {
    return "Mindestens ein Schritt wird benötigt.";
  }
  if (!Array.isArray(input.tags)) return "tags muss ein Array sein.";
  if (!Array.isArray(input.equipment)) return "equipment muss ein Array sein.";

  for (const ing of input.ingredients) {
    if (typeof ing?.name !== "string" || !ing.name.trim()) return "Jede Zutat benötigt einen Namen.";
    if (typeof ing.category !== "string" || !ing.category.trim()) return `Kategorie für "${ing.name}" fehlt.`;
    if (!(UNITS as readonly string[]).includes(ing.unit)) return `Ungültige Einheit für "${ing.name}".`;
    if (!Number.isFinite(ing.quantity) || ing.quantity <= 0) return `Menge für "${ing.name}" muss größer als 0 sein.`;
    if (!SCALINGS.includes(ing.scaling)) return `Ungültige Skalierung für "${ing.name}".`;
  }

  for (const step of input.steps) {
    if (!STEP_KINDS.includes(step?.kind)) return "Ungültige Schrittart.";
    if (typeof step.text !== "string" || !step.text.trim()) return "Jeder Schritt benötigt einen Text.";
    if (step.kind === "off_device" && (typeof step.device !== "string" || !step.device.trim())) {
      return "Externe Schritte benötigen ein Gerät.";
    }
  }

  return null;
}

const CANONICAL_UNIT_DIM: Record<string, UnitDim> = { g: "mass", ml: "volume", "Stück": "count" };

/**
 * Enforces that a canonical unit (g/ml/Stück) matches the ingredient's dimension: the catalog's
 * stored unit_dim for an existing ingredient (matched by name/alias), or the supplied unit_dim for
 * a brand-new one. Informal units (Prise, TL, …) are presence-only downstream and always pass.
 * Read-only (no writes), so it's safe to run before resolveIngredients' auto-create.
 */
export async function validateUnitDimensions(
  db: D1Database, ingredients: RecipeSaveInput["ingredients"],
): Promise<string | null> {
  const rows = await qAll<{ id: number; name: string; unit_dim: UnitDim }>(db.prepare("SELECT id, name, unit_dim FROM ingredients"));
  const aliases = await qAll<{ alias: string; ingredient_id: number }>(
    db.prepare("SELECT alias, ingredient_id FROM ingredient_aliases"));
  const dimById = new Map(rows.map((r) => [r.id, r.unit_dim]));
  const byName = new Map(rows.map((r) => [normalizeName(r.name), r.id]));
  const byAlias = new Map(aliases.map((a) => [normalizeName(a.alias), a.ingredient_id]));

  for (const ing of ingredients) {
    const expectedDim = CANONICAL_UNIT_DIM[ing.unit];
    if (!expectedDim) continue; // informal unit — no dimension constraint
    const matchedId = matchIngredient(ing.name, byName, byAlias);
    const actualDim = matchedId !== null ? dimById.get(matchedId)! : ing.unit_dim;
    if (actualDim !== expectedDim) {
      return `Einheit "${ing.unit}" passt nicht zur Dimension von "${ing.name}".`;
    }
  }
  return null;
}

async function replaceChildren(
  db: D1Database, recipeId: number, input: RecipeSaveInput, extraStmts: D1PreparedStatement[] = [],
) {
  const ids = await resolveIngredients(db, input.ingredients);
  const stmts: D1PreparedStatement[] = [
    ...extraStmts,
    db.prepare("DELETE FROM recipe_ingredients WHERE recipe_id=?").bind(recipeId),
    db.prepare("DELETE FROM recipe_steps WHERE recipe_id=?").bind(recipeId),
    db.prepare("DELETE FROM recipe_tags WHERE recipe_id=?").bind(recipeId),
    db.prepare("DELETE FROM recipe_equipment WHERE recipe_id=?").bind(recipeId),
  ];
  input.ingredients.forEach((ing, i) => stmts.push(db.prepare(
    "INSERT INTO recipe_ingredients (recipe_id, position, ingredient_id, quantity, unit, scaling, note, section) VALUES (?,?,?,?,?,?,?,?)",
  ).bind(recipeId, i, ids.get(ing.name)!, ing.quantity, ing.unit, ing.scaling, ing.note, ing.section)));
  input.steps.forEach((s, i) => stmts.push(db.prepare(
    "INSERT INTO recipe_steps (recipe_id, position, kind, text, seconds, temp, speed, reverse, mode, accessory, device) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(recipeId, i, s.kind, s.text, s.seconds, s.temp, s.speed, s.reverse ? 1 : 0, s.mode, s.accessory, s.device)));
  for (const tag of input.tags) stmts.push(
    db.prepare("INSERT INTO recipe_tags (recipe_id, tag) VALUES (?,?)").bind(recipeId, tag));
  for (const name of input.equipment) {
    await db.prepare("INSERT OR IGNORE INTO equipment (name, owned) VALUES (?, 0)").bind(name).run();
    stmts.push(db.prepare(
      "INSERT INTO recipe_equipment (recipe_id, equipment_id) SELECT ?, id FROM equipment WHERE name=?",
    ).bind(recipeId, name));
  }
  await db.batch(stmts);
}

export async function saveRecipe(db: D1Database, input: RecipeSaveInput, source: "generated" | "manual"): Promise<number> {
  const res = await db.prepare(
    "INSERT INTO recipes (title, description, servings_base, total_time_min, active_time_min, source) VALUES (?,?,?,?,?,?) RETURNING id",
  ).bind(input.title, input.description, input.servings_base, input.total_time_min, input.active_time_min, source)
    .first<{ id: number }>();
  await replaceChildren(db, res!.id, input);
  return res!.id;
}

export const recipeRoutes = new Hono<{ Bindings: Env }>()
  .get("/", async (c) => {
    const { q, tag, favorite, cookable } = c.req.query();
    let sql =
      "SELECT r.id, r.title, r.total_time_min, r.favorite, r.image_key, " +
      "(SELECT group_concat(tag, '|') FROM recipe_tags t WHERE t.recipe_id = r.id) AS tags, " +
      "NOT EXISTS (SELECT 1 FROM recipe_equipment re JOIN equipment e ON e.id=re.equipment_id " +
      "            WHERE re.recipe_id = r.id AND e.owned = 0) AS cookable " +
      "FROM recipes r WHERE 1=1";
    const binds: unknown[] = [];
    if (q) { sql += " AND r.title LIKE ?"; binds.push(`%${q}%`); }
    if (tag) { sql += " AND EXISTS (SELECT 1 FROM recipe_tags t WHERE t.recipe_id=r.id AND t.tag=?)"; binds.push(tag); }
    if (favorite === "1") sql += " AND r.favorite = 1";
    if (cookable === "1") sql += " AND cookable = 1";
    sql += " ORDER BY r.created_at DESC";
    const rows = await qAll<any>(c.env.DB.prepare(sql).bind(...binds));
    return c.json(rows.map((r) => ({ ...r, favorite: !!r.favorite, cookable: !!r.cookable,
      tags: r.tags ? String(r.tags).split("|") : [] })));
  })
  .get("/:id", async (c) => {
    const r = await getFullRecipe(c.env.DB, Number(c.req.param("id")));
    return r ? c.json(r) : c.json({ error: "not found" }, 404);
  })
  .post("/", async (c) => {
    const source = c.req.query("source");
    if (source !== undefined && source !== "manual" && source !== "generated") {
      return c.json({ error: "source muss 'manual' oder 'generated' sein." }, 400);
    }
    const input = await c.req.json<RecipeSaveInput>();
    const shapeError = validateRecipeInput(input);
    if (shapeError) return c.json({ error: shapeError }, 400);
    const dimError = await validateUnitDimensions(c.env.DB, input.ingredients);
    if (dimError) return c.json({ error: dimError }, 400);
    const id = await saveRecipe(c.env.DB, input, (source as "manual" | "generated" | undefined) ?? "manual");
    return c.json({ id }, 201);
  })
  .put("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const input = await c.req.json<RecipeSaveInput>();
    const shapeError = validateRecipeInput(input);
    if (shapeError) return c.json({ error: shapeError }, 400);
    const dimError = await validateUnitDimensions(c.env.DB, input.ingredients);
    if (dimError) return c.json({ error: dimError }, 400);
    // Header UPDATE only runs (as part of the same batch as replaceChildren's statements) once
    // validation has passed, so a rejected save can never leave the header updated while the
    // ingredients/steps/tags/equipment rows are left stale or partially replaced.
    const headerStmt = c.env.DB.prepare(
      "UPDATE recipes SET title=?, description=?, servings_base=?, total_time_min=?, active_time_min=? WHERE id=?",
    ).bind(input.title, input.description, input.servings_base, input.total_time_min, input.active_time_min, id);
    await replaceChildren(c.env.DB, id, input, [headerStmt]);
    return c.json({ ok: true });
  })
  .delete("/:id", async (c) => {
    await c.env.DB.prepare("DELETE FROM recipes WHERE id=?").bind(Number(c.req.param("id"))).run();
    return c.json({ ok: true });
  })
  .patch("/:id/favorite", async (c) => {
    const { favorite } = await c.req.json<{ favorite: boolean }>();
    await c.env.DB.prepare("UPDATE recipes SET favorite=? WHERE id=?")
      .bind(favorite ? 1 : 0, Number(c.req.param("id"))).run();
    return c.json({ ok: true });
  })
  .post("/:id/score", scoreHandler)
  .post("/:id/cooked", cookedHandler)
  .post("/:id/image", async (c) => {
    const id = Number(c.req.param("id"));
    const recipe = await c.env.DB.prepare("SELECT image_key FROM recipes WHERE id=?").bind(id)
      .first<{ image_key: string | null }>();
    if (!recipe) return c.json({ error: "not found" }, 404);
    const contentType = c.req.header("content-type") ?? "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      return c.json({ error: "unsupported content type" }, 415);
    }
    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (contentLength > 5 * 1024 * 1024) return c.json({ error: "file too large" }, 413);
    const body = await c.req.arrayBuffer();
    if (body.byteLength > 5 * 1024 * 1024) return c.json({ error: "file too large" }, 413);
    // Version the key so replacing a photo produces a new URL — GET /api/images/* serves
    // objects with an immutable cache-control, so reusing the same key would leave clients
    // (and the CDN) stuck showing the old bytes after a re-upload.
    const oldKey = recipe.image_key;
    const key = `recipes/${id}-${Date.now()}`;
    await c.env.BUCKET.put(key, body, { httpMetadata: { contentType } });
    await c.env.DB.prepare("UPDATE recipes SET image_key=? WHERE id=?").bind(key, id).run();
    if (oldKey) {
      try {
        await c.env.BUCKET.delete(oldKey);
      } catch (err) {
        // Orphaned R2 object is acceptable; a broken image display is not — never fail the
        // upload because cleanup of the previous object didn't succeed.
        console.error("failed to delete old recipe image", oldKey, err);
      }
    }
    return c.json({ image_key: key });
  })
  .delete("/:id/image", async (c) => {
    const id = Number(c.req.param("id"));
    const recipe = await c.env.DB.prepare("SELECT image_key FROM recipes WHERE id=?").bind(id)
      .first<{ image_key: string | null }>();
    if (!recipe) return c.json({ error: "not found" }, 404);
    if (recipe.image_key) await c.env.BUCKET.delete(recipe.image_key);
    await c.env.DB.prepare("UPDATE recipes SET image_key=NULL WHERE id=?").bind(id).run();
    return c.json({ ok: true });
  });
