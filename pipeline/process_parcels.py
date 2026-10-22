"""Schwyzer AV-Grundstuecke -> parcels.json und Zuordnung zu 3D-Gebaeuden."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
import xml.etree.ElementTree as ET
from urllib.parse import urlencode

import numpy as np
import requests
from shapely import STRtree
from shapely.geometry import GeometryCollection, MultiPolygon, Point, Polygon

from . import config, download
from .common import update_metadata

GML_NS = "http://www.opengis.net/gml/3.2"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def field_text(feature: ET.Element, name: str) -> str | None:
    for child in feature:
        if local_name(child.tag).endswith(name):
            value = "".join(child.itertext()).strip()
            return value or None
    return None


def _ring(boundary: ET.Element) -> list[tuple[float, float]]:
    ring = next((element for element in boundary.iter() if local_name(element.tag) == "LinearRing"), boundary)
    pos_list = next((element for element in ring.iter() if local_name(element.tag) == "posList"), None)
    if pos_list is not None and pos_list.text:
        values = [float(value) for value in pos_list.text.split()]
        dimension = int(pos_list.attrib.get("srsDimension", "2"))
        if dimension < 2 or len(values) % dimension:
            raise ValueError("GML posList hat eine ungueltige Dimension")
        return [(values[index], values[index + 1]) for index in range(0, len(values), dimension)]

    positions = [element.text for element in ring.iter() if local_name(element.tag) == "pos" and element.text]
    return [tuple(map(float, position.split()[:2])) for position in positions]


def _geometry(geometry_element: ET.Element):
    polygon_tags = {"Polygon", "PolygonPatch"}
    polygons = []
    for element in geometry_element.iter():
        if local_name(element.tag) not in polygon_tags:
            continue
        exterior = next((child for child in element if local_name(child.tag) in {"exterior", "outerBoundaryIs"}), None)
        if exterior is None:
            continue
        outer = _ring(exterior)
        holes = [
            _ring(child)
            for child in element
            if local_name(child.tag) in {"interior", "innerBoundaryIs"}
        ]
        if len(outer) >= 4:
            polygons.append(Polygon(outer, holes))
    if not polygons:
        raise ValueError("GML-Grundstueck enthaelt kein Polygon")
    return polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)


def parse_gml(data: bytes) -> list[dict]:
    """Liest Parcel-Polygone und AV-Attribute aus einer WFS-GML-3.2-Antwort."""
    root = ET.fromstring(data)
    if local_name(root.tag) in {"ExceptionReport", "ServiceExceptionReport"}:
        message = " ".join("".join(root.itertext()).split())
        raise ValueError(f"WFS-Fehler: {message[:240]}")

    records = []
    for feature in root.iter():
        children = {local_name(child.tag).split(".")[-1] for child in feature}
        if "geom" not in children or "grundstueck" not in local_name(feature.tag):
            continue
        geometry_element = next(child for child in feature if local_name(child.tag).endswith("geom"))
        geometry = _geometry(geometry_element)
        number = field_text(feature, "nummer")
        municipality = field_text(feature, "gde_nm")
        raw_id = feature.attrib.get(f"{{{GML_NS}}}id")
        identity = f"{municipality}:{number}" if municipality and number else raw_id
        if not identity:
            identity = hashlib.sha1(geometry.wkb).hexdigest()
        area = field_text(feature, "flaechenmass")
        try:
            area_m2 = float(area.replace("'", "").replace(",", ".")) if area else None
        except ValueError:
            area_m2 = None
        records.append({
            "id": identity,
            "number": number,
            "municipality": municipality,
            "areaM2": area_m2,
            "link": field_text(feature, "lgs_links"),
            "geometry": geometry,
        })
    return records


def parse_planning_gml(data: bytes, kind: str) -> list[dict]:
    """Liest polygonale Nutzungsplanungsflaechen aus dem Schwyzer WFS."""
    root = ET.fromstring(data)
    if local_name(root.tag) in {"ExceptionReport", "ServiceExceptionReport"}:
        message = " ".join("".join(root.itertext()).split())
        raise ValueError(f"WFS-Fehler: {message[:240]}")

    records = []
    for feature in root.iter():
        geometry_element = next((child for child in feature if local_name(child.tag).endswith("geom")), None)
        if geometry_element is None:
            continue
        geometry = _geometry(geometry_element)
        raw_id = feature.attrib.get(f"{{{GML_NS}}}id")
        if not raw_id:
            raw_id = hashlib.sha1(f"{kind}|{field_text(feature, 'typ')}|{geometry.wkb.hex()}".encode()).hexdigest()
        records.append({
            "id": f"{kind}:{raw_id}",
            "kind": kind,
            "type": field_text(feature, "typ"),
            "label": field_text(feature, "legend_text"),
            "link": field_text(feature, "geolink"),
            "geometry": geometry,
        })
    return records


def attach_parcels(buildings: list[dict], parcels: list[dict]) -> tuple[int, int]:
    """Verknuepft Gebaeude anhand ihres LV95-Modellmittelpunkts mit AV-Parzellen."""
    if not parcels:
        for building in buildings:
            building["parcels"] = []
        return 0, len(buildings)

    geometries = np.asarray([parcel["geometry"] for parcel in parcels], dtype=object)
    tree = STRtree(geometries)
    matched = 0
    for building in buildings:
        point = Point(*building["center"])
        indices = tree.query(point, predicate="intersects")
        matches = [int(index) for index in indices if parcels[int(index)]["geometry"].covers(point)]
        matches.sort(key=lambda index: parcels[index]["id"])
        building["parcels"] = [
            {
                "id": parcels[index]["id"],
                "number": parcels[index]["number"],
                "municipality": parcels[index]["municipality"],
                "areaM2": parcels[index]["areaM2"],
            }
            for index in matches
        ]
        matched += bool(matches)
    return matched, len(buildings) - matched


def attach_planning(buildings: list[dict], planning: list[dict]) -> tuple[int, int]:
    """Ordnet Planungsflaechen den Gebaeuden zu, deren Mittelpunkt darin liegt."""
    for building in buildings:
        building["landUse"] = []
    if not planning:
        return 0, len(buildings)

    geometries = np.asarray([record["geometry"] for record in planning], dtype=object)
    tree = STRtree(geometries)
    matched = 0
    for building in buildings:
        point = Point(*building["center"])
        indices = tree.query(point, predicate="intersects")
        matches = [int(index) for index in indices if planning[int(index)]["geometry"].covers(point)]
        matches.sort(key=lambda index: (planning[index]["kind"], planning[index]["id"]))
        building["landUse"] = [
            {key: planning[index][key] for key in ("id", "kind", "type", "label", "link")}
            for index in matches
        ]
        matched += bool(matches)
    return matched, len(buildings) - matched


def _request_url(bounds: tuple[float, float, float, float], type_name: str, count: int = 20000) -> str:
    min_e, min_n, max_e, max_n = bounds
    crs = "urn:ogc:def:crs:EPSG::2056"
    params = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "typeNames": type_name,
        "count": str(count),
        "srsName": crs,
        "bbox": f"{min_e},{min_n},{max_e},{max_n},{crs}",
    }
    return f"{config.WFS_URL}?{urlencode(params)}"


def _polygon_parts(geometry):
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, (MultiPolygon, GeometryCollection)):
        return [part for item in geometry.geoms for part in _polygon_parts(item)]
    return []


def _local_rings(geometry, origin: tuple[float, float]) -> list[list[list[float]]]:
    rings = []
    for polygon in _polygon_parts(geometry):
        for ring in [polygon.exterior, *polygon.interiors]:
            rings.append([
                [round(easting - origin[0], 1), round(-(northing - origin[1]), 1)]
                for easting, northing in ring.coords
            ])
    return rings


def main() -> None:
    _, buffered, origin, _ = download.study_area()
    buildings_path = config.OUT_DIR / "buildings.json"
    if not buildings_path.exists():
        raise SystemExit("Zuerst `python -m pipeline.run_all buildings` ausführen.")

    cache_path = config.CACHE_DIR / "parcels" / "ingenbohl.gml"
    try:
        raw_path = download.cached_download(_request_url(buffered.bounds, config.WFS_PARCEL_TYPENAME), cache_path)
    except requests.RequestException as error:
        update_metadata("parcels", {"available": False, "source": config.WFS_URL, "error": str(error)[:240]})
        print(f"AV-Parzellen nicht verfügbar: {error}")
        return

    parcels = parse_gml(raw_path.read_bytes())
    if not parcels:
        raise RuntimeError("Der Schwyzer WFS lieferte keine Parzellen für das Untersuchungsgebiet.")

    for parcel in parcels:
        clipped = parcel["geometry"].intersection(buffered)
        parcel["geometry"] = clipped
    parcels = [parcel for parcel in parcels if not parcel["geometry"].is_empty and _polygon_parts(parcel["geometry"])]
    buildings = json.loads(buildings_path.read_text())["buildings"]
    matched, unmatched = attach_parcels(buildings, parcels)

    planning = []
    planning_errors = []
    for kind, type_name in config.WFS_PLANNING_TYPES.items():
        planning_cache = config.CACHE_DIR / "parcels" / f"planning_{kind}.gml"
        try:
            planning_path = download.cached_download(_request_url(buffered.bounds, type_name, count=10000), planning_cache)
            planning.extend(parse_planning_gml(planning_path.read_bytes(), kind))
        except (requests.RequestException, ET.ParseError, ValueError) as error:
            planning_errors.append(f"{kind}: {str(error)[:160]}")
    for feature in planning:
        feature["geometry"] = feature["geometry"].intersection(buffered)
    planning = [feature for feature in planning if not feature["geometry"].is_empty and _polygon_parts(feature["geometry"])]
    planning_matched, planning_unmatched = attach_planning(buildings, planning)

    building_ids: dict[str, list[str]] = {parcel["id"]: [] for parcel in parcels}
    for building in buildings:
        for match in building["parcels"]:
            building_ids[match["id"]].append(building["id"])

    exported = []
    for parcel in parcels:
        exported.append({
            "id": parcel["id"],
            "number": parcel["number"],
            "municipality": parcel["municipality"],
            "areaM2": parcel["areaM2"],
            "link": parcel["link"],
            "rings": _local_rings(parcel["geometry"], origin),
            "buildingIds": sorted(building_ids[parcel["id"]]),
        })

    retrieved = datetime.fromtimestamp(raw_path.stat().st_mtime, timezone.utc).date().isoformat()
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    (config.OUT_DIR / "parcels.json").write_text(json.dumps({
        "crs": "local",
        "sourceCrs": "EPSG:2056",
        "retrieved": retrieved,
        "source": f"{config.WFS_URL} ({config.WFS_PARCEL_TYPENAME})",
        "matchMethod": "Gebäudemittelpunkt innerhalb Parzellengeometrie",
        "parcels": exported,
    }, ensure_ascii=False, separators=(",", ":")))
    (config.OUT_DIR / "planning.json").write_text(json.dumps({
        "crs": "local",
        "sourceCrs": "EPSG:2056",
        "retrieved": retrieved,
        "source": f"{config.WFS_URL} (ÖREB-Fachdaten Nutzungsplanung Ingenbohl)",
        "warning": "Das Feature-Schema enthält kein Merkmal zur Rechtsverbindlichkeit oder Gültigkeit.",
        "available": bool(planning),
        "errors": planning_errors,
        "features": [
            {key: feature[key] for key in ("id", "kind", "type", "label", "link")}
            | {"rings": _local_rings(feature["geometry"], origin)}
            for feature in planning
        ],
    }, ensure_ascii=False, separators=(",", ":")))
    buildings_path.write_text(json.dumps({"buildings": buildings}, ensure_ascii=False, separators=(",", ":")))
    update_metadata("parcels", {
        "file": "parcels.json",
        "count": len(exported),
        "matchedBuildings": matched,
        "unmatchedBuildings": unmatched,
        "retrieved": retrieved,
        "matchMethod": "Gebäudemittelpunkt innerhalb Parzellengeometrie",
        "source": "Amtliche Vermessung Kanton Schwyz (WFS 2.0, GML 3.2)",
        "sourceCrs": "EPSG:2056",
        "egridAvailable": False,
        "planning": {
            "file": "planning.json",
            "features": len(planning),
            "matchedBuildings": planning_matched,
            "unmatchedBuildings": planning_unmatched,
            "errors": planning_errors,
            "bindingAttributesAvailable": False,
        },
    })
    print(f"AV-Parzellen: {len(exported)}, Gebäudeverknüpfungen {matched}/{len(buildings)}")