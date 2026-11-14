import asyncio

import pytest
from astropy.wcs import WCS

from skytracker.domain.astrometry import jyear_to_mjd
from skytracker.providers import catalogs as K
from skytracker.services import catalog_layer as L


def tan_wcs(ra=269.45, dec=4.74, scale_arcsec=6.15, n=60):
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [n / 2 + 0.5, n / 2 + 0.5]  # 1-based centre
    w.wcs.cdelt = [-scale_arcsec / 3600, scale_arcsec / 3600]
    return w


FIELD = {
    "allwise": [
        # fast mover with significant motion -> moved; named via SIMBAD
        {
            "cat": "AllWISE",
            "id": "J175747.94+044323.8",
            "ra": 269.4498,
            "dec": 4.7241,
            "mag": 4.4,
            "band": "W1",
            "pmra": -800.0,
            "sigpmra": 70.0,
            "pmdec": 10300.0,
            "sigpmdec": 70.0,
        },
        # insignificant motion -> catalogue epoch
        {
            "cat": "AllWISE",
            "id": "J175734.10+044619.8",
            "ra": 269.3921,
            "dec": 4.7722,
            "mag": 9.3,
            "band": "W1",
            "pmra": -21.0,
            "sigpmra": 39.0,
            "pmdec": 51.0,
            "sigpmdec": 39.0,
        },
        {"cat": "AllWISE", "id": "J180500.00+100000.0", "ra": 271.25, "dec": 10.0, "mag": 3.0, "band": "W1"},
    ],
    "twomass": [
        {"cat": "2MASS", "id": "17574653+0447466", "ra": 269.4439, "dec": 4.7700, "mag": 9.3, "band": "Ks"}
    ],
    "simbad": [
        {
            "cat": "SIMBAD",
            "id": "NAME Barnard's star",
            "name": "Barnard's star",
            "otype": "BY*",
            "ra": 269.4520770,
            "dec": 4.6933650,
            "pmra": -801.551,
            "pmdec": 10362.394,
            "mag": 4.5,
            "band": "K",
        }
    ],
    "errors": [],
}


def test_short_codes():
    assert L.short_code("AllWISE", "J175747.94+044323.8") == "J1757+0443"
    assert L.short_code("2MASS", "17574653+0447466") == "J1757+0447"
    assert L.short_code("2MASS", "") == "2MASS"
    assert L.coord_code(133.79, -7.245) == "J0855-0714"


def test_simbad_labels_never_say_gaia_and_drop_star_prefixes():
    s = {"id": "Gaia DR3 5756955162623284096", "name": None}
    assert L.simbad_label(s, 133.79, -7.245) == "J0855-0714"
    assert L.simbad_label({"id": "V* RW Aur", "name": None}, 0, 0) == "RW Aur"
    assert L.simbad_label({"id": "* eps Ind B", "name": None}, 0, 0) == "eps Ind B"
    assert L.simbad_label({"id": "NAME Barnard's star", "name": "Barnard's star"}, 0, 0) == "Barnard's star"


def test_the_same_label_text_is_drawn_once():
    field = {
        "allwise": [{"cat": "AllWISE", "id": "J175746.52+044746.6", "ra": 269.444, "dec": 4.76, "mag": 9.0}],
        "twomass": [{"cat": "2MASS", "id": "17574699+0447530", "ra": 269.4458, "dec": 4.7647, "mag": 9.2}],
        "simbad": [],
    }
    out = L.build(field, tan_wcs(), 60900.0, (269.45, 4.74), (60, 60))
    assert [i["label"] for i in out["items"]] == ["J1757+0447", "J1757+0447"]  # 17″ apart, same code
    assert sum(1 for i in out["items"] if i.get("labelled")) == 1


def test_positions_are_moved_only_when_the_catalogue_has_the_motion():
    mjd = jyear_to_mjd(2025.6)
    ra, dec, ep = L.position_at(FIELD["simbad"][0], mjd)
    assert ep == "moved" and dec - FIELD["simbad"][0]["dec"] == pytest.approx(10.362 * 25.6 / 3600, rel=1e-3)
    assert L.position_at(FIELD["allwise"][1], mjd)[2] == "catalog"  # 21 ± 39 mas/yr: not significant
    assert L.position_at(FIELD["allwise"][0], mjd)[2] == "moved"
    assert L.position_at(FIELD["twomass"][0], mjd)[2] == "catalog"  # 2MASS has no proper motion


