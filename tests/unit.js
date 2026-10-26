// Browser-Unit-Tests ohne Test-Framework (die Umgebung benötigt kein Node).
import { wgs84ToLv95, lv95ToWgs84, createFrame } from "../js/geo.js";
import { sunPosition, zurichParts, zurichToDate } from "../js/sky.js";
import { buildYear, typeGroup, Buildings, COLOR_MODES, facadeStyle, roofColor, floorsOf, isDemolished, hash01 } from "../js/buildings.js";
import { createSegmentIndex, createBlocker } from "../js/roadindex.js";
import { model } from "../js/models.js";
import { moduleWatt, extractRoofFaces, layoutModules } from "../js/pv.js";
import { parseTrees, buildTrees } from "../js/trees.js";
import { buildNetwork, advance, sample } from "../js/ambient.js";
import { markingLines, walk, roadLayout, roadWidth, roadsidePosition } from "../js/roadmarks.js";
import { parseDem, parseBuildings } from "../js/api.js";
import { weatherCondition, PRESETS, LIVE_WINDOW_MS } from "../js/weather.js";
import { createInspector, esc } from "../js/inspector.js";
import { normalizePoi, POI_DISPLAY } from "../js/pois.js";
import { stopPlacement, fetchOfficialStops } from "../js/transport.js";
import { initAlmanac, renderVote, voteTitle } from "../js/almanac.js";
import { Terrain } from "../js/terrain.js";
import { gradeTerrain, gradeWidth } from "../js/grading.js";
import { createCameraRig, connectMarkerNavigation, createPicker } from "../js/controls.js";
import { buildLocationRating } from "../js/location-rating.js";
import { fetchBuildingEnvironment } from "../js/environment.js";
import { fetchDemographicCell } from "../js/demographics.js";
import { createLayerManager } from "../js/layers.js";
import { automaticTimeSpeed, buildingVisibleAtYear } from "../js/history.js";
import { moonIllumination, moonPhaseName } from "../js/time-weather-panel.js";
import { buildWalkingGraph, closestWalkNode, shortestWalkRoutes, walkingRouteTo, walkingSegmentsWithin } from "../js/routing.js";
import { officialRouteMapUrl, renderFeatureInfo } from "../js/official-routes.js";
import { parseConstructionSites, nearestConstructionSite, constructionStatus } from "../js/construction.js";
import { fetchSolarPotential } from "../js/solar-potential.js";

const results = [];
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const assert = (condition, message = "Bedingung verletzt") => { if (!condition) throw new Error(message); };
const near = (actual, expected, tolerance, label = "") => assert(Math.abs(actual - expected) <= tolerance, `${label} ${actual} != ${expected} ±${tolerance}`);

test("Strassen einebnen: Fahrbahn glatt, See, Gebäude und Brücken unverändert", () => {
  const nx = 41, ny = 41, cell = 5, scale = 0.1, values = new Uint16Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) values[j * nx + i] = Math.round((i < 4 ? 3 : 10 + i * cell * 0.1 + ((i + j) % 2 ? 1.5 : 0)) / scale);
  const raw = values.slice();
  const roads = [{ c: "minor", p: [30, 100, 190, 100] }, { c: "minor", b: 1, p: [30, 50, 190, 50] }];
  const grading = gradeTerrain({ dem: { values, nx, ny, cell, scale }, minX: 0, maxZ: 200, roads, footprints: new Float32Array([100, 104, 110, 115]) });
  const profile = (fn) => { const out = []; for (let x = 40; x <= 180; x += 5) out.push(fn(x, 100)); return out; };
  const bump = (a) => Math.max(...a.slice(1, -1).map((v, k) => Math.abs(v - (a[k] + a[k + 2]) / 2)));
  assert(bump(profile(grading.rawHeightAt)) > 1, "Testgelände sollte Buckel haben");
  assert(bump(profile(grading.roadAt)) < 0.2, "Fahrbahn bleibt bucklig");
  for (let j = 0; j < ny; j++) for (let i = 0; i < 4; i++) assert(values[j * nx + i] === raw[j * nx + i], "See verändert");
  for (let j = 17; j <= 19; j++) for (let i = 20; i <= 22; i++) assert(values[j * nx + i] === raw[j * nx + i], "Gebäudegrund verändert");
  for (let i = 6; i < 38; i++) assert(values[30 * nx + i] === raw[30 * nx + i], "Brücke eingeebnet");
  assert(grading.roadAt(100, 150) === null, "roadAt neben der Strasse");
  assert(gradeWidth({ c: "path" }) === null && gradeWidth({ c: "rail" }) === 4, "Breiten");
});

test("WGS84 -> LV95: Bern (swisstopo-Referenzpunkt)", () => {
  const { e, n } = wgs84ToLv95(46.9510828, 7.4386372); // Alte Sternwarte Bern
  near(e, 2600000, 2, "E"); near(n, 1200000, 2, "N");
});

test("LV95 <-> WGS84 Rundreise in Brunnen", () => {
  const { e, n } = wgs84ToLv95(46.999172, 8.610065);
  const back = lv95ToWgs84(e, n);
  near(back.lat, 46.999172, 1e-5); near(back.lon, 8.610065, 1e-5);
  assert(e > 2688000 && e < 2692000 && n > 1204000 && n < 1208000, `LV95 ${e}/${n} ausserhalb Ingenbohl`);
});

test("Lokales System: Ost = +x, Nord = -z", () => {
  const frame = createFrame({ dem: { origin: [2688000, 1206300], elevationOffset: 430 } });
  const p = frame.toLocal(2688100, 1206400, 530);
  assert(p.x === 100 && p.z === -100 && p.y === 100);
  const q = frame.toLV95(100, -100);
  assert(q.e === 2688100 && q.n === 1206400);
});

test("Sonnenstand: Mittag zur Tag-und-Nacht-Gleiche in Brunnen", () => {
  const { altitude, azimuth } = sunPosition(new Date(Date.UTC(2026, 2, 20, 11, 30)), 47.0045, 8.6136);
  near(altitude * 180 / Math.PI, 90 - 47 + 0.0, 3, "Höhe");
  near(Math.abs(azimuth * 180 / Math.PI), 0, 8, "Azimut (Süden)");
});

test("Sonnenstand: Mitternacht liegt unter dem Horizont", () => {
  assert(sunPosition(new Date(Date.UTC(2026, 5, 21, 22, 0)), 47.0045, 8.6136).altitude < 0);
});

test("Zeitzone Zürich: Sommer-/Winterzeit", () => {
  assert(zurichToDate(2026, 7, 1, 12 * 60).toISOString() === "2026-07-01T10:00:00.000Z");
  assert(zurichToDate(2026, 1, 15, 12 * 60).toISOString() === "2026-01-15T11:00:00.000Z");
  const parts = zurichParts(new Date("2026-10-25T01:30:00Z"));
  assert(parts.minutes === 2 * 60 + 30, "nach der Umstellung auf Winterzeit ist es 02:30");
});

test("Baujahr: exakt oder nur Periode, sonst unbekannt", () => {
  const exact = buildYear({ gwr: { yearBuilt: 1987 } });
  assert(exact.exact === true && exact.from === 1987 && exact.to === 1987);
  const period = buildYear({ gwr: { periodBuilt: 8013 } });
  assert(period.exact === false && period.year === 1953 && period.label === "1946 bis 1960" && period.from === 1946 && period.to === 1960);
  assert(buildYear({ gwr: {} }) === null && buildYear({}) === null);
});

test("Zeitreise: unbekannte Baujahre bleiben ausgeblendet, Bauperioden starten am Zeitraum", () => {
  assert(!buildingVisibleAtYear({ gwr: { yearBuilt: 1950 } }, 1949));
  assert(buildingVisibleAtYear({ gwr: { yearBuilt: 1950 } }, 1950));
  assert(!buildingVisibleAtYear({ gwr: { periodBuilt: 8014 } }, 1960));
  assert(buildingVisibleAtYear({ gwr: { periodBuilt: 8014 } }, 1961));
  assert(buildingVisibleAtYear({ gwr: { periodBuilt: 8014 } }, 1970));
  assert(!buildingVisibleAtYear({}, 2026));
});

test("Zeitreise: automatisches Tempo verlangsamt bis 1980 auf 0.5×", () => {
  assert(automaticTimeSpeed(1850) === 3);
  near(automaticTimeSpeed(1980), 0.5, 1e-9, "Tempo 1980");
  assert(automaticTimeSpeed(2026) === 0.5 && automaticTimeSpeed(1900) > automaticTimeSpeed(1970));
});

test("Gebäudetyp aus GWR-Klasse", () => {
  assert(typeGroup({ gwr: { class: 1110 } }).id === "wohnen");
  assert(typeGroup({ gwr: { class: 1242 } }).id === "verkehr");
  assert(typeGroup({}) === null);
});

test("Fussrouting: kürzester OSM-Weg, Sperrung und Gehzeit", () => {
  const graph = buildWalkingGraph([
    { id: 1, c: "minor", p: [0, 0, 100, 0] },
    { id: 2, c: "path", p: [0, 0, 0, 60, 100, 60, 100, 0] },
    { id: 3, c: "path", walk: false, p: [0, 0, 0, -20, 100, -20, 100, 0] },
    { id: 4, c: "motorway", p: [0, 0, 200, 0] },
  ]);
  const start = closestWalkNode(graph, 0, 0);
  const search = shortestWalkRoutes(graph, { x: 0, z: 0 });
  const route = walkingRouteTo(search, { x: 100, z: 0 });
  assert(start?.id === search.startId && graph.nodeCount === 4, "Nicht begehbare Segmente dürfen keine Routingknoten beisteuern");
  assert(route?.distanceM === 100 && route.minutes === 1 && route.points.length === 2, "Der direkte öffentliche Weg soll als kürzeste Route gelten");
  assert(walkingSegmentsWithin(search, 1).length > 0, "Erreichbare Wege sollen für eine Zeitstufe verfügbar sein");
  assert(walkingRouteTo(shortestWalkRoutes(graph, { x: 0, z: 0 }), { x: 200, z: 0 }) === null, "Autobahn und als nicht begehbar markierte Wege sind auszuschliessen");
  assert(shortestWalkRoutes(graph, { x: 1000, z: 1000 }) === null, "Ein weit entfernt liegender Startpunkt darf nicht auf das Netz geschnappt werden");
});

