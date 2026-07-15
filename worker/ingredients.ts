import { Hono } from "hono";
import type { Env } from "./index";
import type { UnitDim } from "../shared/types";
import { qAll } from "./db";

export function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function matchIngredient(
  name: string, byName: Map<string, number>, byAlias: Map<string, number>,
): number | null {
  const n = normalizeName(name);
  return byName.get(n) ?? byAlias.get(n) ?? null;
}

export interface IngredientInput {
  name: string; category: string; unit_dim: UnitDim; grams_per_piece?: number | null;
}

/** exact → alias → auto-create. Returns map of input name → ingredient id. */
export async function resolveIngredients(
  db: D1Database, items: IngredientInput[],
): Promise<Map<string, number>> {
  const rows = await qAll<{ id: number; name: string }>(db.prepare("SELECT id, name FROM ingredients"));
  const aliases = await qAll<{ alias: string; ingredient_id: number }>(
    db.prepare("SELECT alias, ingredient_id FROM ingredient_aliases"));
  const byName = new Map(rows.map((r) => [normalizeName(r.name), r.id]));
  const byAlias = new Map(aliases.map((a) => [normalizeName(a.alias), a.ingredient_id]));

  const out = new Map<string, number>();
  for (const item of items) {
    let id = matchIngredient(item.name, byName, byAlias);
    if (id === null) {
      const res = await db
        .prepare("INSERT INTO ingredients (name, category, unit_dim, grams_per_piece) VALUES (?,?,?,?) RETURNING id")
        .bind(item.name.trim(), item.category, item.unit_dim, item.grams_per_piece ?? null)
        .first<{ id: number }>();
      id = res!.id;
      byName.set(normalizeName(item.name), id);
    }
    out.set(item.name, id);
  }
  return out;
}

export const ingredientRoutes = new Hono<{ Bindings: Env }>()
  .get("/", async (c) => {
    const items = await qAll(c.env.DB.prepare(
      "SELECT i.*, group_concat(a.alias, '|') AS aliases FROM ingredients i " +
      "LEFT JOIN ingredient_aliases a ON a.ingredient_id = i.id GROUP BY i.id ORDER BY i.name"));
    return c.json(items);
  })
  .put("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json<{ category?: string; unit_dim?: UnitDim; grams_per_piece?: number | null; addAlias?: string }>();
    if (body.category) await c.env.DB.prepare("UPDATE ingredients SET category=? WHERE id=?").bind(body.category, id).run();
    if (body.unit_dim) await c.env.DB.prepare("UPDATE ingredients SET unit_dim=? WHERE id=?").bind(body.unit_dim, id).run();
    if (body.grams_per_piece !== undefined)
      await c.env.DB.prepare("UPDATE ingredients SET grams_per_piece=? WHERE id=?").bind(body.grams_per_piece, id).run();
    if (body.addAlias)
      await c.env.DB.prepare("INSERT OR IGNORE INTO ingredient_aliases (alias, ingredient_id) VALUES (?,?)").bind(body.addAlias, id).run();
    return c.json({ ok: true });
  })
  .post("/", async (c) => {
    const { name, category, unit_dim, amountless } = await c.req.json<{
      name: string; category: string; unit_dim: UnitDim; amountless?: boolean;
    }>();
    if (!name?.trim()) return c.json({ error: "Name ist erforderlich" }, 400);
    if (!category?.trim()) return c.json({ error: "Kategorie ist erforderlich" }, 400);
    if (!["mass", "volume", "count"].includes(unit_dim)) {
      return c.json({ error: "Einheit muss mass, volume oder count sein" }, 400);
    }
    const existing = await c.env.DB.prepare(
      "SELECT id FROM ingredients WHERE LOWER(name) = LOWER(?)",
    ).bind(name.trim()).first();
    if (existing) return c.json({ error: "Zutat existiert bereits" }, 409);

    const res = await c.env.DB.prepare(
      "INSERT INTO ingredients (name, category, unit_dim) VALUES (?,?,?) RETURNING id",
    ).bind(name.trim(), category.trim(), unit_dim).first<{ id: number }>();
    const ingredientId = res!.id;

    const defaultQty = unit_dim === "count" ? 1 : 100;
    await c.env.DB.prepare(
      "INSERT INTO pantry (ingredient_id, quantity, amountless, updated_at) VALUES (?,?,?,datetime('now'))",
    ).bind(ingredientId, amountless ? 0 : defaultQty, amountless ? 1 : 0).run();

    return c.json({ id: ingredientId }, 201);
  });
