import { describe, it, expect } from "vitest";
import { formatSeconds, formatTemp, mondayOf, addDays, formatISODate, formatDayLabel, weekRangeLabel } from "../src/format";

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

describe("mondayOf", () => {
  it("steps back to Monday from a mid-week date", () => {
    expect(formatISODate(mondayOf(new Date(2026, 6, 14)))).toBe("2026-07-13"); // Tue -> Mon
  });
  it("steps back across a month boundary", () => {
    expect(formatISODate(mondayOf(new Date(2026, 6, 1)))).toBe("2026-06-29"); // Wed Jul 1 -> Mon Jun 29
  });
  it("treats Sunday as the last day of its week (not the start of the next)", () => {
    expect(formatISODate(mondayOf(new Date(2026, 0, 4)))).toBe("2025-12-29"); // Sun -> Mon of same week
  });
  it("is a no-op when the date is already a Monday", () => {
    expect(formatISODate(mondayOf(new Date(2026, 6, 13)))).toBe("2026-07-13");
  });
});

describe("addDays", () => {
  it("adds days within a month", () => {
    expect(formatISODate(addDays(new Date(2026, 6, 13), 3))).toBe("2026-07-16");
  });
  it("rolls forward across a month boundary", () => {
    expect(formatISODate(addDays(new Date(2026, 6, 29), 3))).toBe("2026-08-01");
  });
  it("supports negative offsets", () => {
    expect(formatISODate(addDays(new Date(2026, 6, 1), -2))).toBe("2026-06-29");
  });
});

describe("formatDayLabel", () => {
  it("formats a day with abbreviated German month", () => {
    expect(formatDayLabel(new Date(2026, 6, 14))).toBe("14. Jul");
  });
  it("formats single-digit days without zero padding", () => {
    expect(formatDayLabel(new Date(2026, 6, 1))).toBe("1. Jul");
  });
});

describe("weekRangeLabel", () => {
  it("formats a week within a single month using the full month name", () => {
    expect(weekRangeLabel(new Date(2026, 6, 13))).toBe("13.–19. Juli");
  });
  it("formats a week spanning two months using abbreviated names", () => {
    expect(weekRangeLabel(new Date(2026, 6, 27))).toBe("27. Jul – 2. Aug 2026");
  });
});
