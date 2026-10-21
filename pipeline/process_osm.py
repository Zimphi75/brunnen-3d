"""OpenStreetMap -> roads.json, water.json, pois.json, transport.json (alle Koordinaten lokal: x = Ost, z = -Nord in m).

Linien und Flächen sind als flache Zahlenlisten [x0, z0, x1, z1, ...] gespeichert (auf 0.1 m gerundet).
Die Gemeinde- und Pufferfläche begrenzt alle Geometrien (Zuschnitt mit shapely).
"""
from __future__ import annotations

import json
from collections import defaultdict

import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box
from shapely.ops import linemerge, polygonize, unary_union

from . import config, download
from .common import update_metadata

to_lv95 = Transformer.from_crs(config.CRS_WGS84, config.CRS_LV95, always_xy=True)

ROAD_CLASSES = {
    "motorway": "motorway", "motorway_link": "motorway", "trunk": "motorway", "trunk_link": "motorway",
    "primary": "primary", "primary_link": "primary", "secondary": "secondary", "secondary_link": "secondary",
    "tertiary": "tertiary", "tertiary_link": "tertiary",
    "residential": "minor", "unclassified": "minor", "living_street": "minor", "service": "service", "pedestrian": "path",
    "track": "track", "path": "path", "footway": "path", "cycleway": "path", "bridleway": "path", "steps": "path",
}
RAIL_VALUES = {"rail", "narrow_gauge", "light_rail", "funicular", "tram", "rack"}
LIT_VALUES = {"yes", "automatic", "24/7", "sunset-sunrise"}
ONEWAY_FORWARD = {"yes", "true", "1"}
ONEWAY_REVERSE = {"-1", "reverse"}
LAMP_SPACING_M = 32
LAMP_MIN_DISTANCE_M = 18
LAMP_CLASSES = {"motorway", "primary", "secondary", "tertiary", "minor", "service"}
ROAD_HALF_WIDTH = {"motorway": 5.5, "primary": 4, "secondary": 3.5, "tertiary": 3, "minor": 2.5, "service": 1.8}

AMENITY_GROUPS = {
    "Gastronomie": {"restaurant", "cafe", "bar", "pub", "fast_food", "biergarten", "ice_cream"},
    "Bildung": {"school", "kindergarten", "college", "university", "library", "music_school"},
    "Gesundheit": {"doctors", "pharmacy", "clinic", "hospital", "dentist", "veterinary", "nursing_home"},
    "Verwaltung und Dienste": {"townhall", "post_office", "bank", "police", "fire_station", "community_centre", "post_box", "atm", "courthouse"},
    "Religion": {"place_of_worship"},
    "Verkehr": {"ferry_terminal", "bus_station", "taxi", "car_rental", "bicycle_rental", "charging_station", "fuel"},
    "Freizeit und Kultur": {"theatre", "cinema", "arts_centre", "events_venue", "marketplace", "social_facility"},
}
IGNORED_AMENITIES = {"parking", "bench", "waste_basket", "recycling", "toilets", "bicycle_parking", "drinking_water", "vending_machine",
                     "shelter", "waste_disposal", "parking_space", "parking_entrance", "motorcycle_parking", "fountain", "clock", "give_box",
                     "bbq", "post_box", "atm", "charging_station", "lounger", "hunting_stand", "grit_bin", "waste_transfer_station"}


def to_local_xy(lon: float, lat: float, origin) -> tuple[float, float]:
    easting, northing = to_lv95.transform(lon, lat)
    return easting - origin[0], -(northing - origin[1])


def project_geometry(points: list[dict], origin) -> list[tuple[float, float]]:
    return [to_local_xy(p["lon"], p["lat"], origin) for p in points]


def flat(coords) -> list[float]:
    return [round(v, 1) for xy in coords for v in xy]


def lines_of(geometry) -> list[LineString]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [geometry]
    if geometry.geom_type in ("MultiLineString", "GeometryCollection"):
        return [g for part in geometry.geoms for g in lines_of(part)]
    return []


