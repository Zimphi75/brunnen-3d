# Brunnen 3D

Interaktiver digitaler Zwilling der Gemeinde **Ingenbohl SZ** (BFS-Nr. 1364) mit Brunnen, Ingenbohl, Vierwaldstättersee und angrenzender Landschaft. Die Anwendung läuft komplett im Browser (Three.js) und basiert auf offenen Schweizer Geodaten. Es gibt keine erfundenen Gebäude, Attribute oder Messwerte: Was in den Quellen fehlt, wird als «nicht erfasst» angezeigt.

## Funktionen

- Gelände (swissALTI3D) mit **simuliertem Boden** (Vorgabe: Wiese, Waldboden, Fels und befestigte Flächen aus der Luftbildfarbe klassiert, mit prozeduralem Detail); wählbar im Panel «Darstellung»: Luftbild (SWISSIMAGE) oder Landeskarte (swisstopo), beide in Blicknähe scharf nachgeladen, 2316 Gebäude (swissBUILDINGS3D 3.0 beta, mit GWR-Attributen), Strassen, Wege, Bahn, Gewässer, 54'000 **Bäume** (Laub- und Nadelbäume mit unregelmässigen Kronen, Kronenfarbe aus dem Luftbild, leichter Windbewegung, zwei Detailstufen, Schattenwurf in der Nähe), Gemeindegrenze, Points of Interest, Ortsnamen
- **Gebäudedarstellung** (Auswahl im Panel «Darstellung»): **Dorfbild (realistisch)** mit Putz- oder Holzfassade, Fensterläden, Fenstern und Ziegeldach in der Farbe des Luftbilds; ausserdem Neutral, Nutzung, Baujahr, Höhe, Geschosse, Wohnungen, Heizenergie und Status im Register
- **Nacht**: beleuchtete Fenster, Strassenlaternen mit Lichtkegeln, Sterne, Leuchteffekt; die Szene bleibt im Dunkeln lesbar
- **Wetter überall sichtbar**: Regen, Schnee, Nebel, Bewölkung und Gewitter wirken am Bildschirm und in der Szene, unabhängig vom Kameraabstand; Live-Wetter (Open-Meteo) für «jetzt», Vorschau-Vorgaben für jede andere Zeit
- **Photovoltaik auf den Dächern**: Die 248 im BFE-Anlagenregister erfassten Anlagen in Ingenbohl (rund 8 MW) erscheinen als Modulfelder auf den Dachflächen der zugeordneten Gebäude: Glas mit Zellraster, Alurahmen, Spiegelung des Himmels, Schattenwurf; ältere Anlagen bläulich, neuere schwarz, dachintegrierte ohne Rahmen, Flachdächer aufgeständert. Anzahl und Lage der Module sind **simuliert** (aus Leistung, Baujahr, Ausrichtung und Neigung des Registers); Standort, Leistung, Jahr und Bauart sind gemessen. Das Informationspanel eines Gebäudes zeigt die Registerdaten und wie viele Module gezeichnet sind.
- **Strassen und Gleise**: Zweispurige Strassen (Klassen Haupt-, Neben- und Quartierstrasse) tragen eine gestrichelte Mittellinie, Haupt- und Nebenstrassen zusätzlich Randlinien; die Linien enden vor Einmündungen. Autobahnfahrbahnen haben Richtung und Spurzahl aus OSM (in der Regel zwei Spuren je Richtung), mit gestrichelter Spurtrennlinie und Randlinien; Auffahrten sind einspurig und schmaler. Gleise haben Schotterbett mit Schwellen und zwei Schienen im Normalspurabstand.
- **Simulierter Alltag** (nur bei Boden «Simulation», Ebene «Verkehr und Personen»): Autos (Limousine, Kompaktwagen, SUV, Lieferwagen; gewölbte Karosserie, Scheiben, Felgen, Kennzeichen, Klarlack mit Himmelsspiegelung) fahren im Rechtsverkehr auf den Strassen und auf beiden Autobahnspuren (links schneller), halten Abstand, biegen ab und umfahren Kreisel gegen den Uhrzeigersinn; Scheinwerfer und Rücklichter leuchten nachts. Personen (Beine und Arme schwingen, Kleidung, Haut und Haar variieren) gehen auf Wegen und auf Trottoirs im Siedlungsgebiet; etwa jede siebte führt einen Hund an der Leine. Aus der Ferne sind Autos und Personen leicht vergrössert, damit man sie erkennt. Es werden nur Agenten in Blicknähe gerechnet.
- **Haltestellen und Fahrzeuge**: Bushaltestellen mit Mast, Wartehäuschen und Bank, Bahnsteige, Schiffsteg; Postauto, SBB-Zug und Kursschiff als schlanke Modelle in der Fahrplansimulation (als Simulation gekennzeichnet)
- Navigation: **linke Maustaste verschiebt die Karte**, rechte Taste oder Umschalt+Ziehen dreht, Mausrad zoomt; Pfeiltasten verschieben, `Q`/`E` drehen, `T` Vogelperspektive, `H` Ausgangsansicht, `/` Suche
- Gebäude anklicken: Informationspanel mit Adresse, Gebäudeklasse, Baujahr/Bauperiode, Höhe, Grundfläche, Heizung usw.
- Sonnenstand, Uhrzeit und Datum, Tagesverlauf, Schattenwurf (Panel oben in der Mitte)
- ÖV: Haltestellen, Linien, nächste Abfahrten (Fahrplan oder Echtzeitprognose)
- Zeitachse: Gebäude nach Baujahr filtern, Wachstum abspielen, historische Landeskarten (swisstopo Zeitreise), Vergleich mit heute per Trennlinie
- Suche nach Adressen, Strassen, Gebäuden (EGID), POI, Orten und Koordinaten (LV95 oder WGS84)
- Werkzeuge: Strecke messen (mit Höhenprofil), Punkt abfragen
- **Register ohne 3D-Modell**: 337 bestehende GWR-Gebäude, die swissBUILDINGS3D nicht enthält (meist Kleinbauten), lassen sich schematisch zuschalten und anklicken
- **Almanach** (unten rechts): Übersicht, Gebäude, Energie, eidgenössische Abstimmungen der Gemeinde, Datenqualität mit Abdeckungskennzahlen, Quellen
- Hell- und Dunkelmodus, Ebenen einzeln schaltbar, Ambient Occlusion, Schatten; Qualität sinkt automatisch auf Touch-Geräten und schwachen CPUs (kein AO, kleinere Schattenkarte)

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