test("BAV-Haltestellen: amtliche IDs, Verkehrsmittel und LV95-Geometrie", async () => {
  const stops = await fetchOfficialStops([2688933, 1205886], async (input) => {
    const url = new URL(input);
    assert(url.searchParams.get("layers") === "all:ch.bav.haltestellen-oev" && url.searchParams.get("returnGeometry") === "true");
    return { ok: true, json: async () => ({ results: [{
      featureId: 8577436,
      attributes: { name: "Brunnen, Kantonalbank", abkuerzung: null, tuabkuerzung: "AAGS", verkehrsmittel_de: "Bus" },
      geometry: { points: [[2688888, 1205729]] },
    }] }) };
  });
  assert(stops.length === 1 && stops[0].id === 8577436 && stops[0].mode === "bus");
  assert(stops[0].east === 2688888 && stops[0].north === 1205729 && stops[0].operator === "AAGS");
});

test("Offizielle Wegkarten: transparente Geländeüberlagerung in LV95", () => {
  const url = new URL(officialRouteMapUrl({ layer: "ch.astra.veloland" }, { minE: 100, minN: 200, maxE: 900, maxN: 600 }, 512, 256));
  assert(url.searchParams.get("LAYERS") === "ch.astra.veloland");
  assert(url.searchParams.get("CRS") === "EPSG:2056" && url.searchParams.get("BBOX") === "100,200,900,600");
  assert(url.searchParams.get("TRANSPARENT") === "true" && url.searchParams.get("FORMAT") === "image/png");
});

test("Baustellen Kanton Schwyz: WFS-GML wird geparst und nächstgelegen zugeordnet", () => {
  const xml = `<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:ms="http://mapserver.gis.umn.edu/mapserver" xmlns:gml="http://www.opengis.net/gml/3.2">
    <wfs:member><ms:ch.sz.a083a.baustellen.erweitert>
      <ms:geom><gml:LineString><gml:posList srsDimension="2">2688000 1205000 2688100 1205000</gml:posList></gml:LineString></ms:geom>
      <ms:lokalname>Teststrasse</ms:lokalname><ms:baubeginn>2020-01-01</ms:baubeginn><ms:bauende>2099-01-01</ms:bauende>
      <ms:behinderungsbemerkung>mittel: Einspurig&lt;br&gt;</ms:behinderungsbemerkung>
      <ms:link>&lt;a href="https://evil.example/x.pdf"&gt;Beilage&lt;/a&gt;</ms:link>
    </ms:ch.sz.a083a.baustellen.erweitert></wfs:member></wfs:FeatureCollection>`;
  const sites = parseConstructionSites(xml);
  assert(sites.length === 1 && sites[0].level === "mittel" && sites[0].impact === "mittel: Einspurig" && sites[0].link === null);
  assert(nearestConstructionSite(sites, 2688050, 1205010) === sites[0] && nearestConstructionSite(sites, 2688050, 1205100) === null);
  assert(constructionStatus(sites[0], "2026-10-26") === "laufend" && constructionStatus(sites[0], "2019-01-01") === "geplant");
});

test("Aquaprotect: leere Gefahrenattribute ergeben keine punktgenaue Risikobehauptung", () => {
  const container = document.createElement("div");
  renderFeatureInfo(container, { id: "flood" }, { attributes: {}, geometry: { type: "Polygon" } });
  assert(container.textContent.includes("keine eindeutige Gefahrenstufe") && !container.textContent.includes("Potenziell überschwemmt"));
});

test("Solarpotenzial: BFE-Dachflächen werden über EGID und modellierte Erträge zugeordnet", async () => {
  const record = { egid: 257113, center: [2688933, 1205886] };
  const feature = (egid, production) => ({
    featureId: egid, attributes: { gwr_egid: egid, klasse_text: "Gut##Bonne", flaeche: 80, stromertrag: production, stromertrag_winterhalbjahr: 20, ausrichtung: 180, neigung: 20 },
    geometry: { rings: [[[2688900, 1205800], [2688950, 1205800], [2688950, 1205850], [2688900, 1205800]]] },
  });
  const potential = await fetchSolarPotential(record, async (input) => {
    const url = new URL(input);
    assert(url.searchParams.get("layers") === "all:ch.bfe.solarenergie-eignung-daecher" && url.searchParams.get("returnGeometry") === "true");
    return { ok: true, json: async () => ({ results: [feature(257111, 9000), feature(257113, 64054)] }) };
  });
  assert(potential.status === "ready" && potential.features.length === 1 && potential.features[0].suitability === "Gut");
  assert(potential.roofAreaM2 === 80 && potential.annualKwh === 64054 && potential.features[0].winterKwh === 20);
});

test("Wetter: Codes und Niederschlag", () => {
  assert(weatherCondition({ weather_code: 61, cloud_cover: 100 }).rain);
  assert(weatherCondition({ weather_code: 80, rain: 0, cloud_cover: 99 }).rain, "Schauer-Wettercode aktiviert Regen auch ohne Niederschlag im Modellintervall");
  assert(weatherCondition({ weather_code: 73, cloud_cover: 90 }).snow);
  assert(weatherCondition({ weather_code: 45, cloud_cover: 90 }).fog);
  assert(!weatherCondition({ weather_code: 0, cloud_cover: 0 }).rain);
});

test("Mondphase: Beleuchtung und fehlende Werte", () => {
  near(moonIllumination(0), 0, 1e-9, "Neumond");
  near(moonIllumination(0.25), 0.5, 1e-9, "erstes Viertel");
  near(moonIllumination(0.5), 1, 1e-9, "Vollmond");
  near(moonIllumination(1), 0, 1e-9, "Phasenzyklus");
  assert(moonPhaseName(0) === "Neumond" && moonPhaseName(0.5) === "Vollmond");
  assert(moonIllumination(null) === null && moonPhaseName(null) === null);
});

test("HTML-Maskierung", () => {
  assert(esc('<img src=x onerror="alert(1)">') === "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

test("POI-Normalisierung: Kontaktvarianten und Adresse", () => {
  const poi = normalizePoi({ id: "w42", n: "Café am See", c: "Gastronomie", s: "cafe", x: 2, z: 3, lat: 47, lon: 8.6, t: {
    "contact:website": "https://example.org", "contact:phone": "+41 41 123 45 67", "contact:email": "info@example.org",
    "addr:street": "Seestrasse", "addr:housenumber": "4", "addr:postcode": "6440", "addr:city": "Brunnen", outdoor_seating: "yes",
    operator: "Gemeinde", fee: "yes", access: "public", capacity: "4", charge: "22 kW", socket_types: "Typ 2",
  } });
  assert(poi.osmType === "way" && poi.osmId === "42" && poi.name === "Café am See");
  assert(poi.subtypeLabel === "Café");
  assert(poi.website === "https://example.org" && poi.phone === "+41 41 123 45 67" && poi.email === "info@example.org");
  assert(poi.address === "Seestrasse 4, 6440 Brunnen" && poi.properties.outdoorSeating === "yes");
  assert(poi.properties.operator === "Gemeinde" && poi.properties.fee === "yes" && poi.properties.capacity === "4");
  assert(poi.properties.power === "22 kW" && poi.properties.socketTypes === "Typ 2");
});

test("POI-Marker: Ziehen und Mausrad gehen an die Karte, Klick bleibt am Pin", () => {
  const canvas = document.createElement("canvas"), layer = document.createElement("div"), marker = document.createElement("button");
  marker.className = "poi-marker";
  layer.append(marker);
  let starts = 0, clicks = 0, mapClicks = 0, wheelDelta = 0;
  canvas.addEventListener("pointerdown", () => { starts++; });
  canvas.addEventListener("wheel", (event) => { wheelDelta = event.deltaY; });
  marker.addEventListener("click", () => { clicks++; });
  createPicker({ canvas, providers: [], onClick: () => { mapClicks++; } });
  connectMarkerNavigation(layer, canvas);
  const pointer = (target, type, x, extra = {}) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", clientX: x, clientY: 20, button: 0, buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1, ...extra }));
  pointer(marker, "pointerdown", 20);
  pointer(canvas, "pointermove", 50);
  pointer(canvas, "pointermove", 20);
  pointer(canvas, "pointerup", 20);
  assert(starts === 1 && clicks === 0 && mapClicks === 0, "Ziehen darf auch nach Rückkehr zum Start weder Pin noch Gebäude auswählen");
  pointer(marker, "pointerdown", 20);
  pointer(canvas, "pointerup", 21);
  assert(clicks === 1 && mapClicks === 0, "Kurzer Klick muss nur den Pin öffnen");
  pointer(marker, "pointerdown", 20);
  pointer(canvas, "pointercancel", 20);
  pointer(canvas, "pointerup", 20);
  assert(clicks === 1, "Abgebrochene Gesten dürfen keine Auswahl auslösen");
  marker.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120 }));
  assert(wheelDelta === -120, "Zoom muss über einem Pin funktionieren");
  marker.click();
  assert(clicks === 2, "Tastaturaktivierung muss erhalten bleiben");
});

test("POI-Marker: Nähe, Hysterese und Grössen sind begrenzt", () => {
  assert(POI_DISPLAY.showDistanceMeters === 850 && POI_DISPLAY.nearDistanceMeters === 300 && POI_DISPLAY.fullOpacityDistanceMeters === 150);
  assert(POI_DISPLAY.showDistanceMeters + POI_DISPLAY.hysteresisMeters === 900);
  assert(POI_DISPLAY.overviewPx === 20 && POI_DISPLAY.nearPx === 26 && POI_DISPLAY.hoverPx === 28);
  assert(POI_DISPLAY.maxMarkerPx === 34 && POI_DISPLAY.touchTargetPx === 44);
});