def oneway_direction(tags: dict) -> int:
    """+1: Einbahn in Digitalisierrichtung, -1: gegen sie, 0: beidseitig befahrbar (Kreisel gelten als Einbahn)."""
    value = tags.get("oneway")
    if value in ONEWAY_FORWARD or tags.get("junction") == "roundabout":
        return 1
    return -1 if value in ONEWAY_REVERSE else 0


def process_roads(raw: dict, clip, origin) -> list[dict]:
    roads = []
    for element in raw["elements"]:
        if element["type"] != "way" or "geometry" not in element:
            continue
        tags = element["tags"]
        highway, railway, aerialway = tags.get("highway"), tags.get("railway"), tags.get("aerialway")
        if highway:
            kind = ROAD_CLASSES.get(highway)
            if kind is None or tags.get("area") == "yes":
                continue
        elif railway in RAIL_VALUES:
            kind = "rail"
        elif aerialway and aerialway not in ("pylon", "station"):
            kind = "aerialway"
        else:
            continue
        line = LineString(project_geometry(element["geometry"], origin))
        for part in lines_of(line.intersection(clip)):
            if part.length < 1:
                continue
            bridge = tags.get("bridge") not in (None, "no")
            tunnel = tags.get("tunnel") not in (None, "no") or tags.get("covered") == "yes"
            roads.append({
                "id": element["id"], "c": kind, "n": tags.get("name") or tags.get("ref"),
                "b": int(bridge), "t": int(tunnel), "lit": int(tags.get("lit") in LIT_VALUES), "l": int(tags.get("layer", 0) or 0) if str(tags.get("layer", "0")).lstrip("-").isdigit() else 0,
                "ow": oneway_direction(tags), "ln": int(tags["lanes"]) if str(tags.get("lanes", "")).isdigit() else 0,
                "p": flat(part.coords),
            })
    return roads


def assemble_polygons(relation: dict, origin):
    """Setzt Multipolygon-Relationen aus den Rand-Wegen zusammen (outer minus inner)."""
    outers, inners = [], []
    for member in relation.get("members", []):
        if member["type"] != "way" or "geometry" not in member:
            continue
        line = LineString(project_geometry(member["geometry"], origin))
        (inners if member["role"] == "inner" else outers).append(line)
    if not outers:
        return None
    outer_polygons = list(polygonize(linemerge(outers)))
    if not outer_polygons:
        return None
    result = unary_union(outer_polygons)
    inner_polygons = list(polygonize(linemerge(inners))) if inners else []
    if inner_polygons:
        result = result.difference(unary_union(inner_polygons))
    return result


def polygon_rings(geometry) -> list[list[list[float]]]:
    polygons = [geometry] if geometry.geom_type == "Polygon" else list(getattr(geometry, "geoms", []))
    out = []
    for polygon in polygons:
        if polygon.geom_type != "Polygon" or polygon.is_empty or polygon.area < 4:
            continue
        out.append([flat(polygon.exterior.coords)] + [flat(ring.coords) for ring in polygon.interiors])
    return out


def process_water(raw: dict, clip, origin) -> dict:
    areas, streams = [], []
    for element in raw["elements"]:
        tags = element.get("tags", {})
        if element["type"] == "relation":
            geometry = assemble_polygons(element, origin)
        elif element["type"] == "way" and "geometry" in element and tags.get("waterway") in {"river", "stream", "canal"}:
            line = LineString(project_geometry(element["geometry"], origin))
            for part in lines_of(line.intersection(clip)):
                streams.append({"id": element["id"], "n": tags.get("name"), "k": tags["waterway"], "p": flat(part.coords)})
            continue
        elif element["type"] == "way" and tags.get("natural") == "water" and "geometry" in element and len(element["geometry"]) >= 4:
            coords = project_geometry(element["geometry"], origin)
            geometry = Polygon(coords) if coords[0] == coords[-1] else None
        else:
            continue
        if geometry is None or geometry.is_empty:
            continue
        geometry = geometry.buffer(0).intersection(clip)
        for rings in polygon_rings(geometry):
            areas.append({"id": element["id"], "n": tags.get("name"), "k": tags.get("water") or "water", "rings": rings})
    return {"areas": areas, "streams": streams}


