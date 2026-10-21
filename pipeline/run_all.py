"""Führt die gesamte Datenpipeline aus (Zwischenspeicher in pipeline/cache/, wiederholbar).

Aufruf: python -m pipeline.run_all [schritt ...]
Schritte: terrain buildings osm trees votes export (ohne Argument: alle in dieser Reihenfolge)
"""
from __future__ import annotations

import sys
import time

from . import export, process_buildings, process_osm, process_terrain, process_trees, process_votes

STEPS = {
    "terrain": lambda: process_terrain.main([]),
    "buildings": process_buildings.main,
    "osm": process_osm.main,
    "trees": process_trees.main,
    "votes": process_votes.main,
    "export": export.main,
}


def main(argv: list[str]) -> None:
    unknown = [name for name in argv if name not in STEPS]
    if unknown:
        raise SystemExit(f"Unbekannte Schritte: {unknown}. Verfügbar: {list(STEPS)}")
    for name in argv or list(STEPS):
        started = time.time()
        print(f"\n== {name} ==")
        STEPS[name]()
        print(f"   ({time.time() - started:.1f} s)")


if __name__ == "__main__":
    main(sys.argv[1:])
