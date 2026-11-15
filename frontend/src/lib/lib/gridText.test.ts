import { describe, expect, it } from "vitest";

import en from "../i18n/en.json";
import tr from "../i18n/tr.json";

describe("six-detector grid wording", () => {
  it("is labelled a band average with λ range and count, and makes no S/N claim", () => {
    for (const d of [tr.grid, en.grid]) {
      const all = Object.values(d).join(" ");
      expect(all).not.toMatch(/SNR|S\/N|√|\+%|%41/);
      expect(d.meta).toContain("{{min}}");
      expect(d.meta).toContain("{{max}}");
      expect(d.meta).toContain("{{n}}");
    }
    expect(tr.grid.label).toContain("bant ortalaması (dedektör başına)");
    expect(tr.grid.blurNote).toBe("Hareket eden cisimler ortalamada bulanır.");
  });

  it("the video keeps the exact interpolation note", () => {
    expect(tr.video.interpNote).toBe(
      "Görüntüleme için interpolasyon uygulandı. Gerçek çözünürlük 6.15″/piksel.",
    );
  });
});