def poi_category(tags: dict) -> tuple[str, str] | None:
    amenity, shop, tourism, historic, leisure = (tags.get(k) for k in ("amenity", "shop", "tourism", "historic", "leisure"))
    if amenity and amenity not in IGNORED_AMENITIES:
        for group, values in AMENITY_GROUPS.items():
            if amenity in values:
                return group, amenity
        return "Sonstiges", amenity
    if shop:
        return "Einkauf", shop
    if tourism and tourism not in {"information"}:
        return "Tourismus", tourism
    if tourism == "information" and tags.get("information") == "office":
        return "Tourismus", "information"
    if historic:
        return "Historisch", historic
    if leisure:
        return "Freizeit und Kultur", leisure
    return None


def process_pois(raw: dict, clip, origin) -> list[dict]:
    pois = []
    for element in raw["elements"]:
        tags = element.get("tags", {})
        if not tags.get("name"):
            continue
        category = poi_category(tags)
        if category is None:
            continue
        lon = element.get("lon") or element.get("center", {}).get("lon")
        lat = element.get("lat") or element.get("center", {}).get("lat")
        if lon is None:
            continue
        x, z = to_local_xy(lon, lat, origin)
        if not clip.contains(Point(x, z)):
            continue
        address = " ".join(filter(None, [tags.get("addr:street"), tags.get("addr:housenumber")]))
        entry = {"id": f"{element['type'][0]}{element['id']}", "n": tags["name"], "c": category[0], "s": category[1], "x": round(x, 1), "z": round(z, 1)}
        extras = {k: tags[k] for k in ("opening_hours", "website", "cuisine", "wheelchair") if k in tags}
        if address:
            extras["address"] = address + (f", {tags['addr:postcode']} {tags['addr:city']}" if "addr:postcode" in tags and "addr:city" in tags else "")
        if extras:
            entry["t"] = extras
        pois.append(entry)
    return pois


def stop_mode(tags: dict) -> str | None:
    if tags.get("railway") in {"station", "halt"} or tags.get("train") == "yes":
        return "train"
    if tags.get("amenity") == "ferry_terminal" or tags.get("ferry") == "yes":
        return "ferry"
    if tags.get("highway") == "bus_stop" or tags.get("bus") == "yes" or tags.get("amenity") == "bus_station":
        return "bus"
    return None


def process_transport(pois_raw: dict, routes_raw: dict, clip, origin) -> dict:
    stops: list[dict] = []
    for element in pois_raw["elements"]:
        tags = element.get("tags", {})
        name = tags.get("name")
        mode = stop_mode(tags)
        if not name or mode is None or "lon" not in element:
            continue
        x, z = to_local_xy(element["lon"], element["lat"], origin)
        if not clip.contains(Point(x, z)):
            continue
        # Gleiche Haltestelle in mehreren Richtungen (> 20 m Abstand) bleibt getrennt; Duplikate am selben Ort werden zusammengeführt.
        same = next((s for s in stops if s["n"] == name and s["m"] == mode and (s["x"] - x) ** 2 + (s["z"] - z) ** 2 < 20 ** 2), None)
        shelter = tags.get("shelter") == "yes" or tags.get("covered") == "yes"
        bench = tags.get("bench") == "yes"
        if same:
            same["shelter"] = same["shelter"] or shelter
            same["bench"] = same["bench"] or bench
            continue
        stops.append({"n": name, "m": mode, "x": round(x, 1), "z": round(z, 1), "ref": tags.get("uic_ref") or tags.get("ref:IFOPT"),
                      "shelter": shelter, "bench": bench})
    lines: dict[tuple, dict] = {}
    for relation in routes_raw["elements"]:
        tags = relation.get("tags", {})
        mode = {"train": "train", "railway": "train", "light_rail": "train", "bus": "bus", "ferry": "ferry"}.get(tags.get("route"))
        ref = tags.get("ref") or tags.get("name") or str(relation["id"])
        if mode is None or "flixbus" in (tags.get("name", "") + tags.get("operator", "")).lower():
            continue
        segments = []
        for member in relation.get("members", []):
            if member["type"] == "way" and "geometry" in member and member.get("role", "") not in {"platform", "platform_entry_only", "platform_exit_only", "stop"}:
                segments.append(LineString(project_geometry(member["geometry"], origin)))
        if not segments:
            continue
        merged = linemerge(MultiLineString(segments)).intersection(clip)
        parts = [p for p in lines_of(merged) if p.length > 5]
        if not parts:
            continue
        key = (mode, ref)
        entry = lines.setdefault(key, {"m": mode, "ref": ref, "name": tags.get("name"), "operator": tags.get("operator"),
                                       "colour": tags.get("colour"), "geom": [], "names": set()})
        entry["geom"].extend(parts)
        entry["names"].add(tags.get("name") or ref)
    output_lines = []
    for entry in lines.values():
        union = unary_union(entry["geom"])
        merged = linemerge(union) if union.geom_type == "MultiLineString" else union
        output_lines.append({"m": entry["m"], "ref": entry["ref"], "name": sorted(entry["names"])[0], "operator": entry["operator"],
                             "colour": entry["colour"], "lines": [flat(p.coords) for p in lines_of(merged)]})
    return {"stops": stops, "lines": output_lines}


