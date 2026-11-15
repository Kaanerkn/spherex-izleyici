"""Field catalogues for the overlay: AllWISE and 2MASS from IRSA (cone search), SIMBAD from the CDS TAP.

All requests go through http.py (host allowlist in config/upstreams.toml, certificate checks, rate limits per
upstream group). Positions are returned as the catalogues give them (catalogue epoch); moving them to the
SPHEREx date is done in services/catalog_layer.py, so the cache key does not depend on any date.
"""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import math

from astropy.table import Table

from .. import cache
from ..http import UpstreamError, http
from . import simbad

log = logging.getLogger("skytracker.catalogs")
IRSA_SCS = "https://irsa.ipac.caltech.edu/SCS"
IRSA_GATOR = "https://irsa.ipac.caltech.edu/cgi-bin/Gator/nph-query"
GATOR_COLUMNS = {
    "allwise_p3as_psd": "designation,ra,dec,w1mpro,w2mpro,pmra,pmdec,sigpmra,sigpmdec,ra_pm,dec_pm",
    "fp_psc": "designation,ra,dec,j_m,h_m,k_m",
}
MAX_ROWS = 60  # per catalogue, brightest first (sorted here)
FETCH_ROWS = 5000
CACHE_S = 7 * 86400
NS = "_external/catalog_field"
TIMEOUT_S = 60  # runs as its own job, never inside the comparison


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _circle(ra_col: str, dec_col: str, ra: float, dec: float, r: float) -> str:
    # floats only, fixed precision: no request text reaches the ADQL
    return f"1 = CONTAINS(POINT('ICRS', {ra_col}, {dec_col}), CIRCLE('ICRS', {ra:.7f}, {dec:.7f}, {r:.6f}))"


def brightest(rows: list[dict], n: int = MAX_ROWS) -> list[dict]:
    """Brightest first (smaller magnitude); rows without a magnitude go last."""
    return sorted(rows, key=lambda x: (x.get("mag") is None, x.get("mag") or 0.0))[:n]


async def _irsa(table: str, ra: float, dec: float, r: float) -> list[dict]:
    """IRSA Simple Cone Search (IVOA SCS) on the same tables as the TAP service. Live 2026-11-14 for a
    0.071° Barnard cone: TAP (allwise_p3as_psd) did not answer within 100 s, the cone search took 2 s."""
    resp = await http.get(
        IRSA_SCS,
        params={"table": table, "RA": f"{ra:.7f}", "DEC": f"{dec:.7f}", "SR": f"{r:.6f}", "format": "csv"},
        timeout=TIMEOUT_S,
        retries=2,  # IRSA's proxy answered 502 on 2026-11-14 (live test); Gator below is the fallback
    )
    text = resp.text
    if resp.status_code == 200 and not text.lstrip().startswith("<"):
        return list(csv.DictReader(io.StringIO(text)))[:FETCH_ROWS]
    # Later on 2026-11-14 the SCS answered 502 for every field while Gator (same host and tables) worked
    log.info("IRSA SCS %s -> %s, falling back to Gator", table, resp.status_code)
    return await _gator(table, ra, dec, r)


async def _gator(table: str, ra: float, dec: float, r: float) -> list[dict]:
    resp = await http.get(
        IRSA_GATOR,
        params={
            "catalog": table,
            "spatial": "cone",
            "objstr": f"{ra:.7f} {dec:+.7f}",
            "radius": f"{r * 3600:.1f}",
            "radunits": "arcsec",
            "outfmt": "1",  # IPAC table
            "selcols": GATOR_COLUMNS[table],
        },
        timeout=TIMEOUT_S,
        retries=2,
    )
    if resp.status_code != 200 or not resp.text.lstrip().startswith("\\"):
        raise UpstreamError("UPSTREAM_UNAVAILABLE", "irsa", f"Gator {table} {resp.status_code}")
    t = await asyncio.to_thread(Table.read, resp.text, format="ascii.ipac")
    # masked cells become '--', which _num() turns into None ("veri yok")
    return [{c: str(row[c]) for c in t.colnames} for row in t[:FETCH_ROWS]]


