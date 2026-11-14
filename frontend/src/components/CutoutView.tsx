import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CutoutResult } from "../lib/api";
import { CAT_COLOR, placeLabels, type CatalogItem } from "../lib/catalog";
import { renderAnaglyph, renderImage, type Colormap, type Stretch } from "../render/image";

export interface DecodedCutout {
  raw: Pick<CutoutResult, "width" | "height"> & { meta: ViewMeta };
  data: Float32Array;
  lambda: Float32Array | null;
}

export type ViewMeta = Pick<
  CutoutResult["meta"],
  "unit" | "target_px" | "wavelength_um" | "date_obs" | "north_deg" | "east_deg" | "pixel_scale_arcsec"
>;

interface Props {
  cutout: DecodedCutout;
  data?: Float32Array; // override (e.g. difference image on the same grid)
  limits: [number, number];
  stretch: Stretch;
  cmap: Colormap | "diverging";
  label?: string;
  unit?: string;
  showOverlays?: boolean;
  track?: MotionTrack | null;
  gaia?: GaiaOverlay | null;
  /** Second epoch on the same grid: renders red (cutout) / cyan (anaglyphB) instead of the colormap. */
  anaglyphB?: Float32Array | null;
  catalog?: CatalogOverlay | null;
}

/** AllWISE / 2MASS / SIMBAD markers on A's grid, with collision-free name labels for the brightest. */
export type CatalogOverlay = {
  items: CatalogItem[];
  showLabels: boolean;
  highlight: string | null;
  onHover?: (key: string | null) => void;
};

/** Gaia DR3 candidate markers and the target's parallax-corrected expected positions (pixels of A). */
export type GaiaOverlay = {
  markers: { source_id: string; px: [number, number] }[];
  expected?: { label: string; px: [number, number] }[];
};

/** Expected positions from the known motion (server, A's grid) and the measured centroids. */
export type MotionTrack = {
  expected: { label: string; mjd: number; px: [number, number] }[];
  measured: { label: string; px: [number, number] }[];
  source: string;
  note: string;
};