test("POI-Detail: unsichere Kontakte werden ausgelassen, OSM bleibt verlinkt", () => {
  const panel = document.createElement("aside"), body = document.createElement("div"), closeButton = document.createElement("button");
  const centered = [];
  const inspector = createInspector({ panel, body, closeButton, codes: {}, onCenterPoi: (poi) => centered.push(poi.id) });
  inspector.showPoi({ id: "poi-42", name: "Ladestation", category: "Mobilität", subtype: "charging_station", subtypeLabel: "E-Ladestation", website: "javascript:alert(1)", phone: "javascript:alert(1)", email: "info@example.org", osmType: "node", osmId: 42, properties: { wheelchair: "yes", fee: "no", access: "public", socketTypes: "CCS" } });
  assert(panel.classList.contains("poi-detail") && panel.getAttribute("role") === "dialog" && panel.getAttribute("aria-labelledby") === "poi-detail-title");
  assert(body.textContent.includes("E-Ladestation") && body.textContent.includes("Rollstuhlgängig") && body.textContent.includes("Kostenlos") && body.textContent.includes("Steckertypen"));
  assert(!body.querySelector('a[href^="javascript:"]') && !body.querySelector('a[href^="tel:"]'));
  assert(body.querySelector('a[href="mailto:info@example.org"]') && body.querySelector('a[href="https://www.openstreetmap.org/node/42"]'));
  assert(body.querySelector("[data-center-poi]") && !body.textContent.includes("Standort anzeigen"));
  body.querySelector("[data-center-poi]").click();
  assert(centered[0] === "poi-42");
  inspector.hide();
  assert(!panel.classList.contains("poi-detail"));
});

test("Gebäude-Inspector zeigt Parzelle und räumliche Zuordnung", () => {
  const panel = document.createElement("section"), body = document.createElement("div"), closeButton = document.createElement("button");
  const inspector = createInspector({ panel, body, closeButton, codes: {} });
  inspector.showBuilding({
    id: "fixture", type: "Gebaeude Einzelhaus", center: [2688000, 1206300], inMunicipality: true,
    gwr: {}, parcels: [{ id: "Ingenbohl:123", number: "123", municipality: "Ingenbohl", areaM2: 100 }],
    landUse: [{ id: "zone.1", kind: "grundnutzung", type: "W1", label: "Wohnzone", link: null }],
  });
  assert(!panel.hidden && body.querySelector('[role="tab"][aria-selected="true"]')?.textContent === "Übersicht");
  assert(body.textContent.includes("Gebäudeprofil") && body.textContent.includes("Gebäude"));
  assert(!body.querySelector('[data-profile-tab="energy"]') && !body.querySelector('[data-profile-tab="compare"]'));
  body.querySelector('[data-profile-tab="data"]').click();
  assert(body.querySelector('[role="tab"][aria-selected="true"]')?.textContent === "Daten & Quellen");
  assert(body.textContent.includes("Grundstück 1"));
  assert(body.textContent.includes("123 · 100 m²"));
  assert(body.textContent.includes("Wohnzone"));
  assert(body.textContent.includes("Gebäudemittelpunkt innerhalb der Parzellengeometrie; kein EGRID im WFS"));
  assert(body.textContent.includes("Rechtsverbindlichkeit und Gültigkeit sind im abgerufenen Feature-Schema nicht enthalten"));
});

test("Gebäudeprofil: Vergleich, Luftlinien, PV und Quellen", () => {
  const panel = document.createElement("section"), body = document.createElement("div"), closeButton = document.createElement("button");
  let ratingInput;
  const inspector = createInspector({
    panel, body, closeButton,
    onRatingPreferenceChange: (record, preferences) => buildLocationRating({ ...ratingInput, record, preferences }),
    codes: {
      GKLAS: { 1122: "Gebäude mit drei oder mehr Wohnungen" }, GKAT: { 1020: "Gebäude mit ausschliesslicher Wohnnutzung" },
      GSTAT: { 1004: "Gebäude bestehend" }, GWAERZH1: { 7410: "Heizkessel (generisch) für ein Gebäude" },
    },
  });
  const profileRecord = {
    type: "Gebaeude Einzelhaus", center: [2688933.1, 1205885.9], inMunicipality: true, egid: 257113, height: 13.93, footprintArea: 282.8,
    gwr: { class: 1122, category: 1020, periodBuilt: 8015, status: 1004, floors: 5, dwellings: 8, heatGenerator: 7410, heatEnergy: 7530, footprintAreaGwr: 283 },
  };
  const frame = { toLocal: () => ({ x: 0, z: 0 }) };
  ratingInput = {
    record: profileRecord, frame,
    pois: [
      { n: "Coop", s: "supermarket", x: 173, z: 0 }, { n: "Theresianum", s: "school", x: 593, z: 0 },
      { n: "Stockfluhe", s: "pitch", x: 1708, z: 0 },
    ],
    stops: [{ n: "Kantonalbank", m: "bus", x: 170, z: 0 }, { n: "Brunnen", m: "train", x: 215, z: 0 }],
    places: [{ n: "Brunnen", k: "village", x: 487, z: 0 }],
    osmSource: { provider: "OpenStreetMap-Mitwirkende", license: "ODbL 1.0", retrieved: "2026-10-22" },
  };
  const rating = buildLocationRating(ratingInput);
  assert(rating.score === 73 && rating.coverage === 100 && rating.availableDimensions === 3, "Wohnattraktivitäts-Orientierung stimmt nicht mit den erfassten Luftlinien überein");
  assert(rating.label === "Eher kurze Distanzen zu erfassten Angeboten" && rating.model.includes("Luftlinien-Distanz"), "Die Standortorientierung muss verständlich erklären, was der Wert einordnet");
  const insufficient = buildLocationRating({ record: profileRecord, frame, pois: [{ n: "Coop", s: "supermarket", x: 173, z: 0 }] });
  assert(insufficient.score === null && insufficient.coverage === 33, "Ein einzelner Bereich darf keinen Score erzeugen");
  const normalizedPois = buildLocationRating({
    record: profileRecord, frame,
    pois: [{ name: "Coop", subtype: "supermarket", x: 173, z: 0 }, { name: "Praxis", subtype: "doctors", x: 240, z: 0 }, { name: "Park", subtype: "park", x: 300, z: 0 }],
    stops: [{ n: "Bus", m: "bus", x: 200, z: 0, sourceProvider: "Bundesamt für Verkehr (BAV) · GeoAdmin", sourceLabel: "BAV-Haltestellenverzeichnis" }],
  });
  assert(normalizedPois.factors.some((factor) => factor.label === "Einkaufen") && normalizedPois.availableDimensions === 3, "Normalisierte POIs mit subtype müssen in die Bereiche eingehen");
  assert(normalizedPois.factors.some((factor) => factor.label === "Bushaltestelle" && factor.source.provider.includes("Bundesamt für Verkehr")), "Amtliche Haltestellen müssen im Score ihre eigene Quelle ausweisen");
  const demographics = { status: "ready", cellSizeM: 100, bounds: [2688500, 1205600, 2688600, 1205700], population: { value: 126, year: 2024 }, employment: { value: 4, year: 2023 } };
  inspector.showBuilding(profileRecord, {
    addresses: ["Rosengartenstrasse 4, 6440 Brunnen"],
    comparison: { group: "Gebäude mit drei oder mehr Wohnungen", count: 443, metrics: [{ label: "Grundfläche GWR", value: 283, unit: "m²", percentile: 56, median: 265, count: 443, histogram: [{ label: "200-300", count: 112, selected: true }, { label: "300-400", count: 70, selected: false }], distribution: "rechtsschief" }] },
    nearby: [{ label: "Supermarkt", name: "Coop", distance: 173 }],
    environmental: { status: "ready", indicators: [{ id: "radon", label: "Radon", available: true, inRating: false, value: 16, unit: "%", resolutionM: 1000, detail: "Modellierte Wahrscheinlichkeit, den Referenzwert zu überschreiten.", source: "BAG-Radonkarte · GeoAdmin" }] },
    demographics: { status: "ready", cellSizeM: 100, bounds: [2688500, 1205600, 2688600, 1205700], population: { value: 126, year: 2024 }, employment: { value: 4, year: 2023 } },
    nextDeparture: { status: "unavailable" },
    solarPotential: { status: "ready", roofAreaM2: 340, annualKwh: 64054, dataStatus: "2023-02-21", features: [{ suitability: "Gut", areaM2: 340, annualKwh: 64054, winterKwh: 16337, slopeDeg: 0, azimuthDeg: -180 }] },
    pv: [{ plant: { kw: 22.28, year: 2023, cat: "angebaut", parts: [[0, 10, 6], [0, 10, 2]] }, requested: 58, placed: 58, onRoof: true }],
    rating,
    demographics,
    gwrExportDate: "2026-10-21",
  });
  assert(body.textContent.includes("1971 bis 1980") && !body.textContent.includes("Coop"), "Übersicht soll Bauzeit zeigen und Detailorte der Umgebung überlassen");
  assert(!body.querySelector(".profile-age-track") && body.textContent.includes("1971 bis 1980"), "Bauzeit soll als Text statt Heatmap erscheinen");
  assert(!body.querySelector(".profile-kpis").textContent.includes("Bauzeit") && body.querySelectorAll(".profile-kpi").length === 2, "Übersicht soll nur Geschosse und Wohnungen als Kennzahlen zeigen");
  body.querySelector('[data-profile-tab="environment"]').click();
  assert(body.querySelector(".profile-content > .profile-demographics") && !body.textContent.includes("Coop") && !body.textContent.includes("173 m Luftlinie"), "Nachbarschaft gehört nach oben; Score-Orte werden nicht doppelt angezeigt");
  assert(!body.textContent.includes("Nächste ÖV-Abfahrt"), "Nicht verfügbare ÖV-Abfahrten dürfen nicht erscheinen");
  assert(body.textContent.includes("126") && body.textContent.includes("Menschen in der 100-m-Zelle") && body.textContent.includes("Vollzeit-Arbeitsplätze in der 100-m-Zelle"), "Nachbarschaftswerte brauchen räumlich genaue Bezeichnungen");
  assert(body.textContent.includes("Einwohner und Arbeitsplätze auf Karte ansehen") && !body.textContent.includes("STATPOP"), "Umgebung soll direkte Kartenanalyse ohne Fachbegriffe anbieten");
  body.querySelector('[data-profile-tab="building"]').click();
  assert(body.textContent.includes("Abweichung der beiden Angaben: 0.2 m²") && body.textContent.includes("Median 265 m²"), "Gebäude-Details brauchen Grundflächendifferenz und Vergleichskontext");
  body.querySelector('[data-profile-tab="overview"]').click();
  assert(body.textContent.includes("22.3 kW registriert"), "PV-Leistung fehlt in der Übersicht");
  assert(body.querySelector("[data-rating-toggle]") && body.textContent.includes("73") && body.textContent.includes("Wohnumfeld-Orientierung"), "Wohnattraktivitäts-Orientierung fehlt");
  assert(body.querySelector(".profile-rating").style.getPropertyValue("--rating-tone").startsWith("hsl(") && body.querySelector(".profile-rating-meter").style.getPropertyValue("--rating-position") === "73%", "Aussagekräftige Orientierung braucht eine farbige Skalenposition");
  assert(body.querySelector(".profile-rating-action")?.textContent.includes("Details und Quellen anzeigen") && body.querySelector("[data-rating-toggle]").getAttribute("aria-expanded") === "false", "Rating braucht eine sichtbare Aufklappaktion");
  body.querySelector("[data-rating-toggle]").click();
  assert(body.querySelector(".profile-rating-action")?.textContent.includes("Details schliessen") && body.querySelector("[data-rating-toggle]").getAttribute("aria-expanded") === "true", "Aufgeklapptes Rating braucht eine erkennbare Schliessaktion");
  assert(body.textContent.includes("OpenStreetMap-Mitwirkende") && body.textContent.includes("Solarpotenzial") && body.textContent.includes("Luftlinie") && body.textContent.includes("keine amtliche oder professionelle Immobilienbewertung"), "Quellen, Grenzen oder nicht eingerechnete Daten fehlen");
  const leisurePriority = body.querySelector('[data-rating-priority="leisure"]');
  assert(leisurePriority?.value === "1", "Bereiche sollen standardmässig gleich gewichtet sein");
  leisurePriority.value = "2";
  leisurePriority.dispatchEvent(new Event("change", { bubbles: true }));
  assert(body.querySelector(".profile-rating-score").textContent.includes("65") && body.querySelector('[data-rating-priority="leisure"]').value === "2", "Persönliche Priorität muss die Orientierung neu berechnen");
  body.querySelector('[data-rating-priority="leisure"]').value = "1";
  body.querySelector('[data-rating-priority="leisure"]').dispatchEvent(new Event("change", { bubbles: true }));
  body.querySelector('[data-profile-tab="environment"]').click();
  assert(body.textContent.includes("Umwelt und Belastungen") && body.textContent.includes("Berechnung / Aussage: Modellierte Wahrscheinlichkeit") && body.textContent.includes("BAG-Radonkarte · GeoAdmin") && body.textContent.includes("1'000 m"), "Umweltwerte müssen Berechnungsweise, Quelle und Auflösung erklären");
  body.querySelector('[data-profile-tab="overview"]').click();
  body.querySelector("[data-rating-toggle]").click();
  assert(!body.querySelector("#profile-rating-details") && body.querySelector(".profile-rating-action").textContent.includes("Details und Quellen anzeigen"), "Rating muss sich wieder schliessen lassen");
  body.querySelector('[data-profile-tab="compare"]').click();
  assert(body.textContent.includes("Die Grundfläche dieses Gebäudes liegt") && body.textContent.includes("typischen Wert vergleichbarer Gebäude"), "Vergleich soll zuerst eine verständliche Einordnung zeigen");
  assert(body.textContent.includes("56. Perzentil") && body.textContent.includes("n = 443"), "Vergleichsperzentil oder Stichprobe fehlt");
  assert(body.querySelectorAll(".profile-histogram-bin").length === 2 && body.querySelector(".profile-histogram-bin.is-current"), "Histogrammsäulen oder Gebäudemarkierung fehlen");
  assert(body.textContent.includes("keine Normalverteilungskurve angenommen"), "Vergleich soll die empirische Form nicht als normal verteilen");
  body.querySelector('[data-profile-tab="energy"]').click();
  assert(body.textContent.includes("Heizöl") && body.textContent.includes("58 von 58 Modulen simuliert"), "Heizöl oder Simulationshinweis fehlt");
  assert(body.textContent.includes("Jahresertrag ist nicht verfügbar"), "Fehlender PV-Jahresertrag wird nicht transparent erklärt");
  assert(body.textContent.includes("64'054 kWh/Jahr modelliert") && body.textContent.includes("Solarpotenzial auf der Karte ansehen"), "BFE-Solarpotenzial muss vom PV-Register getrennt erscheinen");
  body.querySelector('[data-profile-tab="data"]').click();
  assert(body.textContent.includes("GWR-Export 2026-10-21") && body.textContent.includes("EGID"), "Quellenstand oder EGID fehlt");
  assert(body.textContent.includes("STATPOP") && body.textContent.includes("STATENT") && body.textContent.includes("100 × 100 m"), "Technische Demografieangaben gehören in Daten & Quellen");
  body.querySelector('[data-profile-tab="environment"]').click();
  inspector.suspendBuildingProfile();
  inspector.showPoi({ name: "Coop", category: "Einkauf", subtype: "supermarket" });
  assert(inspector.restoreBuildingProfile() && body.querySelector('[data-profile-tab="environment"][aria-selected="true"]'), "Rückkehr aus einem POI-Detail muss den vorherigen Profil-Tab wiederherstellen");
  const unknownPanel = document.createElement("section"), unknownBody = document.createElement("div"), unknownClose = document.createElement("button");
  const unknownInspector = createInspector({ panel: unknownPanel, body: unknownBody, closeButton: unknownClose, codes: {} });
  unknownInspector.showBuilding(profileRecord, { rating: insufficient });
  assert(unknownBody.querySelector(".profile-rating.is-unrated") && unknownBody.querySelector(".profile-rating-meter.is-unrated") && unknownBody.querySelector(".profile-rating-score").textContent.includes("–"), "Nicht aussagekräftige Orientierung muss grau und ohne Zahl erscheinen");
});

