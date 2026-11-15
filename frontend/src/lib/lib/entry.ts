// Welcome-screen choice: remembered for this browser tab's session only (sessionStorage), never across visits.
const KEY = "spx:entered";
const DEEP_HASHES = new Set(["#admin", "#kaynaklar"]);

export const entryChoice = {
  get(): boolean {
    try {
      return window.sessionStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  },
  set(): void {
    try {
      window.sessionStorage.setItem(KEY, "1");
    } catch {
      /* storage blocked: the screen simply shows again next time */
    }
  },
  clear(): void {
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};

/** Search text from a shareable link: ?q=<name or coordinates>, or ?ra=<deg>&dec=<deg>. */
export function initialQuery(search: string): string {
  const p = new URLSearchParams(search);
  const q = p.get("q");
  if (q) return q;
  const ra = p.get("ra")?.trim();
  const dec = p.get("dec")?.trim();
  return ra && dec ? `${ra} ${dec}` : "";
}

/** Object links (?q=… or ?ra=&dec=), shared comparisons (?q=&d=&compare=1) and #admin / #kaynaklar
 *  skip the screen. */
export function hasDeepLink(loc: Location = window.location): boolean {
  return initialQuery(loc.search) !== "" || DEEP_HASHES.has(loc.hash);
}
