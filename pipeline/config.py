"""Zentrale Konfiguration der Datenpipeline (alle Koordinaten in LV95, EPSG:2056)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "pipeline" / "cache"
OUT_DIR = ROOT / "public" / "data"

MUNICIPALITY_BFS = 1364
MUNICIPALITY_NAME = "Ingenbohl"
# Ein Punkt in Brunnen (WGS84), um das Gemeindepolygon abzufragen.
LOOKUP_POINT_WGS84 = (8.6136, 47.0045)

# Umgebungspuffer um die Gemeindegrenze in Metern (konfigurierbar).
BUFFER_M = 300

CRS_LV95 = "EPSG:2056"
CRS_WGS84 = "EPSG:4326"

# Lokaler Ursprung: auf 100 m gerundeter Mittelpunkt der Gemeinde-Bounding-Box.
ORIGIN_ROUNDING_M = 100

# Gelände-Mesh: Rasterauflösung in Metern. swissALTI3D liegt in 0.5 m und 2 m vor.
DEM_SOURCE_RESOLUTION = 2
DEM_CELL_M = 5

# Orthofoto-Textur: Pixelgrösse in Metern (SWISSIMAGE 2-m-Kacheln).
ORTHO_RESOLUTION_M = 2

STAC_BASE = "https://data.geo.admin.ch/api/stac/v0.9"
GEOADMIN_API = "https://api3.geo.admin.ch/rest/services/all/MapServer"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
GWR_URL = "https://public.madd.bfs.admin.ch/sz.zip"
WMS_URL = "https://wms.geo.admin.ch/"

USER_AGENT = "brunnen-3d/0.1 (lokale Datenpipeline)"
