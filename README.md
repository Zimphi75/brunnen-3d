# Brunnen 3D

Interaktiver digitaler Zwilling der Gemeinde **Ingenbohl SZ** (BFS-Nr. 1364) mit Brunnen, Ingenbohl, Vierwaldstättersee und angrenzender Landschaft. Die Anwendung läuft komplett im Browser (Three.js) und basiert auf offenen Schweizer Geodaten. Es gibt keine erfundenen Gebäude, Attribute oder Messwerte: Was in den Quellen fehlt, wird als «nicht erfasst» angezeigt.

**Website:** [brunnen.multikanal.ch](https://brunnen.multikanal.ch/) (GitHub Pages: [zimphi75.github.io/brunnen-3d](https://zimphi75.github.io/brunnen-3d/)). Private, nichtkommerzielle Visualisierung ohne offizielle Verbindung zur Gemeinde oder zu den Datenanbietern.

## Funktionen

- Gelände (swissALTI3D) mit **simuliertem Boden** (Vorgabe: Wiese, Waldboden, Fels und befestigte Flächen aus der Luftbildfarbe klassiert, mit prozeduralem Detail); Kartentypen Simulation, Luftbild (SWISSIMAGE) und Topo (swisstopo Pixelkarte) sind über Bildkacheln unten links wählbar, beide Kartenquellen werden in Blicknähe schärfer nachgeladen; 2316 Gebäude (swissBUILDINGS3D 3.0 beta, mit GWR-Attributen), Strassen, Wege, Bahn, Gewässer, 54'000 **Bäume** (Laub- und Nadelbäume mit unregelmässigen Kronen, Kronenfarbe aus dem Luftbild, leichter Windbewegung, zwei Detailstufen, Schattenwurf in der Nähe), Gemeindegrenze, Points of Interest, Ortsnamen
- **Gebäudedarstellung** unter «Gebäude» und «Kartendetails»: **Dorfbild (realistisch)** mit Putz- oder Holzfassade, Fensterläden, Fenstern und Ziegeldach in der Farbe des Luftbilds; ausserdem Neutral, Nutzung, Baujahr, Höhe, Geschosse, Wohnungen, Heizenergie und Status im Register
- **Nacht**: beleuchtete Fenster, Strassenlaternen mit Lichtkegeln, Sterne, Leuchteffekt; die Szene bleibt im Dunkeln lesbar
- **Wetter überall sichtbar**: Regen, Schnee, Nebel, Bewölkung und Gewitter wirken am Bildschirm und in der Szene, unabhängig vom Kameraabstand; Live-Wetter (Open-Meteo) für «jetzt», Vorschau-Vorgaben für jede andere Zeit
- **Photovoltaik auf den Dächern**: Die 248 im BFE-Anlagenregister erfassten Anlagen in Ingenbohl (rund 8 MW) erscheinen als Modulfelder auf den Dachflächen der zugeordneten Gebäude: Glas mit Zellraster, Alurahmen, Spiegelung des Himmels, Schattenwurf; ältere Anlagen bläulich, neuere schwarz, dachintegrierte ohne Rahmen, Flachdächer aufgeständert. Anzahl und Lage der Module sind **simuliert** (aus Leistung, Baujahr, Ausrichtung und Neigung des Registers); Standort, Leistung, Jahr und Bauart sind gemessen. Das Informationspanel eines Gebäudes zeigt die Registerdaten und wie viele Module gezeichnet sind.
- **Strassen und Gleise**: Zweispurige Strassen (Klassen Haupt-, Neben- und Quartierstrasse) tragen eine gestrichelte Mittellinie, Haupt- und Nebenstrassen zusätzlich Randlinien; die Linien enden vor Einmündungen. Autobahnfahrbahnen haben Richtung und Spurzahl aus OSM (in der Regel zwei Spuren je Richtung), mit gestrichelter Spurtrennlinie und Randlinien; Auffahrten sind einspurig und schmaler. Gleise haben Schotterbett mit Schwellen und zwei Schienen im Normalspurabstand.
- **Simulierter Alltag** (nur bei Boden «Simulation», Ebene «Verkehr und Personen»): Autos (Limousine, Kompaktwagen, SUV, Lieferwagen; gewölbte Karosserie, Scheiben, Felgen, Kennzeichen, Klarlack mit Himmelsspiegelung) fahren im Rechtsverkehr auf den Strassen und auf beiden Autobahnspuren (links schneller), halten Abstand, biegen ab und umfahren Kreisel gegen den Uhrzeigersinn; Scheinwerfer und Rücklichter leuchten nachts. Personen (Beine und Arme schwingen, Kleidung, Haut und Haar variieren) gehen auf Wegen und auf Trottoirs im Siedlungsgebiet; etwa jede siebte führt einen Hund an der Leine. Aus der Ferne sind Autos und Personen leicht vergrössert, damit man sie erkennt. Es werden nur Agenten in Blicknähe gerechnet.
- **Haltestellen und Fahrzeuge**: Bushaltestellen mit Mast, Wartehäuschen und Bank, Bahnsteige, Schiffsteg; Postauto, SBB-Zug und Kursschiff als schlanke Modelle in der Fahrplansimulation (als Simulation gekennzeichnet)
- Navigation: **linke Maustaste verschiebt die Karte**, rechte Taste oder Umschalt+Ziehen dreht, Mausrad zoomt; Pfeiltasten verschieben, `Q`/`E` drehen, `T` Vogelperspektive, `H` Ausgangsansicht, `/` Suche, `V` Velomodus. Die Kamera bleibt immer mindestens 3 m über dem Gelände (kein Zoomen unter den Boden)
- **Velomodus** (Taste `V` oder Velo-Knopf in der Werkzeugleiste): Ein Fahrer auf einem olivgrünen Velo mit gelbem Anhänger und einem Australian Shepherd darin startet auf der Strasse, die der Kartenmitte am nächsten liegt. Die Kamera zeigt ihn zuerst schräg von vorne und kreist dann hinter ihn; erst danach ist er steuerbar. Am Computer Pfeiltasten oder WASD, Leertaste klingelt; am Smartphone ein Kompass-Joystick am unteren Rand mit kurzer Anleitung. Freies Fahren auf Strassen (max. 40 km/h) und im Gelände (max. 25 km/h), Steigungen bremsen bzw. beschleunigen. Das Velo hält vor Gebäuden, Bäumen, See, Autos, Personen, dem Modellrand und sehr steilem Gelände; Autos und Personen warten vor ihm. Während der Fahrt sind alle anderen Bedienelemente ausgeblendet, die Darstellung steht auf «Hell & klar»; die Anzeige nennt Strasse bzw. Wegtyp und Tempo. «Absteigen und Beenden» (`Esc`) stellt die App wieder her
- **Strassen im Gelände**: Strassen, Gleise und Feldwege liegen auf einer geglätteten Fahrbahnhöhe (2-m-Raster, nach dem Vorbild von speicher.mlanalytica.com); das Gelände wird mit weichen Böschungen angepasst. See, Gebäudeumgebung, Brücken und Tunnel bleiben unverändert, Höhenprofile rechnen mit dem Originalgelände. Vergleich ohne Einebnung: `?grading=0`
- Gebäude anklicken: Informationspanel mit Adresse, Gebäudeklasse, Baujahr/Bauperiode, Höhe, Grundfläche, Heizung usw.
- **Gebäudeprofil nach Nutzerfragen**: Übersicht, Umgebung, Gebäude, Energie, Vergleich und Daten & Quellen. Die erste Ansicht konzentriert sich auf Adresse, Bauzeit, Wohnungen und direkte Aktionen; Registerangaben bleiben in den Details.
- **Umgebung** im Gebäudeprofil: STATPOP/STATENT werden korrekt als Werte einer 100 × 100-m-Zelle gezeigt. Orte in der Nähe weisen geroutete OSM-Wegstrecken und geschätzte Gehzeiten aus; Luftlinien bleiben ausdrücklich gekennzeichnet. Amtliche Lärm- und Umweltmodellwerte stehen mit Auflösung und Datenstand separat.
- **Wohnumfeld-Orientierung**: Bereichsübersicht für Mobilität, Alltag und Freizeit, mit optionalen persönlichen Prioritäten. Der Wert ist unverbindlich, keine amtliche oder professionelle Immobilienbewertung. Fehlende Bereiche werden nicht als negativ gewertet; Quellen, Luftlinien und Berechnung sind aufklappbar.
- **Gemeinsame Kartenanalyse**: Bevölkerung, Arbeit, Fusswege in 5/10/15 Minuten, Wanderwege, Veloland-Routen, Sperrungen, Solar-Dacheignung, Lärm und grobe Hochwasserübersicht teilen Auswahl und Rückkehrlogik. Erreichbare Fusswege werden als Netz dargestellt, nicht als Kreis; POIs lassen sich nach Kategorie filtern und gewählte Ziele als Route hervorheben.
- **Solarpotenzial** aus der BFE-Dacheignungskarte wird getrennt von bestehenden PV-Anlagen angezeigt. Wenn EGID und 3D-Dachfläche zusammenpassen, erscheinen Modellwerte und eine farbige 3D-Dachfläche.
- Während geführter Kartenanalysen wechseln Tageslicht und Wettereffekte auf «Hell & klar». «Zurück zum Gebäude» stellt den vorherigen Modus, Zeit, Wetter, Kamera und Layer wieder her; bewusst geänderte Ebenen bleiben erhalten.
- **Responsive Kopfzeile**: kompakte Adresssuche ohne Titelzeile, gleich hohe Elemente für Suche, Zeit/Wetter und Kameraaktionen; auf schmalen Ansichten untereinander. Navigationssymbole sind gruppiert, die Ortsauswahl nutzt den übrigen Platz. Die Koordinatenanzeige ist auf grossen Ansichten unten zentriert und bis 760 Pixel Breite ausgeblendet.
- Sonnenstand, Uhrzeit und Datum, Tagesverlauf, Schattenwurf (Panel oben in der Mitte)
- ÖV: amtliche BAV-Haltestellen, lokale Fusswegzeit und nächste Abfahrt (Fahrplan oder Echtzeitprognose)
- **Zeitreise**: eigenständiger Jahresregler mit Play/Pause und vier Geschwindigkeiten; exakte Baujahre blenden kurz ein, unsichere Bauperioden füllen sich über den gesamten möglichen Zeitraum mit einem GPU-seitigen Fade. Das Abspieltempo sinkt von 3× auf 0.5× bis 1980 und bleibt danach konstant. Der Boden bleibt neutral, historische Karten werden dabei nicht gezeigt; Zeit und Wetter stehen auf heute, 12:00 und klar
- Karten-Dock mit Schnellzugriffen für Gebäude, Verkehr, Zeitreise und Kartendetails; beim Einstieg springt die Ansicht direkt von oben auf das Gebiet, danach bleibt die Kamera während des Zeitraffers unverändert und kehrt beim Beenden zur vorherigen Ansicht zurück
- Suche nach Adressen, Strassen, Gebäuden (EGID), POI, Orten und Koordinaten (LV95 oder WGS84)
- Werkzeuge: Strecke messen (mit Höhenprofil), Punkt abfragen
- **Register ohne 3D-Modell**: 337 bestehende GWR-Gebäude, die swissBUILDINGS3D nicht enthält (meist Kleinbauten), lassen sich schematisch zuschalten und anklicken
- **Almanach «Ingenbohl in Zahlen»** (unten rechts): direkte Tab-Navigation für Übersicht, Gebäude, Grundstücke, Energie, eidgenössische Abstimmungen der Gemeinde, Datenqualität mit Abdeckungskennzahlen und Quellen. Unten auf der Übersicht steht das Impressum. Das animierte Standort-Symbol neben der Adresse schliesst den Dialog und zoomt zur Liegenschaft. Die E-Mail-Adresse wird erst nach Klick im Browser zusammengesetzt; dies erschwert einfaches automatisches Auslesen, bietet aber keinen vollständigen Schutz vor Bots. Die Standortanimation berücksichtigt die Systemeinstellung für reduzierte Bewegung.
- Hell- und Dunkelmodus, nach Themen gruppierte Ebenen, Ambient Occlusion, Schatten; Qualität sinkt automatisch auf Touch-Geräten und schwachen CPUs (kein AO, kleinere Schattenkarte)

## Voraussetzungen

- Python 3.12 (empfohlen) und [uv](https://docs.astral.sh/uv/) für die Datenpipeline
- Ein aktueller Browser mit WebGL 2 und Hardwarebeschleunigung
- Internetzugang für die Datenbeschaffung (einmalig) sowie zur Laufzeit für Wetter und Abfahrten
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
.venv/bin/python -m pipeline.run_all                   # alle Schritte
.venv/bin/python -m pipeline.run_all parcels export   # einzelne Schritte
```

Die Schritte `terrain`, `buildings`, `osm`, `trees`, `pv`, `votes` und `export` können mehrfach ausgeführt werden. Downloads werden in `pipeline/cache/` zwischengespeichert und nicht erneut geladen. Beschreibung, Binärformate und Konfiguration: [docs/data-pipeline.md](docs/data-pipeline.md).

Dauer: wenige Minuten bei leerem Zwischenspeicher (der Gebäudeschritt dauert rund 30 s; Overpass kann einzelne Anfragen verzögern). `public/data/manifest.json` hält Hashwerte der Eingabedateien fest und macht Läufe vergleichbar.

## Webserver starten

```bash
python serve.py          # http://127.0.0.1:8080/
python serve.py 9000     # anderer Port
```

Jeder statische Webserver genügt (siehe [docs/deployment.md](docs/deployment.md)).

## Veröffentlichung

Pushes auf `main` starten den Workflow **Build and deploy website**: Daten und Three.js erzeugen, Pipeline-Tests ausführen und anschliessend auf [GitHub Pages](https://zimphi75.github.io/brunnen-3d/) veröffentlichen. Das Repository bleibt privat; die Website und ihre ausgelieferten Daten sind öffentlich. Der optionale Hoststar-Upload ist derzeit deaktiviert. Einrichtung und eigene Domain: [docs/deployment.md](docs/deployment.md).

## Tests

```bash
.venv/bin/python -m pytest -q          # Pipeline-Funktionen und Datendateien
# Browser-Tests (58): python serve.py, dann http://127.0.0.1:8080/tests/unit.html
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
| Gelände, Luftbild, 3D-Gebäude, Grenze | swisstopo | Open Government Data, Quellenangabe |
| Gebäudeattribute, Adressen | BFS, GWR | Open Government Data, Quellenangabe |
| Strassen, Gewässer, POI, Linien, Ortsnamen | OpenStreetMap-Mitwirkende | ODbL 1.0 |
| Bäume (Standort, Höhe, Kronenradius) | WSL/BAFU Vegetationshöhenmodell NFI | ODbL mit DbCL |
| Landeskarte (optionale Bodenansicht) | swisstopo Pixelkarte farbig, WMS | Open Government Data swisstopo, Quellenangabe |
| Wetter | Open-Meteo | CC BY 4.0 (nicht kommerziell) |
| Abfahrten | transport.opendata.ch / opentransportdata.swiss | Open Data, Quellenangabe |
| Photovoltaikanlagen | BFE, Elektrizitätsproduktionsanlagen | Open Government Data, Quellenangabe |
| Abstimmungsresultate | BFS voteinfo | Open Government Data, Quellenangabe |
| Wanderwegsperrungen und Umleitungen | ASTRA und Kantone, GeoAdmin WMS | Open Government Data, Quellenangabe |
| Baustellen Kantonsstrassen (A083a) | Tiefbauamt Kanton Schwyz, WFS `ch.sz.a083a.baustellen.erweitert` | Quellenangabe |
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
- **Historische Gebäude werden nicht rekonstruiert.** Die Zeitreise blendet den heutigen registrierten Bestand nach GWR-Baujahr/Bauperiode ein; abgebrochene Altgebäude und undatierte Gebäude sind nicht Teil der Darstellung.
- **Luftbild**: 2 m Auflösung global, in Blicknähe wird SWISSIMAGE per WMS scharf nachgeladen (braucht Internet).
- **Bäume**: Standort, Höhe und Kronenradius sind aus dem Vegetationshöhenmodell abgeleitet. **Die Art ist geschätzt** (die dunkelsten 40 % der Kronen im Luftbild, ab 5 m Höhe, werden als Nadelbaum gezeichnet), Farbe und Kronenform sind gestalterisch. Es gibt weder Arten- noch Einzelbaumkataster. Bäume auf Strassen, Wegen, Gleisen, in Bächen und im Wasser werden ausgeblendet (3000 von 54'327; massgebend sind die gezeichneten Breiten aus OSM); Bäume in Gebäuden werden nicht geprüft.
- **Simulierter Boden**: Klassierung (Wiese, Wald, Fels, befestigt) und Detail sind Annahmen, keine Messung. Schatten im Luftbild werden abgeschwächt, befestigte Flächen einheitlich grau gezeichnet; Halme und Muster sind Zufall. Wer Daten braucht, wählt «Luftbild» oder «Landeskarte».
- **Zeitreise**: Gezeigt wird der heute registrierte Gebäudebestand nach Baujahr/Bauperiode, keine Rekonstruktion früherer Gebäude. Abgebrochene und umgebaute Altgebäude sind nicht enthalten; undatierte Gebäude bleiben ausgeblendet. Der Boden ist neutral, die Kamera bleibt unbewegt.
- **ÖV**: Gemessene Fahrzeugpositionen sind über die offene API nicht verfügbar. Die Fahrplansimulation interpoliert Fahrplanzeiten entlang der OSM-Liniengeometrie.
- **Fussrouting**: Wegstrecken folgen dem vorbereiteten OSM-Wegenetz innerhalb des 300-m-Gemeindepuffers. Gehzeiten verwenden eine mittlere Geschwindigkeit von 75 m/min (Treppen mit Zuschlag); Steigung, individuelle Gehgeschwindigkeit und aktuelle Wegsperrungen sind nicht vollständig modelliert. Es ist keine Navigationsgarantie.
- **Offizielle Wegkarten**: Wanderwege und Veloland kommen aus GeoAdmin. Im Modus «Sperrungen und Baustellen» kommen gemeldete Wegsperrungen aus GeoAdmin und Baustellen auf Kantonsstrassen (länger als 5 Tage, täglich aktualisiert) per WFS vom Kanton Schwyz; Gemeindestrassen sind nicht enthalten. Fehlende Meldungen sind keine Bestätigung, dass Wege oder Strassen frei sind; Umleitungen werden nicht automatisch geplant.
- **Solarpotenzial**: BFE-Dacheignungsdaten (Layerstand 2023-02-21) liefern Modellfläche und modellierten Jahresertrag, keine Messung oder Garantie für eine konkrete Anlage. Dachflächen werden nur bei EGID- und Geometriezuordnung in 3D eingefärbt. Bestehende Anlagen stammen weiterhin separat aus dem BFE-Anlagenregister.
- **Hochwasser und Lärm**: Aquaprotect ist eine grobe Übersicht von 2008, keine aktuelle Warnung und nicht parzellenscharf. Lärmwerte sind BAFU-Modellraster mit Referenzjahr 2021, keine Gebäudemessungen.
- **Abstimmungen**: Einzelne Abstimmungstage fehlen, wenn die Quelle sie nicht liefert (derzeit 2025-05-18 und 2023-03-12). Die Quelle sendet keine CORS-Header; darum zieht die Pipeline die Daten (`votes.json`).
- **Photovoltaik**: Das Register kennt weder Modulzahl noch Modullage. Die gezeichnete Belegung ist eine Annahme (Modulgrösse 1.75 × 1.05 m, Wirkungsgrad nach Baujahr, bevorzugt Süd-, sonst Ost-/Westflächen, Randabstand 0.3 m). Freistehende Anlagen (2) und Fassadenanteile (Neigung ab 60°) werden nicht auf dem Dach gezeichnet. Dachflächen stammen aus swissBUILDINGS3D (Beta). Auf Gebäuden mit grosser Anlage reicht die Dachfläche oft nicht; dann ist die Anlage nur teilweise gezeichnet und das steht im Informationspanel.
- **Strassenmarkierung und Verkehr sind symbolisch.** OSM enthält hier keine Spurzahl und keine Einbahnrichtung: zweispurig wird aus der Strassenklasse angenommen, Einbahn nur bei Kreiseln. Es gibt weder Verkehrszählungen noch Personenzahlen; Dichte und Wege sind Annahmen (Strassenklasse, Bebauung in der Nähe). Trottoirs sind aus der Strassenbreite abgeleitet, nicht aus OSM-Daten. Auf Autobahnen sind Richtung und Spurzahl aus OSM übernommen; Spurwechsel und Überholen gibt es nicht. Tunnelstrecken (Axenstrasse) sind ausgenommen.
- **Noch nicht umgesetzt**: persönliche Gehprofile, Steigungsmodellierung, vollständige Isochronen, automatische Umleitungen und Höhenprofile für Velorouten. STATPOP/STATENT bleiben 100-m-Zellwerte, keine Gebäudewerte; ein relativer Gemeinderang wird mangels vollständigem vergleichbarem Datensatz nicht berechnet.
- **Velomodus**: Arcade-Steuerung, keine Physiksimulation. Geprüft wird ein Punkt vor dem Vorderrad bzw. hinter dem Anhänger; in engen Kurven kann der Anhänger seitlich leicht in eine Wand schneiden. Zäune, Mauern, Hecken und Treppenstufen fehlen in den Daten und sind keine Hindernisse. Gebäude ohne Sockel und das 5-m-Gelände wirken auf Augenhöhe modellhaft. Smartphone-Steuerung und Bildrate am Boden sind auf echten Geräten noch nicht getestet.
- **Nicht getestet**: iPhone/Safari und schwache GPUs. Die Leistungswerte stammen von einem Apple-Silicon-Rechner (Chrome), siehe [docs/architecture.md](docs/architecture.md).
- Die Pipeline ist auf Ingenbohl konfiguriert (`pipeline/config.py`); der GWR-Auszug ist auf den Kanton SZ festgelegt.

## Nächste Schritte

Siehe Abschnitt «Offene Punkte und technische Schulden» in [docs/architecture.md](docs/architecture.md): persönliche Gehprofile, Routing ausserhalb des 300-m-Puffers, Umleitungen, swissNAMES3D, Gebäudesockel, Test auf iPhone/Safari und Chunking der Gebäude.
