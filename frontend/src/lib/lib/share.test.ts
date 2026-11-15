import { describe, expect, it } from "vitest";

import { initialQuery } from "./entry";
import { readDate, readFov, shareUrl } from "./share";

describe("shareable link", () => {
  it("reads fov only from the offered sizes and ignores anything else", () => {
    expect(readFov("?q=M31&fov=0.25")).toBe(0.25);
    expect(readFov("?fov=0.3")).toBeNull();
    expect(readFov("?fov=abc")).toBeNull();
    expect(readFov("")).toBeNull();
  });

  it("reads exposure dates and rejects malformed ones", () => {
    expect(readDate("?ta=2025-08-25", "ta")).toBe("2025-08-25");
    expect(readDate("?ta=2025-13-45", "ta")).toBeNull();
    expect(readDate("?tb=yesterday", "tb")).toBeNull();
  });

  it("builds a link that the existing readers understand", () => {
    const url = shareUrl(
      { q: "Barnard's Star", d: 6, fov: 0.25, ta: "2025-08-25", tb: "2026-09-22", compare: true },
      "https://x.example/",
    );
    const search = new URL(url).search;
    expect(initialQuery(search)).toBe("Barnard's Star");
    expect(readFov(search)).toBe(0.25);
    expect(readDate(search, "tb")).toBe("2026-09-22");
    expect(new URLSearchParams(search).get("d")).toBe("6");
    expect(new URLSearchParams(search).get("compare")).toBe("1");
    expect(shareUrl({ q: "M31", d: 2, fov: 0.1 }, "https://x.example/")).not.toContain("compare");
  });
});
