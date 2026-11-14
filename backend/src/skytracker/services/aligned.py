"""North-up aligned frames for the time video and the six-detector grid.

Each SPHEREx cutout is resampled (bilinear) onto one tangent-plane grid centred on the target: north up,
east left, 6.15″/px. FLAGS-masked pixels (display mask) and any pixel touching one become NaN. Frames are
combined only when they share a detector and are within half a bandwidth in λ (the channel "match" rule);
the combination is a per-pixel sigma-clipped median that ignores NaN. Different λ are never averaged in the
video; the six-detector grid averages within one detector and says so (λ range shown, no S/N claim).
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import io
import math
import warnings

import numpy as np
from astropy.io import fits

from .. import cache
from ..domain import compare as C
from ..domain import flags as F
from ..domain.wavelength import celestial_wcs, wave_wcs
from ..http import UpstreamError
from ..providers import spherex as S

PIXEL_SCALE_ARCSEC = 6.15
MAX_VIDEO_FRAMES = 24
MAX_PER_FRAME = 4  # exposures combined into one video frame (same visit, same channel)
MAX_PER_DETECTOR = 12  # exposures averaged per detector in the six-detector grid
HEADERS_PER_DETECTOR = 30
PARALLEL = 4
NS = "aligned_north_up_v1"


def grid_size(size_deg: float) -> int:
    return max(16, round(size_deg * 3600 / PIXEL_SCALE_ARCSEC))


def north_up(raw: bytes, ra: float, dec: float, size_deg: float, zodi: str) -> dict:
    """Pure: one cutout FITS -> north-up float32 array (row 0 = south edge, FITS order) + λ at target."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        h = fits.open(io.BytesIO(raw))
        ih = h["IMAGE"].header
        img = h["IMAGE"].data.astype(np.float64)
        z = h["ZODI"].data.astype(np.float64)
        fl = h["FLAGS"].data
        schema = F.flag_schema(h["FLAGS"].header)
        cw = celestial_wcs(ih)
        tx, ty = (float(v) for v in cw.world_to_pixel_values(ra, dec))
        lam, bw = (float(v) for v in wave_wcs(ih, h["WCS-WAVE"]).pixel_to_world_values(tx, ty))
    data = img - z if zodi == "sub" else img
    bad = F.mask_from(fl, schema, F.DISPLAY_MASK) | ~np.isfinite(data)
    n = grid_size(size_deg)
    step = PIXEL_SCALE_ARCSEC / 3600
    off = (np.arange(n) - (n - 1) / 2) * step
    cos_d = max(math.cos(math.radians(dec)), 1e-6)
    # small-angle tangent grid: column index grows to the WEST so that east is on the left when drawn
    gx, gy = np.meshgrid(off, off)
    g_ra = ra - gx / cos_d
    g_dec = dec + gy
    sx, sy = cw.world_to_pixel_values(g_ra, g_dec)
    out = C.bilinear_sample(data, bad, np.asarray(sx, float), np.asarray(sy, float)).astype(np.float32)
    return {
        "data": out,
        "n": n,
        "lam": lam,
        "bw": bw,
        "mjd": float(ih.get("MJD-AVG") or 0.0),
        "bad_fraction": float(bad.mean()),
    }


async def frame(img: S.SpherexImage, ra: float, dec: float, size: float, zodi: str) -> dict:
    """north_up() of one exposure, cached in its own namespace (the pixel array as .npy bytes)."""
    ns = f"{img.release}/{NS}"
    key = f"{img.obs_id}_D{img.detector}_{S.target_key(ra, dec)}_{size:.3f}_{zodi}"
    meta = cache.get_json(ns, key, None)
    arr = cache.get_bytes(ns, key, ".npy")
    if meta is not None and arr is not None:
        return {**meta, "data": np.load(io.BytesIO(arr))}
    raw = await S.fetch_cutout_fits(img, ra, dec, size)
    out = await asyncio.to_thread(north_up, raw, ra, dec, size, zodi)
    buf = io.BytesIO()
    np.save(buf, out["data"])
    cache.put_bytes(ns, key, buf.getvalue(), ".npy")
    cache.put_json(ns, key, {k: v for k, v in out.items() if k != "data"})
    return out


def robust_combine(arrays: list[np.ndarray], clip: float = 3.0) -> np.ndarray:
    """Per-pixel sigma-clipped median, ignoring NaN; one array is returned unchanged."""
    if len(arrays) == 1:
        return arrays[0]
    st = np.stack(arrays).astype(np.float64)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        med = np.nanmedian(st, axis=0)
        mad = 1.4826 * np.nanmedian(np.abs(st - med), axis=0)
        keep = np.abs(st - med) <= clip * np.where(mad > 0, mad, np.inf)
        out = np.nanmedian(np.where(keep, st, np.nan), axis=0)
    return out.astype(np.float32)


def same_channel(lam: float, ref: float, bw: float) -> bool:
    return bw > 0 and abs(lam - ref) <= 0.5 * bw


def _b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a, dtype="<f4").tobytes()).decode("ascii")


