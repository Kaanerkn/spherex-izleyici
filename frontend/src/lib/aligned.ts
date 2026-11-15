import type { DecodedCutout } from "../components/CutoutView";

/** North-up / east-left grid shared by every aligned frame (server: services/aligned.py); the target is
 *  at the centre. */
export function alignedCutout(
  w: number,
  h: number,
  scale: number,
  data: Float32Array,
  date: string,
  lam: number,
): DecodedCutout {
  return {
    raw: {
      width: w,
      height: h,
      meta: {
        unit: "MJy/sr",
        target_px: [(w - 1) / 2, (h - 1) / 2],
        wavelength_um: lam,
        date_obs: date,
        north_deg: 90,
        east_deg: 180,
        pixel_scale_arcsec: scale,
      },
    },
    data,
    lambda: null,
  };
}
