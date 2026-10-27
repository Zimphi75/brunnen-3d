"""Prüft die Live-Daten und die Live-Schnittstellen von Brunnen 3D.

Aufruf: python scripts/live_check.py [URL]
Schreibt live-check/data.json und gibt eine Markdown-Zusammenfassung aus. Exit 1 bei Fehlern.
Nur Standardbibliothek, damit es ohne Installation läuft.
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://brunnen.multikanal.ch/").rstrip("/") + "/"
TODAY = dt.date.today()
MAX_AGE_DAYS = 40  # Monatlicher Lauf plus Reserve
CHANGING = {"gwr", "osm", "pv", "votes", "parcels", "planning"}

# Untergrenzen: deutlich unter dem heutigen Bestand, damit nur echte Ausfälle anschlagen.
MINIMUM = {
    "buildings.json": ("buildings", 2000),
    "pv.json": ("plants", 200),
    "votes.json": ("votes", 20),
    "parcels.json": ("parcels", 2000),
    "pois.json": ("pois", 300),
}

APIS = {
    "Open-Meteo Wetter": "https://api.open-meteo.com/v1/forecast?latitude=46.99&longitude=8.61&current=temperature_2m",
    "Open-Meteo Luftqualität": "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=46.99&longitude=8.61&current=european_aqi",
    "transport.opendata.ch": "https://transport.opendata.ch/v1/stationboard?station=Brunnen&limit=1",
    "GeoAdmin identify": "https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=esriGeometryPoint"
                          "&geometry=2688600,1205600&tolerance=0&layers=all:ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill"
                          "&sr=2056&returnGeometry=false",
    "Wikipedia": "https://de.wikipedia.org/api/rest_v1/page/summary/Ingenbohl",
}

problems: list[str] = []
lines: list[str] = []


def fetch(url: str, timeout: int = 30):
    request = urllib.request.Request(url, headers={"User-Agent": "brunnen-3d-live-check"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.read()


def age(value: str | None) -> int | None:
    try:
        return (TODAY - dt.date.fromisoformat(str(value)[:10])).days
    except ValueError:
        return None


# 1. Website erreichbar
try:
    status, _ = fetch(BASE)
    lines.append(f"- Startseite: HTTP {status}")
    if status != 200:
        problems.append(f"Startseite antwortet mit HTTP {status}")
except Exception as error:  # noqa: BLE001
    problems.append(f"Startseite nicht erreichbar: {error}")

# 2. Datenmengen
counts = {}
for name, (key, minimum) in MINIMUM.items():
    try:
        _, body = fetch(BASE + "public/data/" + name)
        value = json.loads(body).get(key, [])
        count = len(value) if isinstance(value, (list, dict)) else 0
        counts[name] = count
        lines.append(f"- {name}: {count} {key} (Minimum {minimum})")
        if count < minimum:
            problems.append(f"{name}: nur {count} {key}, erwartet mindestens {minimum}")
    except Exception as error:  # noqa: BLE001
        problems.append(f"{name} nicht lesbar: {error}")

# 3. Aktualität der Quellen
try:
    _, body = fetch(BASE + "public/data/sources.json")
    sources = json.loads(body)
    build_age = age(sources.get("generated"))
    lines.append(f"- Datenstand Build: {sources.get('generated')} (vor {build_age} Tagen)")
    if build_age is None or build_age > MAX_AGE_DAYS:
        problems.append(f"Letzter Daten-Build ist {build_age} Tage alt (Grenze {MAX_AGE_DAYS})")
    for dataset in sources.get("datasets", []):
        if dataset.get("id") in CHANGING:
            days = age(dataset.get("retrieved"))
            if days is None or days > MAX_AGE_DAYS:
                problems.append(f"Quelle {dataset.get('id')}: Abfrage {dataset.get('retrieved')} ist zu alt")
except Exception as error:  # noqa: BLE001
    problems.append(f"sources.json nicht lesbar: {error}")

# 4. Live-Schnittstellen, die der Browser zur Laufzeit abfragt
apis = {}
for label, url in APIS.items():
    try:
        status, body = fetch(url)
        ok = status == 200 and len(body) > 20
        apis[label] = status
        lines.append(f"- {label}: HTTP {status}")
        if not ok:
            problems.append(f"{label}: unerwartete Antwort (HTTP {status})")
    except Exception as error:  # noqa: BLE001
        apis[label] = str(error)
        problems.append(f"{label} nicht erreichbar: {error}")

out = pathlib.Path("live-check")
out.mkdir(exist_ok=True)
(out / "data.json").write_text(json.dumps({"checked": TODAY.isoformat(), "base": BASE, "counts": counts, "apis": apis,
                                            "problems": problems}, ensure_ascii=False, indent=2), encoding="utf-8")

print("## Daten und Schnittstellen\n")
print("\n".join(lines))
print("\n### Ergebnis\n")
print("\n".join(f"- FEHLER: {p}" for p in problems) if problems else "- Alles in Ordnung")
sys.exit(1 if problems else 0)
