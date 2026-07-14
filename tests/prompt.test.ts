import { describe, it, expect } from "vitest";
import { buildSystemPrompt, SAVE_RECIPE_TOOL } from "../worker/prompt";

const base = {
  equipmentOwned: ["Backofen", "Kühlschrank"],
  dietBias: "Muskelaufbau", canonicalNames: ["Zwiebel", "Mehl"], extraGeraeteErlaubt: false,
};

describe("buildSystemPrompt", () => {
  it("contains the full TM6 capability spec", () => {
    const p = buildSystemPrompt(base);
    for (const s of ["0,5 bis 10", "Turbo", "37", "160", "Varoma", "Linkslauf", "Teigstufe",
      "Slow Cooking", "Sous-vide", "Fermentieren", "Gareinsatz", "Gemüse-Styler", "ZWEI Messbecher"])
      expect(p).toContain(s);
  });
  it("lists owned equipment and forbids others", () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain("Backofen");
    expect(p).toContain("TM6 als einziges Kochgerät");
  });
  it("relaxes TM6-only rule when extra devices allowed", () => {
    const p = buildSystemPrompt({ ...base, extraGeraeteErlaubt: true });
    expect(p).toContain("dürfen verwendet werden");
  });
  it("includes diet bias and canonical names", () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain("Muskelaufbau");
    expect(p).toContain("Zwiebel");
  });
});

describe("SAVE_RECIPE_TOOL", () => {
  it("is strict with closed schemas", () => {
    expect(SAVE_RECIPE_TOOL.strict).toBe(true);
    expect(SAVE_RECIPE_TOOL.input_schema.additionalProperties).toBe(false);
  });
});

// These lists ARE the contract between worker/recipes.ts's RecipeSaveInput and the tool schema
// the model is asked to fill in — hard-coded here (rather than derived from the type) so a schema
// edit that silently drifts from RecipeSaveInput's fields fails this test instead of shipping.
describe("SAVE_RECIPE_TOOL mirrors RecipeSaveInput", () => {
  const EXPECTED_TOP_LEVEL = [
    "title", "description", "servings_base", "total_time_min", "active_time_min",
    "tags", "equipment", "ingredients", "steps",
  ];
  const EXPECTED_INGREDIENT = [
    "name", "category", "unit_dim", "grams_per_piece", "quantity", "unit", "scaling", "note", "section",
  ];
  const EXPECTED_STEP = [
    "kind", "text", "seconds", "temp", "speed", "reverse", "mode", "accessory", "device",
  ];

  it("has top-level property keys matching RecipeSaveInput", () => {
    const keys = Object.keys(SAVE_RECIPE_TOOL.input_schema.properties);
    expect(keys.sort()).toEqual([...EXPECTED_TOP_LEVEL].sort());
  });
  it("has ingredient item property keys matching RecipeSaveInput['ingredients'][number]", () => {
    const keys = Object.keys(SAVE_RECIPE_TOOL.input_schema.properties.ingredients.items.properties);
    expect(keys.sort()).toEqual([...EXPECTED_INGREDIENT].sort());
  });
  it("has step item property keys matching RecipeSaveInput['steps'][number]", () => {
    const keys = Object.keys(SAVE_RECIPE_TOOL.input_schema.properties.steps.items.properties);
    expect(keys.sort()).toEqual([...EXPECTED_STEP].sort());
  });
});
