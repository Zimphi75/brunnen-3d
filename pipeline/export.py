"""Gemeindegrenze, GWR-Statistik und Quellenverzeichnis -> municipality.json, statistics.json, sources.json."""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import date

import pandas as pd

from . import config, download
from .common import read_metadata, update_metadata
from .process_osm import flat, to_local_xy  # noqa: F401  (gleiche Rundung und Konvention)

SWISSTOPO_TERMS = "https://www.swisstopo.admin.ch/de/nutzungsbedingungen-kostenlose-geodaten-und-geodienste"
BFS_TERMS = "https://www.bfs.admin.ch/bfs/de/home/dienstleistungen/ogd/nutzungsbedingungen.html"


def local_rings(polygon, origin) -> list[list[float]]:
    rings = [polygon.exterior] + list(polygon.interiors)
    return [flat([(x - origin[0], -(y - origin[1])) for x, y in ring.coords]) for ring in rings]


def export_municipality() -> None:
    boundary, buffered, origin, properties = download.study_area()
    polygons = list(boundary.geoms) if boundary.geom_type == "MultiPolygon" else [boundary]
    min_e, min_n, max_e, max_n = boundary.bounds
    payload = {
        "name": properties["gemname"], "bfs": properties["gde_nr"], "canton": properties["kanton"], "boundaryYear": properties["jahr"],
        "areaHa": round(boundary.area / 1e4, 1), "bufferM": config.BUFFER_M,
        "bboxLv95": [round(min_e), round(min_n), round(max_e), round(max_n)],
        "centerLv95": [round(boundary.centroid.x, 1), round(boundary.centroid.y, 1)],
        "polygons": [local_rings(p, origin) for p in polygons],
    }
    (config.OUT_DIR / "municipality.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    update_metadata("municipality", {"file": "municipality.json", "name": payload["name"], "bfs": payload["bfs"], "areaHa": payload["areaHa"], "bufferM": config.BUFFER_M, "origin": list(origin)})
    print(f"municipality.json: {payload['name']}, {payload['areaHa']} ha")


def export_statistics() -> None:
    folder = download.download_gwr()
    buildings = pd.read_csv(folder / "gebaeude_batiment_edificio.csv", sep="\t", dtype=str)
    codes = pd.read_csv(folder / "kodes_codes_codici.csv", sep="\t", dtype=str)
    label = lambda group: {r.CECODID: r.CODTXTLD for r in codes[codes["CMERKM"] == group].itertuples()}
    mine = buildings[buildings["GGDENR"] == str(config.MUNICIPALITY_BFS)]
    existing = mine[mine["GSTAT"] == "1004"]
    dwellings = pd.to_numeric(existing["GANZWHG"], errors="coerce")
    by = lambda column, group: {label(group).get(k, k): int(v) for k, v in Counter(existing[column].dropna()).most_common()}
    payload = {
        "gwr": {
            "municipality": config.MUNICIPALITY_NAME, "bfs": config.MUNICIPALITY_BFS, "exportDate": str(mine["GEXPDAT"].dropna().max()),
            "buildingsRegistered": int(len(mine)), "buildingsExisting": int(len(existing)),
            "dwellingsInExistingBuildings": int(dwellings.sum()), "buildingsWithDwellingCount": int(dwellings.notna().sum()),
            "byClass": by("GKLAS", "GKLAS"), "byCategory": by("GKAT", "GKAT"), "byPeriod": by("GBAUP", "GBAUP"),
            "note": "Aggregiert aus dem GWR; Einwohnerzahlen (STATPOP) sind in dieser Version nicht integriert.",
        },
    }
    (config.OUT_DIR / "statistics.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1))
    update_metadata("statistics", {"file": "statistics.json", "gwrExportDate": payload["gwr"]["exportDate"]})
    print(f"statistics.json: {payload['gwr']['buildingsExisting']} bestehende Gebäude")


def sources(metadata: dict) -> list[dict]:
    today = date.today().isoformat()
    dem = metadata.get("dem", {})
    return [
        {"id": "boundary", "title": "swissBOUNDARIES3D (Gemeindegrenze)", "provider": "swisstopo", "license": "Open Government Data swisstopo (Quellenangabe)",
         "terms": SWISSTOPO_TERMS, "url": "https://api3.geo.admin.ch/rest/services/all/MapServer (ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill)",
         "coverage": "Schweiz", "crs": "EPSG:2056", "vintage": str(metadata.get("municipality", {}).get("boundaryYear", "aktuell")), "format": "GeoJSON (API)", "retrieved": today, "files": ["municipality.json"]},
        {"id": "terrain", "title": "swissALTI3D", "provider": "swisstopo", "license": "Open Government Data swisstopo (Quellenangabe)", "terms": SWISSTOPO_TERMS,
         "url": f"{config.STAC_BASE}/collections/ch.swisstopo.swissalti3d", "coverage": "Schweiz und Liechtenstein, Aktualisierung alle 6 Jahre", "crs": "EPSG:2056 / LN02",
         "vintage": "jeweils neueste Kachel (STAC)", "format": "Cloud-Optimized GeoTIFF, 2-m-Raster, auf 5 m gemittelt", "retrieved": today, "files": ["dem.bin"], "notes": f"Höhe {dem.get('minHeight')} bis {dem.get('maxHeight')} m ü. M."},
        {"id": "ortho", "title": "SWISSIMAGE 10 cm (2-m-Kacheln)", "provider": "swisstopo", "license": "Open Government Data swisstopo (Quellenangabe)", "terms": SWISSTOPO_TERMS,
         "url": f"{config.STAC_BASE}/collections/ch.swisstopo.swissimage-dop10", "coverage": "Schweiz", "crs": "EPSG:2056", "vintage": "jeweils neueste Kachel (STAC)", "format": "Cloud-Optimized GeoTIFF -> JPEG", "retrieved": today, "files": ["ortho.jpg"]},
        {"id": "buildings", "title": "swissBUILDINGS3D 3.0 Beta", "provider": "swisstopo", "license": "Open Government Data swisstopo (Quellenangabe)", "terms": SWISSTOPO_TERMS,
         "url": f"{config.STAC_BASE}/collections/ch.swisstopo.swissbuildings3d_3_0", "coverage": "Schweiz und Liechtenstein, Kacheln je Landeskarte-Blatt", "crs": "EPSG:2056 / LN02",
         "vintage": ", ".join(metadata.get("buildings", {}).get("tiles", [])), "format": "FileGDB (Building_solid, Floor)", "retrieved": today, "files": ["buildings3d.bin", "buildings.json"],
         "notes": "Beta-Produkt. Das Feld ERSTELLUNG_JAHR bezeichnet die Datenerfassung, nicht das Baujahr."},
        {"id": "gwr", "title": "Eidg. Gebäude- und Wohnungsregister (GWR), Kanton Schwyz", "provider": "Bundesamt für Statistik (BFS)", "license": "Open Government Data BFS (Quellenangabe)", "terms": BFS_TERMS,
         "url": config.GWR_URL, "coverage": "Kanton SZ, täglich aktualisiert", "crs": "EPSG:2056", "vintage": metadata.get("statistics", {}).get("gwrExportDate", ""), "format": "CSV (tab-getrennt)", "retrieved": today,
         "files": ["buildings.json", "addresses.json", "codes.json", "statistics.json", "gwr_unmatched.json"],
         "notes": "Verknüpfung mit swissBUILDINGS3D über EGID, ergänzt über die Lage (GWR-Koordinate im Grundriss). Baujahr nur dort vorhanden, wo im GWR erfasst; sonst Bauperiode. Registergebäude ohne 3D-Modell (meist Kleinbauten) stehen in gwr_unmatched.json."},
        {"id": "roofcolor", "title": "SWISSIMAGE (WMS, 0.5 m) für Dachfarben", "provider": "swisstopo", "license": "Open Government Data swisstopo (Quellenangabe)", "terms": SWISSTOPO_TERMS,
         "url": f"{config.WMS_URL} (ch.swisstopo.swissimage)", "coverage": "Schweiz", "crs": "EPSG:2056", "vintage": "aktuell zum Abruf", "format": "JPEG, 1-km-Kacheln", "retrieved": today,
         "files": ["buildings.json"], "notes": "Dachfarbe = Median der Luftbildpixel auf den Dachflächen des 3D-Modells. Näherung; Schatten und Lagegenauigkeit beeinflussen sie."},
        {"id": "osm", "title": "OpenStreetMap (Strassen, Bahn, Gewässer, POI, Linien, Laternen)", "provider": "OpenStreetMap-Mitwirkende", "license": "ODbL 1.0", "terms": "https://www.openstreetmap.org/copyright",
         "url": config.OVERPASS_URL, "coverage": "Untersuchungsgebiet inkl. Puffer", "crs": "EPSG:4326 -> EPSG:2056", "vintage": "Abruf", "format": "Overpass JSON", "retrieved": today,
         "files": ["roads.json", "water.json", "pois.json", "transport.json", "places.json", "lamps.json"],
         "notes": "Vollständigkeit und Aktualität sind nicht garantiert. Strassenlaternen: nur 27 OSM-Knoten; weitere Standorte sind entlang von Strassen mit lit=yes modelliert (lamps.json, Quelle 1)."},
        {"id": "trees", "title": "Vegetationshöhenmodell NFI", "provider": "WSL / BAFU (Landesforstinventar)", "license": "ODbL mit DbCL", "terms": "https://www.envidat.ch/dataset/vegetation-height-model-nfi",
         "url": f"{config.STAC_BASE}/collections/ch.bafu.landesforstinventar-vegetationshoehenmodell", "coverage": "Schweiz, jährlich 1/6 aktualisiert", "crs": "EPSG:2056", "vintage": metadata.get("trees", {}).get("source", ""),
         "format": "Cloud-Optimized GeoTIFF, 1 m", "retrieved": today, "files": ["trees.bin"], "notes": "Baumpositionen als lokale Maxima abgeleitet (Validierung gegen OSM-Einzelbäume in metadata.json), Kronenradius aus Höhe geschätzt, nicht erkannte OSM-Bäume ergänzt."},
        {"id": "votes", "title": "Eidgenössische Abstimmungen (Gemeinderesultate)", "provider": "Bundesamt für Statistik (BFS), voteinfo", "license": "Open Government Data (Quellenangabe: BFS)", "terms": "https://opendata.swiss/de/terms-of-use",
         "url": "https://ogd-static.voteinfo-app.ch/v1/ogd/", "coverage": "Schweiz, Gemeindeebene", "format": "JSON, serverseitig gezogen (Quelle ohne CORS)", "retrieved": today, "files": ["votes.json"],
         "notes": "Einzelne Abstimmungstage fehlen, wenn die Quelle sie nicht liefert (derzeit 2025-05-18 und 2023-03-12)."},
        {"id": "weather", "title": "Open-Meteo (Wetter, zur Laufzeit)", "provider": "Open-Meteo", "license": "CC BY 4.0 (nicht-kommerzielle Nutzung)", "terms": "https://open-meteo.com/en/terms",
         "url": "https://api.open-meteo.com/v1/forecast", "coverage": "weltweit", "format": "JSON (Browser-Abruf)", "retrieved": "zur Laufzeit", "files": []},
        {"id": "transport", "title": "transport.opendata.ch (Abfahrten, zur Laufzeit)", "provider": "Opendata.ch auf Basis von opentransportdata.swiss", "license": "Open Data (Quellenangabe, Nutzungsbedingungen opentransportdata.swiss)",
         "terms": "https://opentransportdata.swiss/de/terms-of-use/", "url": "https://transport.opendata.ch/v1/", "coverage": "Schweiz", "format": "JSON (Browser-Abruf)", "retrieved": "zur Laufzeit", "files": [],
         "notes": "Liefert Fahrplan und Echtzeitprognosen, keine gemessenen Fahrzeugpositionen."},
        {"id": "history", "title": "Zeitreise: historische Landeskarten (zur Laufzeit)", "provider": "swisstopo", "license": "Open Government Data swisstopo (Quellenangabe)", "terms": SWISSTOPO_TERMS,
         "url": "https://wms.geo.admin.ch/ (ch.swisstopo.zeitreihen)", "coverage": "Schweiz, Kartenstände ab 1844", "format": "WMS (Browser-Abruf)", "retrieved": "zur Laufzeit", "files": []},
    ]


def sha256(path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_manifest() -> None:
    """Prüfsummen aller Eingabedateien im Zwischenspeicher: macht einen Lauf nachvollziehbar und vergleichbar."""
    files = []
    for path in sorted(config.CACHE_DIR.rglob("*")):
        if not path.is_file() or path.suffix == ".part":
            continue
        if path.parent.name in {"gwr"} and path.suffix == ".csv":
            continue  # aus sz.zip entpackt
        files.append({"path": str(path.relative_to(config.CACHE_DIR)), "bytes": path.stat().st_size, "sha256": sha256(path)})
    payload = {"generated": date.today().isoformat(), "files": files}
    (config.OUT_DIR / "manifest.json").write_text(json.dumps(payload, indent=1))
    print(f"manifest.json: {len(files)} Eingabedateien")


def export_sources() -> None:
    metadata = read_metadata()
    payload = {"generated": date.today().isoformat(), "datasets": sources(metadata)}
    (config.OUT_DIR / "sources.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1))
    print(f"sources.json: {len(payload['datasets'])} Datensätze")


def main() -> None:
    export_municipality()
    export_statistics()
    export_sources()
    export_manifest()


if __name__ == "__main__":
    main()
