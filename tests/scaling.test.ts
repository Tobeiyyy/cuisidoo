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
  it("scales count with quarter-piece precision", () => {
    expect(scaleQuantity(1, "linear", 1.5, "Stück")).toBe(1.5);
    expect(scaleQuantity(1, "linear", 0.75, "Stück")).toBe(0.75);  // base 4 -> 3 portions
    expect(scaleQuantity(1, "linear", 0.25, "Stück")).toBe(0.25);  // base 4 -> 1 portion
    expect(scaleQuantity(3, "linear", 0.25, "Stück")).toBe(0.75);
    expect(scaleQuantity(2, "linear", 0.5, "Stück")).toBe(1);
    expect(scaleQuantity(1, "linear", 0.1, "Stück")).toBe(0.25); // never below a quarter piece
  });
});

describe("roundQuantity", () => {
  it("rounds mass >= 100 to 5g steps", () => expect(roundQuantity(233, "g")).toBe(235));
  it("rounds mass < 100 to 1g", () => expect(roundQuantity(33.4, "g")).toBe(33));
  it("rounds ml like g", () => expect(roundQuantity(151, "ml")).toBe(150));
  it("rounds pieces to quarters", () => expect(roundQuantity(1.3, "Stück")).toBe(1.25));
});
