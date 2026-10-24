# Datenquellen

Die maschinenlesbare Fassung mit Abrufdatum steht in `public/data/sources.json` (erzeugt von `pipeline/export.py`). Geprüft wurden jeweils Lizenz, Abdeckung, Koordinatensystem, Aktualität, Format und Dateigrösse.

| Datensatz | Anbieter | Zugang | Format, Grösse (Ingenbohl) | Aktualität | Lizenz |
|---|---|---|---|---|---|
| swissBOUNDARIES3D (Gemeindegrenze) | swisstopo | `api3.geo.admin.ch` Identify, Layer `ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill` (liefert alle historischen Stände; es wird der neueste verwendet) | GeoJSON, LV95, 2 MB roh | jährlich (Stand 2026) | OGD swisstopo, Quellenangabe |
| swissALTI3D | swisstopo | STAC `ch.swisstopo.swissalti3d` | COG, 2-m-Raster, 48 Kacheln, ca. 48 MB | 6-Jahres-Zyklus; neueste Kachel je Position | OGD swisstopo, Quellenangabe |
| SWISSIMAGE 10 cm | swisstopo | STAC `ch.swisstopo.swissimage-dop10` (2-m-Variante) | COG, 48 Kacheln, ca. 6 MB | jeweils neueste Kachel | OGD swisstopo, Quellenangabe |
| swissBUILDINGS3D 3.0 Beta | swisstopo | STAC `ch.swisstopo.swissbuildings3d_3_0` (Kacheln je Landeskarte-Blatt; Vollabdeckung mit 14 GB wird übersprungen) | FileGDB (`Building_solid`, `Floor`), 6 Kacheln, 36 MB | je Kachel 2022–2025 | OGD swisstopo, Quellenangabe |
| GWR Kanton SZ | BFS | `https://public.madd.bfs.admin.ch/sz.zip` | CSV (tab-getrennt), 18 MB | täglich (Stand 2026-10-21) | OGD BFS, Quellenangabe (`license.pdf` im Paket) |
| STATPOP (Einwohner) | BFS via GeoAdmin | WMS/GetFeatureInfo `ch.bfs.volkszaehlung-bevoelkerungsstatistik_einwohner` | Rasterzellen 100 × 100 m, EPSG:2056 | 1990, 2000, 2010–2024; zur Laufzeit | OGD BFS, Quellenangabe |
| STATENT (Beschäftigte VZÄ) | BFS via GeoAdmin | WMS/GetFeatureInfo `ch.bfs.betriebszaehlungen-beschaeftigte_vollzeitaequivalente` | Rasterzellen 100 × 100 m, EPSG:2056 | verfügbare Erhebungsjahre 1995–2023; zur Laufzeit | OGD BFS, Quellenangabe |
| Grundstückskataster (AV) | Amt für Geoinformation Kanton Schwyz | WFS 2.0 `https://map.geo.sz.ch/mapserv_proxy`, Feature-Type `ms:ch.sz.a018.amtliche_vermessung.liegenschaften.grundstueck` | GML 3.2, LV95; Grundstücksnummer, Gemeinde, Fläche und Linkfeld | laufend gepflegter WFS; Katalogstand 2026-10-17 | OGD Kanton Schwyz, Quellenangabe (`terms_by`) |
| ÖREB-Fachdaten: kommunale Nutzungsplanung Ingenbohl | Amt für Geoinformation Kanton Schwyz / Gemeinde Ingenbohl | WFS 2.0 `https://map.geo.sz.ch/mapserv_proxy`; Feature-Types `ms:ch.sz.a094b.oereb.raumplanung.nutzungsplanung_kommunal.ingenbohl.grundnutzung` und `…ueberlagernde_festlegung` | GML 3.2, LV95; Polygon, `typ`, `legend_text`, `geolink` | laut Katalog aktualisiert am 2026-10-08; WFS bei Abruf | OGD Kanton Schwyz, Quellenangabe (`terms_by`); Schema enthält keine Rechtsverbindlichkeit oder Gültigkeit |
| OpenStreetMap | Mitwirkende | Overpass-API | JSON, rund 2 MB | Abruf | ODbL 1.0 |
| Vegetationshöhenmodell NFI | WSL/BAFU | STAC `ch.bafu.landesforstinventar-vegetationshoehenmodell`, COG per HTTP-Bereichsabfrage | COG 1 m (nur Ausschnitt gelesen) | Jahr 2025 | ODbL mit DbCL |
| Photovoltaikanlagen | BFE, Elektrizitätsproduktionsanlagen | STAC `ch.bfe.elektrizitaetsproduktionsanlagen`, Download `…_2056.csv.zip` | CSV, 19 MB (ganze Schweiz) | täglich | OGD BFE, Quellenangabe |
| Abstimmungen (Gemeinderesultate) | BFS voteinfo | `ogd-static.voteinfo-app.ch/v1/ogd/` (Pipeline, keine CORS-Header) | JSON, 6 MB je Tag, kompakt in `votes.json` | je Abstimmungstag | OGD BFS, Quellenangabe |
| Dachfarben | swisstopo SWISSIMAGE (Luftbild) | WMS `ch.swisstopo.swissimage`, 1-km-Kacheln, nur Pipeline | JPEG, abgeleiteter Median je Dach | aktuell zum Abruf | OGD swisstopo, Quellenangabe |
| Scharfes Luftbild in Blicknähe | swisstopo SWISSIMAGE | WMS (zur Laufzeit) | Bild | aktuell | OGD swisstopo, Quellenangabe |
| Wetter | Open-Meteo | `api.open-meteo.com` (zur Laufzeit) | JSON | aktuell | CC BY 4.0, nicht kommerziell |
| Luftqualität und Pollen | Copernicus CAMS Europa via Open-Meteo | `air-quality-api.open-meteo.com` (zur Laufzeit, stündlich) | European AQI, PM2.5, PM10, Ozon, UV und saisonale Pollenwerte; Modellraster ca. 11 km | CAMS-Modell, Aktualisierung zweimal täglich | CC BY 4.0, nicht kommerziell; Attribution Open-Meteo und CAMS |
| Abfahrten | opentransportdata.swiss via transport.opendata.ch | `transport.opendata.ch/v1` (zur Laufzeit, CORS offen) | JSON | Fahrplan und Echtzeitprognose | Open Data, Quellenangabe |
| ÖV-Haltestellen | Bundesamt für Verkehr BAV via GeoAdmin | Identify `ch.bav.haltestellen-oev` (zur Laufzeit) | LV95-Punktgeometrie, amtliche Feature-ID, Name, Verkehrsmittel und Betreiberkennung | Layerstand laut GeoAdmin | OGD BAV, Quellenangabe; OSM-Haltestellen als Fallback |
| Wanderwege | swisstopo swissTLM3D | WMS `ch.swisstopo.swisstlm3d-wanderwege` | Transparente Kartenüberlagerung und Identify im Browser, LV95 | Layerstand 2026-07-28 | OGD swisstopo, Quellenangabe |
| Offizielle Velorouten | ASTRA / SchweizMobil | WMS `ch.astra.veloland` | Transparente Kartenüberlagerung und Identify im Browser, LV95 | Layerstand 2026-02-25 | OGD ASTRA, Quellenangabe |
| Wanderwegsperrungen | ASTRA und Kantone | WMS `ch.astra.wanderland-sperrungen_umleitungen` | Kartenüberlagerung und Identify, LV95 | Layerstand täglich, geprüft 2026-10-24 | OGD, Quellenangabe; keine Meldung ist keine Freigabe |
| Solar-Dacheignung | BFE via GeoAdmin | WMS/Identify `ch.bfe.solarenergie-eignung-daecher`, Zuordnung über `gwr_egid` | Dachpolygone mit Eignungsklasse, Fläche, Modell-Stromertrag, Neigung und Ausrichtung | Layerstand 2023-02-21 | OGD BFE, Quellenangabe |
| Strassen- und Bahnlärm | BAFU via GeoAdmin | WMS `ch.bafu.laerm-{strassenlaerm,bahnlaerm}_{tag,nacht}` (GetMap/GetFeatureInfo) | Modellierte Rasterwerte, Raster ca. 10 m | Referenzjahr 2021 | OGD BAFU, Quellenangabe; keine Messung am Gebäude |
| Grobe Hochwasserübersicht | BAFU Aquaprotect via GeoAdmin | WMS `ch.bafu.aquaprotect_100` (GetMap/GetFeatureInfo) | Grobe potenziell überschwemmte Gebiete | Layerstand 2008-12-18 | OGD BAFU, Quellenangabe; keine aktuelle Warnung und nicht parzellenscharf |
| Zeitreise (historische Karten) | swisstopo | WMS `ch.swisstopo.zeitreihen`, `TIME=JJJJ1231` | Bild, CORS offen | Kartenstände 1864 bis 2021 | OGD swisstopo, Quellenangabe |
| Gebäude-Umweltindikatoren (on demand) | BAG/BAFU via GeoAdmin | Identify `ch.bag.radonkarte`; WMS GetFeatureInfo `ch.bafu.laerm-{strassenlaerm,bahnlaerm}_{tag,nacht}` und `ch.bafu.geochemischer-bodenatlas_schweiz_{arsen,cadmium,blei}` | Abfrage beim Gebäudeauswählen, LV95-Gebäudemittelpunkt; keine Daten beim App-Start | Lärm: Modell/Verkehrsdaten 2021; Bodenatlas: Probenahme 2011–2015 | GeoAdmin/BAG/BAFU, Quellenangabe |

