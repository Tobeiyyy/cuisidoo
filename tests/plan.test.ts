import { describe, it, expect } from "vitest";
import { isValidISODate } from "../worker/plan";

describe("isValidISODate", () => {
  it("accepts a valid calendar date", () => {
    expect(isValidISODate("2026-07-13")).toBe(true);
  });
  it("rejects an impossible month and day", () => {
    expect(isValidISODate("2026-13-45")).toBe(false);
  });
  it("rejects a day that doesn't exist in the given month", () => {
    expect(isValidISODate("2026-02-30")).toBe(false);
  });
});