def test_build_names_labels_and_drops_out_of_field_sources():
    out = L.build(FIELD, tan_wcs(), jyear_to_mjd(2025.6), (269.45, 4.74), (60, 60))
    keys = [i["key"] for i in out["items"]]
    assert "AllWISE:J180500.00+100000.0" not in keys  # 1.7° away: outside the cutout
    aw = next(i for i in out["items"] if i["id"] == "J175747.94+044323.8")
    assert aw["label"] == "Barnard's star" and aw["full_name"].startswith("AllWISE J175747.94")
    tm = next(i for i in out["items"] if i["cat"] == "2MASS")
    assert tm["label"] == "J1757+0447" and tm["epoch"] == "catalog"
    # one label per star: SIMBAD Barnard and AllWISE Barnard coincide -> only the brighter one labelled
    labelled = [i for i in out["items"] if i.get("labelled")]
    assert sum(1 for i in labelled if i["label"] == "Barnard's star") == 1
    assert not any("Gaia" in i["cat"] for i in out["items"])
    assert set(out["sources"]) == {"AllWISE", "2MASS", "SIMBAD"}


def test_irsa_falls_back_to_gator_when_the_cone_search_fails(monkeypatch):
    calls = []
    ipac = (
        "\\fixlen = T\n"
        "|designation      |ra       |dec      |j_m   |h_m   |k_m   |\n"
        "|char             |double   |double   |double|double|double|\n"
        "|                 |deg      |deg      |mag   |mag   |mag   |\n"
        "|null             |null     |null     |null  |null  |null  |\n"
        " 05074953+3024050  76.95641  30.401409  8.378  7.621  7.020\n"
        " 05074999+3025000  76.95830  30.416667  null   9.100  8.900\n"
    )

    class R:
        def __init__(self, code, text):
            self.status_code, self.text = code, text

    async def get(url, params=None, **kw):
        calls.append(url)
        if url == K.IRSA_SCS:
            return R(502, "<!DOCTYPE HTML><title>502 Proxy Error</title>")
        assert params["catalog"] == "fp_psc" and params["outfmt"] == "1"
        return R(200, ipac)

    monkeypatch.setattr(K.http, "get", get)
    rows = asyncio.run(K.twomass(76.96, 30.40, 0.07))
    assert calls == [K.IRSA_SCS, K.IRSA_GATOR]
    assert rows[0]["id"] == "05074953+3024050" and rows[0]["mag"] == pytest.approx(7.02)
    assert rows[1]["j"] is None  # null -> "veri yok", never 0


def test_field_cache_key_has_no_date_and_partial_answers_are_not_cached(monkeypatch, tmp_path):
    stored = {}
    monkeypatch.setattr(K.cache, "get_json", lambda ns, key, ttl: stored.get(key))
    monkeypatch.setattr(K.cache, "put_json", lambda ns, key, v: stored.__setitem__(key, v))

    async def ok(*a):
        return [{"cat": "x", "mag": 2.0}, {"cat": "x", "mag": 1.0}, {"cat": "x", "mag": None}]

    async def fail(*a):
        raise K.UpstreamError("UPSTREAM_UNAVAILABLE", "irsa")

    monkeypatch.setattr(K, "allwise", ok)
    monkeypatch.setattr(K, "twomass", fail)
    monkeypatch.setattr(K, "simbad_field", ok)
    out = asyncio.run(K.field(269.45, 4.74, 0.07))
    assert out["errors"] == ["twomass"] and [r["mag"] for r in out["allwise"]] == [1.0, 2.0, None]
    assert stored == {}
    monkeypatch.setattr(K, "twomass", ok)
    asyncio.run(K.field(269.45, 4.74, 0.07))
    assert list(stored) == ["269.4500_+4.7400_0.0700"]
