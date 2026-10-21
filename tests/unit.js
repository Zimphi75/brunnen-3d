// Browser-Unit-Tests ohne Test-Framework (die Umgebung benötigt kein Node).
import { wgs84ToLv95, lv95ToWgs84, createFrame } from "../js/geo.js";
import { sunPosition, zurichParts, zurichToDate } from "../js/sky.js";
import { buildYear, typeGroup, Buildings, COLOR_MODES, facadeStyle, roofColor, floorsOf, isDemolished, hash01 } from "../js/buildings.js";
import { createSegmentIndex } from "../js/roadindex.js";
import { model } from "../js/models.js";
import { moduleWatt, extractRoofFaces, layoutModules } from "../js/pv.js";
import { parseDem, parseBuildings } from "../js/api.js";
import { weatherCondition, PRESETS, LIVE_WINDOW_MS } from "../js/weather.js";
import { esc } from "../js/inspector.js";

const results = [];
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const assert = (condition, message = "Bedingung verletzt") => { if (!condition) throw new Error(message); };
const near = (actual, expected, tolerance, label = "") => assert(Math.abs(actual - expected) <= tolerance, `${label} ${actual} != ${expected} ±${tolerance}`);

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
  assert(buildYear({ gwr: { yearBuilt: 1987 } }).exact === true);
  const period = buildYear({ gwr: { periodBuilt: 8013 } });
  assert(period.exact === false && period.year === 1953 && period.label === "1946 bis 1960");
  assert(buildYear({ gwr: {} }) === null && buildYear({}) === null);
});

test("Gebäudetyp aus GWR-Klasse", () => {
  assert(typeGroup({ gwr: { class: 1110 } }).id === "wohnen");
  assert(typeGroup({ gwr: { class: 1242 } }).id === "verkehr");
  assert(typeGroup({}) === null);
});

test("Wetter: Codes und Niederschlag", () => {
  assert(weatherCondition({ weather_code: 61, cloud_cover: 100 }).rain);
  assert(weatherCondition({ weather_code: 73, cloud_cover: 90 }).snow);
  assert(weatherCondition({ weather_code: 45, cloud_cover: 90 }).fog);
  assert(!weatherCondition({ weather_code: 0, cloud_cover: 0 }).rain);
});

test("HTML-Maskierung", () => {
  assert(esc('<img src=x onerror="alert(1)">') === "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

test("parseDem prüft die Rastergrösse", () => {
  const meta = { dem: { extent: { nx: 2, ny: 2, cell: 5, min_e: 0, min_n: 0 }, heightScale: 0.1 } };
  assert(parseDem(new Uint16Array([1, 2, 3, 4]).buffer, meta).values.length === 4);
  let failed = false;
  try { parseDem(new Uint16Array([1, 2, 3]).buffer, meta); } catch { failed = true; }
  assert(failed);
});

test("Echte Daten: Gebäudedatei ist konsistent und pickbar", async () => {
  const [bin, json] = await Promise.all([fetch("../public/data/buildings3d.bin").then((r) => r.arrayBuffer()), fetch("../public/data/buildings.json").then((r) => r.json())]);
  const data = parseBuildings(bin, json.buildings);
  assert(data.count > 1000 && data.indices.length === data.indexCount);
  const buildings = new Buildings(data, json.buildings);
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
