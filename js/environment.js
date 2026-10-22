// On-demand environmental context from official GeoAdmin raster layers.
const IDENTIFY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify";
const WMS_URL = "https://wms.geo.admin.ch/";
const REQUEST_TIMEOUT_MS = 8000;

async function getJson(url, fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function unavailable(id, label, reason) {
  return { id, label, available: false, reason, inRating: false };
}

async function queryRadon(east, north, fetcher) {
  const params = new URLSearchParams({
    geometry: `${east},${north}`, geometryType: "esriGeometryPoint", layers: "all:ch.bag.radonkarte", sr: "2056", lang: "de", tolerance: "10",
    mapExtent: `${east - 100},${north - 100},${east + 100},${north + 100}`, imageDisplay: "200,200,96", returnGeometry: "true",
  });
  const data = await getJson(`${IDENTIFY_URL}?${params}`, fetcher);
  const feature = data?.results?.find((item) => Number.isFinite(Number(item.attributes?.probability_prozent)));
  if (!feature) return unavailable("radon", "Radon", "Kein Kartenwert für diesen Standort zurückgegeben.");
  const box = feature.bbox ?? [];
  const resolution = box.length === 4 ? Math.round(Math.max(box[2] - box[0], box[3] - box[1])) : null;
  return {
    id: "radon", label: "Radon", available: true, inRating: false,
    value: Number(feature.attributes.probability_prozent), unit: "%",
    detail: "Modellierte Wahrscheinlichkeit, den BAG-Referenzwert von 300 Bq/m³ zu überschreiten. Keine Messung im Gebäude.",
    source: "BAG-Radonkarte · GeoAdmin", resolutionM: resolution, confidenceIndex: feature.attributes.confidence,
  };
}

async function queryRaster(layer, east, north, fetcher) {
  const params = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetFeatureInfo", LAYERS: layer, QUERY_LAYERS: layer, STYLES: "", CRS: "EPSG:2056",
    BBOX: `${east - 100},${north - 100},${east + 100},${north + 100}`, WIDTH: "256", HEIGHT: "256", I: "128", J: "128",
    FORMAT: "image/png", INFO_FORMAT: "application/json", FEATURE_COUNT: "3",
  });
  const data = await getJson(`${WMS_URL}?${params}`, fetcher);
  const features = data?.features ?? [];
  return features.map((feature) => {
    const [x, y] = feature.geometry?.coordinates ?? [NaN, NaN];
    return { value: Number(feature.properties?.value_0), x, y, distance: Math.hypot(x - east, y - north) };
  }).filter((feature) => Number.isFinite(feature.value) && Number.isFinite(feature.distance)).sort((a, b) => a.distance - b.distance)[0] ?? null;
}

async function queryNoise(id, label, layer, period, east, north, fetcher) {
  const sample = await queryRaster(layer, east, north, fetcher);
  if (!sample) return unavailable(id, label, "Kein Lärmrasterwert für diesen Standort zurückgegeben.");
  return {
    id, label, available: true, inRating: false, value: sample.value, unit: "dB(A)",
    detail: `Modellierter Rasterwert ${period}; Referenzjahr 2021; nächster Rasterpunkt ${Math.round(sample.distance)} m vom Gebäudemittelpunkt. Nicht rechtsverbindlich.`,
    source: "BAFU-Lärmkarte · GeoAdmin", referenceYear: 2021, resolutionM: 10,
  };
}

async function querySoil(id, label, layer, east, north, fetcher) {
  const sample = await queryRaster(layer, east, north, fetcher);
  if (!sample) return unavailable(id, label, "Kein Bodenatlaswert für diesen Standort zurückgegeben.");
  return {
    id, label, available: true, inRating: false, value: sample.value, unit: "mg/kg Feinerde",
    detail: `Interpolierter Wert im Oberboden 0–20 cm; Rasterzelle rund 1 km, nächster Kartenpunkt ${Math.round(sample.distance)} m vom Gebäude. Probenahme 2011–2015; keine parzellenscharfe Aussage.`,
    source: "Geochemischer Bodenatlas Schweiz · BAFU/Agroscope", referencePeriod: "2011–2015", resolutionM: 1000,
  };
}

export async function fetchBuildingEnvironment(center, fetcher = fetch) {
  if (!Array.isArray(center) || center.length < 2 || !center.every(Number.isFinite)) {
    return { status: "ready", fetchedAt: new Date().toISOString(), indicators: [], error: "Für dieses Gebäude fehlen LV95-Koordinaten." };
  }
  const [east, north] = center;
  const indicators = await Promise.all([
    queryRadon(east, north, fetcher),
    queryNoise("road-day", "Strassenlärm am Tag", "ch.bafu.laerm-strassenlaerm_tag", "Tag", east, north, fetcher),
    queryNoise("road-night", "Strassenlärm in der Nacht", "ch.bafu.laerm-strassenlaerm_nacht", "Nacht", east, north, fetcher),
    queryNoise("rail-day", "Bahnlärm am Tag", "ch.bafu.laerm-bahnlaerm_tag", "Tag", east, north, fetcher),
    queryNoise("rail-night", "Bahnlärm in der Nacht", "ch.bafu.laerm-bahnlaerm_nacht", "Nacht", east, north, fetcher),
    querySoil("arsenic", "Arsen im Oberboden", "ch.bafu.geochemischer-bodenatlas_schweiz_arsen", east, north, fetcher),
    querySoil("cadmium", "Cadmium im Oberboden", "ch.bafu.geochemischer-bodenatlas_schweiz_cadmium", east, north, fetcher),
    querySoil("lead", "Blei im Oberboden", "ch.bafu.geochemischer-bodenatlas_schweiz_blei", east, north, fetcher),
  ]);
  return { status: "ready", fetchedAt: new Date().toISOString(), indicators };
}
