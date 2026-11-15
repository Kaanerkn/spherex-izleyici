// Catalogue overlay (AllWISE, 2MASS, SIMBAD) returned by POST /compare/catalog, and label placement.

export type CatalogItem = {
  key: string;
  cat: "AllWISE" | "2MASS" | "SIMBAD";
  id: string;
  label: string;
  full_name: string;
  otype: string | null;
  ra: number;
  dec: number;
  px: [number, number];
  mag: number | null;
  band: string | null;
  epoch: "moved" | "catalog";
  sep_arcsec: number;
  labelled?: boolean;
};

export type CatalogLayer = {
  items: CatalogItem[];
  max_labels: number;
  errors: string[];
  sources: Record<string, string>;
  allwise_epoch: number;
};

export const CAT_COLOR: Record<CatalogItem["cat"], string> = {
  AllWISE: "#86efac",
  "2MASS": "#fdba74",
  SIMBAD: "#f9a8d4",
};

export type PlacedLabel = {
  key: string;
  text: string;
  x: number;
  y: number;
  anchor: "start" | "end" | "middle";
};

type Box = [number, number, number, number]; // x0, y0, x1, y1

/** Greedy label placement in screen-space viewBox units (y down). Each label tries right, left, above,
 *  below its marker; a label is kept only if it lies fully inside the image (never clipped) and does not
 *  overlap one already placed. Labels that do not fit are dropped (the name is still shown on hover). */
export function placeLabels(
  items: { key: string; text: string; x: number; y: number }[],
  w: number,
  h: number,
  fontSize: number,
  gap: number,
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const boxes: Box[] = [];
  const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  for (const it of items) {
    const tw = it.text.length * fontSize * 0.56;
    const th = fontSize;
    const options: { b: Box; x: number; y: number; anchor: PlacedLabel["anchor"] }[] = [
      {
        b: [it.x + gap, it.y - th / 2, it.x + gap + tw, it.y + th / 2],
        x: it.x + gap,
        y: it.y + th * 0.35,
        anchor: "start",
      },
      {
        b: [it.x - gap - tw, it.y - th / 2, it.x - gap, it.y + th / 2],
        x: it.x - gap,
        y: it.y + th * 0.35,
        anchor: "end",
      },
      {
        b: [it.x - tw / 2, it.y - gap - th, it.x + tw / 2, it.y - gap],
        x: it.x,
        y: it.y - gap - th * 0.15,
        anchor: "middle",
      },
      {
        b: [it.x - tw / 2, it.y + gap, it.x + tw / 2, it.y + gap + th],
        x: it.x,
        y: it.y + gap + th * 0.85,
        anchor: "middle",
      },
    ];
    const ok = options.find(
      (o) => o.b[0] >= 0 && o.b[1] >= 0 && o.b[2] <= w && o.b[3] <= h && !boxes.some((b) => hit(b, o.b)),
    );
    if (!ok) continue;
    boxes.push(ok.b);
    placed.push({ key: it.key, text: it.text, x: ok.x, y: ok.y, anchor: ok.anchor });
  }
  return placed;
}
