import { describe, it, expect } from "vitest";
import { formatSeconds, formatTemp } from "../src/format";

describe("formatSeconds", () => {
  it("formats sub-minute durations in seconds", () => {
    expect(formatSeconds(10)).toBe("10 Sek");
  });
  it("formats whole-minute durations under an hour in minutes", () => {
    expect(formatSeconds(180)).toBe("3 Min");
  });
  it("formats mixed minutes and seconds", () => {
    expect(formatSeconds(65)).toBe("1 Min 5 Sek");
  });
  it("formats durations of an hour or more in hours and minutes", () => {
    expect(formatSeconds(4200)).toBe("1 Std 10 Min");
  });
  it("formats exactly one second", () => {
    expect(formatSeconds(1)).toBe("1 Sek");
  });
  it("formats exactly one hour with no remaining minutes", () => {
    expect(formatSeconds(3600)).toBe("1 Std");
  });
});

describe("formatTemp", () => {
  it("renders null as an em dash", () => {
    expect(formatTemp(null)).toBe("—");
  });
  it("renders a numeric temperature with degree celsius", () => {
    expect(formatTemp("90")).toBe("90°C");
  });
  it("renders Varoma as-is", () => {
    expect(formatTemp("Varoma")).toBe("Varoma");
  });
});