async def allwise(ra: float, dec: float, r: float) -> list[dict]:
    rows = await _irsa("allwise_p3as_psd", ra, dec, r)
    out = []
    for x in rows:
        # ra_pm/dec_pm: the position fitted together with the motion, at MJD 55400 (AllWISE supplement)
        pra, pdec = _num(x.get("ra_pm")), _num(x.get("dec_pm"))
        if pra is None or pdec is None:
            pra, pdec = _num(x.get("ra")), _num(x.get("dec"))
        if pra is None or pdec is None:
            continue
        out.append(
            {
                "cat": "AllWISE",
                "id": (x.get("designation") or "").strip(),
                "ra": pra,
                "dec": pdec,
                "mag": _num(x.get("w1mpro")),
                "band": "W1",
                "w2": _num(x.get("w2mpro")),
                "pmra": _num(x.get("pmra")),
                "pmdec": _num(x.get("pmdec")),
                "sigpmra": _num(x.get("sigpmra")),
                "sigpmdec": _num(x.get("sigpmdec")),
            }
        )
    return out


async def twomass(ra: float, dec: float, r: float) -> list[dict]:
    rows = await _irsa("fp_psc", ra, dec, r)
    out = []
    for x in rows:
        if _num(x.get("ra")) is None or _num(x.get("dec")) is None:
            continue
        out.append(
            {
                "cat": "2MASS",
                "id": (x.get("designation") or "").strip(),
                "ra": _num(x["ra"]),
                "dec": _num(x["dec"]),
                "mag": _num(x.get("k_m")),
                "band": "Ks",
                "j": _num(x.get("j_m")),
                "h": _num(x.get("h_m")),
            }
        )
    return out


async def simbad_field(ra: float, dec: float, r: float) -> list[dict]:
    rows = await simbad.tap_query(
        f"SELECT TOP {MAX_ROWS * 2} b.main_id, b.ra, b.dec, b.otype, b.pmra, b.pmdec, f.K, f.V, i.id "  # noqa: S608
        "FROM basic AS b LEFT JOIN allfluxes AS f ON f.oidref = b.oid "
        "LEFT JOIN ident AS i ON i.oidref = b.oid AND i.id LIKE 'NAME %' "
        f"WHERE {_circle('b.ra', 'b.dec', ra, dec, r)}",
        timeout=TIMEOUT_S,
    )
    seen: dict[str, dict] = {}
    for x in rows:
        mid = " ".join((x.get("main_id") or "").split())  # SIMBAD pads ids: 'GAT  771'
        if not mid or _num(x.get("ra")) is None or _num(x.get("dec")) is None:
            continue
        name = (x.get("id") or "").strip()
        name = name[5:].strip() if name.startswith("NAME ") else None
        if mid in seen:  # several NAME identifiers: keep the first
            continue
        k, v = _num(x.get("K")), _num(x.get("V"))
        seen[mid] = {
            "cat": "SIMBAD",
            "id": mid,
            "name": name,
            "otype": (x.get("otype") or "").strip() or None,
            "ra": _num(x["ra"]),
            "dec": _num(x["dec"]),
            "pmra": _num(x.get("pmra")),
            "pmdec": _num(x.get("pmdec")),
            "mag": k if k is not None else v,
            "band": "K" if k is not None else ("V" if v is not None else None),
        }
    return list(seen.values())


async def field(ra: float, dec: float, radius_deg: float) -> dict:
    """All three catalogues around (ra, dec); a failing one is reported in `errors`, the others still come.
    Only a complete answer is cached (key: position and radius, never a date)."""
    key = f"{ra:.4f}_{dec:+.4f}_{radius_deg:.4f}"
    hit = cache.get_json(NS, key, CACHE_S)
    if hit is not None:
        return hit
    names = ("allwise", "twomass", "simbad")
    res = await asyncio.gather(
        allwise(ra, dec, radius_deg),
        twomass(ra, dec, radius_deg),
        simbad_field(ra, dec, radius_deg),
        return_exceptions=True,
    )
    out: dict = {"errors": []}
    for n, r in zip(names, res, strict=True):
        if isinstance(r, BaseException):
            log.info("catalog %s failed: %r", n, r)
            out[n] = []
            out["errors"].append(n)
        else:
            out[n] = brightest(r)
    if not out["errors"]:
        cache.put_json(NS, key, out)
    return out
