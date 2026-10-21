// Laden der statischen Daten aus public/data/ mit Fortschrittsanzeige.

const DATA_BASE = "public/data/";

async function fetchChecked(name) {
  const response = await fetch(DATA_BASE + name);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response;
}

export const loadJson = async (name) => (await fetchChecked(name)).json();
export const loadBinary = async (name) => (await fetchChecked(name)).arrayBuffer();

export async function loadOptionalJson(name) {
  try { return await loadJson(name); } catch { return null; }
}

export async function loadOptionalBinary(name) {
  try { return await loadBinary(name); } catch { return null; }
}

export function parseDem(buffer, meta) {
  const { nx, ny, cell, min_e: minE, min_n: minN } = meta.dem.extent;
  const values = new Uint16Array(buffer);
  if (values.length !== nx * ny) throw new Error(`dem.bin: ${values.length} Werte, erwartet ${nx * ny}`);
  return { values, nx, ny, cell, minE, minN, scale: meta.dem.heightScale };
}

// Format siehe pipeline/process_buildings.py (Magic "BLD3", Version 2).
export const BUILDING_TABLE_STRIDE = 6; // vertexStart, vertexCount, indexStart, indexCount, faceStart, faceCount

export function parseBuildings(buffer, records) {
  const header = new Uint32Array(buffer, 0, 6);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== "BLD3" || header[1] !== 2) throw new Error("buildings3d.bin: unbekanntes Format (erwartet Version 2, Pipeline neu ausführen)");
  const [, , count, vertexCount, indexCount, faceCount] = header;
  if (count !== records.length) throw new Error(`buildings3d.bin (${count}) und buildings.json (${records.length}) passen nicht zusammen`);
  let offset = 24;
  const table = new Uint32Array(buffer, offset, count * BUILDING_TABLE_STRIDE); offset += count * BUILDING_TABLE_STRIDE * 4;
  const positions = new Float32Array(buffer, offset, vertexCount * 3); offset += vertexCount * 12;
  const indices = new Uint32Array(buffer, offset, indexCount); offset += indexCount * 4;
  const surfaces = new Uint8Array(buffer, offset, vertexCount); offset += vertexCount + ((4 - (vertexCount % 4)) % 4);
  const faces = new Uint32Array(buffer, offset, faceCount);
  return { count, vertexCount, indexCount, faceCount, table, positions, indices, surfaces, faces };
}

export function createProgress(onChange) {
  const tasks = new Map();
  return {
    add(name, weight = 1) { tasks.set(name, { weight, done: 0 }); return this; },
    finish(name, text) {
      const task = tasks.get(name);
      if (task) task.done = 1;
      let total = 0, done = 0;
      for (const t of tasks.values()) { total += t.weight; done += t.weight * t.done; }
      onChange(total ? done / total : 1, text);
    },
  };
}