test("Nachbarschaft: echte Nullwerte bleiben von fehlenden Daten unterscheidbar", () => {
  const panel = document.createElement("section"), body = document.createElement("div"), closeButton = document.createElement("button");
  const inspector = createInspector({ panel, body, closeButton, codes: {} });
  inspector.showBuilding({ type: "Gebaeude Einzelhaus", center: [2688000, 1206300], gwr: {} }, {
    demographics: { status: "ready", population: { value: 0, year: 2024 }, employment: null },
  });
  body.querySelector('[data-profile-tab="environment"]').click();
  assert(body.querySelector(".profile-demographic-grid")?.children[0].querySelector("strong")?.textContent === "0", "Ein echter Nullwert muss sichtbar bleiben");
  assert(body.querySelector(".profile-demographic-grid")?.children[1].querySelector("strong")?.textContent === "–", "Fehlende Beschäftigungsdaten dürfen nicht als Null erscheinen");
  assert(!body.textContent.includes("STATPOP") && !body.textContent.includes("STATENT"), "Fachbegriffe gehören nicht in die Profilübersicht");
  body.querySelector('[data-profile-tab="data"]').click();
  assert(body.textContent.includes("STATPOP") && body.textContent.includes("STATENT") && body.textContent.includes("Kein Wert verfügbar"), "Daten & Quellen muss Herkunft und fehlende Werte erklären");
  panel.hidden = true;
  inspector.updateBuildingDemographics({ status: "ready", population: { value: 2, year: 2024 }, employment: null });
  assert(panel.hidden, "Ein später Datenabruf darf das Profil während einer Kartenanalyse nicht wieder einblenden");
});

test("Umweltkarten: GeoAdmin-Werte behalten Auflösung und Modellhinweise", async () => {
  const calls = [];
  const fetcher = async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.hostname === "api3.geo.admin.ch") {
      return { ok: true, json: async () => ({ results: [{ bbox: [2688000, 1205000, 2689000, 1206000], attributes: { probability_prozent: 16, confidence: 2897.92 } }] }) };
    }
    const layer = url.searchParams.get("QUERY_LAYERS");
    const value = layer.includes("strassenlaerm_tag") ? "37.9" : layer.includes("radon") ? "16" : "5";
    return { ok: true, json: async () => ({ bbox: [2688525, 1205685, 2688535, 1205695], features: [{ properties: { value_0: value }, geometry: { coordinates: [2688530, 1205690] } }] }) };
  };
  const data = await fetchBuildingEnvironment([2688532.9, 1205692], fetcher);
  const radon = data.indicators.find((item) => item.id === "radon");
  const noise = data.indicators.find((item) => item.id === "road-day");
  const soil = data.indicators.find((item) => item.id === "arsenic");
  assert(data.status === "ready" && data.indicators.length === 8 && calls.length === 8);
  assert(radon.value === 16 && radon.resolutionM === 1000 && radon.inRating === false);
  assert(noise.value === 37.9 && noise.resolutionM === 10 && noise.detail.includes("Nicht rechtsverbindlich"));
  assert(soil.value === 5 && soil.resolutionM === 1000 && soil.detail.includes("keine parzellenscharfe Aussage"));
  const unavailable = await fetchBuildingEnvironment([2688532.9, 1205692], async () => ({ ok: false }));
  assert(unavailable.status === "ready" && unavailable.indicators.every((item) => !item.available));
});