Die Schritte `terrain`, `buildings`, `osm`, `trees`, `pv`, `votes` und `export` können mehrfach ausgeführt werden. Downloads werden in `pipeline/cache/` zwischengespeichert und nicht erneut geladen. Beschreibung, Binärformate und Konfiguration: [docs/data-pipeline.md](docs/data-pipeline.md).

Dauer: wenige Minuten bei leerem Zwischenspeicher (der Gebäudeschritt dauert rund 30 s; Overpass kann einzelne Anfragen verzögern). `public/data/manifest.json` hält Hashwerte der Eingabedateien fest und macht Läufe vergleichbar.

## Webserver starten

```bash
python serve.py          # http://127.0.0.1:8080/
python serve.py 9000     # anderer Port
```

Jeder statische Webserver genügt (siehe [docs/deployment.md](docs/deployment.md)).

## Tests

```bash
.venv/bin/python -m pytest -q          # Pipeline-Funktionen und Datendateien
# Browser-Tests (33): python serve.py, dann http://127.0.0.1:8080/tests/unit.html
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
| Bäume (Standort, Höhe, Kronenradius) | WSL/BAFU Vegetationshöhenmodell NFI | ODbL mit DbCL |
| Landeskarte (optionale Bodenansicht) | swisstopo Pixelkarte farbig, WMS | Open Government Data swisstopo, Quellenangabe |
| Wetter | Open-Meteo | CC BY 4.0 (nicht kommerziell) |
| Abfahrten | transport.opendata.ch / opentransportdata.swiss | Open Data, Quellenangabe |
| Photovoltaikanlagen | BFE, Elektrizitätsproduktionsanlagen | Open Government Data, Quellenangabe |
| Abstimmungsresultate | BFS voteinfo | Open Government Data, Quellenangabe |
| Dachfarben | SWISSIMAGE-Luftbild (Median je Dach, abgeleitet) | Open Government Data swisstopo |

Bei einer Veröffentlichung müssen die Quellenangaben sichtbar bleiben (Inspector und diese Dokumentation). Für die kommerzielle Nutzung von Open-Meteo ist ein API-Schlüssel nötig.

## Datenqualität in Zahlen

| Kennzahl | Wert |
|---|---|
| Gebäude im 3D-Modell | 2316 (2010 in der Gemeinde, Rest Pufferzone) |
| GWR-Verknüpfung | 2275, davon 2238 über EGID und 37 über die Lage |
| Abdeckung bestehender GWR-Gebäude durch das 3D-Modell | Wohngebäude 98.5 %, ab 40 m² Grundfläche 96.8 %, alle 85.3 % |
| Registergebäude ohne 3D-Modell | 387 (Median 14 m² Grundfläche), 337 davon im Register-Layer |
| Als abgebrochen registriert, aber im 3D-Modell | 30, standardmässig ausgeblendet |
| Exaktes Baujahr | 684 Gebäude (weitere rund 1400 mit Bauperiode) |
| Dachfarbe aus Luftbild | 2315 von 2316 |
| Baumpositionen gegen OSM-Einzelbäume geprüft | 65 % mit Modellbaum innerhalb 4 m |
| Strassenlaternen | 27 aus OSM, 215 entlang von Strassen mit `lit=yes` modelliert (gekennzeichnet) |
| Photovoltaik | 281 Registeranlagen den 3D-Gebäuden zugeordnet (264 über EGID, 17 über die Lage), davon 248 in der Gemeinde; 4 Anlagen (271 kW) in der Gemeinde ohne passendes Gebäude |
| Photovoltaik: Modulbelegung | 176 von 273 Gebäuden mit voller Belegung, auf den übrigen reicht die Dachfläche nicht (insgesamt rund 77 % der aus der Leistung berechneten Module) |

Die Zahlen stehen auch im Almanach («Datenqualität») und stammen aus `public/data/metadata.json`.

## Bekannte Einschränkungen

- **Fassaden, Fensterläden, Fenster und Dachziegel sind gestalterisch.** Kein offener Datensatz enthält Fassadenfarben. Die Fassade wird stabil aus der Gebäude-ID und der GWR-Nutzung abgeleitet; Dachfarbe und Geometrie sind gemessen. Das Panel «Darstellung» weist in der Legende darauf hin. Wer Daten braucht statt Optik, wählt einen der Datenmodi.
- **Abdeckung**: swissBUILDINGS3D enthält kaum Kleinbauten. 15 % der bestehenden Registergebäude haben kein 3D-Modell (siehe Tabelle). Sie sind nicht erfunden, sondern als schematische Quader zuschaltbar.
- **Baujahr**: Nur 684 von 2316 Gebäuden haben ein exaktes Baujahr im GWR. Das Feld `ERSTELLUNG_JAHR` von swissBUILDINGS3D ist die Erfassung der Daten, nicht das Baujahr.
- **swissBUILDINGS3D 3.0** ist ein Beta-Produkt; Dachformen sind teils vereinfacht.
- **Gebäude an Hängen** haben keinen Sockel; der Fuss kann schweben (der Shader dunkelt nur den Fussbereich ab).
- **Historische Gebäude werden nicht rekonstruiert.** Die Zeitachse blendet vorhandene Gebäude nach GWR-Baujahr aus und zeigt historische Landeskarten.
- **Luftbild**: 2 m Auflösung global, in Blicknähe wird SWISSIMAGE per WMS scharf nachgeladen (braucht Internet).
- **Bäume**: Standort, Höhe und Kronenradius sind aus dem Vegetationshöhenmodell abgeleitet. **Die Art ist geschätzt** (die dunkelsten 40 % der Kronen im Luftbild, ab 5 m Höhe, werden als Nadelbaum gezeichnet), Farbe und Kronenform sind gestalterisch. Es gibt weder Arten- noch Einzelbaumkataster. Bäume auf Strassen, Wegen, Gleisen, in Bächen und im Wasser werden ausgeblendet (3000 von 54'327; massgebend sind die gezeichneten Breiten aus OSM); Bäume in Gebäuden werden nicht geprüft.
- **Simulierter Boden**: Klassierung (Wiese, Wald, Fels, befestigt) und Detail sind Annahmen, keine Messung. Schatten im Luftbild werden abgeschwächt, befestigte Flächen einheitlich grau gezeichnet; Halme und Muster sind Zufall. Wer Daten braucht, wählt «Luftbild» oder «Landeskarte».
- **ÖV**: Gemessene Fahrzeugpositionen sind über die offene API nicht verfügbar. Die Fahrplansimulation interpoliert Fahrplanzeiten entlang der OSM-Liniengeometrie.
- **Abstimmungen**: Einzelne Abstimmungstage fehlen, wenn die Quelle sie nicht liefert (derzeit 2025-05-18 und 2023-03-12). Die Quelle sendet keine CORS-Header; darum zieht die Pipeline die Daten (`votes.json`).
- **Photovoltaik**: Das Register kennt weder Modulzahl noch Modullage. Die gezeichnete Belegung ist eine Annahme (Modulgrösse 1.75 × 1.05 m, Wirkungsgrad nach Baujahr, bevorzugt Süd-, sonst Ost-/Westflächen, Randabstand 0.3 m). Freistehende Anlagen (2) und Fassadenanteile (Neigung ab 60°) werden nicht auf dem Dach gezeichnet. Dachflächen stammen aus swissBUILDINGS3D (Beta). Auf Gebäuden mit grosser Anlage reicht die Dachfläche oft nicht; dann ist die Anlage nur teilweise gezeichnet und das steht im Informationspanel.
- **Strassenmarkierung und Verkehr sind symbolisch.** OSM enthält hier keine Spurzahl und keine Einbahnrichtung: zweispurig wird aus der Strassenklasse angenommen, Einbahn nur bei Kreiseln. Es gibt weder Verkehrszählungen noch Personenzahlen; Dichte und Wege sind Annahmen (Strassenklasse, Bebauung in der Nähe). Trottoirs sind aus der Strassenbreite abgeleitet, nicht aus OSM-Daten. Auf Autobahnen sind Richtung und Spurzahl aus OSM übernommen; Spurwechsel und Überholen gibt es nicht. Tunnelstrecken (Axenstrasse) sind ausgenommen.
- **Nicht umgesetzt**: Solarpotenzial der Dächer (BFE sonnendach.ch), Isochronen, Objektprofil, Fahrmodus, STATPOP, Grundstücke und ÖREB, swissNAMES3D.
- **Nicht getestet**: iPhone/Safari und schwache GPUs. Die Leistungswerte stammen von einem Apple-Silicon-Rechner (Chrome), siehe [docs/architecture.md](docs/architecture.md).
- Die Pipeline ist auf Ingenbohl konfiguriert (`pipeline/config.py`); der GWR-Auszug ist auf den Kanton SZ festgelegt.

## Nächste Schritte

Siehe Abschnitt «Offene Punkte und technische Schulden» in [docs/architecture.md](docs/architecture.md): Solarpotenzial der Dächer (sonnendach.ch), Isochronen und Fussgänger-Erreichbarkeit, Objektprofil, Fahrmodus, STATPOP-Hektarraster, swissNAMES3D, Grundstücke/ÖREB, Gebäudesockel, Test auf iPhone/Safari, Chunking der Gebäude.
