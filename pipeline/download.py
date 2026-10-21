"""Download der Rohdaten mit Zwischenspeicher (pipeline/cache/). Mehrfach ausführbar.

Aufruf: python -m pipeline.download [boundary] [terrain] [buildings] [ortho] [osm] [gwr]
Ohne Argument werden alle Quellen geladen.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import requests
from pyproj import Transformer
from shapely.geometry import Polygon, shape

from . import config

_session = requests.Session()
_session.headers["User-Agent"] = config.USER_AGENT


def cached_download(url: str, dest: Path, *, retries: int = 4) -> Path:
    """Lädt eine Datei einmalig; vorhandene, vollständige Dateien werden nicht erneut geladen."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, retries + 1):
        try:
            with _session.get(url, stream=True, timeout=120) as response:
                response.raise_for_status()
                with open(tmp, "wb") as handle:
                    for chunk in response.iter_content(1 << 20):
                        handle.write(chunk)
            tmp.replace(dest)
            return dest
        except requests.RequestException as error:
            if attempt == retries:
                raise
            print(f"  Wiederholung {attempt}/{retries} für {url}: {error}", file=sys.stderr)
            time.sleep(2 * attempt)
    raise RuntimeError("unreachable")


def cached_json(url: str, dest: Path, *, params: dict | None = None, post: str | None = None) -> dict:
    if dest.exists() and dest.stat().st_size > 0:
        return json.loads(dest.read_text())
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, 5):
        try:
            if post is not None:
                response = _session.post(url, data={"data": post}, timeout=300)
            else:
                response = _session.get(url, params=params, timeout=120)
            response.raise_for_status()
            data = response.json()
            dest.write_text(json.dumps(data))
            return data
        except (requests.RequestException, ValueError) as error:
            if attempt == 4:
                raise
            print(f"  Wiederholung {attempt}/4 für {url}: {error}", file=sys.stderr)
            time.sleep(5 * attempt)
    raise RuntimeError("unreachable")


# --- Gemeindegrenze --------------------------------------------------------

def fetch_boundary():
    """Gemeindepolygon (LV95) aus swissBOUNDARIES3D über die geo.admin.ch-Identify-API."""
    to_lv95 = Transformer.from_crs(config.CRS_WGS84, config.CRS_LV95, always_xy=True)
    easting, northing = to_lv95.transform(*config.LOOKUP_POINT_WGS84)
    params = {
        "geometry": f"{easting},{northing}",
        "geometryType": "esriGeometryPoint",
        "sr": 2056,
        "layers": "all:ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill",
        "tolerance": 0,
        "mapExtent": f"{easting - 500},{northing - 500},{easting + 500},{northing + 500}",
        "imageDisplay": "100,100,96",
        "returnGeometry": "true",
        "geometryFormat": "geojson",
    }
    raw = cached_json(f"{config.GEOADMIN_API}/identify", config.CACHE_DIR / "boundary_raw.json", params=params)
    candidates = [r for r in raw["results"] if r["properties"].get("gde_nr") == config.MUNICIPALITY_BFS]
    if not candidates:
        raise RuntimeError("Gemeindepolygon nicht gefunden")
    latest = max(candidates, key=lambda r: r["properties"]["jahr"])
    geometry = shape(latest["geometry"])
    if geometry.bounds[0] < 2_000_000:
        raise RuntimeError(f"Unerwartetes Koordinatensystem: {geometry.bounds}")
    return geometry, latest["properties"]


def study_area():
    """Gemeindepolygon, gepufferte Fläche und lokaler Ursprung."""
    boundary, properties = fetch_boundary()
    buffered = boundary.buffer(config.BUFFER_M)
    min_e, min_n, max_e, max_n = boundary.bounds
    step = config.ORIGIN_ROUNDING_M
    origin = (round((min_e + max_e) / 2 / step) * step, round((min_n + max_n) / 2 / step) * step)
    return boundary, buffered, origin, properties


def wgs84_bbox(geometry) -> tuple[float, float, float, float]:
    to_wgs = Transformer.from_crs(config.CRS_LV95, config.CRS_WGS84, always_xy=True)
    min_e, min_n, max_e, max_n = geometry.bounds
    west, south = to_wgs.transform(min_e, min_n)
    east, north = to_wgs.transform(max_e, max_n)
    return west, south, east, north


# --- STAC (swisstopo) ------------------------------------------------------

def stac_items(collection: str, geometry) -> list[dict]:
    """Alle STAC-Items einer Collection, die die Geometrie schneiden (mit Paginierung)."""
    west, south, east, north = wgs84_bbox(geometry)
    url = f"{config.STAC_BASE}/collections/{collection}/items"
    params = {"bbox": f"{west},{south},{east},{north}", "limit": 100}
    items: list[dict] = []
    while url:
        response = _session.get(url, params=params, timeout=60)
        response.raise_for_status()
        page = response.json()
        items.extend(page["features"])
        url = next((link["href"] for link in page.get("links", []) if link["rel"] == "next"), None)
        params = None
    return items