test("Demografie: GeoAdmin liefert neuestes Jahr mit 100-m-Zellgeometrie", async () => {
  const fetcher = async (input) => {
    const url = new URL(input);
    const isPopulation = url.searchParams.get("layers").includes("bevoelkerungsstatistik");
    const years = isPopulation ? [2022, 2024] : [2021, 2023];
    return { ok: true, json: async () => ({ results: years.map((year) => ({
      bbox: [2688500, 1205600, 2688600, 1205700],
      geometry: { rings: [[[2688500, 1205600], [2688600, 1205600], [2688600, 1205700], [2688500, 1205700], [2688500, 1205600]]] },
      attributes: { number: isPopulation ? year - 1898 : year - 2019, i_year: year },
    })) }) };
  };
  const cell = await fetchDemographicCell([2688532.9, 1205692], fetcher);
  assert(cell.cellSizeM === 100 && cell.bounds[0] === 2688500 && cell.bounds[2] === 2688600);
  assert(cell.population.value === 126 && cell.population.year === 2024);
  assert(cell.employment.value === 4 && cell.employment.year === 2023);
  assert(cell.geometry.rings[0].length === 5);
  const zeroAndMissing = await fetchDemographicCell([2688532.9, 1205692], async (input) => {
    const isPopulation = new URL(input).searchParams.get("layers").includes("bevoelkerungsstatistik");
    return { ok: true, json: async () => ({ results: [{ attributes: { number: isPopulation ? null : 0, i_year: 2024 } }] }) };
  });
  assert(zeroAndMissing.population === null && zeroAndMissing.employment.value === 0, "Fehlende GeoAdmin-Werte und echte Nullwerte müssen unterscheidbar bleiben");
});

test("Ebenen: nach Nutzeraufgabe gruppiert und mit Aktivzählern", () => {
  const list = document.createElement("div");
  const analysisList = document.createElement("div"), displayList = document.createElement("div");
  const layers = createLayerManager(list, { analysis: analysisList, display: displayList });
  layers.add({ id: "terrain", label: "Gelände", color: "#888", visible: true });
  layers.add({ id: "planning-use", label: "Nutzungsplanung: Grundnutzung", color: "#4aa58d", visible: false });
  layers.add({ id: "roads", label: "Strassen", color: "#888", visible: false });
  layers.add({ id: "ambient", label: "Personen (Simulation)", color: "#888", visible: true });
  layers.add({ id: "lamps", label: "Strassenlaternen", color: "#888", visible: true });
  layers.add({ id: "weather", label: "Wettereffekte", color: "#888", visible: false });
  const groups = [...list.querySelectorAll(":scope > .layer-group")];
  const base = groups.find((group) => group.textContent.includes("Karte, Gebäude & Grundstücke"));
  const mobility = groups.find((group) => group.textContent.includes("Mobilität & Verkehr"));
  const analysis = analysisList.querySelector(":scope > .layer-group");
  const display = displayList.querySelector(":scope > .layer-group");
  assert(base?.open === true, "Grundkarte-Gruppe soll geöffnet starten");
  assert(base.querySelectorAll(".layer-row").length === 2, "Gelände- oder Nutzungsplanungs-Layer fehlt in der Grundkarte-Gruppe");
  assert(mobility?.open === false, "Mobilität-Gruppe soll eingeklappt starten");
  assert(mobility.querySelectorAll(".layer-row").length === 1, "Strassen-Layer fehlt in der Mobilität-Gruppe");
  assert(analysis?.textContent.includes("Personen (Simulation)"), "Simulation fehlt im Analysebereich");
  assert(display?.textContent.includes("Strassenlaternen") && display.textContent.includes("Wettereffekte"), "Darstellungsebenen fehlen");
  assert(analysis.querySelector("summary").textContent.includes("Simulationsebenen"), "Simulations-Untergruppe fehlt");
  assert(display.querySelector("summary").textContent.includes("Darstellungsebenen"), "Darstellungs-Untergruppe fehlt");
  const terrainTile = base.querySelector(".layer-row");
  const roadTile = mobility.querySelector(".layer-row");
  assert(terrainTile.tagName === "BUTTON" && terrainTile.querySelector("input") === null, "Layer-Kacheln sollen selbst die Schalter sein");
  assert(base.querySelector('[aria-label*="Nutzungsplanung: Grundnutzung"] .name')?.textContent === "Grundnutzung", "Lange Tile-Labels sollen gekürzt bleiben und der zugängliche Name vollständig sein");
  terrainTile.click(); roadTile.click();
  assert(!layers.isVisible("terrain") && layers.isVisible("roads"), "Layer-Kacheln müssen unabhängig mehrfach schaltbar sein");
  terrainTile.click(); roadTile.click();
  assert(base.querySelector(".layer-group-count").textContent === "1/2", "Grundkarte-Aktivzähler ist falsch");
  const saved = layers.snapshot();
  layers.setVisible("roads", true);
  assert(mobility.querySelector(".layer-group-count").textContent === "1/1", "Mobilität-Aktivzähler aktualisiert nicht");
  layers.setVisible("lamps", false);
  assert(display.querySelector(".layer-group-count").textContent === "0/2", "Darstellungs-Aktivzähler aktualisiert nicht");
  layers.setVisible("terrain", false);
  layers.restore(saved);
  assert(layers.isVisible("terrain") && !layers.isVisible("roads") && layers.isVisible("lamps"), "Layerzustände wurden nicht wiederhergestellt");
  assert(!list.querySelector(":scope > .layer-row"), "Layer dürfen nicht ungegliedert bleiben");
});

test("Abstimmungen: lokaler Entscheid, Vergleich und Sonderfälle", () => {
  const element = document.createElement("div");
  const row = { title: 'Volksinitiative «Test (Testinitiative)»', date: "20260614", local: 60, swiss: 48, canton: 70, accepted: false, turnout: 55 };
  element.innerHTML = renderVote(row);
  assert(voteTitle(row.title) === "Testinitiative");
  assert(voteTitle("Bundesgesetz über den elektronischen Identitätsnachweis (E-ID-Gesetz, BGEID)") === "E-ID-Gesetz");
  assert(element.querySelector(".vote-result").textContent === "Angenommen", "Nationaler Entscheid darf nicht lokal verwendet werden");
  assert(element.querySelector(".vote-shares").textContent.includes("Ja 60.0 %") && element.querySelector(".vote-shares").textContent.includes("Nein 40.0 %"));
  assert(element.querySelector(".vote-delta").textContent.includes("+12.0 Prozentpunkte"));
  assert(element.querySelector(".vote-swiss").textContent.includes("48.0 %"), "Vergleich muss Schweiz statt Kanton verwenden");
  assert(element.querySelector("details").textContent.includes(row.title) && element.querySelector("details").textContent.includes("Abgelehnt"));
  element.innerHTML = renderVote({ ...row, local: 40 });
  assert(element.querySelector(".vote-result").textContent === "Abgelehnt");
  assert(element.querySelector(".vote-delta").textContent.includes("−8.0 Prozentpunkte"));
  element.innerHTML = renderVote({ ...row, local: 50, swiss: 50 });
  assert(element.querySelector(".vote-result").textContent === "Abgelehnt");
  assert(element.querySelector(".vote-delta").textContent.includes("Gleicher Ja-Anteil"));
  element.innerHTML = renderVote({ ...row, local: null, swiss: null, turnout: null, accepted: null });
  assert(element.querySelector(".vote-result").textContent === "Ergebnis fehlt" && !element.querySelector(".vote-shares"));
  assert(!element.textContent.includes("NaN") && element.textContent.includes("Vergleich nicht verfügbar"));
  element.innerHTML = renderVote({ ...row, title: "Bargeldinitiative und Gegenvorschlag: Stichfrage" });
  assert(element.querySelector(".vote-result").textContent === "Stichfrage" && !element.querySelector(".vote-shares"));
  assert(!element.querySelector(".vote-swiss") && element.textContent.includes("Antwortoption unbekannt"));
});

test("Abstimmungen: Datums- und lokale Entscheidfilter kombinieren", async () => {
  const elements = new Map(["#almanac", "#almanac-body", "#almanac-tabs", "#btn-almanac", "#almanac-close"].map((selector) => [selector, document.createElement("div")]));
  const ctx = { $: (selector) => elements.get(selector), meta: {}, records: [] };
  const originalFetch = window.fetch;
  window.fetch = (input, options) => originalFetch(typeof input === "string" && input.startsWith("public/data/") ? `../${input}` : input, options);
  try {
    await initAlmanac(ctx);
    await ctx.almanac.open("Abstimmungen");
  } finally {
    window.fetch = originalFetch;
  }
  const body = elements.get("#almanac-body"), date = body.querySelector("#vote-date"), decision = body.querySelector("#vote-decision");
  assert(date && decision && body.querySelectorAll(".vote").length > 10);
  date.value = "20260614";
  decision.value = "accepted";
  decision.dispatchEvent(new Event("change", { bubbles: true }));
  assert(body.querySelectorAll(".vote").length === 2, "Beide lokalen Ja-Mehrheiten müssen trotz unterschiedlichem nationalem Entscheid erscheinen");
  assert([...body.querySelectorAll(".vote")].every((vote) => vote.dataset.decision === "accepted"));
  decision.value = "rejected";
  decision.dispatchEvent(new Event("change", { bubbles: true }));
  assert(body.querySelector(".vote-empty") && body.querySelector("#vote-count").textContent.startsWith("0 von"));
  date.value = "all";
  decision.value = "all";
  date.dispatchEvent(new Event("change", { bubbles: true }));
  assert(body.querySelectorAll(".vote").length > 10 && body.querySelector('[data-decision="unknown"]'));
});

