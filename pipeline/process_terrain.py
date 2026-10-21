"""Gelände (swissALTI3D) und Luftbild (SWISSIMAGE) -> dem.bin, ortho.jpg.

dem.bin (little endian, ohne Header):
  Uint16[nx * ny], Index = j * nx + i, i = West->Ost, j = Süd->Nord.
  Höhe in m ü. M. = metadata.elevationOffset + wert * metadata.dem.heightScale
Georeferenz und Raster stehen in metadata.json (Abschnitt "dem").
"""
from __future__ import annotations

import sys

import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.enums import Resampling
from PIL import Image

from . import config, download
from .common import compute_extent, extent_dict, update_metadata

HEIGHT_SCALE_M = 0.1
Image.MAX_IMAGE_PIXELS = None


def build_dem(buffered, origin) -> None:
    extent = compute_extent(buffered, config.DEM_CELL_M)
    tiles = download.download_terrain(buffered)
    half = extent.cell / 2
    bounds = (extent.min_e - half, extent.min_n - half, extent.max_e + half, extent.max_n + half)
    datasets = [rasterio.open(path) for path in tiles]
    try:
        mosaic, _ = merge(datasets, bounds=bounds, res=extent.cell, resampling=Resampling.average, nodata=-9999)
    finally:
        for dataset in datasets:
            dataset.close()
    heights = mosaic[0].astype("float32")[::-1]  # Süd->Nord
    heights = heights[: extent.ny, : extent.nx]
    invalid = (heights <= -9000) | ~np.isfinite(heights)
    if invalid.all():
        raise RuntimeError("Gelände enthält keine gültigen Höhen")
    if invalid.any():
        print(f"  {invalid.sum()} Zellen ohne Höhe, mit Minimum gefüllt")
        heights[invalid] = heights[~invalid].min()

    elevation_offset = float(np.floor(heights.min() / 10) * 10)
    quantised = np.round((heights - elevation_offset) / HEIGHT_SCALE_M)
    if quantised.max() > 65535:
        raise RuntimeError("Höhenbereich überschreitet Uint16")
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    quantised.astype("<u2").tofile(config.OUT_DIR / "dem.bin")

    update_metadata("dem", {
        "file": "dem.bin",
        "format": "uint16-le, row-major, j=Süd->Nord, i=West->Ost",
        "extent": extent_dict(extent),
        "heightScale": HEIGHT_SCALE_M,
        "elevationOffset": elevation_offset,
        "minHeight": float(heights.min()),
        "maxHeight": float(heights.max()),
        "origin": list(origin),
        "crs": config.CRS_LV95,
        "source": "swisstopo swissALTI3D",
        "sourceResolutionM": config.DEM_SOURCE_RESOLUTION,
    })
    print(f"dem.bin: {extent.nx}x{extent.ny} Punkte, {heights.min():.1f}..{heights.max():.1f} m ü. M.")


def build_ortho(buffered) -> None:
    extent = compute_extent(buffered, config.DEM_CELL_M)
    tiles = download.download_ortho(buffered)
    bounds = (extent.min_e, extent.min_n, extent.max_e, extent.max_n)
    datasets = [rasterio.open(path) for path in tiles]
    try:
        mosaic, _ = merge(datasets, bounds=bounds, res=config.ORTHO_RESOLUTION_M, indexes=[1, 2, 3], nodata=0)
    finally:
        for dataset in datasets:
            dataset.close()
    image = Image.fromarray(np.transpose(mosaic, (1, 2, 0)).astype("uint8"))
    image.save(config.OUT_DIR / "ortho.jpg", quality=85, optimize=True)
    update_metadata("ortho", {
        "file": "ortho.jpg",
        "width": image.width,
        "height": image.height,
        "extent": [extent.min_e, extent.min_n, extent.max_e, extent.max_n],
        "resolutionM": config.ORTHO_RESOLUTION_M,
        "source": "swisstopo SWISSIMAGE 10 cm (2-m-Kacheln)",
    })
    print(f"ortho.jpg: {image.width}x{image.height}")


def main(argv: list[str]) -> None:
    wanted = set(argv) or {"dem", "ortho"}
    _, buffered, origin, _ = download.study_area()
    if "dem" in wanted:
        build_dem(buffered, origin)
    if "ortho" in wanted:
        build_ortho(buffered)


if __name__ == "__main__":
    main(sys.argv[1:])
