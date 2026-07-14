import { describe, it, expect } from "vitest";
import { buildNutritionPrompt, buildNutritionInput } from "../worker/nutrition";
import type { Recipe } from "../shared/types";

describe("buildNutritionPrompt", () => {
  it("contains the weight hierarchy markers and evidence-base references", () => {
    const p = buildNutritionPrompt();
    for (const marker of ["35", "25", "20", "15", "5", "NOVA", "Conflict Resolution", "WHO"])
      expect(p).toContain(marker);
  });

  it("drops the interactive/output-format sections", () => {
    const p = buildNutritionPrompt();
    expect(p).not.toContain("Visual Analysis Strategy");
    expect(p).not.toContain("Worked Reference Examples");
    expect(p).not.toContain("Follow-Up Turn Protocol");
    expect(p).not.toContain("Error Handling");
  });

  it("appends the German recipe-input instruction", () => {
    const p = buildNutritionPrompt();
    expect(p).toContain("Der Input ist immer ein vollständiges Rezept");
    expect(p).toContain("Antworte in pros/cons auf Deutsch.");
  });
});

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 1, title: "Testsuppe", description: null, servings_base: 2,
    total_time_min: 30, active_time_min: 10, source: "manual", favorite: false,
    image_key: null, nutrition: null, created_at: "2026-01-01",
    tags: [], equipment: [],
    ingredients: [
      { position: 0, ingredient_id: 1, name: "Kartoffel", quantity: 200, unit: "g", scaling: "linear", note: null, section: null },
    ],
    steps: [],
    ...overrides,
  };
}

describe("buildNutritionInput", () => {
  it("divides quantities by servings_base", () => {
    const input = buildNutritionInput(makeRecipe());
    expect(input).toContain("100 g");
  });

  it("includes the recipe title", () => {
    const input = buildNutritionInput(makeRecipe());
    expect(input).toContain("Testsuppe");
  });

  it("passes informal units through as-is with a per-serving caveat", () => {
    const input = buildNutritionInput(makeRecipe({
      ingredients: [
        { position: 0, ingredient_id: 2, name: "Salz", quantity: 1, unit: "Prise", scaling: "fixed", note: null, section: null },
      ],
    }));
    expect(input).toContain("1 Prise Salz");
    expect(input).toContain("gesamt");
  });
});
