export type UnitDim = "mass" | "volume" | "count";
export type Scaling = "linear" | "damped" | "fixed";
export type StepKind = "tm6" | "off_device";

export interface Ingredient {
  id: number; name: string; category: string;
  unit_dim: UnitDim; grams_per_piece: number | null;
}
export interface RecipeIngredient {
  position: number; ingredient_id: number;
  name: string;              // joined canonical name (read); on write the name is used for matching
  quantity: number; unit: string; scaling: Scaling;
  note: string | null; section: string | null;
}
export interface RecipeStep {
  position: number; kind: StepKind; text: string;
  seconds: number | null; temp: string | null; speed: string | null;
  reverse: boolean; mode: string | null; accessory: string | null; device: string | null;
}
export interface Recipe {
  id: number; title: string; description: string | null;
  servings_base: number; total_time_min: number | null; active_time_min: number | null;
  source: "generated" | "manual"; favorite: boolean; image_key: string | null;
  nutrition: NutritionScore | null; created_at: string;
  tags: string[]; ingredients: RecipeIngredient[]; steps: RecipeStep[];
  equipment: string[];       // required equipment names beyond TM6
}
export interface NutritionScore {
  score: number; tier: string; kcal_per_serving: number;
  pros: string[]; cons: string[];
}
// Draft shapes returned by generation (no ids yet)
export interface RecipeDraft extends Omit<Recipe, "id" | "created_at" | "favorite" | "image_key" | "nutrition" | "ingredients"> {
  ingredients: Omit<RecipeIngredient, "position" | "ingredient_id">[];
}
export const INFORMAL_UNITS = ["Prise", "TL", "EL", "Spritzer", "Msp."] as const;
export function isInformalUnit(unit: string): boolean {
  return (INFORMAL_UNITS as readonly string[]).includes(unit);
}
