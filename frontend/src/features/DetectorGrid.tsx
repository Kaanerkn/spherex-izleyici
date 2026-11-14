import { Grid3x3, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import CutoutView from "../components/CutoutView";
import ProgressLine from "../components/ProgressLine";
import { alignedCutout } from "../lib/aligned";
import { apiPost, type Target } from "../lib/api";
import { errorText, fmt } from "../lib/format";
import { runJob } from "../lib/jobs";
import { decodeFloat32, percentileLimits, type Colormap, type Stretch } from "../render/image";
import { ViewControls } from "./CompareView";

type Band = {
  detector: number;
  count: number;
  lam_min_um?: number;
  lam_max_um?: number;
  lam_mean_um?: number;
  date_first?: string;
  date_last?: string;
  data_b64?: string;
};
type GridResult = {
  width: number;
  height: number;
  size_deg: number;
  pixel_scale_arcsec: number;
  bands: Band[];
};

/** Six detectors side by side, each the per-pixel mean of its exposures on the north-up grid. Labelled as a
 *  band average with its λ range and frame count; no signal-to-noise claim is made. */
export default function DetectorGrid({
  target,
  size,
  zodi,
}: {
  target: Target;
  size: number;
  zodi: boolean;
}) {
  const { t } = useTranslation();
  const [res, setRes] = useState<GridResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stretch, setStretch] = useState<Stretch>("asinh");
  const [cmap, setCmap] = useState<Colormap>("inferno");
  const arrays = useMemo(
    () => (res ? res.bands.map((b) => (b.data_b64 ? decodeFloat32(b.data_b64) : null)) : []),
    [res],
  );

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await runJob<GridResult>(
        () =>
          apiPost("/sky/detectors", {
            ra: target.ra,
            dec: target.dec,
            size_deg: size,
            zodi: zodi ? "sub" : "raw",
            object_key: target.key,
          }),
        (s) =>
          setStep(
            s.step === "grid_frames"
              ? t("grid.loading", { done: s.done, total: s.total })
              : s.step === "grid_detector"
                ? t("grid.detector", { d: s.detector })
                : t("video.indexing"),
          ),
      );
      setRes(r);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  return (
    <section className="glass space-y-3 rounded-2xl p-5" aria-labelledby="grid-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="grid-title" className="font-display text-lg font-semibold text-ink-100">
          {t("grid.title")}
        </h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => void build()}
          className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-white/15 px-4 text-sm text-ink-100 hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Grid3x3 className="size-4" />}
          {t("grid.build")}
        </button>
      </div>
      <p className="text-sm text-ink-300">{t("grid.intro")}</p>
      {size > 0.25 && <p className="text-xs text-warn-400">{t("video.sizeClamped")}</p>}
      {step && <ProgressLine text={step} />}
      {error && (
        <p className="text-sm text-danger-400" role="alert">
          {error}
        </p>
      )}
      {res && (
        <>
          <ViewControls stretch={stretch} setStretch={setStretch} cmap={cmap} setCmap={setCmap} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {res.bands.map((b, i) => {
              const data = arrays[i];
              return (
                <div key={b.detector} className="space-y-1">
                  {data && b.lam_mean_um !== undefined ? (
                    <CutoutView
                      cutout={alignedCutout(
                        res.width,
                        res.height,
                        res.pixel_scale_arcsec,
                        data,
                        b.date_last ?? "",
                        b.lam_mean_um,
                      )}
                      limits={percentileLimits([data])}
                      stretch={stretch}
                      cmap={cmap}
                      label={t("grid.label", { d: b.detector })}
                    />
                  ) : (
                    <p className="text-sm text-ink-400">
                      D{b.detector}: {t("grid.empty")}
                    </p>
                  )}
                  {b.count > 0 && (
                    <p className="text-xs text-ink-300">
                      {t("grid.meta", {
                        min: fmt(b.lam_min_um ?? null, 3),
                        max: fmt(b.lam_max_um ?? null, 3),
                        mean: fmt(b.lam_mean_um ?? null, 3),
                        n: b.count,
                        first: b.date_first,
                        last: b.date_last,
                      })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-ink-300">{t("grid.blurNote")}</p>
          <p className="text-xs text-ink-400">
            {t("grid.method")} {t("video.interpNote")}
          </p>
        </>
      )}
    </section>
  );
}
