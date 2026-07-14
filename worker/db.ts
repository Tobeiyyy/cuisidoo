import type { Recipe, RecipeIngredient, RecipeStep } from "../shared/types";

export async function qAll<T>(stmt: D1PreparedStatement): Promise<T[]> {
  const { results } = await stmt.all<T>();
  return results ?? [];
}

export async function getFullRecipe(db: D1Database, id: number): Promise<Recipe | null> {
  const r = await db.prepare("SELECT * FROM recipes WHERE id=?").bind(id).first<any>();
  if (!r) return null;
  const ingredients = await qAll<RecipeIngredient>(db.prepare(
    "SELECT ri.position, ri.ingredient_id, i.name, ri.quantity, ri.unit, ri.scaling, ri.note, ri.section " +
    "FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id " +
    "WHERE ri.recipe_id=? ORDER BY ri.position").bind(id));
  const stepsRaw = await qAll<any>(db.prepare(
    "SELECT position, kind, text, seconds, temp, speed, reverse, mode, accessory, device " +
    "FROM recipe_steps WHERE recipe_id=? ORDER BY position").bind(id));
  const steps: RecipeStep[] = stepsRaw.map((s) => ({ ...s, reverse: !!s.reverse }));
  const tags = (await qAll<{ tag: string }>(
    db.prepare("SELECT tag FROM recipe_tags WHERE recipe_id=?").bind(id))).map((t) => t.tag);
  const equipment = (await qAll<{ name: string }>(db.prepare(
    "SELECT e.name FROM recipe_equipment re JOIN equipment e ON e.id=re.equipment_id WHERE re.recipe_id=?",
  ).bind(id))).map((e) => e.name);
  return {
    id: r.id, title: r.title, description: r.description, servings_base: r.servings_base,
    total_time_min: r.total_time_min, active_time_min: r.active_time_min, source: r.source,
    favorite: !!r.favorite, image_key: r.image_key,
    nutrition: r.nutrition_json ? JSON.parse(r.nutrition_json) : null,
    created_at: r.created_at, tags, ingredients, steps, equipment,
  };
}