test("Almanach: direkte Tab-Navigation ohne Zurück-Button", async () => {
  const elements = new Map();
  for (const selector of ["#almanac", "#almanac-body", "#almanac-tabs", "#btn-almanac", "#almanac-close"]) {
    elements.set(selector, document.createElement(selector === "#almanac-tabs" ? "nav" : "div"));
  }
  elements.get("#almanac").hidden = true;
  let chosenAddress = null;
  const address = ["Parkstrasse 29, 6440 Brunnen", 2688661.8, 1205890.2, 1421];
  const ctx = { $: (selector) => elements.get(selector), meta: {}, records: [], addresses: [address], searchChoose: (entry) => { chosenAddress = entry; } };
  await initAlmanac(ctx);
  elements.get("#btn-almanac").click();
  elements.get("#almanac-tabs").querySelector('[data-tab="Grundstücke"]').click();
  assert(elements.get("#almanac-tabs").querySelector('[data-tab="Grundstücke"]').getAttribute("aria-selected") === "true");
  elements.get("#almanac-tabs").querySelector('[data-tab="Übersicht"]').click();
  assert(elements.get("#almanac-tabs").querySelector('[data-tab="Übersicht"]').getAttribute("aria-selected") === "true");
  assert(elements.get("#almanac").hidden === false);
  elements.get("#almanac-close").click();
  assert(elements.get("#almanac").hidden === true);
  ctx.almanac.open("Grundstücke");
  assert(elements.get("#almanac").hidden === false);
  assert(elements.get("#almanac-tabs").querySelector('[data-tab="Grundstücke"]').getAttribute("aria-selected") === "true");
  elements.get("#almanac-tabs").querySelector('[data-tab="Übersicht"]').click();
  const body = elements.get("#almanac-body");
  assert(body.querySelector(".imprint")?.textContent.includes("Philipp Zimmermann"), "Impressum fehlt auf der Übersicht");
  assert(!body.innerHTML.includes("mailto:"), "E-Mail darf vor der Nutzeraktion nicht verlinkt sein");
  body.querySelector('[data-imprint-action="email"]').click();
  assert(body.querySelector('a[href="mailto:philipp@unsere-homepage.ch"]'), "E-Mail wird erst bei Klick zusammengesetzt");
  body.querySelector('[data-imprint-action="location"]').click();
  assert(elements.get("#almanac").hidden === true, "Adresslink muss die Infobox schliessen");
  assert(chosenAddress?.label === address[0] && chosenAddress?.building === address[3], "Adresslink muss die richtige Liegenschaft auswählen");
});

test("Gelände: Plattenrand hat Lippe und geschichtete Seitenwand", async () => {
  const dem = { nx: 3, ny: 3, cell: 5, minE: 100, minN: 200, scale: 1, values: new Float32Array([10, 11, 12, 11, 12, 13, 12, 13, 14]) };
  const terrain = new Terrain(dem, { originE: 100, originN: 200 });
  await terrain.build({ nearCenter: { x: 5, z: -5 }, nearRadius: 10 });
  const plate = terrain.group.getObjectByName("terrain-plate");
  const side = plate?.getObjectByName("terrain-plate-side");
  const lip = plate?.getObjectByName("terrain-plate-lip");
  assert(side && lip, "Plattenwand oder Randlippe fehlt");
  near(side.geometry.boundingBox.min.y, 10 - 150, 1e-4, "untere Plattenkante");
  assert(side.geometry.attributes.color.count === side.geometry.attributes.position.count);
});

test("Kamera: Startflug nähert sich dem Ziel über die Flugzeit", async () => {
  const { PerspectiveCamera, Vector3 } = await import("three");
  const camera = new PerspectiveCamera();
  camera.position.set(0, 1400, 0);
  const target = new Vector3();
  const controls = { target, update() {}, addEventListener() {} };
  const frames = [];
  const rig = createCameraRig({ camera, controls, terrain: { heightAt: () => 0 }, onFrame: (callback) => frames.push(callback) });
  rig.flyTo({ target: target.clone(), distance: 700, heading: 0, tilt: Math.PI / 3, duration: 8 });
  frames[0](5);
  const middleDistance = rig.currentView().distance;
  assert(middleDistance < 1400 && middleDistance > 700, "Flug bewegt die Kamera nicht graduell");
  frames[0](4);
  frames[0](5);
});

test("Kamera: Folgezoom startet erst am Ende der ersten Fahrt", async () => {
  const { PerspectiveCamera, Vector3 } = await import("three");
  const camera = new PerspectiveCamera();
  camera.position.set(0, 1400, 0);
  const target = new Vector3();
  const controls = { target, update() {}, addEventListener() {} };
  const frames = [];
  const rig = createCameraRig({ camera, controls, terrain: { heightAt: () => 0 }, onFrame: (callback) => frames.push(callback) });
  let followStarted = false;
  rig.flyTo({ target: target.clone(), distance: 700, heading: 0, tilt: Math.PI / 3, duration: 8, onComplete: () => {
    followStarted = true;
    rig.flyTo({ target: target.clone(), distance: 350, heading: 0, tilt: Math.PI / 3, duration: 4 });
  } });
  frames[0](4);
  assert(!followStarted && rig.currentView().distance > 700);
  frames[0](4);
  assert(followStarted);
  near(rig.currentView().distance, 700, 1e-3, "Startdistanz Folgezoom");
  frames[0](4);
  near(rig.currentView().distance, 350, 1e-3, "Enddistanz Folgezoom");
});

test("Kamera: Kompass dreht in beide Richtungen um 90 Grad", async () => {
  const { PerspectiveCamera, Vector3 } = await import("three");
  const camera = new PerspectiveCamera();
  camera.position.set(0, 1000, 0);
  const target = new Vector3();
  const controls = { target, update() {}, addEventListener() {} };
  const frames = [];
  const rig = createCameraRig({ camera, controls, terrain: { heightAt: () => 0 }, onFrame: (callback) => frames.push(callback) });
  rig.flyTo({ target: target.clone(), distance: 1000, heading: 0, tilt: Math.PI / 3, instant: true });
  rig.rotate(90);
  frames[0](0.5);
  near(rig.currentView().heading, Math.PI / 2, 1e-3, "Drehung im Uhrzeigersinn");
  rig.rotate(-90);
  frames[0](0.5);
  near(rig.currentView().heading, 0, 1e-3, "Drehung gegen den Uhrzeigersinn");
});

test("Kamera: Zeitreise kann einen laufenden Kameraflug stoppen", async () => {
  const { PerspectiveCamera, Vector3 } = await import("three");
  const camera = new PerspectiveCamera();
  camera.position.set(0, 7000, 0);
  const target = new Vector3();
  const controls = { target, update() {}, addEventListener() {} };
  const frames = [];
  const rig = createCameraRig({ camera, controls, terrain: { heightAt: () => 38 }, onFrame: (callback) => frames.push(callback) });
  rig.flyTo({ target: new Vector3(-50, 38, 400), distance: 1400, heading: 0, tilt: Math.PI / 4, duration: 10 });
  frames[0](2);
  rig.stop();
  const stoppedPosition = camera.position.clone(), stoppedTarget = controls.target.clone();
  frames[0](2);
  assert(camera.position.distanceTo(stoppedPosition) === 0 && controls.target.distanceTo(stoppedTarget) === 0, "Kamera bewegt sich nach dem Stop weiter");
});

test("parseDem prüft die Rastergrösse", () => {
  const meta = { dem: { extent: { nx: 2, ny: 2, cell: 5, min_e: 0, min_n: 0 }, heightScale: 0.1 } };
  assert(parseDem(new Uint16Array([1, 2, 3, 4]).buffer, meta).values.length === 4);
  let failed = false;
  try { parseDem(new Uint16Array([1, 2, 3]).buffer, meta); } catch { failed = true; }
  assert(failed);
});

test("Echte Daten: Gebäudedatei ist konsistent und pickbar", async () => {
  const [bin, json, addresses] = await Promise.all([
    fetch("../public/data/buildings3d.bin").then((r) => r.arrayBuffer()),
    fetch("../public/data/buildings.json").then((r) => r.json()),
    fetch("../public/data/addresses.json").then((r) => r.json()),
  ]);
  const data = parseBuildings(bin, json.buildings);
  assert(data.count > 1000 && data.indices.length === data.indexCount);
  const buildings = new Buildings(data, json.buildings);
  buildings.setTimeTravel(1950.5, true);
  assert(buildings.uniforms.uTimelineYear.value === 1950.5 && buildings.uniforms.uTimelineFade.value === 1);
  buildings.setTimeTravel(2026, false);
  assert(buildings.uniforms.uTimelineFade.value === 0);
  const gersauerAddress = addresses.find(([label]) => label === "Gersauerstrasse 32, 6440 Brunnen");
  assert(gersauerAddress, "Gersauerstrasse 32 fehlt im Adressindex");
  const buildingIndex = gersauerAddress[3], { table, faces, surfaces, positions } = data;
  const faceNormals = buildings.geometry.attributes.normal.array, faceUvs = buildings.geometry.attributes.aFaceUv.array;
  const wallGroups = new Map();
  let vertex = table[buildingIndex * 6];
  for (let face = table[buildingIndex * 6 + 4]; face < table[buildingIndex * 6 + 4] + table[buildingIndex * 6 + 5]; face++) {
    const size = faces[face];
    if (surfaces[vertex] === 0) {
      const nx0 = faceNormals[vertex * 3], nz0 = faceNormals[vertex * 3 + 2], horizontalLength = Math.hypot(nx0, nz0) || 1;
      const nx = nx0 / horizontalLength, nz = nz0 / horizontalLength;
      const plane = nx * positions[vertex * 3] + nz * positions[vertex * 3 + 2];
      const key = `${Math.round(nx * 100)}:${Math.round(nz * 100)}:${Math.round(plane * 4)}`;
      if (!wallGroups.has(key)) wallGroups.set(key, []);
      wallGroups.get(key).push(faceUvs[vertex * 3 + 2]);
    }
    vertex += size;
  }
  const joinedWall = [...wallGroups.values()].find((lengths) => lengths.length >= 4);
  assert(joinedWall && Math.max(...joinedWall) - Math.min(...joinedWall) < 1e-4, "Wanddreiecke starten das Fenster-UV-Raster nicht mehr einzeln");
  const { Ray, Vector3 } = await import("three");
  const centre = buildings.center(0);
  const hit = buildings.pick(new Ray(new Vector3(centre.x, centre.y + 500, centre.z), new Vector3(0, -1, 0)));
  assert(hit && hit.index >= 0, "Strahl von oben trifft kein Gebäude");
  // Filter blendet Gebäude aus
  const visible = buildings.applyFilter((record) => record.gwr?.yearBuilt && record.gwr.yearBuilt < 1900);
  assert(visible < data.count && buildings.geometry.drawRange.count < data.indexCount);
  assert(buildings.applyFilter(null) === data.count - buildings.stats().hiddenDemolished, "ohne Filter bleiben nur abgebrochene Gebäude ausgeblendet");
});

