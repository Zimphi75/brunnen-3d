"""Gemeinsame Geometrie des Untersuchungsgebiets für alle Pipeline-Schritte."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, asdict

from . import config


@dataclass(frozen=True)
class Extent:
    """Rasterraster-Ausdehnung in LV95, ausgerichtet auf das DEM-Zellraster.

    min_e/min_n sind die Koordinaten der Südwestecke; das Gelände hat nx*ny Gitterpunkte
    im Abstand cell. Zellmitte-Konvention: Gitterpunkt (i, j) liegt bei (min_e + i*cell, min_n + j*cell).
    """
    min_e: float
    min_n: float
    nx: int
    ny: int
    cell: float

    @property
    def max_e(self) -> float:
        return self.min_e + (self.nx - 1) * self.cell

    @property
    def max_n(self) -> float:
        return self.min_n + (self.ny - 1) * self.cell

    @property
    def width(self) -> float:
        return (self.nx - 1) * self.cell

    @property
    def height(self) -> float:
        return (self.ny - 1) * self.cell


def compute_extent(buffered, cell: float) -> Extent:
    min_e, min_n, max_e, max_n = buffered.bounds
    min_e = math.floor(min_e / cell) * cell
    min_n = math.floor(min_n / cell) * cell
    nx = int(math.ceil((max_e - min_e) / cell)) + 1
    ny = int(math.ceil((max_n - min_n) / cell)) + 1
    return Extent(min_e, min_n, nx, ny, cell)


def to_local(easting: float, northing: float, elevation: float, origin: tuple[float, float], elevation_offset: float):
    """LV95 + Meter über Meer -> lokales Three.js-System (x = Ost, y = Höhe, z = -Nord)."""
    return easting - origin[0], elevation - elevation_offset, -(northing - origin[1])


def read_metadata() -> dict:
    path = config.OUT_DIR / "metadata.json"
    return json.loads(path.read_text()) if path.exists() else {}


def update_metadata(section: str, values: dict) -> None:
    """Schreibt einen Abschnitt in metadata.json (Mehrfachausführung überschreibt nur den eigenen Abschnitt)."""
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    metadata = read_metadata()
    metadata[section] = values
    (config.OUT_DIR / "metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False))


def extent_dict(extent: Extent) -> dict:
    return asdict(extent)


def download_date(*names: str) -> str:
    """Datum des neuesten zwischengespeicherten Downloads unter pipeline/cache/<name> (Datei oder Ordner).

    Massgebend ist das Änderungsdatum der Datei, also der tatsächliche Abruf bei der Quelle, nicht der Build-Tag.
    Ohne zwischengespeicherte Datei: heute.
    """
    import datetime as _datetime
    from . import config as _config
    newest = None
    for name in names:
        path = _config.CACHE_DIR / name
        files = [path] if path.is_file() else (list(path.rglob("*")) if path.is_dir() else [])
        for file in files:
            if file.is_file():
                newest = max(newest or 0.0, file.stat().st_mtime)
    if newest is None:
        return _datetime.date.today().isoformat()
    return _datetime.datetime.fromtimestamp(newest, _datetime.timezone.utc).date().isoformat()