async def _usable(images: list[S.SpherexImage], ra: float, dec: float) -> list[tuple[S.SpherexImage, dict]]:
    samples = await S.index_wavelengths(images, ra, dec)
    out = []
    for i in images:
        s = samples.get(i.image_id) or {}
        if s.get("on_detector") and s.get("wavelength_um") and s.get("bandwidth_um"):
            out.append((i, s))
    return out


async def _frames(
    picks: list[S.SpherexImage], ra: float, dec: float, size: float, zodi: str, progress, step: str
) -> dict[str, dict]:
    sem = asyncio.Semaphore(PARALLEL)
    got: dict[str, dict] = {}
    done = 0

    async def one(i: S.SpherexImage):
        nonlocal done
        async with sem:
            # a missing exposure only shortens the series; it is counted in the result
            with contextlib.suppress(UpstreamError, OSError, KeyError, ValueError):
                got[i.image_id] = await frame(i, ra, dec, size, zodi)
        done += 1
        await progress(step, {"done": done, "total": len(picks)})

    await asyncio.gather(*(one(i) for i in picks))
    return got


async def time_video(
    ra: float, dec: float, detector: int, lam_ref: float, size: float, zodi: str, progress
) -> dict:
    images = [i for i in await S.coverage(ra, dec, progress) if i.detector == detector]
    visits = S.group_visits(images)
    await progress("video_index", {"total": len(images)})
    usable = {i.image_id: s for i, s in await _usable(images, ra, dec)}
    plan: list[dict] = []
    for v in visits:
        chosen = [
            (i, usable[i.image_id])
            for i in v["images"]
            if i.image_id in usable
            and same_channel(usable[i.image_id]["wavelength_um"], lam_ref, usable[i.image_id]["bandwidth_um"])
        ]
        chosen.sort(key=lambda p: abs(p[1]["wavelength_um"] - lam_ref))
        if chosen:
            plan.append({"visit": v, "images": [i for i, _ in chosen[:MAX_PER_FRAME]]})
    skipped_visits = max(0, len(plan) - MAX_VIDEO_FRAMES)
    plan = plan[-MAX_VIDEO_FRAMES:] if skipped_visits else plan
    picks = [i for p in plan for i in p["images"]]
    got = await _frames(picks, ra, dec, size, zodi, progress, "video_frames")
    frames = []
    for p in plan:
        fs = [got[i.image_id] for i in p["images"] if i.image_id in got]
        if not fs:
            continue
        lams = [f["lam"] for f in fs]
        frames.append(
            {
                "date": p["visit"]["start"],
                "date_end": p["visit"]["end"],
                "n": len(fs),
                "lam_um": float(np.mean(lams)),
                "lam_min_um": min(lams),
                "lam_max_um": max(lams),
                "releases": sorted({i.release for i in p["images"]}),
                "data_b64": _b64(robust_combine([f["data"] for f in fs])),
            }
        )
    n = grid_size(size)
    return {
        "width": n,
        "height": n,
        "size_deg": size,
        "detector": detector,
        "lam_ref_um": lam_ref,
        "pixel_scale_arcsec": PIXEL_SCALE_ARCSEC,
        "frames": frames,
        "skipped_visits": skipped_visits,
        "missing_exposures": len(picks) - len(got),
    }


async def six_detectors(ra: float, dec: float, size: float, zodi: str, progress) -> dict:
    images = await S.coverage(ra, dec, progress)
    bands = []
    for det in range(1, 7):
        await progress("grid_detector", {"detector": det})
        det_imgs = sorted((i for i in images if i.detector == det), key=lambda i: i.t_start_mjd)
        # headers of an evenly spread subset (the whole time span, not only the first visits)
        if len(det_imgs) > HEADERS_PER_DETECTOR:
            idx = np.linspace(0, len(det_imgs) - 1, HEADERS_PER_DETECTOR).round().astype(int)
            det_imgs = [det_imgs[k] for k in sorted(set(idx))]
        usable = await _usable(det_imgs, ra, dec)
        if len(usable) > MAX_PER_DETECTOR:
            idx = np.linspace(0, len(usable) - 1, MAX_PER_DETECTOR).round().astype(int)
            usable = [usable[k] for k in sorted(set(idx))]
        if not usable:
            bands.append({"detector": det, "count": 0})
            continue
        got = await _frames([i for i, _ in usable], ra, dec, size, zodi, progress, "grid_frames")
        fs = [got[i.image_id] for i, _ in usable if i.image_id in got]
        if not fs:
            bands.append({"detector": det, "count": 0})
            continue
        lams = [f["lam"] for f in fs]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            avg = np.nanmean(np.stack([f["data"] for f in fs]), axis=0).astype(np.float32)
        bands.append(
            {
                "detector": det,
                "count": len(fs),
                "lam_min_um": min(lams),
                "lam_max_um": max(lams),
                "lam_mean_um": float(np.mean(lams)),
                "date_first": min(i.date_obs for i, _ in usable)[:10],
                "date_last": max(i.date_obs for i, _ in usable)[:10],
                "data_b64": _b64(avg),
            }
        )
    n = grid_size(size)
    return {
        "width": n,
        "height": n,
        "size_deg": size,
        "pixel_scale_arcsec": PIXEL_SCALE_ARCSEC,
        "bands": bands,
    }
