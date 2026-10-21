"""Dachfarbe je Gebäude aus dem SWISSIMAGE-Luftbild (WMS, 0.5 m) abgeleitet.

Die Dachflächen des 3D-Modells werden auf das Luftbild projiziert; der Median der Pixel (leicht erodiert)
ergibt eine Farbe. Das ist eine Näherung: Schatten, Dachaufbauten und Lagegenauigkeit des Luftbilds beeinflussen sie.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from . import config, download

TILE_M = 1000
RESOLUTION_M = 0.5
TILE_PX = int(TILE_M / RESOLUTION_M)


def tile_path(e0: int, n0: int) -> Path:
    return config.CACHE_DIR / "ortho_hires" / f"{e0}_{n0}.jpg"


def fetch_tile(e0: int, n0: int) -> Path:
    params = (
        "SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=ch.swisstopo.swissimage&STYLES=&SRS=EPSG:2056"
        f"&BBOX={e0},{n0},{e0 + TILE_M},{n0 + TILE_M}&WIDTH={TILE_PX}&HEIGHT={TILE_PX}&FORMAT=image/jpeg"
    )
    return download.cached_download(f"{config.WMS_URL}?{params}", tile_path(e0, n0))


class RoofSampler:
    def __init__(self) -> None:
        self._tiles: dict[tuple[int, int], np.ndarray] = {}

    def _tile(self, e0: int, n0: int) -> np.ndarray:
        key = (e0, n0)
        if key not in self._tiles:
            with Image.open(fetch_tile(e0, n0)) as image:
                self._tiles[key] = np.asarray(image.convert("RGB"))
        return self._tiles[key]

    def _crop(self, min_e: float, min_n: float, max_e: float, max_n: float):
        """Bildausschnitt (RGB) mit Ursprung oben links bei (min_e, max_n)."""
        width = max(1, int(math.ceil((max_e - min_e) / RESOLUTION_M)))
        height = max(1, int(math.ceil((max_n - min_n) / RESOLUTION_M)))
        out = np.zeros((height, width, 3), dtype=np.uint8)
        for e0 in range(int(min_e // TILE_M) * TILE_M, int(max_e // TILE_M) * TILE_M + 1, TILE_M):
            for n0 in range(int(min_n // TILE_M) * TILE_M, int(max_n // TILE_M) * TILE_M + 1, TILE_M):
                tile = self._tile(e0, n0)
                # Pixelbereich dieses Tiles im Ausschnitt
                x0 = int(round((max(e0, min_e) - min_e) / RESOLUTION_M))
                y0 = int(round((max_n - min(n0 + TILE_M, max_n)) / RESOLUTION_M))
                tx0 = int(round((max(e0, min_e) - e0) / RESOLUTION_M))
                ty0 = int(round(((n0 + TILE_M) - min(n0 + TILE_M, max_n)) / RESOLUTION_M))
                w = min(width - x0, TILE_PX - tx0)
                h = min(height - y0, TILE_PX - ty0)
                if w > 0 and h > 0:
                    out[y0:y0 + h, x0:x0 + w] = tile[ty0:ty0 + h, tx0:tx0 + w]
        return out

    def roof_color(self, vertices: np.ndarray, triangles: np.ndarray, surfaces: np.ndarray) -> str | None:
        """vertices in LV95 (E, N, Höhe); liefert '#rrggbb' oder None."""
        roof = triangles[surfaces[triangles[:, 0]] == 1]
        if len(roof) == 0:
            return None
        points = vertices[np.unique(roof)][:, :2]
        pad = 1.0
        min_e, min_n = points.min(axis=0) - pad
        max_e, max_n = points.max(axis=0) + pad
        crop = self._crop(min_e, min_n, max_e, max_n)
        mask_image = Image.new("L", (crop.shape[1], crop.shape[0]), 0)
        draw = ImageDraw.Draw(mask_image)
        for triangle in roof:
            xy = [((vertices[i, 0] - min_e) / RESOLUTION_M, (max_n - vertices[i, 1]) / RESOLUTION_M) for i in triangle]
            draw.polygon(xy, fill=1)
        mask = np.asarray(mask_image, dtype=bool)
        eroded = ndimage.binary_erosion(mask, iterations=2)
        if eroded.sum() >= 12:
            mask = eroded
        pixels = crop[mask]
        if len(pixels) < 4:
            return None
        median = np.median(pixels, axis=0).astype(int)
        return "#{:02x}{:02x}{:02x}".format(*median)
