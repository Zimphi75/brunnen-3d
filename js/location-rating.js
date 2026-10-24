// Non-official, proximity-based orientation from currently available local data.
import { typeGroup } from "./buildings.js";

const FOOD_TYPES = new Set(["supermarket", "convenience", "bakery", "butcher", "greengrocer", "kiosk"]);
const HEALTH_TYPES = new Set(["pharmacy", "doctors", "clinic", "hospital", "dentist"]);
const RECREATION_TYPES = new Set(["park", "playground", "sports_centre", "pitch"]);
const DISTANCE_BANDS = [
  { max: 250, score: 100 },
  { max: 500, score: 80 },
  { max: 1000, score: 60 },
  { max: 2000, score: 40 },
  { max: Infinity, score: 20 },
];
const DIMENSIONS = [
  { id: "mobility", label: "Mobilität" },
  { id: "everyday", label: "Alltag" },
  { id: "leisure", label: "Freizeit und Erholung" },
];
const PRIORITY_MULTIPLIERS = new Set([1, 1.5, 2]);

function nearest(items, predicate, point) {
  let best = null;
  for (const item of items) {
    if (!predicate(item)) continue;
    const distance = Math.hypot(item.x - point.x, item.z - point.z);
    if (!best || distance < best.distance) best = { item, distance: Math.round(distance) };
  }
  return best;
}

const poiType = (item) => item.s ?? item.subtype;
const poiName = (item) => item.n ?? item.name;

function scoreDistance(distance) {
  return DISTANCE_BANDS.find((band) => distance <= band.max).score;
}

function normalizedPreferences(preferences = {}) {
  return Object.fromEntries(DIMENSIONS.map(({ id }) => {
    const value = Number(preferences[id]);
    return [id, PRIORITY_MULTIPLIERS.has(value) ? value : 1];
  }));
}

function unavailable(reason, source, preferences) {
  return { score: null, label: "Noch keine Einordnung", coverage: 0, availableDimensions: 0, totalDimensions: DIMENSIONS.length, factors: [], dimensions: [], excluded: [], source, preferences, reason };
}

