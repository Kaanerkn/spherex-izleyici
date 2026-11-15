// Shareable state of the workspace in the URL. Reading ignores anything invalid (falls back to defaults);
// existing parameters (?q, ?ra&dec, ?d, compare=1) keep their meaning.

export const SIZES = [0.05, 0.1, 0.25, 0.5];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ShareState = {
  q: string;
  d: number;
  fov: number;
  ta?: string | null; // YYYY-MM-DD of exposure A
  tb?: string | null; // YYYY-MM-DD of exposure B
  compare?: boolean;
};

/** ?fov=<deg>: only one of the offered cutout sizes; anything else -> null (default kept). */
export function readFov(search: string): number | null {
  const v = Number(new URLSearchParams(search).get("fov"));
  return SIZES.includes(v) ? v : null;
}

/** ?ta= / ?tb=: exposure dates (YYYY-MM-DD) to pre-select; anything else -> null. */
export function readDate(search: string, key: "ta" | "tb"): string | null {
  const v = new URLSearchParams(search).get(key)?.trim() ?? "";
  return DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
}

export function shareUrl(s: ShareState, base: string = window.location.origin + window.location.pathname) {
  const p = new URLSearchParams();
  p.set("q", s.q);
  p.set("d", String(s.d));
  p.set("fov", String(s.fov));
  if (s.ta) p.set("ta", s.ta);
  if (s.tb) p.set("tb", s.tb);
  if (s.compare) p.set("compare", "1");
  return `${base}?${p.toString()}`;
}
