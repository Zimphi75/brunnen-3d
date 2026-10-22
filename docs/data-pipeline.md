# Datenpipeline

Die Pipeline (`pipeline/`) lädt die Rohdaten, verarbeitet sie und schreibt browseroptimierte Dateien nach `public/data/`. Sie ist wiederholbar: Downloads landen in `pipeline/cache/` und werden bei erneuter Ausführung nicht wiederholt (Löschen des Ordners erzwingt einen frischen Abruf).

```bash
.venv/bin/python -m pipeline.run_all            # terrain buildings parcels osm trees pv votes export
.venv/bin/python -m pipeline.run_all buildings  # einzelner Schritt
.venv/bin/python -m pipeline.run_all parcels    # Parzellen und Gebäudeverknüpfung
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
4. **Gebäude** (`process_buildings.py`): swissBUILDINGS3D-Kacheln (neueste je Kachel) lesen, Flächen triangulieren (earcut nach Projektion auf die dominante Ebene, mit Löchern), je Fläche nach aussen ausrichten, Oberflächenklasse bestimmen, mit GWR über EGID verknüpfen (Gebäude ohne EGID über die Lage im GWR-Grundriss, 37 Treffer), Adressen aus GWR-Eingängen exportieren. Bestehende GWR-Gebäude ohne 3D-Modell gehen nach `gwr_unmatched.json`; als abgebrochen registrierte Gebäude (Status 1007/1008) bleiben im Modell, werden aber im Browser ausgeblendet.
5. **Parzellen und Nutzungsplanung** (`process_parcels.py`): AV-Grundstücke, Grundnutzung und überlagernde ÖREB-Fachdaten über den Schwyzer WFS beziehen, GML 3.2 in LV95 einlesen und auf das Untersuchungsgebiet zuschneiden. Gebäude werden anhand ihres Modellmittelpunkts räumlich Parzellen und Planungsflächen zugeordnet. Der AV-WFS liefert Grundstücksnummer, Gemeinde und Fläche, aber kein EGRID; Eigentümerdaten werden nicht bezogen. Das Nutzungsplanungs-Schema liefert `typ`, `legend_text` und `geolink`, aber keine Rechtsverbindlichkeit oder Gültigkeit.
6. **OSM** (`process_osm.py`): Strassen, Bahn, Seilbahnen, Gewässer (Multipolygone zusammengesetzt), POI, Linien, Haltestellen, Ortsnamen; Zuschnitt auf das Gebiet.
7. **Bäume** (`process_trees.py`): Ausschnitt des Vegetationshöhenmodells per HTTP-Bereichsabfrage, Gaussglättung, lokale Maxima ≥ 3 m (Fenster 5 m), Kronenradius aus Höhe geschätzt.
8. **Luftbild** (`process_terrain.build_ortho`): SWISSIMAGE-Kacheln zu einem JPEG; Ausdehnung identisch mit dem Höhenraster.
9. **Dachfarben** (`roof_colors.py`, aus `process_buildings`): SWISSIMAGE-WMS-Kacheln (1 km, Zwischenspeicher), Median der Pixel auf den Dachflächen jedes Gebäudes → `roofColor` in `buildings.json`.
10. **Photovoltaik** (`process_pv.py`): BFE-Anlagenregister (CSV-ZIP, 340'000 Anlagen), Unterkategorie Photovoltaik; Zuordnung zum 3D-Gebäude über die EGID, sonst über die Koordinate (Dachprojektion, höchstens 6 m Abstand); Teilanlagen mit Ausrichtung und Neigung aus `PlantDetail` → `pv.json`.
11. **Abstimmungen** (`process_votes.py`): BFS-voteinfo-JSON je Abstimmungstag (per `curl`, System-Zertifikate), Ja-Anteil der Gemeinde, des Kantons und der Schweiz → `votes.json`.
12. **Export** (`export.py`): `municipality.json`, `statistics.json` (GWR-Aggregate), `sources.json` (Herkunft, Lizenz, Abrufdatum), `manifest.json` (SHA-256 der Eingabedateien).

`metadata.json` wird von den Schritten abschnittsweise ergänzt (`dem`, `ortho`, `buildings`, `parcels`, `osm`, `trees`, `municipality`, `statistics`) und ist die Verbindung zwischen Pipeline und Frontend (Ursprung, Raster, Höhenversatz, Abdeckung und Qualität).

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

### `buildings3d.bin` (Version 2)

| Bereich | Inhalt |
|---|---|
| Kopf (6 × uint32) | `"BLD3"`, Version (2), Gebäudeanzahl, Vertexanzahl, Indexanzahl, Flächenanzahl |
| Gebäudetabelle | je Gebäude 6 × uint32: `vertexStart`, `vertexCount`, `indexStart`, `indexCount`, `faceStart`, `faceCount` |
| Positionen | `Float32[vertexCount * 3]`, lokale Koordinaten |
| Indizes | `Uint32[indexCount]`, globale Vertexindizes, Dreiecke gegen den Uhrzeigersinn von aussen |
| Oberflächen | `Uint8[vertexCount]` (0 Wand, 1 Dach, 2 Boden), auf 4 Byte aufgefüllt |
| Flächen | `Uint32[faceCount]`: Vertexanzahl je Fläche (jede Fläche hat eigene Vertices; der Shader leitet daraus Wandbreite und Fensterraster ab) |

Eintrag *i* der Tabelle gehört zu `buildings.json → buildings[i]`. Normalen werden im Browser berechnet (flache Schattierung).

### `buildings.json`

`{"buildings": [ { id (UUID), egid, type (OBJEKTART), usage, name, height (GESAMTHOEHE), roofMax, roofMin, groundElevation, footprintArea, center [E, N], inMunicipality, modelYear, tile, gwr: { category, class, yearBuilt, periodBuilt, status, footprintAreaGwr, volumeGwr, floors, dwellings, heatGenerator, heatEnergy }, roofColor } ]}`. `roofColor` ist ein Hexwert aus dem Luftbild (fehlt, wenn kein Dachpixel messbar war). Fehlende Werte sind `null` bzw. fehlen; sie werden nicht ergänzt.

### `codes.json`

GWR-Codetabellen (`GKAT`, `GKLAS`, `GBAUP`, `GSTAT`, `GWAERZH1`, `GENH1`) → deutsche Bezeichnung.

### `addresses.json`

`[ [Bezeichnung, E, N, Gebäudeindex oder -1], … ]` aus den GWR-Eingängen.

### `trees.bin`

Kopf (4 × uint32: `"TRE1"`, Version, Anzahl, 0), dann `Float32[n]` x, `Float32[n]` z, `Uint8[n]` Höhe in 0.5 m, `Uint8[n]` Kronenradius in 0.25 m (jeweils auf 4 Byte aufgefüllt).

### JSON-Dateien

- `parcels.json`: `{ crs, sourceCrs, retrieved, source, matchMethod, parcels: [ { id, number, municipality, areaM2, link, rings: [[[x, z], ...]], buildingIds } ] }`. `buildings.json` enthält je Gebäude zusätzlich `parcels` mit den zugeordneten Parzellen. Zuordnungsmethode: LV95-Modellmittelpunkt liegt innerhalb der Parzellengeometrie; EGRID ist in diesem WFS nicht enthalten.
- `planning.json`: `{ crs, sourceCrs, retrieved, source, warning, available, errors, features: [ { id, kind, type, label, link, rings: [[[x, z], ...]] } ] }`. `buildings.json` enthält je Gebäude zusätzlich `landUse` mit Grundnutzungs- und überlagernden Festlegungen am Gebäudemittelpunkt. Das gelieferte Schema enthält keine Rechtsverbindlichkeit und keinen Gültigkeitszeitraum.
- `roads.json`: `{ roads: [ { id, c (Klasse), n, b (Brücke), t (Tunnel), l (Layer), lit (beleuchtet, OSM), ow (Einbahn: +1 in Punktfolge, -1 dagegen, 0 beidseitig; Kreisel +1), ln (Spurzahl laut OSM oder 0), p [x0, z0, x1, z1, …] } ] }`
- `lamps.json`: `{ lamps: [ [x, z, art] ] }`, `art` 0 = OSM-Knoten, 1 = entlang `lit=yes`-Strassen modelliert (Abstand rund 35 m)
- `gwr_unmatched.json`: `{ buildings: [ { egid, e, n, address, inMunicipality, gwr } ] }`, bestehende Registergebäude ohne 3D-Modell
- `pv.json`: `{ retrieved, source, orientations, plants: [ { id, b (Gebäudeindex), kw, year, cat (angebaut/integriert/freistehend), match (egid/lage), parts: [ [kw, Neigung°, Ausrichtung 1–9, Jahr] ] } ] }`; Ausrichtung 1 Norden … 5 Süden … 8 Nordwest, 9 Zenit (flach)
- `votes.json`: `{ bfs, retrieved, source, votes: [ { date, title, local, turnout, canton, swiss, accepted } ] }`
- `manifest.json`: SHA-256 und Grösse der Eingabedateien
- `water.json`: `{ areas: [ { id, n, k, rings: [aussen, loch…] } ], streams: [ { id, n, k, p } ] }`
- `pois.json`: `{ pois: [ { id, n, c (Kategorie), s (OSM-Wert), x, z, t (Zusatzangaben) } ] }`
- `transport.json`: `{ stops: [ { n, m (train/bus/ferry), x, z, ref, shelter, bench } ], lines: [ { m, ref, name, operator, colour, lines: [[…]] } ] }`
- `places.json`: `{ places: [ { n, k, x, z, ele } ] }`
- `municipality.json`: Name, BFS, Fläche, Mittelpunkt, `polygons` (Ringe lokal)
- `statistics.json`, `sources.json`, `metadata.json`

## Tests der Pipeline

`tests/test_pipeline.py` prüft Triangulation und Orientierung (Würfel, Loch), Extent und Koordinaten sowie – wenn vorhanden – Grössen, Header (Format v2) und Konsistenz der erzeugten Dateien, Dachfarben, Laternen, Registergebäude ohne Modell, Abstimmungen, Abdeckungskennzahlen, Manifest, AV-/ÖREB-GML und räumliche Gebäudezuordnung sowie die Dokumentation von Lizenz und Herkunft je Datensatz (26 Tests).