/** One SPHEREx cutout on a canvas (pixelated), with scale bar, N/E arrows and a hover readout. */
export default function CutoutView({
  cutout,
  data,
  limits,
  stretch,
  cmap,
  label,
  unit,
  showOverlays = true,
  track = null,
  gaia = null,
  anaglyphB = null,
  catalog = null,
}: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const { width: w, height: h, meta } = cutout.raw;
  const pixels = data ?? cutout.data;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    if (!ctx) return; // no canvas (tests)
    const img = anaglyphB
      ? renderAnaglyph(pixels, anaglyphB, w, h, limits, stretch)
      : renderImage(pixels, w, h, limits, stretch, cmap);
    ctx.putImageData(img, 0, 0);
  }, [pixels, anaglyphB, w, h, limits, stretch, cmap]);

  // Overlay geometry in native pixel units (SVG viewBox = image size; y axis points down on screen)
  const overlay = useMemo(() => {
    const arcminPx = 60 / meta.pixel_scale_arcsec;
    const barArcmin = arcminPx > w * 0.5 ? 0.5 : 1;
    const toScreen = (deg: number) => (-deg * Math.PI) / 180; // FITS y-up -> screen y-down
    const len = Math.min(w, h) * 0.14;
    const ox = w * 0.84;
    const oy = h * 0.84;
    const n = toScreen(meta.north_deg);
    const e = toScreen(meta.east_deg);
    return {
      bar: { len: barArcmin * arcminPx, label: barArcmin === 1 ? "1′" : "30″" },
      origin: [ox, oy] as const,
      north: [ox + len * Math.cos(n), oy + len * Math.sin(n)] as const,
      east: [ox + len * Math.cos(e), oy + len * Math.sin(e)] as const,
      target: [meta.target_px[0] + 0.5, h - (meta.target_px[1] + 0.5)] as const,
    };
  }, [meta, w, h]);

  // Catalogue labels: brightest candidates from the server, placed without overlap and never clipped
  const catFont = w * 0.03;
  const catItems = catalog?.items;
  const catShowLabels = catalog?.showLabels ?? false;
  const labels = useMemo(() => {
    if (!catItems || !catShowLabels) return [];
    const cands = catItems
      .filter((i) => i.labelled)
      .map((i) => ({ key: i.key, text: i.label, x: i.px[0] + 0.5, y: h - (i.px[1] + 0.5) }));
    return placeLabels(cands, w, h, catFont, w * 0.02);
  }, [catItems, catShowLabels, w, h, catFont]);
  // Catalogue source under the pointer (within 1.5 px): full name in the readout, row highlighted
  const hoverItem =
    hover && catalog
      ? (catalog.items
          .map((i) => ({ i, d: Math.hypot(i.px[0] - hover.x, i.px[1] - (h - 1 - hover.y)) }))
          .filter((x) => x.d <= 1.5)
          .sort((a, b) => a.d - b.d)[0]?.i ?? null)
      : null;
  const onCatHover = catalog?.onHover;
  const hoverKey = hoverItem?.key ?? null;
  useEffect(() => {
    onCatHover?.(hoverKey);
  }, [hoverKey, onCatHover]);

  const readout = hover
    ? (() => {
        const row = h - 1 - hover.y;
        const i = row * w + hover.x;
        return { v: pixels[i], lam: cutout.lambda ? cutout.lambda[i] : null };
      })()
    : null;

  return (
    <figure className="flex flex-col gap-2">
      {label && <figcaption className="text-sm font-medium text-ink-100">{label}</figcaption>}
      <div
        className="relative aspect-square w-full overflow-hidden rounded-xl border border-white/10 bg-space-950"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(ev) => {
          const r = ev.currentTarget.getBoundingClientRect();
          const x = Math.floor(((ev.clientX - r.left) / r.width) * w);
          const y = Math.floor(((ev.clientY - r.top) / r.height) * h);
          if (x >= 0 && y >= 0 && x < w && y < h) setHover({ x, y });
        }}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          style={{ imageRendering: "pixelated" }}
          role="img"
          aria-label={t("viewer.canvasLabel", {
            lam: meta.wavelength_um.toFixed(3),
            date: meta.date_obs.slice(0, 10),
          })}
        />
        {showOverlays && (
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            {gaia && (
              <g data-layer="gaia" fontSize={w * 0.04} fontFamily="Inter Variable">
                {gaia.markers.map((m) => (
                  <circle
                    key={m.source_id}
                    cx={m.px[0] + 0.5}
                    cy={h - (m.px[1] + 0.5)}
                    r={Math.max(w * 0.012, 0.5)}
                    fill="none"
                    stroke="#67e8f9"
                    strokeOpacity={0.75}
                    strokeWidth={Math.max(w / 400, 0.15)}
                  />
                ))}
                {(gaia.expected ?? []).map((e) => {
                  const x = e.px[0] + 0.5;
                  const y = h - (e.px[1] + 0.5);
                  const s = w * 0.022;
                  return (
                    <g key={e.label}>
                      <path
                        d={`M${x} ${y - s} L${x + s} ${y} L${x} ${y + s} L${x - s} ${y} Z`}
                        fill="none"
                        stroke="#f0abfc"
                        strokeWidth={Math.max(w / 300, 0.2)}
                      />
                      <text
                        x={x + s * 1.2}
                        y={y + s * 1.6}
                        fill="#f5d0fe"
                        stroke="#050816"
                        strokeWidth={w / 500}
                        paintOrder="stroke"
                      >
                        {e.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}
            {catalog && (
              <g data-layer="catalog" fontSize={catFont} fontFamily="Inter Variable">
                {catalog.items.map((i) => {
                  const on = i.key === catalog.highlight;
                  return (
                    <rect
                      key={i.key}
                      x={i.px[0] + 0.5 - w * 0.011}
                      y={h - (i.px[1] + 0.5) - w * 0.011}
                      width={w * 0.022}
                      height={w * 0.022}
                      fill="none"
                      stroke={on ? "#ffffff" : CAT_COLOR[i.cat]}
                      strokeOpacity={on ? 1 : 0.8}
                      strokeWidth={Math.max(w / (on ? 180 : 400), 0.15)}
                      transform={
                        i.cat === "AllWISE" ? `rotate(45 ${i.px[0] + 0.5} ${h - (i.px[1] + 0.5)})` : undefined
                      }
                    />
                  );
                })}
                {labels.map((l) => (
                  <text
                    key={`l-${l.key}`}
                    x={l.x}
                    y={l.y}
                    textAnchor={l.anchor}
                    fill={l.key === catalog.highlight ? "#ffffff" : "#e8edf7"}
                    stroke="#050816"
                    strokeWidth={w / 450}
                    paintOrder="stroke"
                  >
                    {l.text}
                  </text>
                ))}
              </g>
            )}
            {track && track.expected.length > 1 && (
              <g fontSize={w * 0.045} fontFamily="Inter Variable">
                <polyline
                  points={track.expected.map((p) => `${p.px[0] + 0.5},${h - (p.px[1] + 0.5)}`).join(" ")}
                  fill="none"
                  stroke="#93c5fd"
                  strokeWidth={Math.max(w / 260, 0.2)}
                  strokeDasharray={`${w * 0.02} ${w * 0.015}`}
                />
                {track.expected.map((p) => (
                  <g key={p.label} transform={`translate(${p.px[0] + 0.5} ${h - (p.px[1] + 0.5)})`}>
                    <circle r={w * 0.012} fill="#93c5fd" stroke="#050816" strokeWidth={w / 400} />
                    <text
                      x={w * 0.02}
                      y={-w * 0.015}
                      fill="#e8edf7"
                      stroke="#050816"
                      strokeWidth={w / 500}
                      paintOrder="stroke"
                    >
                      {p.label}
                    </text>
                  </g>
                ))}
                {track.measured.map((m) => (
                  <g
                    key={`m-${m.label}`}
                    transform={`translate(${m.px[0] + 0.5} ${h - (m.px[1] + 0.5)})`}
                    stroke="#f9fafb"
                    strokeWidth={Math.max(w / 300, 0.2)}
                  >
                    <line x1={-w * 0.018} y1={-w * 0.018} x2={w * 0.018} y2={w * 0.018} />
                    <line x1={-w * 0.018} y1={w * 0.018} x2={w * 0.018} y2={-w * 0.018} />
                  </g>
                ))}
              </g>
            )}
            <g stroke="#fcd34d" strokeWidth={Math.max(w / 220, 0.25)} fill="none">
              <circle cx={overlay.target[0]} cy={overlay.target[1]} r={w * 0.06} />
              <line
                x1={overlay.target[0]}
                y1={overlay.target[1] - w * 0.11}
                x2={overlay.target[0]}
                y2={overlay.target[1] - w * 0.07}
              />
              <line
                x1={overlay.target[0]}
                y1={overlay.target[1] + w * 0.07}
                x2={overlay.target[0]}
                y2={overlay.target[1] + w * 0.11}
              />
            </g>
            <g
              stroke="#e8edf7"
              strokeWidth={Math.max(w / 200, 0.3)}
              fill="#e8edf7"
              fontSize={w * 0.055}
              fontFamily="Inter Variable"
            >
              <line
                x1={overlay.origin[0]}
                y1={overlay.origin[1]}
                x2={overlay.north[0]}
                y2={overlay.north[1]}
              />
              <line x1={overlay.origin[0]} y1={overlay.origin[1]} x2={overlay.east[0]} y2={overlay.east[1]} />
              <text x={overlay.north[0]} y={overlay.north[1]} stroke="none" textAnchor="middle" dy="-0.3em">
                {t("viewer.north")}
              </text>
              <text x={overlay.east[0]} y={overlay.east[1]} stroke="none" textAnchor="middle" dy="-0.3em">
                {t("viewer.east")}
              </text>
              <line x1={w * 0.06} y1={h * 0.93} x2={w * 0.06 + overlay.bar.len} y2={h * 0.93} />
              <text x={w * 0.06} y={h * 0.93} stroke="none" dy="-0.4em">
                {overlay.bar.label}
              </text>
            </g>
          </svg>
        )}
      </div>
      <div className="min-h-5 font-mono text-xs text-ink-400" aria-live="off">
        {readout && Number.isFinite(readout.v)
          ? `x=${hover!.x} y=${h - 1 - hover!.y} · ${readout.v.toFixed(3)} ${unit ?? meta.unit}` +
            (readout.lam !== null ? ` · λ=${readout.lam.toFixed(4)} µm` : "")
          : readout
            ? `x=${hover!.x} y=${h - 1 - hover!.y} · ${t("viewer.masked")}`
            : t("viewer.hoverHint")}
        {hoverItem && (
          <span className="block text-ink-100">
            {hoverItem.full_name}
            {hoverItem.otype ? ` · ${hoverItem.otype}` : ""} ·{" "}
            {t(hoverItem.epoch === "moved" ? "catalog.moved" : "catalog.notMoved")}
          </span>
        )}
      </div>
    </figure>
  );
}