test("Dorfbild: Fassade und Dach sind pro Gebäude stabil und deterministisch", () => {
  const record = { id: "abc-1", footprintArea: 120, gwr: { class: 1110, yearBuilt: 1975 }, roofColor: "#a05a40" };
  assert(JSON.stringify(facadeStyle(record)) === JSON.stringify(facadeStyle({ ...record })));
  assert(hash01("x", "a") === hash01("x", "a") && hash01("x", "a") !== hash01("x", "b"));
  assert(roofColor(record).measured === true && /^#[0-9a-f]{6}$/.test(roofColor(record).hex));
  assert(roofColor({ id: "ohne" }).measured === false, "ohne Messwert Rückfallfarbe, als nicht gemessen markiert");
  assert(facadeStyle({ id: "k", gwr: { class: 1272 } }).kind === "kirche");
  assert(facadeStyle({ id: "g", gwr: { class: 1242 } }).kind === "beton");
});

test("Geschosse: GWR-Wert hat Vorrang, sonst Schätzung aus der Traufhöhe", () => {
  assert(floorsOf({ gwr: { floors: 4 } }).count === 4 && floorsOf({ gwr: { floors: 4 } }).estimated === false);
  const estimated = floorsOf({ roofMin: 109, groundElevation: 100 });
  assert(estimated.estimated === true && estimated.count === 3);
});

test("Abgebrochene Gebäude (GWR-Status 1007/1008) werden erkannt", () => {
  assert(isDemolished({ gwr: { status: 1007 } }) && isDemolished({ gwr: { status: 1008 } }));
  assert(!isDemolished({ gwr: { status: 1004 } }) && !isDemolished({}));
});

test("Gebäudemodi: Dorfbild ist Vorgabe und alle Modi sind benannt", () => {
  assert(COLOR_MODES[0].id === "dorf" && COLOR_MODES.length >= 8);
  assert(new Set(COLOR_MODES.map((m) => m.id)).size === COLOR_MODES.length);
});

test("Wetter: Vorgaben und Live-Zeitfenster", () => {
  for (const key of ["live", "clear", "cloudy", "rain", "snow", "fog", "storm"]) assert(PRESETS[key], key);
  assert(weatherCondition(PRESETS.rain.current).rain && weatherCondition(PRESETS.snow.current).snow);
  assert(weatherCondition(PRESETS.storm.current).storm && LIVE_WINDOW_MS === 2 * 3600 * 1000);
});

test("Strassenindex: nächstes Segment samt Richtung", () => {
  const index = createSegmentIndex([{ p: [0, 0, 100, 0] }], () => true);
  const hit = index.nearest(50, 8, 20);
  assert(hit && Math.abs(hit.distance - 8) < 1e-6 && Math.abs(hit.x - 50) < 1e-6 && hit.tx === 1);
  assert(index.nearest(50, 80, 20) === null);
});

test("Laternen und Haltestellen stehen ausserhalb der Fahrbahn", () => {
  const road = { c: "primary", p: [0, 0, 100, 0] };
  const roads = [road];
  const index = createSegmentIndex(roads, () => true);
  const center = roadsidePosition(50, 0, roads, index, 20);
  const left = roadsidePosition(50, -2, roads, index, 20);
  const curb = roadsidePosition(50, 5.5, roads, index, 20);
  const stop = stopPlacement({ m: "bus", x: 50, z: 0 }, { heightAt: () => 12 }, {
    roads, roadIndex: index,
  });
  near(center.z, 5.25, 1e-6);
  near(left.z, -5.25, 1e-6);
  near(curb.z, 5.5, 1e-6);
  near(stop.z, 5.25, 1e-6);
  near(stop.y, 12, 1e-6);

  const crossingRoads = [
    { c: "primary", p: [-50, 0, 50, 0] },
    { c: "secondary", p: [0, -50, 0, 50] },
  ];
  const crossingIndex = createSegmentIndex(crossingRoads, () => true);
  const crossing = roadsidePosition(0, 0, crossingRoads, crossingIndex, 20);
  for (const road of crossingRoads) {
    const roadIndex = createSegmentIndex([road], () => true);
    const hit = roadIndex.nearest(crossing.x, crossing.z, 20);
    assert(hit && hit.distance >= roadWidth(road) / 2 + 1.25);
  }
});

test("Modelle: Haltestelle, Zug und Schiff liefern Geometrie mit Vertexfarben", () => {
  for (const [name, args] of [["busStop", [{ shelter: true, bench: true }]], ["trainPlatform", []], ["ferryPier", []], ["postBus", []], ["sbbTrain", [3]], ["lakeShip", []]]) {
    const geometry = model(name, ...args);
    assert(geometry.getAttribute("position").count > 20 && geometry.getAttribute("color"), name);
  }
});

test("Echte Daten: Dorfbild-Modus und ausgeblendete abgebrochene Gebäude", async () => {
  const [bin, json, codes] = await Promise.all([fetch("../public/data/buildings3d.bin").then((r) => r.arrayBuffer()), fetch("../public/data/buildings.json").then((r) => r.json()), fetch("../public/data/codes.json").then((r) => r.json())]);
  const buildings = new Buildings(parseBuildings(bin, json.buildings), json.buildings, codes);
  assert(buildings.mode === "dorf");
  const demolished = json.buildings.filter(isDemolished).length;
  assert(buildings.stats().hiddenDemolished === demolished);
  for (const mode of COLOR_MODES) { buildings.setColorMode(mode.id); assert(Array.isArray(buildings.legend()), mode.id); }
  const withRoof = json.buildings.filter((b) => b.roofColor).length;
  assert(withRoof / json.buildings.length > 0.95, "Dachfarbe für mehr als 95 % der Gebäude");
});

test("Echte Daten: Abstimmungen, Laternen und Register-Rest", async () => {
  const votes = await fetch("../public/data/votes.json").then((r) => r.json());
  assert(votes.bfs === 1364 && votes.votes.length > 10 && votes.votes.every((v) => v.local >= 0 && v.local <= 100));
  const lamps = await fetch("../public/data/lamps.json").then((r) => r.json());
  assert(lamps.lamps.length > 100 && lamps.lamps.every((l) => l.length >= 2));
  const rest = await fetch("../public/data/gwr_unmatched.json").then((r) => r.json());
  assert(rest.buildings.length > 100 && rest.buildings.every((b) => b.egid && b.e && b.n));
});

// Satteldach 10 x 8 m, Neigung 30°, First in Ost-West-Richtung: Südfläche (Normale +z) und Nordfläche.
function gableRoof() {
  const h = Math.tan(Math.PI / 6) * 4;
  const south = [[-5, 0, 4], [5, 0, 4], [5, h, 0], [-5, h, 0]];
  const north = [[5, 0, -4], [-5, 0, -4], [-5, h, 0], [5, h, 0]];
  const positions = new Float32Array([...south, ...north].flat());
  return {
    table: new Uint32Array([0, 8, 0, 12, 0, 2]), faces: new Uint32Array([4, 4]), surfaces: new Uint8Array(8).fill(1), positions,
    indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
  };
}

test("Photovoltaik: Dachflächen werden aus der Geometrie gelesen", () => {
  const faces = extractRoofFaces(gableRoof(), 0);
  assert(faces.length === 2);
  const south = faces.find((f) => f.normal.z > 0);
  near(south.slope, 30, 0.1, "Neigung"); near(south.azimuth, 180, 0.5, "Azimut Süd"); near(south.area, 10 * 4 / Math.cos(Math.PI / 6), 0.1, "Fläche");
});

test("Photovoltaik: Modulzahl aus Leistung und Jahr, Module liegen auf der Südfläche", () => {
  assert(moduleWatt(2007) < moduleWatt(2015) && moduleWatt(2015) < moduleWatt(2024) && moduleWatt(2030) === moduleWatt(2040));
  const result = layoutModules(extractRoofFaces(gableRoof(), 0), { kw: 3.9, year: 2015, cat: "angebaut", parts: [] });
  assert(result.requested === Math.round(3900 / moduleWatt(2015)) && result.placed === result.requested, `${result.placed}/${result.requested}`);
  for (const matrix of result.modules) {
    const e = matrix.elements; // Spalte 2: Modulnormale
    assert(e[5] > 0.8 && e[6] > 0.3, "Normale zeigt nach oben und Süden");
    assert(e[14] > 0 && e[14] < 4.5 && Math.abs(e[12]) < 5, "Modul liegt über der Dachfläche");
  }
});

test("Photovoltaik: Ausrichtung aus dem Register bestimmt die Dachfläche, zu grosse Anlagen werden gekappt", () => {
  const faces = extractRoofFaces(gableRoof(), 0);
  const north = layoutModules(faces, { kw: 2, year: 2015, cat: "angebaut", parts: [[2, null, 1, 2015]] });
  assert(north.placed > 0 && north.modules.every((m) => m.elements[6] < -0.3), "Norden: Normale zeigt nach Norden");
  const huge = layoutModules(extractRoofFaces(gableRoof(), 0), { kw: 500, year: 2015, cat: "angebaut", parts: [] });
  assert(huge.placed < huge.requested && huge.placed >= 10 && huge.placed <= 28, "Dachfläche begrenzt die Modulzahl");
  const facade = layoutModules(extractRoofFaces(gableRoof(), 0), { kw: 5, year: 2020, parts: [[5, 90, 5, 2020]] });
  assert(facade.placed === 0 && facade.facadeKw === 5, "Fassadenanlagen werden nicht aufs Dach gelegt");
});

test("Echte Daten: pv.json passt zu den Gebäuden und liefert Module", async () => {
  const [bin, json, pv] = await Promise.all([fetch("../public/data/buildings3d.bin").then((r) => r.arrayBuffer()), fetch("../public/data/buildings.json").then((r) => r.json()), fetch("../public/data/pv.json").then((r) => r.json())]);
  const data = parseBuildings(bin, json.buildings);
  assert(pv.plants.length > 100 && pv.plants.every((p) => p.b >= 0 && p.b < data.count && p.kw > 0));
  const withEgid = pv.plants.filter((p) => p.match === "egid");
  assert(withEgid.every((p) => json.buildings[p.b].egid), "EGID-Treffer gehören zu Gebäuden mit EGID");
  const total = pv.plants.slice(0, 40).reduce((sum, plant) => sum + layoutModules(extractRoofFaces(data, plant.b), plant).placed, 0);
  assert(total > 100, `Module: ${total}`);
});

test("Bäume: Datei lässt sich lesen, Falsches Format wird abgelehnt", async () => {
  const buffer = await fetch("../public/data/trees.bin").then((r) => r.arrayBuffer());
  const trees = parseTrees(buffer);
  assert(trees.count > 10000 && trees.x.length === trees.count && trees.height.length === trees.count);
  let failed = false;
  try { parseTrees(new Uint32Array(8).buffer); } catch { failed = true; }
  assert(failed);
});

test("Bäume: Laub- und Nadelbaum in zwei Detailstufen, Kronenbreite aus Höhe, Instanzen teilen Matrizen", () => {
  const trees = { count: 4, x: new Float32Array([5, 20, 40, 60]), z: new Float32Array([-5, -20, -40, -60]), height: new Uint8Array([40, 60, 12, 80]), radius: new Uint8Array([8, 12, 4, 20]) };
  const terrain = { minX: 0, maxZ: 0, width: 100, depth: 100, heightAt: () => 10 };
  const frames = [];
  const layer = buildTrees({ trees, terrain, ortho: null, scene3d: { onFrame: (fn) => frames.push(fn), controls: { target: { x: 0, z: 0 } } }, ctx: {} });
  assert(layer.count === 4 && layer.group.children.length >= 2 && layer.group.children.length % 2 === 0);
  for (let i = 0; i < layer.group.children.length; i += 2) {
    const [high, low] = layer.group.children.slice(i, i + 2);
    assert(high.instanceMatrix === low.instanceMatrix && high.instanceColor === low.instanceColor, "Detailstufen teilen Daten");
    const triangles = (mesh) => (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;
    assert(triangles(high) > triangles(low) && triangles(high) < 400 && triangles(low) < 60, `Dreiecke ${triangles(high)}/${triangles(low)}`);
    assert(high.geometry.getAttribute("aCrown") && high.geometry.getAttribute("color"));
  }
  frames.forEach((fn) => fn(0.016, 1000));
  assert(layer.group.children.some((mesh) => mesh.visible), "nahe Bäume werden gezeichnet");
});

test("Bäume: nicht auf Strassen, Gleisen, Wegen, in Bächen oder im Wasser, aber neben Strassen und über Tunneln", () => {
  const roads = [{ c: "primary", p: [0, 0, 100, 0] }, { c: "rail", p: [0, 40, 100, 40] }, { c: "path", p: [0, 70, 100, 70] }, { c: "primary", t: true, p: [0, 90, 100, 90] }];
  const water = { streams: [{ k: "stream", p: [0, 20, 100, 20] }], areas: [{ rings: [[50, 100, 80, 100, 80, 130, 50, 130]] }] };
  const blocked = createBlocker(roads, water);
  assert(blocked(50, 1) && blocked(50, 3.9), "auf der Strasse");
  assert(!blocked(50, 8), "neben der Strasse");
  assert(blocked(50, 20.4) && !blocked(50, 23), "im Bach");
  assert(blocked(30, 41.5) && !blocked(30, 46), "auf dem Gleis");
  assert(blocked(30, 70.3) && !blocked(30, 73), "auf dem Weg");
  assert(!blocked(50, 90), "über einem Tunnel stehen Bäume");
  assert(blocked(60, 110) && !blocked(10, 110), "im Wasser");
});

test("Verkehr: Agent folgt der Linie, biegt an Knoten ab, kehrt an Enden um oder meldet Sackgasse", () => {
  const net = buildNetwork([{ p: [0, 0, 100, 0], cls: "minor" }, { p: [100, 0, 100, 50], cls: "minor" }]);
  assert(net.lines.length === 2 && Math.abs(net.lines[0].total - 100) < 1e-6);
  const car = { line: net.lines[0], seg: 0, t: 90, dir: 1 };
  assert(advance(car, 20, net, () => 0.5, { bounce: false }), "wechselt an der Einmündung auf die Anschlusslinie");
  assert(car.line === net.lines[1] && Math.abs(car.t - 10) < 1e-6 && car.dir === 1);
  const dead = { line: net.lines[1], seg: 0, t: 40, dir: 1 };
  assert(advance(dead, 30, net, () => 0.5, { bounce: false }) === false, "Sackgasse ohne Wendemöglichkeit");
  const walker = { line: net.lines[1], seg: 0, t: 40, dir: 1 };
  assert(advance(walker, 30, net, () => 0.5, { bounce: true }) && walker.dir === -1 && Math.abs(walker.t - 30) < 1e-6, "Fussgänger kehrt um");
  const p = sample(walker, {});
  assert(Math.abs(p.x - 100) < 1e-6 && Math.abs(p.z - 30) < 1e-6 && p.tz === -1);
});

test("Verkehr: Kreisel sind Einbahn (Rechtsverkehr, gegen den Uhrzeigersinn) und werden umfahren", () => {
  const ring = [];
  for (let k = 0; k <= 16; k++) ring.push(Math.cos((k / 16) * 2 * Math.PI) * 10, Math.sin((k / 16) * 2 * Math.PI) * 10);
  ring[ring.length - 2] = ring[0]; ring[ring.length - 1] = ring[1];
  const net = buildNetwork([{ p: ring, cls: "minor", oneway: 1 }]);
  assert(net.lines[0].closed);
  const car = { line: net.lines[0], seg: 14, t: 0, dir: 1 };
  assert(advance(car, 40, net, () => 0.5, { bounce: false }) && car.dir === 1, "fährt über den Schluss der Schleife weiter");
});

test("Strassenmarkierung: gestrichelte Mittellinie, Randlinien an Hauptstrassen, Unterbruch bei Kreuzungen", () => {
  const roads = [{ c: "primary", p: [0, 0, 200, 0] }, { c: "minor", p: [100, -60, 100, 0] }, { c: "service", p: [0, 30, 200, 30] }];
  const index = {
    nearest(x, z, max, exclude) {
      let best = null;
      roads.forEach((r, owner) => {
        if (owner === exclude) return;
        for (let i = 0; i + 3 < r.p.length; i += 2) {
          const [x0, z0, x1, z1] = r.p.slice(i, i + 4), dx = x1 - x0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz)));
          const d = Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
          if (d <= max && (!best || d < best.distance)) best = { distance: d, owner };
        }
      });
      return best;
    },
  };
  const { dashes, edges } = markingLines(roads, index);
  assert(dashes.length > 20, `Striche ${dashes.length}`);
  assert(dashes.every((d) => Math.hypot(d[2] - d[0], d[3] - d[1]) <= 3.5), "Striche höchstens 3 m lang");
  assert(!dashes.some((d) => d.some((v, i) => i % 2 === 0 && false)) && dashes.filter((d) => d[1] === 0 && d[0] > 95 && d[2] < 105 && d[3] === 0).length === 0, "keine Striche in der Einmündung");
  assert(edges.length >= 2 && edges.every((e) => Math.abs(Math.abs(e[1]) - 3.6) < 0.05), "Randlinien 0.4 m vom Rand der 8 m breiten Strasse");
  assert(!dashes.some((d) => d[1] > 20), "Servicestrasse ohne Markierung");
  assert(walk([0, 0, 10, 0], 2).length === 6, "Abtastung im festen Abstand");
});

