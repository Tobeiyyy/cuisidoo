import { describe, it, expect } from "vitest";
import { normalizeName, matchIngredient } from "../worker/ingredients";

describe("normalizeName", () => {
  it("trims, collapses spaces, lowercases", () => {
    expect(normalizeName("  Rote   Zwiebel ")).toBe("rote zwiebel");
  });
});

describe("matchIngredient", () => {
  const byName = new Map([["zwiebel", 1], ["mehl", 2]]);
  const byAlias = new Map([["zwiebeln", 1], ["weizenmehl", 2]]);
  it("matches exact canonical name case-insensitively", () => {
    expect(matchIngredient("Zwiebel", byName, byAlias)).toBe(1);
  });
  it("matches via alias", () => {
    expect(matchIngredient("Zwiebeln", byName, byAlias)).toBe(1);
  });
  it("returns null when unknown", () => {
    expect(matchIngredient("Drachenfrucht", byName, byAlias)).toBeNull();
  });
});