def process_lamps(raw: dict, roads: list[dict], clip, origin) -> list[list[float]]:
    """[x, z, Quelle]: 0 = OSM-Knoten (street_lamp), 1 = modelliert entlang Strassen mit lit=yes (Abstand ca. 32 m)."""
    lamps = []
    for element in raw["elements"]:
        if "lon" not in element:
            continue
        x, z = to_local_xy(element["lon"], element["lat"], origin)
        if clip.contains(Point(x, z)):
            lamps.append([round(x, 1), round(z, 1), 0])
    real = [(x, z) for x, z, _ in lamps]
    placed: list[tuple[float, float]] = list(real)

    def near_existing(x: float, z: float) -> bool:
        return any((x - px) ** 2 + (z - pz) ** 2 < LAMP_MIN_DISTANCE_M ** 2 for px, pz in placed)

    for road in roads:
        if not road["lit"] or road["t"] or road["c"] not in LAMP_CLASSES:
            continue
        line = LineString(list(zip(road["p"][0::2], road["p"][1::2])))
        offset = ROAD_HALF_WIDTH[road["c"]] + 1.0
        distance = LAMP_SPACING_M / 2
        while distance < line.length:
            a, b = line.interpolate(distance), line.interpolate(min(line.length, distance + 2))
            dx, dz = b.x - a.x, b.y - a.y
            length = (dx * dx + dz * dz) ** 0.5 or 1.0
            x, z = a.x - dz / length * offset, a.y + dx / length * offset  # rechte Strassenseite
            if not near_existing(x, z):
                lamps.append([round(x, 1), round(z, 1), 1])
                placed.append((x, z))
            distance += LAMP_SPACING_M
    return lamps


MARKED_CROSSINGS = {"zebra", "marked", "uncontrolled", "traffic_signals"}
CROSSING_ROADS = {"primary", "secondary", "tertiary", "minor", "service"}


def process_crossings(raw: dict, roads: list[dict], clip, origin) -> dict:
    """Fussgängerstreifen: [x, z, Winkel der Strasse (rad, atan2(dz, dx)), Strassenbreite, Art]; nur markierte Übergänge auf Strassen."""
    segments = []
    for road in roads:
        if road["c"] not in CROSSING_ROADS or road["t"]:
            continue
        p = road["p"]
        for i in range(0, len(p) - 3, 2):
            segments.append((p[i], p[i + 1], p[i + 2], p[i + 3], road["c"]))
    seg = np.array([s[:4] for s in segments], dtype="float64") if segments else np.zeros((0, 4))
    crossings, level = [], []
    for element in raw["elements"]:
        tags = element.get("tags", {})
        if "lon" not in element:
            continue
        x, z = to_local_xy(element["lon"], element["lat"], origin)
        if not clip.contains(Point(x, z)):
            continue
        if tags.get("railway") == "level_crossing":
            level.append([round(x, 1), round(z, 1)])
            continue
        kind = tags.get("crossing")
        markings = tags.get("crossing:markings")
        if kind == "unmarked" or markings == "no":
            continue
        zebra = kind == "zebra" or markings in {"zebra", "yes", "ladder", "surface", "lines"} or tags.get("crossing_ref") == "zebra"
        if not (zebra or kind in MARKED_CROSSINGS) or not len(seg):
            continue
        dx, dz = seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1]
        length2 = np.maximum(dx * dx + dz * dz, 1e-9)
        t = np.clip(((x - seg[:, 0]) * dx + (z - seg[:, 1]) * dz) / length2, 0, 1)
        distance = np.hypot(x - (seg[:, 0] + dx * t), z - (seg[:, 1] + dz * t))
        index = int(distance.argmin())
        if distance[index] > 6:
            continue
        cls = segments[index][4]
        crossings.append([round(x, 1), round(z, 1), round(float(np.arctan2(dz[index], dx[index])), 3), ROAD_HALF_WIDTH[cls] * 2, "zebra" if zebra else "marked"])
    return {"crossings": crossings, "levelCrossings": level}


