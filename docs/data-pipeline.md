# Datenpipeline

Die Pipeline (`pipeline/`) lädt die Rohdaten, verarbeitet sie und schreibt browseroptimierte Dateien nach `public/data/`. Sie ist wiederholbar: Downloads landen in `pipeline/cache/` und werden bei erneuter Ausführung nicht wiederholt (Löschen des Ordners erzwingt einen frischen Abruf).

```bash
.venv/bin/python -m pipeline.run_all            # terrain buildings osm trees export
.venv/bin/python -m pipeline.run_all buildings  # einzelner Schritt
.venv/bin/python -m pipeline.download osm       # nur Download
```

## Konfiguration (`pipeline/config.py`)

| Wert | Bedeutung | Standard |
|---|---|---|
| `MUNICIPALITY_BFS`, `LOOKUP_POINT_WGS84` | Gemeinde und ein Punkt darin | 1364, Brunnen |
| `BUFFER_M` | Umgebungspuffer um die Gemeindegrenze | 300 m |
| `ORIGIN_ROUNDING_M` | Rundung des lokalen Ursprungs | 100 m (ergibt 2'688'000 / 1'206'300) |
| `DEM_CELL_M` | Zellgrösse von `dem.bin` | 5 m |
| `ORTHO_RESOLUTION_M` | Pixelgrösse von `ortho.jpg` | 2 m |

Das Untersuchungsgebiet ist das Rechteck um die gepufferte Gemeindegrenze (für Gelände und Luftbild) bzw. die gepufferte Fläche selbst (für Gebäude, Adressen, Bäume).

## Schritte

1. **Gemeindegrenze** (`download.fetch_boundary`): Identify-Abfrage, neuester Stand der Gemeinde, Plausibilitätsprüfung auf LV95.
2. **Lokaler Ursprung**: gerundeter Mittelpunkt der Gemeinde-Bounding-Box.
3. **Gelände** (`process_terrain.py`): swissALTI3D-Kacheln (2 m) werden zu einem 5-m-Raster gemittelt, auf Uint16 quantisiert (0.1 m).
4. **Gebäude** (`process_buildings.py`): swissBUILDINGS3D-Kacheln (neueste je Kachel) lesen, Flächen triangulieren (earcut nach Projektion auf die dominante Ebene, mit Löchern), je Fläche nach aussen ausrichten, Oberflächenklasse bestimmen, mit GWR über EGID verknüpfen, Adressen aus GWR-Eingängen exportieren.
5. **OSM** (`process_osm.py`): Strassen, Bahn, Seilbahnen, Gewässer (Multipolygone zusammengesetzt), POI, Linien, Haltestellen, Ortsnamen; Zuschnitt auf das Gebiet.
6. **Bäume** (`process_trees.py`): Ausschnitt des Vegetationshöhenmodells per HTTP-Bereichsabfrage, Gaussglättung, lokale Maxima ≥ 3 m (Fenster 5 m), Kronenradius aus Höhe geschätzt.
7. **Luftbild** (`process_terrain.build_ortho`): SWISSIMAGE-Kacheln zu einem JPEG; Ausdehnung identisch mit dem Höhenraster.
8. **Export** (`export.py`): `municipality.json`, `statistics.json` (GWR-Aggregate), `sources.json` (Herkunft, Lizenz, Abrufdatum).

`metadata.json` wird von den Schritten abschnittsweise ergänzt (`dem`, `ortho`, `buildings`, `osm`, `trees`, `municipality`, `statistics`) und ist die Verbindung zwischen Pipeline und Frontend (Ursprung, Raster, Höhenversatz).

## Koordinatensystem

Quelldaten: LV95 (EPSG:2056). Lokales Three.js-System (Rotation, keine Spiegelung, daher bleibt die Dreiecksorientierung erhalten):

```
x = E - E0                (Ost = +x)
y = Höhe m ü. M. - 430    (elevationOffset)
z = -(N - N0)             (Nord = -z)
E0, N0 = metadata.dem.origin
```

