"""Photovoltaikanlagen (BFE, Elektrizitätsproduktionsanlagen) -> pv.json.

Das Register enthält Standort, Leistung, Inbetriebnahme, Anlagenkategorie und
teils Neigung und Ausrichtung je Teilanlage. Es enthält weder Modulzahl noch
Modullage. Jede Anlage wird dem 3D-Gebäude über die EGID oder, ohne EGID, über
die Koordinate zugeordnet.
"""
from __future__ import annotations

import datetime
import json
import struct
import zipfile

import numpy as np
import pandas as pd
import shapely
from shapely import STRtree

from . import config, download
from .common import read_metadata, update_metadata

URL = ("https://data.geo.admin.ch/ch.bfe.elektrizitaetsproduktionsanlagen/elektrizitaetsproduktionsanlagen/"
       "elektrizitaetsproduktionsanlagen_2056.csv.zip")
PHOTOVOLTAIC = "subcat_2"
CATEGORY = {"plantcat_8": "angebaut", "plantcat_9": "integriert", "plantcat_10": "freistehend"}
MAX_LOCATION_DISTANCE_M = 6.0


def read_roof_footprints(origin):
    """Dachprojektion jedes Gebäudes (LV95) aus buildings3d.bin."""
    raw = (config.OUT_DIR / "buildings3d.bin").read_bytes()
    magic, version, count, vertex_count, index_count, _ = struct.unpack_from("<4sIIIII", raw, 0)
    assert magic == b"BLD3" and version == 2
    offset = 24
    table = np.frombuffer(raw, "<u4", count * 6, offset).reshape(count, 6)
    offset += count * 24
    positions = np.frombuffer(raw, "<f4", vertex_count * 3, offset).reshape(-1, 3)
    offset += vertex_count * 12
    indices = np.frombuffer(raw, "<u4", index_count, offset)
    offset += index_count * 4
    surfaces = np.frombuffer(raw, "u1", vertex_count, offset)
    footprints = []
    for vertex_start, _, index_start, index_total, _, _ in table:
        triangles = indices[index_start:index_start + index_total].reshape(-1, 3)
        triangles = triangles[surfaces[triangles[:, 0]] == 1]
        if not len(triangles):
            footprints.append(shapely.Polygon())
            continue
        xz = positions[triangles][:, :, [0, 2]].astype("float64")
        east = xz[:, :, 0] + origin[0]
        north = -xz[:, :, 1] + origin[1]
        polygons = shapely.polygons(np.stack([east, north], axis=2))
        footprints.append(shapely.union_all(shapely.buffer(polygons[shapely.area(polygons) > 1e-6], 0.01)))
    return footprints


def main() -> None:
    zip_path = download.cached_download(URL, config.CACHE_DIR / "pv" / "anlagen.csv.zip")
    archive = zipfile.ZipFile(zip_path)
    plants = pd.read_csv(archive.open("ElectricityProductionPlant.csv"))
    details = pd.read_csv(archive.open("PlantDetail.csv"))
    plants = plants[plants.SubCategory == PHOTOVOLTAIC].copy()

    metadata = read_metadata()
    origin = metadata["dem"]["origin"]
    records = json.loads((config.OUT_DIR / "buildings.json").read_text())["buildings"]
    footprints = read_roof_footprints(origin)
    tree = STRtree(footprints)
    by_egid = {r["egid"]: i for i, r in enumerate(records) if r.get("egid")}

    boundary, buffered, _, _ = download.study_area()
    has_xy = plants._x.notna()
    x, y = plants._x.fillna(0).to_numpy(), plants._y.fillna(0).to_numpy()
    inside = pd.Series(has_xy.to_numpy() & shapely.contains_xy(buffered, x, y), index=plants.index)
    in_municipality = pd.Series(has_xy.to_numpy() & shapely.contains_xy(boundary, x, y), index=plants.index)
    near_area = plants[plants.EGID.isin(by_egid) | inside]
    parts = details.groupby("ElectricityProductionPlantR")
    output, stats = [], {"byEgid": 0, "byLocation": 0, "noBuilding": 0, "freestanding": 0}
    unmatched_kw = 0.0
    for _, plant in near_area.iterrows():
        building, how = by_egid.get(plant.EGID), "egid"
        if building is None and pd.notna(plant._x):
            point = shapely.Point(plant._x, plant._y)
            hits = tree.query(point.buffer(MAX_LOCATION_DISTANCE_M))
            hits = [h for h in hits if footprints[h].distance(point) <= MAX_LOCATION_DISTANCE_M]
            if hits:
                building = int(min(hits, key=lambda h: footprints[h].distance(point)))
                how = "lage"
        if building is None:
            if in_municipality[plant.name]:
                stats["noBuilding"] += 1
                unmatched_kw += float(plant.TotalPower)
            continue
        category = CATEGORY.get(plant.PlantCategory)
        year = int(str(plant.BeginningOfOperation)[:4]) if pd.notna(plant.BeginningOfOperation) else None
        rows = []
        if plant.xtf_id in parts.groups:
            for _, part in parts.get_group(plant.xtf_id).iterrows():
                orientation = int(part.Orientation.split("_")[1]) if isinstance(part.Orientation, str) else None
                rows.append([round(float(part.Power), 2), None if pd.isna(part.Inclination) else float(part.Inclination),
                             orientation, int(str(part.Date)[:4]) if pd.notna(part.Date) else None])
        stats["byEgid" if how == "egid" else "byLocation"] += 1
        stats["freestanding"] += category == "freistehend"
        output.append({
            "id": int(plant.xtf_id), "b": int(building), "kw": round(float(plant.TotalPower), 2), "year": year,
            "cat": category, "match": how, "parts": rows,
        })

    today = datetime.date.today().isoformat()
    payload = {
        "retrieved": today, "source": "BFE, Elektrizitätsproduktionsanlagen (Photovoltaik)",
        "orientations": {"1": "Norden", "2": "Nordost", "3": "Osten", "4": "Südost", "5": "Süden", "6": "Südwest", "7": "Westen", "8": "Nordwest", "9": "Zenit (flach)"},
        "plants": output,
    }
    (config.OUT_DIR / "pv.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    buildings_with = len({p["b"] for p in output})
    summary = {
        "file": "pv.json", "retrieved": today, "plants": len(output), "buildings": buildings_with,
        "totalKw": round(sum(p["kw"] for p in output), 1), "withPartDetail": sum(bool(p["parts"]) for p in output),
        "withOrientation": sum(any(part[2] for part in p["parts"]) for p in output),
        "inMunicipality": sum(bool(records[p["b"]]["inMunicipality"]) for p in output),
        "unmatchedPlantsInMunicipality": stats["noBuilding"], "unmatchedKw": round(unmatched_kw, 1), **stats,
    }
    update_metadata("pv", summary)
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
