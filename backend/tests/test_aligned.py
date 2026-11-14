import io

import numpy as np
import pytest
from astropy.io import fits

from skytracker.services import aligned as A


def synthetic_cutout(ra=150.0, dec=20.0, n=40, rot=True, star_dx_arcsec=30.0):
    """A cutout whose pixel grid is rotated (SPHEREx detectors are not north-aligned) with one star
    30″ east of the target. HOT flag set on one pixel."""
    scale = 6.15 / 3600
    c, s = (np.cos(np.radians(30)), np.sin(np.radians(30))) if rot else (1.0, 0.0)
    h = fits.Header()
    h.update(
        {
            "CTYPE1": "RA---TAN",
            "CTYPE2": "DEC--TAN",
            "CRVAL1": ra,
            "CRVAL2": dec,
            "CRPIX1": n / 2 + 0.5,
            "CRPIX2": n / 2 + 0.5,
            "CD1_1": -scale * c,
            "CD1_2": scale * s,
            "CD2_1": scale * s,
            "CD2_2": scale * c,
            "MJD-AVG": 60900.0,
        }
    )
    from astropy.wcs import WCS

    w = WCS(h)
    yy, xx = np.mgrid[0:n, 0:n]
    sx, sy = w.world_to_pixel_values(ra + star_dx_arcsec / 3600 / np.cos(np.radians(dec)), dec)
    img = (1.0 + 50 * np.exp(-((xx - sx) ** 2 + (yy - sy) ** 2) / 2.0)).astype(np.float32)
    flags = np.zeros((n, n), np.int32)
    flags[5, 5] = 1 << 3
    wh = fits.Header({"CTYPE1": "X", "CTYPE2": "Y"})
    return h, img, flags, wh, (float(sx), float(sy))


def test_robust_combine_rejects_an_outlier_and_ignores_nan():
    a = np.full((3, 3), 1.0, np.float32)
    b = a.copy()
    c = a.copy()
    c[1, 1] = 100.0  # cosmic ray in one frame
    b[0, 0] = np.nan  # masked in another
    out = A.robust_combine([a, b, c, a.copy()])
    assert out[1, 1] == pytest.approx(1.0)
    assert out[0, 0] == pytest.approx(1.0)
    assert A.robust_combine([a]) is a


def test_same_channel_is_the_half_bandwidth_rule():
    assert A.same_channel(2.000, 2.010, 0.04)
    assert not A.same_channel(2.000, 2.030, 0.04)


def test_grid_size_is_native_pixel_scale():
    assert A.grid_size(0.1) == 59
    assert A.grid_size(0.25) == 146


def test_north_up_puts_east_on_the_left(monkeypatch):
    h, img, flags, _, _ = synthetic_cutout()
    from astropy.wcs import WCS

    monkeypatch.setattr(A, "celestial_wcs", lambda ih: WCS(ih))

    class _W:
        def pixel_to_world_values(self, x, y):
            return 2.0, 0.04

    monkeypatch.setattr(A, "wave_wcs", lambda ih, wh: _W())
    monkeypatch.setattr(A.F, "flag_schema", lambda hdr: {"HOT": 3})
    hdul = fits.HDUList(
        [
            fits.PrimaryHDU(),
            fits.ImageHDU(img, h, name="IMAGE"),
            fits.ImageHDU(np.zeros_like(img), name="ZODI"),
            fits.ImageHDU(flags, name="FLAGS"),
            fits.ImageHDU(name="WCS-WAVE"),
        ]
    )
    buf = io.BytesIO()
    hdul.writeto(buf)
    out = A.north_up(buf.getvalue(), 150.0, 20.0, 0.05, "raw")
    d = out["data"]
    n = out["n"]
    y, x = np.unravel_index(np.nanargmax(d), d.shape)
    c = (n - 1) / 2
    # star 30″ east (≈ 4.9 px): to the LEFT of centre (smaller column), same row
    assert c - x == pytest.approx(30 / 6.15, abs=1.0)
    assert abs(y - c) <= 1
    assert out["lam"] == 2.0
