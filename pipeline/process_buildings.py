"""swissBUILDINGS3D 3.0 + GWR -> buildings3d.bin, buildings.json, addresses.json, codes.json.

buildings3d.bin (little endian):
  Header (5 x uint32): magic "BLD3", version (=1), buildingCount, vertexCount, indexCount
  Gebäudetabelle: buildingCount x 4 x uint32 = (vertexStart, vertexCount, indexStart, indexCount)
  Positionen:     Float32[vertexCount * 3]  lokale Koordinaten (x = Ost, y = Höhe, z = -Nord)
  Indizes:        Uint32[indexCount]        globale Vertexindizes, Dreiecke, gegen den Uhrzeigersinn von aussen
  Oberflächen:    Uint8[vertexCount]        0 = Wand, 1 = Dach, 2 = Boden (auf 4 Byte aufgefüllt)
Der Eintrag i der Gebäudetabelle gehört zu buildings.json -> buildings[i].
Lokale Koordinaten: x = E - origin.e, y = Höhe m ü. M. - elevationOffset, z = -(N - origin.n).
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

import fiona
import mapbox_earcut as earcut
import numpy as np
import pandas as pd
from shapely.geometry import Point, shape

from . import config, download
from .common import read_metadata, update_metadata

SKIPPED_TYPES = {"Gebaeude unsichtbar"}
GWR_FIELDS = {
    "GKAT": "category", "GKLAS": "class", "GBAUJ": "yearBuilt", "GBAUP": "periodBuilt", "GSTAT": "status",
    "GAREA": "footprintAreaGwr", "GVOL": "volumeGwr", "GASTW": "floors", "GANZWHG": "dwellings",
    "GWAERZH1": "heatGenerator", "GENH1": "heatEnergy",
}
CODE_GROUPS = ["GKAT", "GKLAS", "GBAUP", "GSTAT", "GWAERZH1", "GENH1"]


def triangulate_face(rings: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """Trianguliert ein ebenes 3D-Polygon (Ring 0 aussen, weitere = Löcher)."""
    cleaned = []
    for ring in rings:
        points = np.asarray(ring, dtype="float64")[:, :3]
        if len(points) > 1 and np.allclose(points[0], points[-1]):
            points = points[:-1]
        if len(points) >= 3:
            cleaned.append(points)
    if not cleaned:
        return None
    outer = cleaned[0]
    nxt = np.roll(outer, -1, axis=0)
    normal = np.array([
        np.sum((outer[:, 1] - nxt[:, 1]) * (outer[:, 2] + nxt[:, 2])),
        np.sum((outer[:, 2] - nxt[:, 2]) * (outer[:, 0] + nxt[:, 0])),
        np.sum((outer[:, 0] - nxt[:, 0]) * (outer[:, 1] + nxt[:, 1])),
    ])
    length = np.linalg.norm(normal)
    if length < 1e-9:
        return None
    normal /= length
    drop = int(np.argmax(np.abs(normal)))
    keep = [axis for axis in range(3) if axis != drop]
    vertices = np.concatenate(cleaned)
    ends = np.cumsum([len(ring) for ring in cleaned]).astype("uint32")
    triangles = earcut.triangulate_float64(vertices[:, keep], ends).reshape(-1, 3)
    if len(triangles) == 0:
        return None
    # earcut liefert die Orientierung der 2D-Projektion; an der 3D-Normale ausrichten.
    a, b, c = (vertices[triangles[:, k]] for k in range(3))
    triangle_normals = np.cross(b - a, c - a)
    flip = (triangle_normals @ normal) < 0
    triangles[flip] = triangles[flip][:, ::-1]
    return vertices, triangles, normal


def building_mesh(geometry: dict, origin, elevation_offset: float):
    """Alle Flächen eines Gebäudes -> (Positionen, Indizes, Oberflächenklassen) im lokalen System.

    Jede Fläche wird einzeln nach aussen ausgerichtet: Dächer zeigen nach oben, Böden nach unten,
    Wände vom Gebäudeschwerpunkt weg. Das ist unabhängig von der Ringrichtung der Quelldaten.
    """
    faces = []
    for polygon in geometry["coordinates"]:
        result = triangulate_face([np.asarray(ring) for ring in polygon])
        if result is not None:
            faces.append(result)
    if not faces:
        return None
    all_vertices = np.concatenate([vertices for vertices, _, _ in faces])
    middle = (all_vertices[:, 2].min() + all_vertices[:, 2].max()) / 2
    centre_xy = all_vertices[:, :2].mean(axis=0)

    positions, indices, surfaces = [], [], []
    base = 0
    for vertices, triangles, normal in faces:
        slope = abs(normal[2])
        height = vertices[:, 2].mean()
        kind = 0 if slope <= 0.2 else 1 if height >= middle else 2
        if kind == 1:
            flip = normal[2] < 0
        elif kind == 2:
            flip = normal[2] > 0
        else:
            flip = float(np.dot(normal[:2], vertices[:, :2].mean(axis=0) - centre_xy)) < 0
        if flip:
            triangles = triangles[:, ::-1]
        positions.append(vertices)
        indices.append(triangles.reshape(-1) + base)
        surfaces.append(np.full(len(vertices), kind, dtype="uint8"))
        base += len(vertices)

    vertices = np.concatenate(positions)
    local = np.empty_like(vertices, dtype="float32")
    local[:, 0] = vertices[:, 0] - origin[0]
    local[:, 1] = vertices[:, 2] - elevation_offset
    local[:, 2] = -(vertices[:, 1] - origin[1])
    return local, np.concatenate(indices).reshape(-1, 3).astype("uint32"), np.concatenate(surfaces), vertices


def load_gwr() -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    folder = download.download_gwr()
    buildings = pd.read_csv(folder / "gebaeude_batiment_edificio.csv", sep="\t", dtype=str)
    entrances = pd.read_csv(folder / "eingang_entree_entrata.csv", sep="\t", dtype=str)
    codes_raw = pd.read_csv(folder / "kodes_codes_codici.csv", sep="\t", dtype=str)
    codes: dict[str, dict[str, str]] = {}
    for group in CODE_GROUPS:
        rows = codes_raw[codes_raw["CMERKM"] == group]
        codes[group] = {row.CECODID: row.CODTXTLD for row in rows.itertuples()}
    return buildings.set_index("EGID"), entrances, codes


def number(value):
    if value is None or (isinstance(value, float) and np.isnan(value)) or value == "":
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    return int(parsed) if parsed.is_integer() else parsed


def read_tiles(tile_paths: list[Path], buffered):
    seen: set[str] = set()
    for path in tile_paths:
        with fiona.open(path, layer="Floor") as floors:
            floor_by_uuid = {f["properties"]["UUID"]: shape(f["geometry"]) for f in floors if f["geometry"]}
        with fiona.open(path, layer="Building_solid") as solids:
            for feature in solids:
                properties = dict(feature["properties"])
                uuid = properties["UUID"]
                if uuid in seen or not feature["geometry"]:
                    continue
                seen.add(uuid)
                if properties["OBJEKTART"] in SKIPPED_TYPES:
                    continue
                yield properties, feature["geometry"], floor_by_uuid.get(uuid), path.name


def main() -> None:
    boundary, buffered, origin, _ = download.study_area()
    dem_meta = read_metadata().get("dem")
    if not dem_meta:
        raise SystemExit("Zuerst `python -m pipeline.process_terrain` ausführen (elevationOffset fehlt).")
    elevation_offset = dem_meta["elevationOffset"]
    tile_paths = download.download_buildings(buffered)
    gwr, entrances, codes = load_gwr()

    records, meshes = [], []
    for properties, geometry, floor, tile in read_tiles(tile_paths, buffered):
        mesh = building_mesh(geometry, origin, elevation_offset)
        if mesh is None:
            continue
        local, triangles, surfaces, lv95 = mesh
        center = lv95[:, :2].mean(axis=0)
        if not buffered.contains(Point(*center)):
            continue
        egid = number(properties.get("EGID"))
        record = {
            "id": properties["UUID"].strip("{}"),
            "egid": egid,
            "type": properties["OBJEKTART"],
            "usage": properties.get("GEBAEUDE_NUTZUNG"),
            "name": properties.get("NAME_KOMPLETT"),
            "height": number(properties.get("GESAMTHOEHE")),
            "roofMax": number(properties.get("DACH_MAX")),
            "roofMin": number(properties.get("DACH_MIN")),
            "groundElevation": number(properties.get("GELAENDEPUNKT")),
            "footprintArea": round(float(floor.area), 1) if floor is not None else None,
            "center": [round(float(center[0]), 1), round(float(center[1]), 1)],
            "inMunicipality": bool(boundary.contains(Point(*center))),
            "modelYear": number(properties.get("ERSTELLUNG_JAHR")),
            "tile": tile.split("_")[4] + "_" + tile.split("_")[3],
        }
        if egid is not None and str(egid) in gwr.index:
            row = gwr.loc[str(egid)]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            record["gwr"] = {name: number(row[column]) for column, name in GWR_FIELDS.items()}
            record["gwr"] = {k: v for k, v in record["gwr"].items() if v is not None}
        records.append(record)
        meshes.append((local, triangles, surfaces))

    export_binary(meshes)
    export_addresses(entrances, records, buffered)
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    (config.OUT_DIR / "buildings.json").write_text(json.dumps({"buildings": records}, ensure_ascii=False, separators=(",", ":")))
    (config.OUT_DIR / "codes.json").write_text(json.dumps(codes, ensure_ascii=False, separators=(",", ":")))

    with_gwr = sum("gwr" in r for r in records)
    with_year = sum(r.get("gwr", {}).get("yearBuilt") is not None for r in records)
    update_metadata("buildings", {
        "files": ["buildings3d.bin", "buildings.json", "addresses.json", "codes.json"],
        "count": len(records),
        "inMunicipality": sum(r["inMunicipality"] for r in records),
        "withGwr": with_gwr,
        "withYearBuilt": with_year,
        "source": "swisstopo swissBUILDINGS3D 3.0 beta (Building_solid, Floor), BFS GWR",
        "tiles": sorted({r["tile"] for r in records}),
        "skippedTypes": sorted(SKIPPED_TYPES),
    })
    print(f"{len(records)} Gebäude, davon {with_gwr} mit GWR-Eintrag, {with_year} mit Baujahr")


def export_binary(meshes) -> None:
    table = np.zeros((len(meshes), 4), dtype="<u4")
    positions, indices, surfaces = [], [], []
    vertex_start = index_start = 0
    for i, (local, triangles, kinds) in enumerate(meshes):
        flat = triangles.reshape(-1) + vertex_start
        table[i] = (vertex_start, len(local), index_start, len(flat))
        positions.append(local.astype("<f4"))
        indices.append(flat.astype("<u4"))
        surfaces.append(kinds)
        vertex_start += len(local)
        index_start += len(flat)
    surface_bytes = np.concatenate(surfaces).tobytes()
    surface_bytes += b"\x00" * (-len(surface_bytes) % 4)
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(config.OUT_DIR / "buildings3d.bin", "wb") as handle:
        handle.write(struct.pack("<4sIIII", b"BLD3", 1, len(meshes), vertex_start, index_start))
        handle.write(table.tobytes())
        handle.write(np.concatenate(positions).tobytes())
        handle.write(np.concatenate(indices).tobytes())
        handle.write(surface_bytes)


def export_addresses(entrances: pd.DataFrame, records: list[dict], buffered) -> None:
    """Adressen aus den GWR-Eingängen für die Suche: [Bezeichnung, E, N, Gebäudeindex oder -1]."""
    index_by_egid = {r["egid"]: i for i, r in enumerate(records) if r["egid"] is not None}
    rows = entrances.dropna(subset=["DKODE", "DKODN", "STRNAME"])
    result = []
    for row in rows.itertuples():
        easting, northing = float(row.DKODE), float(row.DKODN)
        if not buffered.contains(Point(easting, northing)):
            continue
        number_ = row.DEINR if isinstance(row.DEINR, str) else ""
        label = f"{row.STRNAME} {number_}".strip() + f", {row.DPLZ4} {row.DPLZNAME}"
        result.append([label, round(easting, 1), round(northing, 1), index_by_egid.get(number(row.EGID), -1)])
    (config.OUT_DIR / "addresses.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(result)} Adressen")


if __name__ == "__main__":
    main()