test("Autobahn: zwei Spuren je Fahrtrichtung mit Spurtrennlinie, Randlinien und Fahrstreifenmitten", () => {
  const oneway = roadLayout({ c: "motorway", ow: 1, ln: 2 });
  assert(oneway.lanes.length === 2 && Math.abs(oneway.lanes[1] - oneway.lanes[0] - 3.75) < 1e-9, "Spurbreite 3.75 m");
  assert(oneway.dividers.length === 1 && oneway.edges.length === 2 && Math.abs(oneway.dividers[0] - (oneway.lanes[0] + oneway.lanes[1]) / 2) < 1e-9);
  assert(oneway.width > 9.5 && oneway.width < 11 && roadLayout({ c: "motorway", ow: 1, ln: 1 }).width < oneway.width, "Auffahrt schmaler als zweispurige Fahrbahn");
  const twoWay = roadLayout({ c: "motorway", ow: 0, ln: 4 });
  assert(twoWay.dividers[0] === 0 && twoWay.lanes.length === 1 && twoWay.lanes[0] > 0, "Gegenverkehr: Mittellinie, Rechtsverkehr");
  const net = buildNetwork([{ p: [0, 0, 300, 0], cls: "motorway", oneway: 1, lanes: oneway.lanes, width: oneway.width }]);
  assert(net.lines[0].lanes.length === 2 && net.lines[0].oneway === 1);
  const lines = markingLines([{ c: "motorway", ow: 1, ln: 2, p: [0, 0, 300, 0] }], { nearest: () => null });
  assert(lines.dashes.length > 10 && lines.edges.length === 2, "gestrichelte Spurtrennlinie, zwei Randlinien");
  assert(lines.dashes.every((d) => Math.abs(d[2] - d[0]) <= 6.5), "Striche 6 m");
});

test("Echte Daten: Höhenraster entspricht metadata.json", async () => {
  const meta = await fetch("../public/data/metadata.json").then((r) => r.json());
  const dem = parseDem(await fetch("../public/data/dem.bin").then((r) => r.arrayBuffer()), meta);
  const heights = [...dem.values.slice(0, 5000)].map((v) => v * dem.scale + meta.dem.elevationOffset);
  assert(Math.min(...heights) >= meta.dem.minHeight - 0.2 && Math.max(...heights) <= meta.dem.maxHeight + 0.2);
});

const list = document.getElementById("results");
for (const [name, fn] of tests) {
  let ok = true, message = "";
  try { await fn(); } catch (error) { ok = false; message = error.message; }
  results.push({ name, ok, message });
  const item = document.createElement("li");
  item.className = ok ? "pass" : "fail";
  item.textContent = `${ok ? "OK" : "FEHLER"}: ${name}${message ? ` – ${message}` : ""}`;
  list.append(item);
}
window.testResults = { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), total: results.length, done: true };
