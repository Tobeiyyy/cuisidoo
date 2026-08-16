import { describe, expect, it } from "vitest";
import { toBase64 } from "../worker/scan";

describe("toBase64", () => {
  it("encodes an empty buffer", () => {
    expect(toBase64(new ArrayBuffer(0))).toBe("");
  });

  it("matches Buffer's encoding for small input", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(toBase64(bytes.buffer)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("handles a photo-sized buffer without blowing the call stack", () => {
    // ~400KB, the size of a typical downscaled receipt JPEG. A naive
    // String.fromCharCode(...allBytes) throws RangeError at this size.
    const bytes = new Uint8Array(400_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    expect(toBase64(bytes.buffer)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
