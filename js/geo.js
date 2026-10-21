// Koordinatentransformationen: LV95 <-> lokales Three.js-System <-> WGS84.
// WGS84/LV95 über die offiziellen swisstopo-Näherungsformeln (Genauigkeit ca. 1 m).

export function createFrame(meta) {
  const [originE, originN] = meta.dem.origin;
  const elevationOffset = meta.dem.elevationOffset;
  return {
    originE, originN, elevationOffset,
    toLocal(e, n, h = elevationOffset) { return { x: e - originE, y: h - elevationOffset, z: -(n - originN) }; },
    toLV95(x, z) { return { e: x + originE, n: originN - z }; },
    elevation(y) { return y + elevationOffset; },
  };
}

export function wgs84ToLv95(lat, lon) {
  const p = (lat * 3600 - 169028.66) / 10000;
  const l = (lon * 3600 - 26782.5) / 10000;
  const e = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3;
  const n = 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3;
  return { e, n };
}

export function lv95ToWgs84(e, n) {
  const y = (e - 2600000) / 1e6;
  const x = (n - 1200000) / 1e6;
  const l = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y ** 3;
  const p = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.0140 * x ** 3;
  return { lat: p * 100 / 36, lon: l * 100 / 36 };
}

export const formatLv95 = (e, n) => `${Math.round(e).toLocaleString("de-CH")} / ${Math.round(n).toLocaleString("de-CH")}`;
