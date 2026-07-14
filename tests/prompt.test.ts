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
