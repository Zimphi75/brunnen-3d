# Brunnen 3D

Interaktiver digitaler Zwilling der Gemeinde **Ingenbohl SZ** (BFS-Nr. 1364) mit Brunnen, Ingenbohl, Vierwaldstättersee und angrenzender Landschaft. Die Anwendung läuft komplett im Browser (Three.js) und basiert auf offenen Schweizer Geodaten. Es gibt keine erfundenen Gebäude, Attribute oder Messwerte: Was in den Quellen fehlt, wird als «nicht erfasst» angezeigt.

Architektonisches Vorbild ist [speicher.mlanalytica.com](https://speicher.mlanalytica.com/) (statische Dateien, vorberechnete Binärdaten, Vanilla-JS mit ES-Modulen). Es wurde kein Quellcode oder Asset übernommen.

## Funktionen

- Gelände (swissALTI3D), Luftbild (SWISSIMAGE), 2316 Gebäude (swissBUILDINGS3D 3.0 beta, mit GWR-Attributen), Strassen, Wege, Bahn, Gewässer, Bäume, Gemeindegrenze, Points of Interest, Ortsnamen
- Navigation (Drehen, Zoomen, Verschieben), Voreinstellungen, Vogelperspektive, Schrägansicht, Kamera zurücksetzen
- Gebäude anklicken: Informationspanel mit Adresse, Gebäudeklasse, Baujahr/Bauperiode, Höhe, Grundfläche, Heizung usw.
- Einfärben nach Baujahr, Höhe und Gebäudetyp
- Sonnenstand, Uhrzeit und Datum, Tagesverlauf, Schattenwurf, Tag-Nacht-Modus
- Aktuelles Wetter (Open-Meteo) mit Bewölkung, Nebel, Regen und Schnee
- ÖV: Haltestellen, Linien, nächste Abfahrten (Fahrplan oder Echtzeitprognose), optionale Fahrplansimulation (klar als Simulation gekennzeichnet)
- Zeitachse: Gebäude nach Baujahr filtern, Wachstum abspielen, historische Landeskarten (swisstopo Zeitreise), Vergleich mit heute per Trennlinie
- Suche nach Adressen, Strassen, Gebäuden (EGID), POI, Orten und Koordinaten (LV95 oder WGS84)
- Werkzeuge: Strecke messen (mit Höhenprofil), Punkt abfragen (Koordinaten, Höhe)
- Hell- und Dunkelmodus, Ebenen einzeln schaltbar, Ambient Occlusion, Schatten

## Voraussetzungen

- Python 3.12 (empfohlen) und [uv](https://docs.astral.sh/uv/) für die Datenpipeline
- Ein aktueller Browser mit WebGL 2 und Hardwarebeschleunigung
- Internetzugang für die Datenbeschaffung (einmalig) sowie zur Laufzeit für Wetter, Abfahrten und historische Karten
- Rund 250 MB freier Speicher für den Download-Zwischenspeicher (`pipeline/cache/`, aktuell 180 MB)

Node.js ist nicht nötig. Die Datenbank ist nicht nötig.

## Installation

```bash
cd brunnen-3d
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r pipeline/requirements.txt
.venv/bin/python scripts/vendor_three.py        # three.js lokal nach public/vendor/ laden
```

## Datenpipeline

```bash
.venv/bin/python -m pipeline.run_all             # alle Schritte
.venv/bin/python -m pipeline.run_all osm export  # einzelne Schritte
```

Die Schritte `terrain`, `buildings`, `osm`, `trees` und `export` können mehrfach ausgeführt werden. Downloads werden in `pipeline/cache/` zwischengespeichert und nicht erneut geladen. Beschreibung, Binärformate und Konfiguration: [docs/data-pipeline.md](docs/data-pipeline.md).

Dauer: wenige Minuten bei leerem Zwischenspeicher (der Gebäudeschritt dauert rund 30 s; Overpass kann einzelne Anfragen verzögern).

## Webserver starten

```bash
python serve.py          # http://127.0.0.1:8080/
python serve.py 9000     # anderer Port
```

Jeder statische Webserver genügt (siehe [docs/deployment.md](docs/deployment.md)).

## Tests

```bash
.venv/bin/python -m pytest -q          # Pipeline-Funktionen und Datendateien
# Browser-Tests: python serve.py, dann http://127.0.0.1:8080/tests/unit.html
```

## Projektstruktur

```
index.html, css/main.css, serve.py
js/            Frontend-Module (siehe docs/architecture.md)
pipeline/      Python-Datenpipeline
public/data/   erzeugte Daten (nicht versioniert)
public/vendor/ three.js (nicht versioniert, per Skript geladen)
scripts/       vendor_three.py
tests/         pytest und Browser-Tests
docs/          Architektur, Datenquellen, Pipeline, Deployment
```

## Datenquellen und Lizenzen

Alle Datensätze mit Herkunft, Lizenz, Stand und Abdeckung stehen in [docs/data-sources.md](docs/data-sources.md) und maschinenlesbar in `public/data/sources.json`. Kurz:

| Bereich | Quelle | Lizenz |
|---|---|---|
| Gelände, Luftbild, 3D-Gebäude, Grenze, historische Karten | swisstopo | Open Government Data, Quellenangabe |
| Gebäudeattribute, Adressen | BFS, GWR | Open Government Data, Quellenangabe |
| Strassen, Gewässer, POI, Linien, Ortsnamen | OpenStreetMap-Mitwirkende | ODbL 1.0 |
| Bäume | WSL/BAFU Vegetationshöhenmodell NFI | ODbL mit DbCL |
| Wetter | Open-Meteo | CC BY 4.0 (nicht kommerziell) |
| Abfahrten | transport.opendata.ch / opentransportdata.swiss | Open Data, Quellenangabe |

Bei einer Veröffentlichung müssen die Quellenangaben sichtbar bleiben (Inspector und diese Dokumentation). Für die kommerzielle Nutzung von Open-Meteo ist ein API-Schlüssel nötig.

## Bekannte Einschränkungen

- **Baujahr**: Nur 660 von 2316 Gebäuden haben ein exaktes Baujahr im GWR. Weitere rund 1400 haben nur eine Bauperiode (in der Zeitachse als Periodenmitte). Gebäude ohne GWR-Angabe sind nicht datierbar. Das Feld `ERSTELLUNG_JAHR` von swissBUILDINGS3D ist die Erfassung der Daten, nicht das Baujahr.
- **swissBUILDINGS3D 3.0** ist ein Beta-Produkt; Dachformen sind teils vereinfacht, Dachüberstände und Details können fehlen.
- **Historische Gebäude werden nicht rekonstruiert.** Die Zeitachse blendet vorhandene Gebäude nach GWR-Baujahr aus und zeigt historische Landeskarten. Abgebrochene Gebäude fehlen naturgemäss.
- **Luftbild** hat 2 m Auflösung (Download-Umfang); aus der Nähe wirkt die Textur unscharf.
- **Bäume** sind aus dem Vegetationshöhenmodell abgeleitete Kronenmaxima mit geschätztem Kronenradius, keine Einzelbaumkataster. Alle Bäume haben dieselbe stilisierte Form.
- **ÖV**: Gemessene Fahrzeugpositionen sind über die offene API nicht verfügbar. Die Fahrplansimulation interpoliert Fahrplanzeiten entlang der OSM-Liniengeometrie, ohne Verspätungen, und wird nur für Abschnitte mit passender Geometrie gezeichnet.
- **Statistiken**: `statistics.json` enthält GWR-Aggregate. Einwohnerzahlen (STATPOP) und Unternehmen (STATENT) sind nicht integriert.
- **Grundstücke und ÖREB** (Geoportal Kanton Schwyz) sind noch nicht eingebunden; es wurde kein stabiler offener Massendownload geprüft.
- **Ortsnamen** stammen aus OpenStreetMap. swissNAMES3D ist nicht integriert.
- Die Pipeline ist auf Ingenbohl konfiguriert (`pipeline/config.py`); der GWR-Auszug ist auf den Kanton SZ festgelegt.

## Nächste Schritte

Siehe Abschnitt «Offene Punkte und technische Schulden» in [docs/architecture.md](docs/architecture.md): Isochronen, Fussgänger-Erreichbarkeit, Solarpotenzial (sonnendach.ch), STATPOP-Hektarraster, swissNAMES3D, Grundstücke/ÖREB, höher aufgelöste Orthofotos im Zentrum, Chunking der Gebäude.
