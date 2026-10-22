// Transparent residential proximity score from existing OSM POIs and public-transport stops.
import { typeGroup } from "./buildings.js";

const FOOD_TYPES = new Set(["supermarket", "convenience", "bakery", "butcher", "greengrocer", "kiosk"]);
const RECREATION_TYPES = new Set(["park", "playground", "sports_centre", "pitch"]);
const DISTANCE_BANDS = [
  { max: 250, score: 5 },
  { max: 500, score: 4 },
  { max: 1000, score: 3 },
  { max: 2000, score: 2 },
  { max: Infinity, score: 1 },
];

function nearest(items, predicate, point) {
  let best = null;
  for (const item of items) {
    if (!predicate(item)) continue;
    const distance = Math.hypot(item.x - point.x, item.z - point.z);
    if (!best || distance < best.distance) best = { item, distance: Math.round(distance) };
  }
  return best;
}

function scoreDistance(distance) {
  return DISTANCE_BANDS.find((band) => distance <= band.max).score;
}

export function buildLocationRating({ record, frame, pois = [], stops = [], places = [], osmSource = null }) {
  const source = {
    provider: osmSource?.provider ?? "OpenStreetMap-Mitwirkende",
    license: osmSource?.license ?? "ODbL 1.0",
    retrieved: osmSource?.retrieved ?? null,
  };
  const place = frame && record?.center
    ? nearest(places, (item) => item.k === "town" || item.k === "village", frame.toLocal(record.center[0], record.center[1]))
    : null;
  const excluded = [
    {
      label: "Ortszentrum oder Dorfplatz",
      detail: place ? `Nächster OSM-Ortsnamenpunkt: ${place.item.n}, ${place.distance} m Luftlinie. Kein verifizierter Dorfplatz oder amtlicher Mittelpunkt.` : "Kein verifizierter Zentrumspunkt im Datenbestand.",
      possibleSource: "Gemeinde- oder Ortskernpunkt",
    },
    { label: "ÖV-Güteklasse", detail: "Die ARE-Klassierung ist nicht integriert.", possibleSource: "ARE, ÖV-Güteklassen" },
    { label: "Sonnenstunden", detail: "Kein gebäudebezogenes Besonnungsmodell vorhanden.", possibleSource: "Gebäude- und Geländeschattensimulation" },
    { label: "Ozon", detail: "Die regionale Modellkarte ist noch nicht zeitlich ausgewertet; sie wird nicht als Gebäudeexposition interpretiert.", possibleSource: "BAFU-Ozonkarte" },
  ];

  if (typeGroup(record)?.id !== "wohnen") {
    return { score: null, label: "Kein passendes Ratingmodell", coverage: 0, factors: [], totalFactors: 5, excluded, source, reason: "Das verfügbare Ratingmodell ist nur für Wohngebäude definiert." };
  }
  if (!record.inMunicipality) {
    return { score: null, label: "Nicht bewertet", coverage: 0, factors: [], totalFactors: 5, excluded, source, reason: "Das Wohnlagenmodell ist auf Gebäude innerhalb Ingenbohls begrenzt." };
  }
  if (!frame || !record.center) {
    return { score: null, label: "Nicht bewertet", coverage: 0, factors: [], totalFactors: 5, excluded, source, reason: "Für dieses Gebäude fehlen Koordinaten." };
  }

  const point = frame.toLocal(record.center[0], record.center[1]);
  const food = nearest(pois, (poi) => FOOD_TYPES.has(poi.s), point);
  const school = nearest(pois, (poi) => poi.s === "school", point);
  const bus = nearest(stops, (stop) => stop.m === "bus", point);
  const rail = nearest(stops, (stop) => stop.m === "train", point);
  const recreation = nearest(pois, (poi) => RECREATION_TYPES.has(poi.s), point);
  const candidates = [
    { label: "Lebensmittel", weight: 25, hit: food, sourceLabel: "OSM-POI", name: (item) => item.n },
    { label: "Schule", weight: 20, hit: school, sourceLabel: "OSM-POI", name: (item) => item.n },
    { label: "Bushaltestelle", weight: 25, hit: bus, sourceLabel: "ÖV-Haltestelle (OSM)", name: (item) => item.n },
    { label: "Bahnhof", weight: 20, hit: rail, sourceLabel: "ÖV-Haltestelle (OSM)", name: (item) => item.n },
    { label: "Freizeit und Erholung", weight: 10, hit: recreation, sourceLabel: "OSM-Freizeit-POI", name: (item) => item.n },
  ];
  const factors = candidates.filter((candidate) => candidate.hit).map((candidate) => ({
    label: candidate.label,
    name: candidate.name(candidate.hit.item),
    distance: candidate.hit.distance,
    score: scoreDistance(candidate.hit.distance),
    weight: candidate.weight,
    sourceLabel: candidate.sourceLabel,
    source,
  }));
  const availableWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const coverage = Math.round(availableWeight);
  const score = factors.length >= 4 && availableWeight >= 80
    ? Math.round((10 * factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0)) / availableWeight) / 10
    : null;
  const label = score == null ? "Zu wenige Daten" : score >= 4.2 ? "Sehr gute Nähe" : score >= 3.4 ? "Gute Nähe" : score >= 2.6 ? "Mittlere Nähe" : score >= 1.8 ? "Eher weite Distanzen" : "Weite Distanzen";

  return {
    score, label, coverage, factors, totalFactors: candidates.length, excluded, source,
    reason: score == null ? "Mindestens vier Kriterien und 80 % Gewichtungsabdeckung sind für einen Score nötig." : null,
    model: "Wohnlagenmodell · gewichteter Mittelwert; Gewichte werden über die verfügbaren Kriterien normalisiert",
    dataCaveat: "OSM-Vollständigkeit und Aktualität sind nicht garantiert. Alle Distanzen sind Luftlinie.",
    distanceBands: DISTANCE_BANDS,
  };
}