def intersects_lv95(item: dict, geometry_lv95) -> bool:
    to_lv95 = Transformer.from_crs(config.CRS_WGS84, config.CRS_LV95, always_xy=True)
    ring = item["geometry"]["coordinates"][0]
    return Polygon([to_lv95.transform(x, y) for x, y in ring]).intersects(geometry_lv95)


def latest_per_tile(items: list[dict], tile_key) -> list[dict]:
    """Behält je Kachel nur die aktuellste Version (Item-Datum)."""
    chosen: dict[str, dict] = {}
    for item in items:
        key = tile_key(item["id"])
        if key is None:
            continue
        if key not in chosen or item["properties"]["datetime"] > chosen[key]["properties"]["datetime"]:
            chosen[key] = item
    return list(chosen.values())


def download_terrain(buffered) -> list[Path]:
    area = buffered.envelope  # Rechteck, damit das Raster keine Lücken hat
    items = [i for i in stac_items("ch.swisstopo.swissalti3d", area) if intersects_lv95(i, area)]
    tiles = latest_per_tile(items, lambda item_id: item_id.rsplit("_", 1)[-1])
    paths = []
    suffix = f"_{config.DEM_SOURCE_RESOLUTION}_2056_5728.tif"
    for item in sorted(tiles, key=lambda i: i["id"]):
        asset = next(a for name, a in item["assets"].items() if name.endswith(suffix))
        paths.append(cached_download(asset["href"], config.CACHE_DIR / "terrain" / Path(asset["href"]).name))
    print(f"Gelände: {len(paths)} Kacheln")
    return paths


def download_buildings(buffered) -> list[Path]:
    items = [i for i in stac_items("ch.swisstopo.swissbuildings3d_3_0", buffered) if intersects_lv95(i, buffered)]
    # Vollabdeckungs-Items (ohne Kachel-ID, mehrere GB) werden übersprungen.
    items = [i for i in items if i["id"].count("_") >= 4]
    tiles = latest_per_tile(items, lambda item_id: item_id.rsplit("_", 1)[-1])
    paths = []
    for item in sorted(tiles, key=lambda i: i["id"]):
        asset = next(a for name, a in item["assets"].items() if name.endswith(".gdb.zip"))
        paths.append(cached_download(asset["href"], config.CACHE_DIR / "buildings" / Path(asset["href"]).name))
    print(f"swissBUILDINGS3D: {len(paths)} Kacheln")
    return paths


def download_ortho(buffered) -> list[Path]:
    area = buffered.envelope
    items = [i for i in stac_items("ch.swisstopo.swissimage-dop10", area) if intersects_lv95(i, area)]
    tiles = latest_per_tile(items, lambda item_id: item_id.rsplit("_", 1)[-1])
    paths = []
    suffix = f"_{config.ORTHO_RESOLUTION_M}_2056.tif"
    for item in sorted(tiles, key=lambda i: i["id"]):
        asset = next(a for name, a in item["assets"].items() if name.endswith(suffix))
        paths.append(cached_download(asset["href"], config.CACHE_DIR / "ortho" / Path(asset["href"]).name))
    print(f"SWISSIMAGE: {len(paths)} Kacheln")
    return paths


def download_gwr() -> Path:
    """GWR-Kantonsauszug (BFS, Open Government Data) und die benötigten CSV-Dateien."""
    import zipfile
    folder = config.CACHE_DIR / "gwr"
    archive = cached_download(config.GWR_URL, folder / "sz.zip")
    with zipfile.ZipFile(archive) as bundle:
        for name in ("gebaeude_batiment_edificio.csv", "eingang_entree_entrata.csv", "kodes_codes_codici.csv"):
            if not (folder / name).exists():
                bundle.extract(name, folder)
    print("GWR: Kanton SZ geladen")
    return folder


def main(argv: list[str]) -> None:
    wanted = set(argv) or {"boundary", "terrain", "buildings", "ortho", "gwr"}
    if "gwr" in wanted:
        download_gwr()
    boundary, buffered, origin, properties = study_area()
    print(f"Gemeinde {properties['gemname']} (BFS {properties['gde_nr']}), Stand {properties['jahr']}, Ursprung {origin}")
    if "terrain" in wanted:
        download_terrain(buffered)
    if "buildings" in wanted:
        download_buildings(buffered)
    if "ortho" in wanted:
        download_ortho(buffered)


if __name__ == "__main__":
    main(sys.argv[1:])