### OSM-POIs und öffentliche Dienste

Der OSM-Import berücksichtigt neben benannten Orten nun auch unbenannte öffentliche Objekte: Toiletten, Trinkwasserstellen, Recycling-/Entsorgungsstellen, Parkplätze, Veloparkplätze, E-Ladestationen und Defibrillatoren. Flächen und Relationen werden über ihren Overpass-Mittelpunkt verortet; nahe gleichartige Objekte mit gleichem Namen werden innerhalb von 8 m zusammengeführt. Fehlt ein Eigenname, zeigt die UI die verständliche Objektart statt eines erfundenen Ortsnamens.

Betreiber, Gebühren, Zugang, Kapazität, Parkdauer sowie verfügbare Stecker/Ladeleistung werden nur aus den jeweiligen OSM-Tags übernommen. Daraus wird keine aktuelle Belegung oder Ladeverfügbarkeit abgeleitet. Live-Daten zu freien Parkplätzen oder Ladepunkten sind nicht integriert.

## Nicht verwendet oder nicht verfügbar

- **STATPOP/STATENT**: Einwohner und Beschäftigte (VZÄ) werden als 100-m-Rasterzellen beim Gebäudeauswählen und über die zuschaltbaren Rasterlayer abgefragt. Sie sind Zellwerte und werden nicht als individuelle Gebäudewerte interpretiert; `statistics.json` enthält weiterhin nur GWR-Aggregate.
- **swissNAMES3D**: nicht integriert; Ortsnamen stammen aus OpenStreetMap.
- **BFE-Dacheignung**: der Layer `ch.bfe.solarenergie-eignung-daecher` ist integriert. Die Werte sind Modellwerte (Layerstand 2023-02-21), kein konkretes Anlagendesign und keine Ertragsgarantie. Eine Dachfärbung erfolgt nur bei EGID- und Geometriezuordnung zur vorhandenen swissBUILDINGS3D-Fläche.
- **Umweltwerte im Gebäudeprofil**: BAG-Radonwahrscheinlichkeit, BAFU-Strassen-/Bahnlärm und geochemischer Bodenatlas werden bei Gebäudeauswahl aus GeoAdmin abgefragt. Sie erscheinen als Umweltindikatoren, nicht im numerischen Nähe-Score: Radon ist eine 1-km-Wahrscheinlichkeit für die Überschreitung von 300 Bq/m³ und keine Gebäudemessung; Lärmwerte sind Rastermodelle und nicht rechtsverbindlich; Bodenmetalle stammen aus einer 1-km-Interpolation des Oberbodens (0–20 cm) und sind nicht parzellenscharf. Ozon und SwissPRTR sind noch nicht in die Gebäudeabfrage integriert.
- **Grundstücke und ÖREB Kanton Schwyz**: Grundstücksgeometrien sind neu über den AV-WFS eingebunden und räumlich mit Gebäudemittelpunkten verknüpft. ÖREB-/Nutzungsplan-Layer sind verfügbar, aber noch nicht objektbezogen integriert.
- **Gemessene ÖV-Fahrzeugpositionen**: Die offene Fahrplan-API liefert nur Fahrplan und Echtzeitprognosen. Positionen in der Karte sind entweder Haltestellen (Lage aus OSM) oder als «Fahrplansimulation» gekennzeichnet.
- **Fassadenfarben, Fensterläden, Fenster, Dachziegel**: nicht in den offenen Daten enthalten. Das «Dorfbild» zeigt sie gestalterisch (aus Gebäude-ID und GWR-Nutzung abgeleitet); nur die Dachfarbe ist gemessen (Luftbild).
- **Modulzahl und Modullage der Photovoltaik**: nicht im Register (nur Leistung, Standort, Jahr, Bauart, teils Ausrichtung/Neigung). Die 3D-Ansicht simuliert die Belegung der Dachflächen.
- **Solarpotenzial**: vom BFE-Modell ausgegebene Eignung, Dachfläche und modellierter Jahresertrag werden getrennt vom BFE-Register bestehender PV-Anlagen gezeigt. Sie sind kein gemessener Ertrag und sagen nichts über Bewilligung, Wirtschaftlichkeit, Verschattung im Detail oder ein konkretes Anlagendesign aus.
- **ÖV-Haltestellen**: amtliche BAV-Geometrien und Feature-IDs werden für Profilnähe und Abfahrten verwendet; fällt GeoAdmin aus, bleibt die OSM-Haltestellenliste als Fallback verfügbar. Fahrplanabfahrten werden über den Namen mit `transport.opendata.ch` abgefragt; eine verlässliche gemeinsame Betreiberkennung ist nicht für alle Haltestellen verfügbar.
- **Fusswege**: Wegstrecke folgt dem lokalen OSM-Netz im 300-m-Puffer um Ingenbohl. Gehzeiten sind aus 75 m/min (mit Zuschlag für Treppen) berechnet, keine individuelle Gehzeit; Neigung, temporäre Sperren und fehlende Zugänge werden nicht vollständig modelliert.
- **Wander-/Velowege und Sperrungen**: amtliche GeoAdmin-WMS-Überlagerungen. Höhenprofile, durchgängige Routenplanung und Umleitungssuche sind nicht integriert. Eine fehlende Sperrungsmeldung bestätigt keine Begehbarkeit.
- **Umweltkarten**: Aquaprotect 100 ist eine grobe, ältere Hochwasserübersicht und keine aktuelle Warnung. Die Lärmkarte ist ein Modell (Referenzjahr 2021), nicht eine Messung oder rechtsverbindliche Beurteilung.
- **Strassenlaternen**: OSM enthält nur 27 Knoten. Weitere 215 Standorte sind entlang von Strassen mit `lit=yes` modelliert und im Modell als «mod.» gekennzeichnet.
- **Bus- und Bahnausstattung**: Wartehäuschen und Bänke nur, wo OSM sie erfasst hat; sonst nur Mast bzw. Bahnsteig.
- **Veranstaltungen, Baustellen und Abfallkalender**: im aktuellen Quellenverzeichnis ist kein geprüfter, lizenzierter strukturierter Feed für Ingenbohl hinterlegt. Diese Angaben werden deshalb weder gescrapt noch aus Beispieldaten erzeugt.
- **Live-Park- und Ladeverfügbarkeit**: OSM liefert hier nur den statischen Bestand und gepflegte Attribute; Belegung, freie Plätze oder ein aktueller Ladestatus werden nicht behauptet.

## Wichtige Hinweise zu den Attributen

- swissBUILDINGS3D und GWR werden über die **EGID** verknüpft. 2238 von 2316 Gebäuden haben einen GWR-Eintrag über die EGID, 37 weitere werden über die Lage im GWR-Grundriss zugeordnet (insgesamt 2275). Übrige Gebäude bleiben ohne GWR-Attribute. 30 als abgebrochen registrierte Gebäude werden standardmässig ausgeblendet.
- **Baujahr (`GBAUJ`)** ist nur für 684 Gebäude erfasst. Für viele weitere gibt es die **Bauperiode (`GBAUP`)**. Das Feld `ERSTELLUNG_JAHR` aus swissBUILDINGS3D ist die Erfassung der Daten und wird nicht als Baujahr verwendet.
- Die Gebäude ausserhalb der Gemeindegrenze (Pufferzone, 300 m) sind im Inspector markiert.
