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
from pipeline.download import overpass_queries
from pipeline.process_buildings import building_mesh, triangulate_face
from pipeline.process_osm import process_pois, process_roads
from pipeline.process_parcels import attach_parcels, attach_planning, parse_gml, parse_planning_gml

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


def test_process_pois_normalizes_contact_tags_and_address():
    raw = {"elements": [{
        "type": "node", "id": 42, "lat": 47.0, "lon": 8.6,
        "tags": {
            "name": "Café am See", "amenity": "cafe", "contact:website": "https://example.org",
            "contact:phone": "+41 41 123 45 67", "contact:email": "info@example.org",
            "addr:street": "Seestrasse", "addr:housenumber": "4", "addr:postcode": "6440", "addr:city": "Brunnen",
            "outdoor_seating": "yes", "opening_hours": "Mo-Fr 09:00-18:00",
        },
    }]}
    items = process_pois(raw, box(-100_000, -100_000, 100_000, 100_000), (2_688_000, 1_206_300))
    assert len(items) == 1
    poi = items[0]
    assert (poi["osmType"], poi["osmId"], poi["lat"], poi["lon"]) == ("node", 42, 47.0, 8.6)
    assert poi["t"]["website"] == "https://example.org"
    assert poi["t"]["phone"] == "+41 41 123 45 67"
    assert poi["t"]["email"] == "info@example.org"
    assert poi["t"]["address"] == "Seestrasse 4, 6440 Brunnen"
    assert poi["t"]["outdoor_seating"] == "yes"


def test_process_roads_preserves_walk_access_and_highway_kind():
    raw = {"elements": [
        {"type": "way", "id": 1, "geometry": [{"lat": 47.0, "lon": 8.6}, {"lat": 47.0001, "lon": 8.6001}], "tags": {"highway": "footway", "foot": "designated"}},
        {"type": "way", "id": 2, "geometry": [{"lat": 47.0, "lon": 8.6}, {"lat": 47.0001, "lon": 8.6001}], "tags": {"highway": "residential", "foot": "no"}},
        {"type": "way", "id": 3, "geometry": [{"lat": 47.0, "lon": 8.6}, {"lat": 47.0001, "lon": 8.6001}], "tags": {"highway": "motorway", "foot": "yes"}},
        {"type": "way", "id": 4, "geometry": [{"lat": 47.0, "lon": 8.6}, {"lat": 47.0001, "lon": 8.6001}], "tags": {"highway": "service", "foot": "customers"}},
    ]}
    roads = process_roads(raw, box(-100_000, -100_000, 100_000, 100_000), (2_688_000, 1_206_300))
    by_id = {road["id"]: road for road in roads}
    assert by_id[1]["walk"] == 1 and by_id[1]["hw"] == "footway"
    assert by_id[2]["walk"] == 0 and by_id[3]["walk"] == 1 and by_id[4]["walk"] == 0


def test_process_pois_includes_unnamed_public_services_and_chargers():
    raw = {"elements": [
        {"type": "node", "id": 1, "lat": 47.0, "lon": 8.6, "tags": {"amenity": "toilets"}},
        {"type": "node", "id": 2, "lat": 47.0, "lon": 8.6001, "tags": {"amenity": "toilets"}},
        {"type": "way", "id": 3, "center": {"lat": 47.001, "lon": 8.601}, "tags": {
            "amenity": "charging_station", "capacity": "4", "fee": "yes", "operator": "Gemeinde",
            "socket:type2": "4", "socket:type2:output": "22 kW",
        }},
        {"type": "node", "id": 4, "lat": 47.002, "lon": 8.602, "tags": {"emergency": "defibrillator"}},
        {"type": "node", "id": 5, "lat": 47.003, "lon": 8.603, "tags": {"amenity": "drinking_water"}},
    ]}
    items = process_pois(raw, box(-100_000, -100_000, 100_000, 100_000), (2_688_000, 1_206_300))
    assert [(item["n"], item["c"]) for item in items] == [
        ("Öffentliche Toilette", "Öffentliche Einrichtungen"),
        ("E-Ladestation", "Mobilität"),
        ("Defibrillator", "Gesundheit"),
        ("Trinkwasserstelle", "Öffentliche Einrichtungen"),
    ]
    charger = items[1]
    assert charger["t"]["capacity"] == "4" and charger["t"]["fee"] == "yes"
    assert charger["t"]["socket_types"] == "Typ 2" and charger["t"]["charge"] == "22 kW"


def test_overpass_query_fetches_unnamed_public_service_areas():
    query = overpass_queries("1,2,3,4")["pois"]
    assert 'way["amenity"~"^(toilets|drinking_water' in query
    assert 'node["emergency"="defibrillator"]' in query


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


