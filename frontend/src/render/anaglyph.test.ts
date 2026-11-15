import { beforeAll, describe, expect, it } from "vitest";

import { renderAnaglyph } from "./image";

beforeAll(() => {
  // jsdom has no ImageData; a minimal stand-in is enough for pixel checks
  if (typeof globalThis.ImageData === "undefined") {
    class FakeImageData {
      data: Uint8ClampedArray;
      constructor(
        public width: number,
        public height: number,
      ) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    }
    (globalThis as unknown as { ImageData: typeof FakeImageData }).ImageData = FakeImageData;
  }
});

describe("cyan–red anaglyph", () => {
  it("puts the first frame in red and the second in cyan; masked pixels stay grey", () => {
    // 3 pixels in one row: only in A, only in B, masked in B
    const a = new Float32Array([1, 0, 1]);
    const b = new Float32Array([0, 1, NaN]);
    const px = renderAnaglyph(a, b, 3, 1, [0, 1], "linear").data;
    expect([px[0], px[1], px[2]]).toEqual([255, 0, 0]); // red: present only in the first frame
    expect([px[4], px[5], px[6]]).toEqual([0, 255, 255]); // cyan: only in the second
    expect([px[8], px[9], px[10]]).toEqual([40, 42, 52]); // masked
  });

  it("an unchanged source is neutral (equal R, G, B)", () => {
    const v = new Float32Array([0.5]);
    const px = renderAnaglyph(v, v, 1, 1, [0, 1], "asinh").data;
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
  });
});
