"""Tests der Pipeline-Bausteine und der erzeugten Datendateien (ohne Netzwerkzugriff).

Aufruf: .venv/bin/python -m pytest tests -q
Tests gegen public/data werden übersprungen, wenn die Pipeline noch nicht gelaufen ist.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import Polygon, box

from pipeline import config
from pipeline.common import Extent, compute_extent, to_local
from pipeline.process_buildings import building_mesh, triangulate_face

DATA = config.OUT_DIR


def needs(name: str):
    return pytest.mark.skipif(not (DATA / name).exists(), reason=f"{name} fehlt (Pipeline nicht ausgeführt)")


# --- reine Funktionen -------------------------------------------------------

def test_extent_is_aligned_and_covers_area():
    area = box(2_685_003, 1_204_001, 2_690_497, 1_207_999)
    extent = compute_extent(area, 5)
    assert extent.min_e % 5 == 0 and extent.min_n % 5 == 0
    assert extent.min_e <= 2_685_003 and extent.max_e >= 2_690_497
    assert extent.min_n <= 1_204_001 and extent.max_n >= 1_207_999
    assert extent.width == (extent.nx - 1) * 5


def test_to_local_axes():
    x, y, z = to_local(2_688_100, 1_206_400, 530.0, (2_688_000, 1_206_300), 430.0)
    assert (x, y, z) == (100, 100.0, -100)  # Ost = +x, Nord = -z, Höhe = y


def unit_cube(origin=(2_688_000.0, 1_206_300.0), size=10.0, base=500.0):
    e, n = origin
    a, b, c, d = (e, n), (e + size, n), (e + size, n + size), (e, n + size)
    top, bottom = base + size, base

    def ring(points, z):
        return [(x, y, z) for x, y in points] + [(points[0][0], points[0][1], z)]

    faces = [[ring([a, b, c, d], bottom)], [ring([a, b, c, d], top)]]
    for p, q in zip([a, b, c, d], [b, c, d, a]):
        faces.append([[(p[0], p[1], bottom), (q[0], q[1], bottom), (q[0], q[1], top), (p[0], p[1], top), (p[0], p[1], bottom)]])
    return {"type": "MultiPolygon", "coordinates": faces}


def test_triangulate_square_face():
    ring = [(0, 0, 5), (4, 0, 5), (4, 4, 5), (0, 4, 5), (0, 0, 5)]
    vertices, triangles, normal = triangulate_face([np.array(ring)])
    assert len(vertices) == 4 and len(triangles) == 2
    assert abs(abs(normal[2]) - 1) < 1e-9


def test_triangulate_face_with_hole_keeps_area():
    outer = [(0, 0, 0), (10, 0, 0), (10, 10, 0), (0, 10, 0), (0, 0, 0)]
    hole = [(4, 4, 0), (4, 6, 0), (6, 6, 0), (6, 4, 0), (4, 4, 0)]
    vertices, triangles, _ = triangulate_face([np.array(outer), np.array(hole)])
    area = sum(abs(np.cross(vertices[t[1]] - vertices[t[0]], vertices[t[2]] - vertices[t[0]])[2]) / 2 for t in triangles)
    assert area == pytest.approx(100 - 4)


def test_building_mesh_cube_is_closed_and_outward():
    origin = (2_688_000, 1_206_300)
    local, triangles, surfaces, lv95, face_sizes = building_mesh(unit_cube(), origin, 430.0)
    assert face_sizes == [4] * 6
    assert len(triangles) == 12  # 6 Flächen x 2 Dreiecke
    assert set(surfaces.tolist()) == {0, 1, 2}  # Wand, Dach, Boden
    assert local[:, 1].min() == pytest.approx(70.0) and local[:, 1].max() == pytest.approx(80.0)
    # Normalen aller Dreiecke zeigen vom Würfelzentrum weg
    centre = local.mean(axis=0)
    a, b, c = (local[triangles[:, k]] for k in range(3))
    assert np.all(np.sum(np.cross(b - a, c - a) * (a - centre), axis=1) > 0)


# --- erzeugte Daten -----------------------------------------------------------

@needs("metadata.json")
def test_metadata_has_dem_section():
    meta = json.loads((DATA / "metadata.json").read_text())
    dem = meta["dem"]
    assert dem["crs"] == "EPSG:2056"
    assert 400 < dem["minHeight"] < dem["maxHeight"] < 4500
    assert len(dem["origin"]) == 2


@needs("dem.bin")
def test_dem_size_and_range():
    meta = json.loads((DATA / "metadata.json").read_text())["dem"]
    extent = Extent(**meta["extent"])
    values = np.fromfile(DATA / "dem.bin", dtype="<u2")
    assert values.size == extent.nx * extent.ny
    heights = meta["elevationOffset"] + values * meta["heightScale"]
    assert heights.min() == pytest.approx(meta["minHeight"], abs=0.2)
    assert heights.max() == pytest.approx(meta["maxHeight"], abs=0.2)


@needs("buildings3d.bin")
def test_buildings_binary_matches_json():
    raw = (DATA / "buildings3d.bin").read_bytes()
    magic, version, count, vertex_count, index_count, face_count = struct.unpack_from("<4sIIIII", raw, 0)
    assert magic == b"BLD3" and version == 2
    records = json.loads((DATA / "buildings.json").read_text())["buildings"]
    assert count == len(records) > 1000
    table = np.frombuffer(raw, dtype="<u4", count=count * 6, offset=24).reshape(count, 6)
    assert table[:, 1].sum() == vertex_count and table[:, 3].sum() == index_count and table[:, 5].sum() == face_count
    assert table[-1, 0] + table[-1, 1] == vertex_count
    positions_offset = 24 + count * 24
    indices = np.frombuffer(raw, dtype="<u4", count=index_count, offset=positions_offset + vertex_count * 12)
    assert indices.max() < vertex_count
    faces_offset = positions_offset + vertex_count * 12 + index_count * 4 + vertex_count + (-vertex_count % 4)
    faces = np.frombuffer(raw, dtype="<u4", count=face_count, offset=faces_offset)
    assert faces.sum() == vertex_count
    assert len(raw) == faces_offset + face_count * 4


@needs("buildings.json")
def test_building_records_are_not_invented():
    records = json.loads((DATA / "buildings.json").read_text())["buildings"]
    assert len({r["id"] for r in records}) == len(records)
    for record in records:
        assert record["height"] is None or 0 < record["height"] < 300
        year = record.get("gwr", {}).get("yearBuilt")
        assert year is None or 1000 < year <= 2030
    assert any("gwr" in r for r in records)


@needs("trees.bin")
def test_trees_binary_layout():
    raw = (DATA / "trees.bin").read_bytes()
    magic, version, count, _ = struct.unpack_from("<4sIII", raw, 0)
    assert magic == b"TRE1" and version == 1
    pad = lambda n: n + (-n % 4)
    assert len(raw) == 16 + count * 8 + 2 * pad(count)


@needs("roads.json")
def test_roads_inside_extent():
    meta = json.loads((DATA / "metadata.json").read_text())["dem"]
    extent = Extent(**meta["extent"])
    ox, on = meta["origin"]
    minx, maxx = extent.min_e - ox - 600, extent.max_e - ox + 600
    for road in json.loads((DATA / "roads.json").read_text())["roads"][:500]:
        xs = road["p"][0::2]
        assert minx <= min(xs) and max(xs) <= maxx
        assert len(road["p"]) % 2 == 0 and len(road["p"]) >= 4


@needs("sources.json")
def test_every_dataset_documents_license_and_origin():
    for dataset in json.loads((DATA / "sources.json").read_text())["datasets"]:
        for key in ("title", "provider", "license", "terms", "url", "retrieved"):
            assert dataset.get(key), f"{dataset['id']}: {key} fehlt"


@needs("municipality.json")
def test_municipality_polygon():
    municipality = json.loads((DATA / "municipality.json").read_text())
    assert municipality["bfs"] == config.MUNICIPALITY_BFS
    outer = municipality["polygons"][0][0]
    polygon = Polygon(list(zip(outer[0::2], outer[1::2])))
    assert polygon.is_valid and polygon.area / 1e4 == pytest.approx(municipality["areaHa"], rel=0.02)


# --- Erweiterungen: Dachfarbe, Laternen, Register-Rest, Abstimmungen, Qualitätszahlen ---

@needs("buildings.json")
def test_roof_colors_are_hex_and_cover_almost_all_buildings():
    records = json.loads((DATA / "buildings.json").read_text())["buildings"]
    colors = [r.get("roofColor") for r in records]
    assert sum(c is not None for c in colors) / len(records) > 0.95
    assert all(c is None or (len(c) == 7 and c[0] == "#") for c in colors)


@needs("lamps.json")
def test_lamps_are_marked_as_osm_or_modelled_and_not_on_buildings():
    lamps = json.loads((DATA / "lamps.json").read_text())["lamps"]
    assert len(lamps) > 100
    assert {lamp[2] for lamp in lamps} <= {0, 1}, "0 = OSM-Knoten, 1 = entlang lit=yes modelliert"
    assert sum(1 for lamp in lamps if lamp[2] == 0) >= 10


@needs("gwr_unmatched.json")
def test_unmatched_register_buildings_are_not_in_3d_model():
    rest = json.loads((DATA / "gwr_unmatched.json").read_text())["buildings"]
    egids = {r["gwr"].get("egid") for r in json.loads((DATA / "buildings.json").read_text())["buildings"] if "gwr" in r}
    assert rest and not ({b["egid"] for b in rest} & egids)
    assert all(b["gwr"]["status"] not in (1007, 1008) for b in rest if b.get("inMunicipality"))


@needs("votes.json")
def test_votes_have_valid_percentages_and_known_municipality():
    votes = json.loads((DATA / "votes.json").read_text())
    assert votes["bfs"] == config.MUNICIPALITY_BFS and len(votes["votes"]) > 10
    for vote in votes["votes"]:
        assert 0 <= vote["local"] <= 100 and len(vote["date"]) == 8 and vote["title"]


@needs("metadata.json")
def test_coverage_metrics_are_consistent():
    match = json.loads((DATA / "metadata.json").read_text())["buildings"]["match"]
    assert match["joinedByEgid"] + match["joinedByLocation"] >= match["gwrCoveredBy3d"] - 400
    assert match["coverageResidential"]["rate"] > 0.95 and match["coverageRate"] < 1
    assert match["gwrCoveredBy3d"] + match["gwrWithout3dModel"] >= match["gwrExistingInMunicipality"] - 5


@needs("manifest.json")
def test_manifest_lists_hashed_inputs():
    manifest = json.loads((DATA / "manifest.json").read_text())
    files = manifest.get("files") or manifest.get("inputs")
    assert files and all(entry.get("sha256") for entry in files)
