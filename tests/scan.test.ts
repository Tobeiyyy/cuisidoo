import { describe, expect, it } from "vitest";
import { toBase64 } from "../worker/scan";

describe("toBase64", () => {
  it("encodes an empty buffer", () => {
    expect(toBase64(new ArrayBuffer(0))).toBe("");
  });

  it("encodes a known byte sequence", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(toBase64(bytes.buffer)).toBe("AAEC/f7/");
  });

  it("handles a photo-sized buffer without blowing the call stack", () => {
    // ~400KB, the size of a typical downscaled receipt JPEG. A naive
    // String.fromCharCode(...allBytes) throws RangeError at this size.
    const bytes = new Uint8Array(400_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const decoded = atob(toBase64(bytes.buffer));
    expect(decoded.length).toBe(bytes.length);
    // Spot-check bytes across the chunk boundaries (chunk size is 0x8000).
    for (const i of [0, 1, 0x7fff, 0x8000, 0x8001, 200_000, 399_999]) {
      expect(decoded.charCodeAt(i)).toBe(bytes[i]);
    }
  });
});
