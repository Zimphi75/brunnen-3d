# Navigationsinventur: Kartenebenen und Analyse

Stand: 2026-10-22. Grundlage: `index.html`, `js/map-navigation.js`, `js/layers.js`, `js/analysis.js` und die Layer-Registrierungen der Fachmodule.

## Ist-Zustand

| Funktion | Einstieg | Zuständigkeit und Zustand | Befund |
|---|---|---|---|
| Simulation, Luftbild, Topo | Map-Dock | `ctx.ground`; Kartenwechsel werden in `map-navigation.js` synchronisiert | Übergreifende Kartenbasis, bleibt im Dock |
| Gebäude und Darstellungsmodi | Map-Dock → Gebäude | `buildings` Layer plus dieselben 3×3-Farbmodi im Detailpanel | Ein Layer-Zustand, aber doppelte Zugangsorte |
| Verkehrsebenen | Map-Dock → Verkehr | `roads`, `paths`, `rail`, `transport-lines`, `stops`, `lamps` via `ctx.layers.setVisible()` | «Weitere Kartendetails» führt fachfremd ins globale Ebenenpanel; `lamps` ist Darstellung |
| Thematische Ebenen | Verkehr → Weitere Kartendetails → Kartendetails | `createLayerManager` mit Gruppen, Counts, Verfügbarkeit, Snapshot/Restore | Richtige zentrale Verwaltung, unnötig tiefer und falscher Einstieg |
| Analysen | Kartendetails → Werkzeuge | `initAnalysis`: `measure`, `point`, `ctx.clickHandlers` und Analyse-Overlay | Analysewerkzeuge, keine Layer |
| Simulationen | Kartendetails → Ebenen nach Thema | `ambient`, `vehicles`; Layerzustand lebt in den Fachmodulen | Gehört zu Analysen/Simulationen |
| Darstellung | Kartendetails → Ebenen nach Thema | `hires`, `shadows`, `ao`, `bloom`; `lamps` wirkt auf Leuchten, `weather` auf Wettereffekte | `lamps` und `weather` sind falsch gruppiert |
| Zeitreise | eigener Schnellzugriff und Kartendetails | `ctx.history`; Layer-Snapshot plus Zeit, Kamera und Wetter werden restauriert | Eigene Simulation, bestehender Einstieg bleibt erhalten |

## Zentrale Layer-IDs

- Karte/Gebäude/Grundstücke: `terrain`, `buildings`, `boundary`, `parcels`, `planning-use`, `planning-overlays`, `register`.
- Mobilität/Verkehr: `roads`, `paths`, `rail`, `transport-lines`, `stops`.
- Orte/Natur: `pois`, `labels`, `water`, `trees`.
- Bevölkerung/Arbeit: `demography-population`, `demography-employment`.
- Energie: `pv`.
- Analysen/Simulationen: `ambient`, `vehicles`.
- Darstellung: `lamps`, `hires`, `weather`, `shadows`, `ao`, `bloom`.

## Schutz der Zustände

`createLayerManager` bleibt die einzige Quelle für `visible`, `available`, Counts, `snapshot()` und `restore()`. Ebenen werden wie Gebäudefarben als gleich grosse 3×3-Stil-Kacheln dargestellt; jede Kachel ist selbst ein unabhängiger `aria-pressed`-Schalter, Mehrfachauswahl ist erlaubt. Die vorhandenen Layer-IDs und `ctx.layers.setVisible()` bleiben die Zustandsquelle; es gibt keine parallele Verwaltung. Analysewerkzeuge bleiben über `ctx.analysis` und `ctx.clickHandlers` registriert. Zeitreise- und Kamera-Snapshots bleiben unverändert.

## Regressionen

Bestehende Unit-Abdeckung für Layer-Gruppen/Counts, Kameraflug, Zeitreise und Interaktionen beibehalten. Nach der Navigationsergänzung prüfen: direkter Einstieg aus dem Map-Dock, alle Gruppen/Counts, Layerzustände beim Schliessen und Wiederöffnen, Analyse starten/beenden, Simulationen und Darstellung toggeln, Verkehr ohne «Weitere Kartendetails», sowie Zeitreise-Snapshot/Restore.
