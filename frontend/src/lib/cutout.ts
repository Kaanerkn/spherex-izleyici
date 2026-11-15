import type { DecodedCutout } from "../components/CutoutView";
import { decodeFloat32 } from "../render/image";
import type { CutoutResult } from "./api";

/** Server cutout -> pixel arrays for CutoutView (the whole response is kept in `raw`). */
export function decodeCutout(c: CutoutResult): DecodedCutout {
  return { raw: c, data: decodeFloat32(c.data_b64), lambda: decodeFloat32(c.lambda_b64) };
}
