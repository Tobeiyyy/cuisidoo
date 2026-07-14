import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "../worker/auth";

describe("auth token", () => {
  it("round-trips a valid token", async () => {
    const t = await signToken("secret", Date.now() + 10_000);
    expect(await verifyToken("secret", t)).toBe(true);
  });
  it("rejects a tampered token", async () => {
    const t = await signToken("secret", Date.now() + 10_000);
    expect(await verifyToken("secret", t + "x")).toBe(false);
  });
  it("rejects wrong secret", async () => {
    const t = await signToken("secret", Date.now() + 10_000);
    expect(await verifyToken("other", t)).toBe(false);
  });
  it("rejects expired token", async () => {
    const t = await signToken("secret", Date.now() - 1);
    expect(await verifyToken("secret", t)).toBe(false);
  });
  it("rejects garbage", async () => {
    expect(await verifyToken("secret", "not.a.token")).toBe(false);
  });
});
