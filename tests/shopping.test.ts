import { describe, it, expect } from "vitest";
import { aggregateNeeds, subtractPantry } from "../worker/shopping";

const zwiebel = { ingredient_id: 1, name: "Zwiebel", category: "Gemüse & Obst",
  quantity: 1, unit: "Stück", scaling: "linear" as const, note: null, section: null, position: 0 };
const salz = { ingredient_id: 2, name: "Salz", category: "Gewürze",
  quantity: 1, unit: "Prise", scaling: "fixed" as const, note: null, section: null, position: 1 };

describe("aggregateNeeds", () => {
  it("scales by plan servings and sums across recipes", () => {
    const needs = aggregateNeeds([
      { servings: 4, servings_base: 2, ingredients: [zwiebel] },   // 1 * 2 = 2
      { servings: 2, servings_base: 2, ingredients: [zwiebel] },   // 1
    ]);
    expect(needs).toHaveLength(1);
    expect(needs[0].quantity).toBe(3);
  });
  it("flags informal units", () => {
    const needs = aggregateNeeds([{ servings: 2, servings_base: 2, ingredients: [salz] }]);
    expect(needs[0].informal).toBe(true);
  });
});

describe("subtractPantry", () => {
  it("subtracts stock and keeps positive remainders", () => {
    const needs = aggregateNeeds([{ servings: 4, servings_base: 2, ingredients: [zwiebel] }]); // 2
    expect(subtractPantry(needs, new Map([[1, 0.5]]))[0].quantity).toBe(1.5);
    expect(subtractPantry(needs, new Map([[1, 5]]))).toHaveLength(0);
  });
  it("keeps informal items only when ingredient absent from pantry", () => {
    const needs = aggregateNeeds([{ servings: 2, servings_base: 2, ingredients: [salz] }]);
    expect(subtractPantry(needs, new Map())).toHaveLength(1);
    expect(subtractPantry(needs, new Map([[2, 1]]))).toHaveLength(0);
  });
});
