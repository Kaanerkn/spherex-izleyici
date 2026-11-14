"""Catalogue overlay for a SPHEREx cutout: AllWISE, 2MASS and SIMBAD sources in the field, on A's pixel grid.

Positions are moved to the SPHEREx date only when the catalogue has the motion for it:
- SIMBAD: J2000 position + proper motion (when given) -> moved.
- AllWISE: ra_pm/dec_pm at MJD 55400 (2010.56) + pmra/pmdec; moved only when the motion is significant
  (> 3σ in either axis), otherwise "katalog dönemi konumu, taşınmadı".
- 2MASS: no proper motion in the catalogue -> never moved (positions from 1997–2001).
Gaia DR3 stays a separate layer (services/gaia_layer.py); nothing here is called Gaia.
"""

from __future__ import annotations

import math
import re

from ..domain.astrometry import propagate

ALLWISE_EPOCH = 2010.5589  # MJD 55400.0, epoch of AllWISE ra_pm/dec_pm
MATCH_ARCSEC = 3.0  # SIMBAD name attached to an AllWISE/2MASS source within this distance
MAX_LABELS = 12
SOURCES = {
    "AllWISE": "NASA/IPAC IRSA, AllWISE Source Catalog (allwise_p3as_psd), cone search (SCS) / Gator",
    "2MASS": "NASA/IPAC IRSA, 2MASS All-Sky Point Source Catalog (fp_psc), cone search (SCS) / Gator",
    "SIMBAD": "CDS SIMBAD (basic, allfluxes, ident)",
}
_AW = re.compile(r"^J(\d{4})\d*(?:\.\d+)?([+-]\d{4})")
_TM = re.compile(r"^(\d{4})\d*(?:\.\d+)?([+-]\d{4})")


def short_code(cat: str, designation: str) -> str:
    """'J175747.16+044211.0' (AllWISE) or '17574716+0442110' (2MASS) -> 'J1757+0442'."""
    m = (_AW if cat == "AllWISE" else _TM).match(designation or "")
    return f"J{m.group(1)}{m.group(2)}" if m else (designation or cat)


def coord_code(ra: float, dec: float) -> str:
    """Short position code 'JHHMM±DDMM' (truncated, like catalogue designations)."""
    h = (ra % 360) / 15
    sign = "-" if dec < 0 else "+"
    d = abs(dec)
    return f"J{int(h):02d}{int(h * 60) % 60:02d}{sign}{int(d):02d}{int(d * 60) % 60:02d}"


_SIMBAD_PREFIX = re.compile(r"^(?:V\*|\*\*|\*)\s+")


def simbad_label(s: dict, ra: float, dec: float) -> str:
    """Common name if SIMBAD has one, else its main id without the '*' / 'V*' / '**' prefix. A main id from
    another catalogue's numbering (e.g. 'Gaia DR3 …') is not used as a label: the Gaia name is kept for the
    real Gaia layer, so the position code is shown instead (the full id stays in the table)."""
    if s.get("name"):
        return s["name"]
    mid = _SIMBAD_PREFIX.sub("", s["id"])
    return coord_code(ra, dec) if mid.startswith("Gaia") else mid


def _sep_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    d = math.radians
    c = math.sin(d(dec1)) * math.sin(d(dec2)) + math.cos(d(dec1)) * math.cos(d(dec2)) * math.cos(d(ra1 - ra2))
    return math.degrees(math.acos(max(-1.0, min(1.0, c)))) * 3600


def _significant(pm: float | None, sig: float | None) -> bool:
    return pm is not None and sig is not None and sig > 0 and abs(pm) > 3 * sig


def position_at(src: dict, mjd: float) -> tuple[float, float, str]:
    """(ra, dec, epoch) where epoch is 'moved' or 'catalog'."""
    cat = src["cat"]
    if cat == "SIMBAD" and (src.get("pmra") or src.get("pmdec")):
        ra, dec = propagate(src["ra"], src["dec"], src.get("pmra"), src.get("pmdec"), mjd)
        return ra, dec, "moved"
    if cat == "AllWISE" and (
        _significant(src.get("pmra"), src.get("sigpmra"))
        or _significant(src.get("pmdec"), src.get("sigpmdec"))
    ):
        ra, dec = propagate(src["ra"], src["dec"], src.get("pmra"), src.get("pmdec"), mjd, ALLWISE_EPOCH)
        return ra, dec, "moved"
    return src["ra"], src["dec"], "catalog"


def build(field: dict, wcs, mjd: float, target: tuple[float, float], shape: tuple[int, int]) -> dict:
    ny, nx = shape
    simbad = []
    for s in field.get("simbad") or []:
        ra, dec, ep = position_at(s, mjd)
        simbad.append((s, ra, dec, ep))
    items: list[dict] = []
    for cat in ("allwise", "twomass", "simbad"):
        for s in field.get(cat) or []:
            ra, dec, ep = position_at(s, mjd)
            x, y = (float(v) for v in wcs.world_to_pixel_values(ra, dec))
            if not (-0.5 <= x < nx - 0.5 and -0.5 <= y < ny - 0.5):
                continue
            if s["cat"] == "SIMBAD":
                label = simbad_label(s, ra, dec)
                full = f"SIMBAD {s['id']}" + (f" ({s['name']})" if s.get("name") else "")
                otype = s.get("otype")
            else:
                near = min(
                    ((_sep_arcsec(ra, dec, sr, sd), so) for so, sr, sd, _ in simbad),
                    default=(None, None),
                    key=lambda t: t[0],
                )
                named = near[1] if near[0] is not None and near[0] <= MATCH_ARCSEC else None
                code = short_code(s["cat"], s["id"])
                label = simbad_label(named, ra, dec) if named else code
                full = f"{s['cat']} {s['id']}" + (
                    f" = SIMBAD {named['name'] or named['id']}" if named else ""
                )
                otype = named.get("otype") if named else None
            items.append(
                {
                    "key": f"{s['cat']}:{s['id']}",
                    "cat": s["cat"],
                    "id": s["id"],
                    "label": label,
                    "full_name": full,
                    "otype": otype,
                    "ra": ra,
                    "dec": dec,
                    "px": [round(x, 2), round(y, 2)],
                    "mag": s.get("mag"),
                    "band": s.get("band"),
                    "epoch": ep,
                    "sep_arcsec": round(_sep_arcsec(ra, dec, *target), 1),
                }
            )
    items.sort(key=lambda i: (i["mag"] is None, i["mag"] or 0.0))
    # Label candidates: brightest first, one label per star (catalogue duplicates within 3″ skipped) and
    # never the same text twice (AllWISE and 2MASS codes of one star coincide; codes are truncated)
    labelled: list[dict] = []
    for i in items:
        if len(labelled) >= MAX_LABELS:
            break
        if any(
            i["label"] == j["label"] or _sep_arcsec(i["ra"], i["dec"], j["ra"], j["dec"]) <= MATCH_ARCSEC
            for j in labelled
        ):
            continue
        i["labelled"] = True
        labelled.append(i)
    return {
        "items": items,
        "max_labels": MAX_LABELS,
        "errors": field.get("errors") or [],
        "sources": SOURCES,
        "allwise_epoch": ALLWISE_EPOCH,
    }
