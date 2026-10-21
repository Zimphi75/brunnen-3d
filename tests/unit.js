// Browser-Unit-Tests ohne Test-Framework (die Umgebung benötigt kein Node).
import { wgs84ToLv95, lv95ToWgs84, createFrame } from "../js/geo.js";
import { sunPosition, zurichParts, zurichToDate } from "../js/sky.js";
import { buildYear, typeGroup, Buildings } from "../js/buildings.js";
import { parseDem, parseBuildings } from "../js/api.js";
import { weatherCondition } from "../js/weather.js";
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
  assert(buildings.applyFilter(null) === data.count);
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