def test_parcel_gml_extracts_lv95_polygon_and_attributes():
        raw = b'''<?xml version="1.0"?>
        <wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"
            xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:ms="http://mapserver.gis.umn.edu/mapserver">
            <wfs:member><ms:ch.sz.a018.amtliche_vermessung.liegenschaften.grundstueck gml:id="parcel.1">
                <ms:nummer>123</ms:nummer><ms:gde_nm>Ingenbohl</ms:gde_nm><ms:flaechenmass>100</ms:flaechenmass>
                <ms:lgs_links>https://example.invalid/parcel</ms:lgs_links>
                <ms:geom><gml:Surface srsName="urn:ogc:def:crs:EPSG::2056"><gml:patches><gml:PolygonPatch>
                    <gml:exterior><gml:LinearRing><gml:posList srsDimension="2">0 0 10 0 10 10 0 10 0 0</gml:posList></gml:LinearRing></gml:exterior>
                </gml:PolygonPatch></gml:patches></gml:Surface></ms:geom>
            </ms:ch.sz.a018.amtliche_vermessung.liegenschaften.grundstueck></wfs:member>
        </wfs:FeatureCollection>'''
        parcels = parse_gml(raw)
        assert len(parcels) == 1
        assert parcels[0]["id"] == "Ingenbohl:123"
        assert parcels[0]["areaM2"] == 100
        assert parcels[0]["geometry"].area == 100


def test_buildings_link_to_parcels_by_center_and_keep_unmatched():
        from shapely.geometry import box

        buildings = [{"center": [5, 5]}, {"center": [20, 20]}]
        parcels = [{"id": "Ingenbohl:123", "number": "123", "municipality": "Ingenbohl", "areaM2": 100, "geometry": box(0, 0, 10, 10)}]
        assert attach_parcels(buildings, parcels) == (1, 1)
        assert buildings[0]["parcels"] == [{"id": "Ingenbohl:123", "number": "123", "municipality": "Ingenbohl", "areaM2": 100}]
        assert buildings[1]["parcels"] == []


def test_planning_gml_extracts_polygon_and_legend_attributes():
        raw = b'''<?xml version="1.0"?>
        <wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"
            xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:ms="http://mapserver.gis.umn.edu/mapserver">
            <wfs:member><ms:ch.sz.a094b.oereb.raumplanung.nutzungsplanung_kommunal.ingenbohl.grundnutzung gml:id="zone.1">
                <ms:typ>W1</ms:typ><ms:legend_text>Wohnzone</ms:legend_text><ms:geolink>https://example.invalid/zone</ms:geolink>
                <ms:geom><gml:Surface srsName="urn:ogc:def:crs:EPSG::2056"><gml:patches><gml:PolygonPatch>
                    <gml:exterior><gml:LinearRing><gml:posList srsDimension="2">0 0 10 0 10 10 0 10 0 0</gml:posList></gml:LinearRing></gml:exterior>
                </gml:PolygonPatch></gml:patches></gml:Surface></ms:geom>
            </ms:ch.sz.a094b.oereb.raumplanung.nutzungsplanung_kommunal.ingenbohl.grundnutzung></wfs:member>
        </wfs:FeatureCollection>'''
        features = parse_planning_gml(raw, "grundnutzung")
        assert len(features) == 1
        assert features[0]["id"] == "grundnutzung:zone.1"
        assert features[0]["label"] == "Wohnzone"
        assert features[0]["geometry"].area == 100


def test_building_land_use_is_spatially_linked_and_unmatched_is_empty():
        from shapely.geometry import box

        buildings = [{"center": [5, 5]}, {"center": [20, 20]}]
        planning = [{"id": "zone.1", "kind": "grundnutzung", "type": "W1", "label": "Wohnzone", "link": None, "geometry": box(0, 0, 10, 10)}]
        assert attach_planning(buildings, planning) == (1, 1)
        assert buildings[0]["landUse"] == [{"id": "zone.1", "kind": "grundnutzung", "type": "W1", "label": "Wohnzone", "link": None}]
        assert buildings[1]["landUse"] == []


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


@needs("pv.json")
def test_pv_plants_reference_buildings_and_have_plausible_values():
    pv = json.loads((DATA / "pv.json").read_text())
    records = json.loads((DATA / "buildings.json").read_text())["buildings"]
    assert len(pv["plants"]) > 100
    for plant in pv["plants"]:
        assert 0 <= plant["b"] < len(records) and 0 < plant["kw"] < 5000
        assert plant["match"] in ("egid", "lage") and plant["cat"] in (None, "angebaut", "integriert", "freistehend")
        if plant["match"] == "egid":
            assert records[plant["b"]]["egid"]
        for kw, inclination, orientation, _ in plant["parts"]:
            assert kw > 0 and (inclination is None or 0 <= inclination <= 90) and (orientation is None or 1 <= orientation <= 9)


@needs("pv.json")
@needs("metadata.json")
def test_pv_summary_matches_file():
    pv = json.loads((DATA / "pv.json").read_text())
    summary = json.loads((DATA / "metadata.json").read_text())["pv"]
    assert summary["plants"] == len(pv["plants"])
    assert abs(summary["totalKw"] - sum(p["kw"] for p in pv["plants"])) < 0.5


@needs("roads.json")
def test_roads_have_direction_and_lane_attributes():
    roads = json.loads((DATA / "roads.json").read_text())["roads"]
    assert all(r["ow"] in (-1, 0, 1) and isinstance(r["ln"], int) and r["ln"] >= 0 for r in roads)
    motorways = [r for r in roads if r["c"] == "motorway" and not r["t"]]
    assert motorways and sum(r["ow"] != 0 for r in motorways) > len(motorways) / 2, "Autobahnfahrbahnen sind Einbahn"
    assert any(r["ln"] == 2 and r["ow"] for r in motorways), "zweispurige Fahrbahnen vorhanden"
