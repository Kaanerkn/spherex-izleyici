import { describe, expect, it } from "vitest";

import { hasDeepLink, initialQuery } from "./entry";
import { pollDelayMs } from "./jobs";

describe("competition checklist helpers", () => {
  it("coordinates from the URL: ?q= and ?ra=&dec=", () => {
    expect(initialQuery("?q=10.684%20%2B41.269")).toBe("10.684 +41.269");
    expect(initialQuery("?ra=269.4461&dec=4.7707")).toBe("269.4461 4.7707");
    expect(initialQuery("?ra=269.4461")).toBe(""); // both are needed
    expect(hasDeepLink({ search: "?ra=1&dec=2", hash: "" } as Location)).toBe(true);
    expect(hasDeepLink({ search: "", hash: "" } as Location)).toBe(false);
  });

  it("job polling: fast at first, then a 15 s safety net while the socket is open", () => {
    expect([0, 1, 2, 3].map((i) => pollDelayMs(i, true))).toEqual([1500, 1500, 1500, 1500]);
    expect(pollDelayMs(4, true)).toBe(15_000);
    expect(pollDelayMs(40, false)).toBe(1500); // no socket: HTTP polling stays quick
  });
});