## Dateiformate (`public/data/`)

Alle Binärdateien sind little-endian.

### `dem.bin`

`Uint16[nx * ny]`, Index `j * nx + i`, `i` = West→Ost, `j` = Süd→Nord. Gitterpunkt `(i, j)` liegt bei `E = min_e + i * cell`, `N = min_n + j * cell`. Höhe m ü. M. = `elevationOffset + wert * heightScale` (0.1 m). Werte stehen in `metadata.dem` (`extent`, `heightScale`, `elevationOffset`, `minHeight`, `maxHeight`, `origin`).

### `buildings3d.bin`

| Bereich | Inhalt |
|---|---|
| Kopf (5 × uint32) | `"BLD3"`, Version (1), Gebäudeanzahl, Vertexanzahl, Indexanzahl |
| Gebäudetabelle | je Gebäude 4 × uint32: `vertexStart`, `vertexCount`, `indexStart`, `indexCount` |
| Positionen | `Float32[vertexCount * 3]`, lokale Koordinaten |
| Indizes | `Uint32[indexCount]`, globale Vertexindizes, Dreiecke gegen den Uhrzeigersinn von aussen |
| Oberflächen | `Uint8[vertexCount]` (0 Wand, 1 Dach, 2 Boden), auf 4 Byte aufgefüllt |

Eintrag *i* der Tabelle gehört zu `buildings.json → buildings[i]`. Normalen werden im Browser berechnet (jede Fläche hat eigene Vertices, daher flache Schattierung).

### `buildings.json`

`{"buildings": [ { id (UUID), egid, type (OBJEKTART), usage, name, height (GESAMTHOEHE), roofMax, roofMin, groundElevation, footprintArea, center [E, N], inMunicipality, modelYear, tile, gwr: { category, class, yearBuilt, periodBuilt, status, footprintAreaGwr, volumeGwr, floors, dwellings, heatGenerator, heatEnergy } } ]}`. Fehlende Werte sind `null` bzw. fehlen; sie werden nicht ergänzt.

### `codes.json`

GWR-Codetabellen (`GKAT`, `GKLAS`, `GBAUP`, `GSTAT`, `GWAERZH1`, `GENH1`) → deutsche Bezeichnung.

### `addresses.json`

`[ [Bezeichnung, E, N, Gebäudeindex oder -1], … ]` aus den GWR-Eingängen.

### `trees.bin`

Kopf (4 × uint32: `"TRE1"`, Version, Anzahl, 0), dann `Float32[n]` x, `Float32[n]` z, `Uint8[n]` Höhe in 0.5 m, `Uint8[n]` Kronenradius in 0.25 m (jeweils auf 4 Byte aufgefüllt).

### JSON-Dateien

- `roads.json`: `{ roads: [ { id, c (Klasse), n, b (Brücke), t (Tunnel), l (Layer), p [x0, z0, x1, z1, …] } ] }`
- `water.json`: `{ areas: [ { id, n, k, rings: [aussen, loch…] } ], streams: [ { id, n, k, p } ] }`
- `pois.json`: `{ pois: [ { id, n, c (Kategorie), s (OSM-Wert), x, z, t (Zusatzangaben) } ] }`
- `transport.json`: `{ stops: [ { n, m (train/bus/ferry), x, z } ], lines: [ { m, ref, name, operator, colour, lines: [[…]] } ] }`
- `places.json`: `{ places: [ { n, k, x, z, ele } ] }`
- `municipality.json`: Name, BFS, Fläche, Mittelpunkt, `polygons` (Ringe lokal)
- `statistics.json`, `sources.json`, `metadata.json`

## Tests der Pipeline

`tests/test_pipeline.py` prüft Triangulation und Orientierung (Würfel, Loch), Extent und Koordinaten sowie – wenn vorhanden – Grössen, Header und Konsistenz der erzeugten Dateien und die Dokumentation von Lizenz und Herkunft je Datensatz.
