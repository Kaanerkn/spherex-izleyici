import { Film, Loader2, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import CutoutView from "../components/CutoutView";
import ProgressLine from "../components/ProgressLine";
import { alignedCutout } from "../lib/aligned";
import { apiPost, type Target } from "../lib/api";
import { errorText, fmt } from "../lib/format";
import { runJob } from "../lib/jobs";
import { decodeFloat32, percentileLimits, type Colormap, type Stretch } from "../render/image";
import { ViewControls } from "./CompareView";

type VideoFrame = {
  date: string;
  date_end: string;
  n: number;
  lam_um: number;
  lam_min_um: number;
  lam_max_um: number;
  releases: string[];
  data_b64: string;
};
type VideoResult = {
  width: number;
  height: number;
  size_deg: number;
  detector: number;
  lam_ref_um: number;
  pixel_scale_arcsec: number;
  frames: VideoFrame[];
  skipped_visits: number;
  missing_exposures: number;
};

/** "Hizalanmış zaman videosu": one frame per visit, same detector and channel (Δλ ≤ ½ bandwidth),
 *  several exposures of a visit combined by a sigma-clipped median; shared brightness scale. */
export default function AlignedVideo({
  target,
  detector,
  lamRef,
  size,
  zodi,
}: {
  target: Target;
  detector: number;
  lamRef: number | null;
  size: number;
  zodi: boolean;
}) {
  const { t } = useTranslation();
  const [res, setRes] = useState<VideoResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rateMs, setRateMs] = useState(700);
  const [stretch, setStretch] = useState<Stretch>("asinh");
  const [cmap, setCmap] = useState<Colormap>("inferno");

  const frames = useMemo(() => (res ? res.frames.map((f) => decodeFloat32(f.data_b64)) : []), [res]);
  const limits = useMemo(() => percentileLimits(frames), [frames]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % frames.length), rateMs);
    return () => window.clearInterval(id);
  }, [playing, frames.length, rateMs]);

  const build = async () => {
    if (lamRef === null) return;
    setBusy(true);
    setError(null);
    setPlaying(false);
    try {
      const r = await runJob<VideoResult>(
        () =>
          apiPost("/sky/video", {
            ra: target.ra,
            dec: target.dec,
            detector,
            lam_um: lamRef,
            size_deg: size,
            zodi: zodi ? "sub" : "raw",
            object_key: target.key,
          }),
        (s) =>
          setStep(
            s.step === "video_frames"
              ? t("video.loading", { done: s.done, total: s.total })
              : t("video.indexing"),
          ),
      );
      setRes(r);
      setIdx(0);
      setPlaying(r.frames.length > 1);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  const f = res?.frames[idx];
  return (
    <section className="glass space-y-3 rounded-2xl p-5" aria-labelledby="video-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="video-title" className="font-display text-lg font-semibold text-ink-100">
          {t("video.title")}
        </h3>
        <button
          type="button"
          disabled={busy || lamRef === null}
          onClick={() => void build()}
          className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-white/15 px-4 text-sm text-ink-100 hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Film className="size-4" />}
          {t("video.build", { lam: lamRef === null ? "?" : lamRef.toFixed(3) })}
        </button>
      </div>
      <p className="text-sm text-ink-300">{t("video.intro")}</p>
      {size > 0.25 && <p className="text-xs text-warn-400">{t("video.sizeClamped")}</p>}
      {step && <ProgressLine text={step} />}
      {error && (
        <p className="text-sm text-danger-400" role="alert">
          {error}
        </p>
      )}
      {res && res.frames.length === 0 && <p className="text-sm text-warn-400">{t("video.none")}</p>}
      {res && f && (
        <>
          <ViewControls stretch={stretch} setStretch={setStretch} cmap={cmap} setCmap={setCmap} />
          <div className="mx-auto max-w-xl space-y-2">
            <CutoutView
              cutout={alignedCutout(
                res.width,
                res.height,
                res.pixel_scale_arcsec,
                frames[idx],
                f.date,
                f.lam_um,
              )}
              limits={limits}
              stretch={stretch}
              cmap={cmap}
              label={t("video.frameLabel", {
                i: idx + 1,
                n: res.frames.length,
                date: f.date,
                lam: fmt(f.lam_um, 4),
                k: f.n,
                rel: f.releases.join("+").toUpperCase(),
              })}
            />
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-300">
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                disabled={res.frames.length < 2}
                aria-label={playing ? t("video.pause") : t("video.play")}
                className="flex size-9 cursor-pointer items-center justify-center rounded-lg border border-white/15 disabled:opacity-50"
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0, res.frames.length - 1)}
                value={idx}
                aria-label={t("video.frame")}
                onChange={(e) => {
                  setPlaying(false);
                  setIdx(Number(e.target.value));
                }}
                className="min-w-40 flex-1 accent-star-400"
              />
              <label className="flex items-center gap-2">
                {t("viewer.blinkRate")}
                <input
                  type="range"
                  min={250}
                  max={1500}
                  step={50}
                  value={1750 - rateMs}
                  onChange={(e) => setRateMs(1750 - Number(e.target.value))}
                  className="w-28 accent-star-400"
                />
              </label>
            </div>
          </div>
          <p className="text-xs text-ink-300">{t("video.interpNote")}</p>
          <p className="text-xs text-ink-400">
            {t("video.combineNote", { lam: fmt(res.lam_ref_um, 3) })}
            {res.skipped_visits > 0 && ` ${t("video.skipped", { n: res.skipped_visits })}`}
            {res.missing_exposures > 0 && ` ${t("video.missing", { n: res.missing_exposures })}`}
          </p>
        </>
      )}
    </section>
  );
}