def process_places(raw: dict, clip, origin) -> list[dict]:
    places = []
    for element in raw["elements"]:
        tags = element.get("tags", {})
        if "lon" not in element or not tags.get("name"):
            continue
        x, z = to_local_xy(element["lon"], element["lat"], origin)
        if not clip.contains(Point(x, z)):
            continue
        kind = tags.get("place") or tags.get("natural")
        entry = {"n": tags["name"], "k": kind, "x": round(x, 1), "z": round(z, 1)}
        if "ele" in tags:
            entry["ele"] = tags["ele"]
        places.append(entry)
    return places


def write_json(name: str, payload) -> None:
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    (config.OUT_DIR / name).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def main() -> None:
    boundary, buffered, origin, properties = download.study_area()
    raw = download.download_osm(buffered)
    clip_lv95 = buffered.envelope
    # Zuschnitt im lokalen System: gleiche Fläche, verschoben/gespiegelt wie die Daten.
    min_e, min_n, max_e, max_n = clip_lv95.bounds
    clip = box(min_e - origin[0], -(max_n - origin[1]), max_e - origin[0], -(min_n - origin[1]))

    roads = process_roads(raw["roads"], clip, origin)
    write_json("roads.json", {"roads": roads})
    water = process_water(raw["water"], clip, origin)
    write_json("water.json", water)
    pois = process_pois(raw["pois"], clip, origin)
    write_json("pois.json", {"pois": pois})
    transport = process_transport(raw["pois"], raw["routes"], clip, origin)
    write_json("transport.json", transport)
    places = process_places(raw["places"], clip, origin)
    write_json("places.json", {"places": places})
    lamps = process_lamps(raw["lamps"], roads, clip, origin)
    write_json("lamps.json", {"lamps": lamps, "sources": {"0": "OSM street_lamp", "1": "modelliert entlang Strassen mit lit=yes"}})

    crossings = process_crossings(raw["crossings"], roads, clip, origin)
    write_json("crossings.json", crossings)

    counts = defaultdict(int)
    for road in roads:
        counts[road["c"]] += 1
    update_metadata("osm", {
        "files": ["roads.json", "water.json", "pois.json", "transport.json", "places.json", "lamps.json", "crossings.json"],
        "crossings": {"marked": len(crossings["crossings"]), "levelCrossings": len(crossings["levelCrossings"])},
        "lamps": {"osm": sum(1 for lamp in lamps if lamp[2] == 0), "modelled": sum(1 for lamp in lamps if lamp[2] == 1)},
        "roads": dict(counts), "waterAreas": len(water["areas"]), "streams": len(water["streams"]),
        "pois": len(pois), "stops": len(transport["stops"]), "lines": len(transport["lines"]),
        "source": "OpenStreetMap-Mitwirkende, ODbL 1.0 (Overpass-API)",
    })
    print(f"Strassen/Bahn: {len(roads)}, Wasserflächen: {len(water['areas'])}, Bäche: {len(water['streams'])}, "
          f"POI: {len(pois)}, Haltestellen: {len(transport['stops'])}, Linien: {len(transport['lines'])}")


if __name__ == "__main__":
    main()
