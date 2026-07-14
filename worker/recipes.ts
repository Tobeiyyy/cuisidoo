import { Hono } from "hono";
import type { Env } from "./index";
import type { Scaling, RecipeStep, UnitDim } from "../shared/types";
import { resolveIngredients } from "./ingredients";
import { getFullRecipe, qAll } from "./db";

export interface RecipeSaveInput {
  title: string; description: string | null; servings_base: number;
  total_time_min: number | null; active_time_min: number | null;
  tags: string[]; equipment: string[];   // device names; matched to equipment table by name (create if missing, owned=0)
  ingredients: { name: string; category: string; unit_dim: UnitDim; grams_per_piece?: number | null;
                 quantity: number; unit: string; scaling: Scaling; note: string | null; section: string | null }[];
  steps: Omit<RecipeStep, "position">[];
}

async function replaceChildren(db: D1Database, recipeId: number, input: RecipeSaveInput) {
  const ids = await resolveIngredients(db, input.ingredients);
  const stmts: D1PreparedStatement[] = [
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
    const input = await c.req.json<RecipeSaveInput>();
    const id = await saveRecipe(c.env.DB, input, (c.req.query("source") as any) ?? "manual");
    return c.json({ id }, 201);
  })
  .put("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const input = await c.req.json<RecipeSaveInput>();
    await c.env.DB.prepare(
      "UPDATE recipes SET title=?, description=?, servings_base=?, total_time_min=?, active_time_min=? WHERE id=?",
    ).bind(input.title, input.description, input.servings_base, input.total_time_min, input.active_time_min, id).run();
    await replaceChildren(c.env.DB, id, input);
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
  });
