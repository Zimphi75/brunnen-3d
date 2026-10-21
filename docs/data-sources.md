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
| Photovoltaikanlagen | BFE, Elektrizitätsproduktionsanlagen | STAC `ch.bfe.elektrizitaetsproduktionsanlagen`, Download `…_2056.csv.zip` | CSV, 19 MB (ganze Schweiz) | täglich | OGD BFE, Quellenangabe |
| Abstimmungen (Gemeinderesultate) | BFS voteinfo | `ogd-static.voteinfo-app.ch/v1/ogd/` (Pipeline, keine CORS-Header) | JSON, 6 MB je Tag, kompakt in `votes.json` | je Abstimmungstag | OGD BFS, Quellenangabe |
| Dachfarben | swisstopo SWISSIMAGE (Luftbild) | WMS `ch.swisstopo.swissimage`, 1-km-Kacheln, nur Pipeline | JPEG, abgeleiteter Median je Dach | aktuell zum Abruf | OGD swisstopo, Quellenangabe |
| Scharfes Luftbild in Blicknähe | swisstopo SWISSIMAGE | WMS (zur Laufzeit) | Bild | aktuell | OGD swisstopo, Quellenangabe |
| Wetter | Open-Meteo | `api.open-meteo.com` (zur Laufzeit) | JSON | aktuell | CC BY 4.0, nicht kommerziell |
| Abfahrten | opentransportdata.swiss via transport.opendata.ch | `transport.opendata.ch/v1` (zur Laufzeit, CORS offen) | JSON | Fahrplan und Echtzeitprognose | Open Data, Quellenangabe |
| Zeitreise (historische Karten) | swisstopo | WMS `ch.swisstopo.zeitreihen`, `TIME=JJJJ1231` | Bild, CORS offen | Kartenstände 1864 bis 2021 | OGD swisstopo, Quellenangabe |

## Nicht verwendet oder nicht verfügbar

- **BFS STATPOP/STATENT (Hektarraster)**: offene Daten vorhanden, aber nicht integriert; `statistics.json` enthält nur GWR-Aggregate.
- **swissNAMES3D**: nicht integriert; Ortsnamen stammen aus OpenStreetMap.
- **BFE sonnendach.ch**: nicht integriert (Solarpotenzial als spätere Erweiterung).
- **Grundstücke und ÖREB Kanton Schwyz**: kein geprüfter offener Massendownload; nicht integriert.
- **Gemessene ÖV-Fahrzeugpositionen**: Die offene Fahrplan-API liefert nur Fahrplan und Echtzeitprognosen. Positionen in der Karte sind entweder Haltestellen (Lage aus OSM) oder als «Fahrplansimulation» gekennzeichnet.
- **Fassadenfarben, Fensterläden, Fenster, Dachziegel**: nicht in den offenen Daten enthalten. Das «Dorfbild» zeigt sie gestalterisch (aus Gebäude-ID und GWR-Nutzung abgeleitet); nur die Dachfarbe ist gemessen (Luftbild).
- **Modulzahl und Modullage der Photovoltaik**: nicht im Register (nur Leistung, Standort, Jahr, Bauart, teils Ausrichtung/Neigung). Die 3D-Ansicht simuliert die Belegung der Dachflächen.
- **Solarpotenzial der Dächer (BFE sonnendach.ch)**: nicht integriert.
- **Strassenlaternen**: OSM enthält nur 27 Knoten. Weitere 215 Standorte sind entlang von Strassen mit `lit=yes` modelliert und im Modell als «mod.» gekennzeichnet.
- **Bus- und Bahnausstattung**: Wartehäuschen und Bänke nur, wo OSM sie erfasst hat; sonst nur Mast bzw. Bahnsteig.

## Wichtige Hinweise zu den Attributen

- swissBUILDINGS3D und GWR werden über die **EGID** verknüpft. 2238 von 2316 Gebäuden haben einen GWR-Eintrag über die EGID, 37 weitere werden über die Lage im GWR-Grundriss zugeordnet (insgesamt 2275). Übrige Gebäude bleiben ohne GWR-Attribute. 30 als abgebrochen registrierte Gebäude werden standardmässig ausgeblendet.
- **Baujahr (`GBAUJ`)** ist nur für 684 Gebäude erfasst. Für viele weitere gibt es die **Bauperiode (`GBAUP`)**. Das Feld `ERSTELLUNG_JAHR` aus swissBUILDINGS3D ist die Erfassung der Daten und wird nicht als Baujahr verwendet.
- Die Gebäude ausserhalb der Gemeindegrenze (Pufferzone, 300 m) sind im Inspector markiert.