export function buildLocationRating({ record, frame, pois = [], stops = [], osmSource = null, preferences = {} }) {
  const priorities = normalizedPreferences(preferences);
  const source = {
    provider: osmSource?.provider ?? "OpenStreetMap-Mitwirkende",
    license: osmSource?.license ?? "ODbL 1.0",
    retrieved: osmSource?.retrieved ?? null,
  };
  const excluded = [
    {
      label: "Umwelt und Ruhe",
      detail: "Vorhandene Umweltwerte haben unterschiedliche Rasterweiten und Modellgrundlagen und werden nicht in diese Orientierung gemischt.",
      possibleSource: "Amtliche Lärm- und Umweltkarten",
    },
    { label: "Solarpotenzial", detail: "Das Anlagenregister zeigt bestehende Anlagen, nicht das theoretische Potenzial dieses Dachs.", possibleSource: "BFE-Solarpotenzialdaten" },
  ];

  if (typeGroup(record)?.id !== "wohnen") {
    return { ...unavailable("Diese Orientierung ist für Wohngebäude vorgesehen.", source, priorities), excluded };
  }
  if (!frame || !record.center) {
    return { ...unavailable("Für dieses Gebäude fehlen Koordinaten.", source, priorities), excluded };
  }

  const point = frame.toLocal(record.center[0], record.center[1]);
  const food = nearest(pois, (poi) => FOOD_TYPES.has(poiType(poi)), point);
  const school = nearest(pois, (poi) => poiType(poi) === "school", point);
  const health = nearest(pois, (poi) => HEALTH_TYPES.has(poiType(poi)), point);
  const bus = nearest(stops, (stop) => stop.m === "bus", point);
  const rail = nearest(stops, (stop) => stop.m === "train", point);
  const recreation = nearest(pois, (poi) => RECREATION_TYPES.has(poiType(poi)), point);
  const candidates = [
    { id: "food", dimension: "everyday", label: "Einkaufen", hit: food, sourceLabel: "OpenStreetMap", name: poiName },
    { id: "school", dimension: "everyday", label: "Schule oder Kindergarten", hit: school, sourceLabel: "OpenStreetMap", name: poiName },
    { id: "health", dimension: "everyday", label: "Gesundheitsangebot", hit: health, sourceLabel: "OpenStreetMap", name: poiName },
    { id: "bus", dimension: "mobility", label: "Bushaltestelle", hit: bus, sourceLabel: bus?.item.sourceLabel ?? "ÖV-Haltestelle (OpenStreetMap)", name: (item) => item.n ?? item.name },
    { id: "train", dimension: "mobility", label: "Bahnhof", hit: rail, sourceLabel: rail?.item.sourceLabel ?? "ÖV-Haltestelle (OpenStreetMap)", name: (item) => item.n ?? item.name },
    { id: "recreation", dimension: "leisure", label: "Freizeit und Erholung", hit: recreation, sourceLabel: "OpenStreetMap", name: poiName },
  ];
  const factors = candidates.filter((candidate) => candidate.hit).map((candidate) => ({
    id: candidate.id,
    dimension: candidate.dimension,
    dimensionLabel: DIMENSIONS.find((dimension) => dimension.id === candidate.dimension).label,
    label: candidate.label,
    name: candidate.name(candidate.hit.item),
    distance: candidate.hit.distance,
    score: scoreDistance(candidate.hit.distance),
    sourceLabel: candidate.sourceLabel,
    source: candidate.hit.item.sourceProvider ? {
      provider: candidate.hit.item.sourceProvider,
      license: candidate.hit.item.sourceLicense ?? "Open Government Data, Quellenangabe",
      retrieved: candidate.hit.item.sourceRetrieved ?? null,
    } : source,
  }));
  const dimensions = DIMENSIONS.map((dimension) => {
    const items = factors.filter((factor) => factor.dimension === dimension.id);
    return {
      id: dimension.id, label: dimension.label, available: items.length > 0,
      score: items.length ? Math.round(items.reduce((sum, factor) => sum + factor.score, 0) / items.length) : null,
      factors: items, priority: priorities[dimension.id],
    };
  });
  const availableDimensions = dimensions.filter((dimension) => dimension.available);
  const priorityTotal = availableDimensions.reduce((sum, dimension) => sum + dimension.priority, 0);
  const score = availableDimensions.length >= 2
    ? Math.round(availableDimensions.reduce((sum, dimension) => sum + dimension.score * dimension.priority, 0) / priorityTotal)
    : null;
  const coverage = Math.round((availableDimensions.length / DIMENSIONS.length) * 100);
  const label = score == null ? "Noch zu wenig erfasst"
    : score >= 80 ? "Viele erfasste Ziele liegen nah"
      : score >= 60 ? "Mehrere erfasste Ziele liegen nah"
        : score >= 40 ? "Ein Teil der Ziele liegt weiter entfernt"
          : "Viele erfasste Ziele liegen weiter entfernt";

  return {
    score, label, coverage, availableDimensions: availableDimensions.length, totalDimensions: DIMENSIONS.length,
    factorCoverage: Math.round((factors.length / candidates.length) * 100), factors, dimensions, excluded, source, preferences: priorities,
    reason: score == null ? "Für eine Orientierung müssen mindestens zwei der drei Bereiche Daten enthalten." : null,
    model: "Wohnattraktivitäts-Orientierung aus der Nähe erfasster Orte; kein amtliches oder professionelles Immobilienrating.",
    dataCaveat: "Die Berechnung nutzt Luftlinien, keine Fusswege. OpenStreetMap kann unvollständig oder veraltet sein. Fehlende Einträge gelten nicht als negative Eigenschaft.",
    distanceBands: DISTANCE_BANDS,
  };
}
