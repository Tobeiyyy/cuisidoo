import { describe, it, expect } from "vitest";
import { scaleQuantity, roundQuantity } from "../shared/scaling";

describe("scaleQuantity", () => {
  it("scales linear proportionally", () => {
    expect(scaleQuantity(200, "linear", 2, "g")).toBe(400);
  });
  it("dampens seasoning with factor^0.6", () => {
    // 10 g chili, doubled: 10 * 2^0.6 ≈ 15.16 → rounded to 15
    expect(scaleQuantity(10, "damped", 2, "g")).toBe(15);
  });
  it("keeps fixed unchanged", () => {
    expect(scaleQuantity(500, "fixed", 3, "ml")).toBe(500);
  });
  it("keeps informal units unchanged regardless of scaling", () => {
    expect(scaleQuantity(1, "linear", 4, "Prise")).toBe(1);
  });
  it("rounds count to whole pieces", () => {
    expect(scaleQuantity(1, "linear", 1.5, "Stück")).toBe(2);
  });
});

describe("roundQuantity", () => {
  it("rounds mass >= 100 to 5g steps", () => expect(roundQuantity(233, "g")).toBe(235));
  it("rounds mass < 100 to 1g", () => expect(roundQuantity(33.4, "g")).toBe(33));
  it("rounds ml like g", () => expect(roundQuantity(151, "ml")).toBe(150));
  it("rounds pieces up to halves", () => expect(roundQuantity(1.3, "Stück")).toBe(1.5));
});
