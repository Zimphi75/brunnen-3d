"""Bäume aus dem BAFU-Vegetationshöhenmodell (NFI, 1 m) -> trees.bin (+ OSM-Einzelbäume als Kontrolle).

Methode: lokale Maxima im geglätteten Vegetationshöhenmodell (Höhe >= MIN_HEIGHT_M, Mindestabstand ~3 m).
Die Kronenradien sind aus der Höhe geschätzt (Allometrie), nicht gemessen.

trees.bin (little endian):
  Header (4 x uint32): magic "TRE1", version (=1), treeCount, 0
  Float32[treeCount]  x (lokal, Ost)
  Float32[treeCount]  z (lokal, -Nord)
  Uint8[treeCount]    Höhe in 0.5 m  (aufgefüllt auf 4 Byte)
  Uint8[treeCount]    Kronenradius in 0.25 m (aufgefüllt auf 4 Byte)
Die Höhe über Meer ergibt sich im Browser aus dem Gelände.
"""
from __future__ import annotations

import struct

import numpy as np
import rasterio
import shapely
from rasterio.windows import from_bounds
from pyproj import Transformer
from scipy import ndimage
from scipy.spatial import cKDTree

from . import config, download
from .common import update_metadata

MIN_HEIGHT_M = 2.5
SMOOTHING_SIGMA = 1.0
OSM_SUPPLEMENT_DISTANCE_M = 4.0
OSM_DEFAULT_HEIGHT_M = 7.0
MAX_TREES = 250_000
COLLECTION = "ch.bafu.landesforstinventar-vegetationshoehenmodell"


def osm_height(tags: dict) -> float:
    try:
        return float(str(tags.get("height", "")).lower().replace("m", "").strip())
    except ValueError:
        return OSM_DEFAULT_HEIGHT_M


def newest_item(buffered) -> dict:
    items = download.stac_items(COLLECTION, buffered.envelope)
    west, south, east, north = download.wgs84_bbox(buffered.envelope)
    covering = [i for i in items if i["bbox"][0] <= west and i["bbox"][1] <= south and i["bbox"][2] >= east and i["bbox"][3] >= north]
    if not covering:
        raise RuntimeError("Kein Vegetationshöhenmodell deckt das Gebiet ab")
    return max(covering, key=lambda i: i["properties"]["datetime"])


def read_window(buffered, item) -> tuple[np.ndarray, rasterio.Affine, float | None]:
    cache = config.CACHE_DIR / "vegetation" / f"{item['id']}_window.tif"
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        asset = next(iter(item["assets"].values()))
        min_e, min_n, max_e, max_n = buffered.bounds
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
            with rasterio.open(asset["href"]) as source:
                window = from_bounds(min_e, min_n, max_e, max_n, source.transform).round_offsets().round_lengths()
                data = source.read(1, window=window)
                transform = source.window_transform(window)
                profile = dict(driver="GTiff", height=data.shape[0], width=data.shape[1], count=1, dtype=data.dtype,
                               crs=source.crs, transform=transform, nodata=source.nodata, compress="deflate")
        with rasterio.open(cache, "w", **profile) as target:
            target.write(data, 1)
    with rasterio.open(cache) as source:
        return source.read(1), source.transform, source.nodata


def main() -> None:
    boundary, buffered, origin, _ = download.study_area()
    item = newest_item(buffered)
    print("Vegetationshöhenmodell:", item["id"])
    data, transform, nodata = read_window(buffered, item)
    heights = data.astype("float32")
    if nodata is not None:
        heights[data == nodata] = 0
    heights[heights < 0] = 0
    smooth = ndimage.gaussian_filter(heights, sigma=SMOOTHING_SIGMA)
    peaks = (smooth == ndimage.maximum_filter(smooth, size=5)) & (smooth >= MIN_HEIGHT_M)
    rows, cols = np.nonzero(peaks)
    easting = transform.c + (cols + 0.5) * transform.a
    northing = transform.f + (rows + 0.5) * transform.e
    height = smooth[rows, cols]
    inside = shapely.contains_xy(buffered, easting, northing)
    easting, northing, height = easting[inside], northing[inside], height[inside]
    # Kontrolle gegen OSM-Einzelbäume; im Siedlungsgebiet maskiert das Vegetationsmodell Objekte, daher werden
    # nicht erkannte OSM-Bäume ergänzt (Höhe aus dem Tag `height`, sonst Standardwert).
    osm = download.download_osm(buffered, only={"trees"})["trees"]["elements"]
    to_lv95 = Transformer.from_crs(config.CRS_WGS84, config.CRS_LV95, always_xy=True)
    osm_xy = np.array([to_lv95.transform(e["lon"], e["lat"]) for e in osm if "lon" in e]).reshape(-1, 2)
    osm_tags = [e.get("tags", {}) for e in osm if "lon" in e]
    inside_osm = shapely.contains_xy(buffered, osm_xy[:, 0], osm_xy[:, 1]) if len(osm_xy) else np.array([], dtype=bool)
    osm_xy = osm_xy[inside_osm]
    osm_tags = [t for t, keep in zip(osm_tags, inside_osm) if keep]
    detected = cKDTree(np.c_[easting, northing]) if len(easting) else None
    distance = detected.query(osm_xy)[0] if detected is not None and len(osm_xy) else np.full(len(osm_xy), np.inf)
    recall = float(np.mean(distance <= OSM_SUPPLEMENT_DISTANCE_M)) if len(osm_xy) else None
    missing = distance > OSM_SUPPLEMENT_DISTANCE_M
    added_height = np.array([osm_height(t) for t in osm_tags])[missing]
    easting = np.concatenate([easting, osm_xy[missing, 0]])
    northing = np.concatenate([northing, osm_xy[missing, 1]])
    height = np.concatenate([height, added_height])
    detected_count = int(len(height) - missing.sum())
    if len(height) > MAX_TREES:
        keep = np.argsort(-height)[:MAX_TREES]
        easting, northing, height = easting[keep], northing[keep], height[keep]
    radius = np.clip(0.16 * height + 0.6, 1.0, 5.5)
    x = (easting - origin[0]).astype("<f4")
    z = (-(northing - origin[1])).astype("<f4")
    h = np.clip(np.round(height * 2), 0, 255).astype("u1")
    r = np.clip(np.round(radius * 4), 0, 255).astype("u1")
    pad = lambda arr: arr.tobytes() + b"\x00" * (-arr.nbytes % 4)
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(config.OUT_DIR / "trees.bin", "wb") as handle:
        handle.write(struct.pack("<4sIII", b"TRE1", 1, len(x), 0))
        handle.write(x.tobytes() + z.tobytes() + pad(h) + pad(r))
    update_metadata("trees", {
        "file": "trees.bin", "count": int(len(x)), "minHeightM": MIN_HEIGHT_M,
        "method": "Lokale Maxima im Vegetationshöhenmodell; Kronenradius aus Höhe geschätzt; nicht erkannte OSM-Einzelbäume ergänzt",
        "fromVegetationModel": detected_count, "addedFromOsm": int(missing.sum()),
        "validation": {"osmTrees": int(len(osm_xy)), "osmTreesWithModelTreeWithin4m": recall},
        "source": f"BAFU Vegetationshöhenmodell NFI ({item['properties']['datetime'][:4]})",
    })
    print(f"trees.bin: {len(x)} Bäume (Modell {detected_count}, OSM ergänzt {int(missing.sum())}); OSM-Bäume mit Modellbaum <= 4 m: {recall:.0%}")


if __name__ == "__main__":
    main()
