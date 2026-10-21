# Datenquellen

Die maschinenlesbare Fassung mit Abrufdatum steht in `public/data/sources.json` (erzeugt von `pipeline/export.py`). Geprüft wurden jeweils Lizenz, Abdeckung, Koordinatensystem, Aktualität, Format und Dateigrösse.

| Datensatz | Anbieter | Zugang | Format, Grösse (Ingenbohl) | Aktualität | Lizenz |
|---|---|---|---|---|---|
| swissBOUNDARIES3D (Gemeindegrenze) | swisstopo | `api3.geo.admin.ch` Identify, Layer `ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill` (liefert alle historischen Stände; es wird der neueste verwendet) | GeoJSON, LV95, 2 MB roh | jährlich (Stand 2026) | OGD swisstopo, Quellenangabe |
| swissALTI3D | swisstopo | STAC `ch.swisstopo.swissalti3d` | COG, 2-m-Raster, 48 Kacheln, ca. 48 MB | 6-Jahres-Zyklus; neueste Kachel je Position | OGD swisstopo, Quellenangabe |
| SWISSIMAGE 10 cm | swisstopo | STAC `ch.swisstopo.swissimage-dop10` (2-m-Variante) | COG, 48 Kacheln, ca. 6 MB | jeweils neueste Kachel | OGD swisstopo, Quellenangabe |
| swissBUILDINGS3D 3.0 Beta | swisstopo | STAC `ch.swisstopo.swissbuildings3d_3_0` (Kacheln je Landeskarte-Blatt; Vollabdeckung mit 14 GB wird übersprungen) | FileGDB (`Building_solid`, `Floor`), 6 Kacheln, 36 MB | je Kachel 2022–2025 | OGD swisstopo, Quellenangabe |
| GWR Kanton SZ | BFS | `https://public.madd.bfs.admin.ch/sz.zip` | CSV (tab-getrennt), 18 MB | täglich (Stand 2026-10-21) | OGD BFS, Quellenangabe (`license.pdf` im Paket) |
| OpenStreetMap | Mitwirkende | Overpass-API | JSON, rund 2 MB | Abruf | ODbL 1.0 |
| Vegetationshöhenmodell NFI | WSL/BAFU | STAC `ch.bafu.landesforstinventar-vegetationshoehenmodell`, COG per HTTP-Bereichsabfrage | COG 1 m (nur Ausschnitt gelesen) | Jahr 2025 | ODbL mit DbCL |
| Wetter | Open-Meteo | `api.open-meteo.com` (zur Laufzeit) | JSON | aktuell | CC BY 4.0, nicht kommerziell |
| Abfahrten | opentransportdata.swiss via transport.opendata.ch | `transport.opendata.ch/v1` (zur Laufzeit, CORS offen) | JSON | Fahrplan und Echtzeitprognose | Open Data, Quellenangabe |
| Zeitreise (historische Karten) | swisstopo | WMS `ch.swisstopo.zeitreihen`, `TIME=JJJJ1231` | Bild, CORS offen | Kartenstände 1864 bis 2021 | OGD swisstopo, Quellenangabe |

## Nicht verwendet oder nicht verfügbar

- **BFS STATPOP/STATENT (Hektarraster)**: offene Daten vorhanden, aber nicht integriert; `statistics.json` enthält nur GWR-Aggregate.
- **swissNAMES3D**: nicht integriert; Ortsnamen stammen aus OpenStreetMap.
- **BFE sonnendach.ch**: nicht integriert (Solarpotenzial als spätere Erweiterung).
- **Grundstücke und ÖREB Kanton Schwyz**: kein geprüfter offener Massendownload; nicht integriert.
- **Gemessene ÖV-Fahrzeugpositionen**: Die offene Fahrplan-API liefert nur Fahrplan und Echtzeitprognosen. Positionen in der Karte sind entweder Haltestellen (Lage aus OSM) oder als «Fahrplansimulation» gekennzeichnet.
- **Dachformen, Fassaden und Gebäudetexturen**: nicht in den offenen Daten enthalten.

## Wichtige Hinweise zu den Attributen

- swissBUILDINGS3D und GWR werden über die **EGID** verknüpft. 2238 von 2316 Gebäuden haben einen GWR-Eintrag. Gebäude ohne EGID bleiben ohne GWR-Attribute.
- **Baujahr (`GBAUJ`)** ist nur für 660 Gebäude erfasst. Für viele weitere gibt es die **Bauperiode (`GBAUP`)**. Das Feld `ERSTELLUNG_JAHR` aus swissBUILDINGS3D ist die Erfassung der Daten und wird nicht als Baujahr verwendet.
- Die Gebäude ausserhalb der Gemeindegrenze (Pufferzone, 300 m) sind im Inspector markiert.
