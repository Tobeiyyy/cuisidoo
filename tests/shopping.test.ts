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
    expect(subtractPantry(needs, new Map([[1, { quantity: 0.5, amountless: false }]]))[0].quantity).toBe(1.5);
    expect(subtractPantry(needs, new Map([[1, { quantity: 5, amountless: false }]]))).toHaveLength(0);
  });
  it("keeps informal items only when ingredient absent from pantry", () => {
    const needs = aggregateNeeds([{ servings: 2, servings_base: 2, ingredients: [salz] }]);
    expect(subtractPantry(needs, new Map())).toHaveLength(1);
    expect(subtractPantry(needs, new Map([[2, { quantity: 1, amountless: false }]]))).toHaveLength(0);
  });
});

describe("subtractPantry with amountless", () => {
  it("skips amountless items entirely", () => {
    const needs = aggregateNeeds([{ servings: 2, servings_base: 2, ingredients: [zwiebel] }]);
    const pantry = new Map([[1, { quantity: 0, amountless: true }]]);
    expect(subtractPantry(needs, pantry)).toHaveLength(0);
  });
  it("still subtracts tracked items", () => {
    const needs = aggregateNeeds([{ servings: 4, servings_base: 2, ingredients: [zwiebel] }]);
    const pantry = new Map([[1, { quantity: 0.5, amountless: false }]]);
    expect(subtractPantry(needs, pantry)[0].quantity).toBe(1.5);
  });
});
