import { describe, expect, it } from "vitest";

import { placeLabels } from "./catalog";

describe("catalogue label placement", () => {
  it("never places a label outside the image (no clipped names)", () => {
    // marker at the right edge: the label must go left, not off the image
    const [p] = placeLabels([{ key: "a", text: "Barnard's star", x: 58, y: 30 }], 60, 60, 2, 1);
    expect(p.anchor).toBe("end");
    expect(p.x - 14 * 2 * 0.56).toBeGreaterThanOrEqual(0);
  });

  it("drops a label that cannot be placed without overlap", () => {
    const items = [
      { key: "a", text: "AAAAAAAAAA", x: 30, y: 30 },
      { key: "b", text: "BBBBBBBBBB", x: 30, y: 30 }, // same spot: takes another side
      { key: "c", text: "CCCCCCCCCC", x: 30, y: 30 },
      { key: "d", text: "DDDDDDDDDD", x: 30, y: 30 },
      { key: "e", text: "EEEEEEEEEE", x: 30, y: 30 }, // all four sides taken
    ];
    const out = placeLabels(items, 60, 60, 2, 1);
    expect(out.map((p) => p.key)).toEqual(["a", "b", "c", "d"]);
    expect(new Set(out.map((p) => p.anchor + p.y)).size).toBe(4);
  });
});
