import * as THREE from "three";

// Kanton Schwyz, A083a Baustellen (Kantonsstrassen); WFS-Layer ms:ch.sz.a083a.baustellen.erweitert
const WFS_URL = "https://map.geo.sz.ch/mapserv_proxy";
const LAYER = "ms:ch.sz.a083a.baustellen.erweitert";
const MS_NS = "http://mapserver.gis.umn.edu/mapserver";
const GML_NS = "http://www.opengis.net/gml/3.2";

export const CONSTRUCTION_LEVELS = Object.freeze({
  gering: { label: "Baustelle: geringe Behinderung", color: "#f2c230" },
  mittel: { label: "Baustelle: mittlere Behinderung", color: "#f08a24" },
  stark: { label: "Baustelle: starke Behinderung", color: "#d62828" },
  unbekannt: { label: "Baustelle: Behinderung nicht angegeben", color: "#8a8f98" },
});

export function constructionUrl() {
  const params = new URLSearchParams({
    SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature", TYPENAMES: LAYER, SRSNAME: "urn:ogc:def:crs:EPSG::2056",
  });
  return `${WFS_URL}?${params}`;
}

function plainText(html) {
  return String(html ?? "").replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").replace(/(,\s*)+$/, "").trim();
}

function safeLink(html) {
  const href = /href\s*=\s*["']([^"']+)["']/i.exec(String(html ?? ""))?.[1]?.replace(/&amp;/g, "&");
  try {
    const url = new URL(href);
    return url.protocol === "https:" && /(^|\.)sz\.ch$/.test(url.hostname) ? url.href : null;
  } catch { return null; }
}

export function parseConstructionSites(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Ungültige Baustellenantwort");
  const sites = [];
  for (const feature of doc.getElementsByTagNameNS("http://www.opengis.net/wfs/2.0", "member")) {
    const element = feature.firstElementChild;
    if (!element) continue;
    const field = (name) => element.getElementsByTagNameNS(MS_NS, name)[0]?.textContent ?? "";
    const lines = [...element.getElementsByTagNameNS(GML_NS, "posList")].map((node) => {
      const values = node.textContent.trim().split(/\s+/).map(Number);
      const points = [];
      for (let i = 0; i + 1 < values.length; i += 2) points.push([values[i], values[i + 1]]);
      return points;
    }).filter((points) => points.length > 1 && points.every(([e, n]) => Number.isFinite(e) && Number.isFinite(n)));
    if (!lines.length) continue;
    const note = plainText(field("behinderungsbemerkung"));
    const levelKey = note.split(":")[0].trim().toLowerCase();
    sites.push({
      name: plainText(field("lokalname")) || "Baustelle", start: field("baubeginn"), end: field("bauende"),
      description: plainText(field("beschreibung")), impact: note, level: CONSTRUCTION_LEVELS[levelKey] && levelKey !== "unbekannt" ? levelKey : "unbekannt",
      contact: plainText(field("kontaktbauleitung")), authority: plainText(field("kontakttba")), link: safeLink(field("link")), lines,
    });
  }
  return sites;
}

export function constructionStatus(site, today = new Date().toISOString().slice(0, 10)) {
  if (site.start && site.start > today) return "geplant";
  if (site.end && site.end < today) return "abgeschlossen";
  return "laufend";
}

function segmentDistance(e, n, [e1, n1], [e2, n2]) {
  const de = e2 - e1, dn = n2 - n1, length2 = de * de + dn * dn;
  const t = length2 ? Math.max(0, Math.min(1, ((e - e1) * de + (n - n1) * dn) / length2)) : 0;
  return Math.hypot(e - (e1 + t * de), n - (n1 + t * dn));
}

export function nearestConstructionSite(sites, e, n, maxDistance = 30) {
  let best = null, bestDistance = maxDistance;
  for (const site of sites) for (const line of site.lines) for (let i = 1; i < line.length; i++) {
    const distance = segmentDistance(e, n, line[i - 1], line[i]);
    if (distance <= bestDistance) { best = site; bestDistance = distance; }
  }
  return best;
}

export function sitesInExtent(sites, extent) {
  return sites.filter((site) => site.lines.some((line) => line.some(([e, n]) => e >= extent.minE && e <= extent.maxE && n >= extent.minN && n <= extent.maxN)));
}

const RIBBON_WIDTH = 7, RIBBON_LIFT = 1.6, RIBBON_STEP = 6;

// Schneidet Linien am Kartenausschnitt ab; Punkte ausserhalb haben keine Geländehöhe.
export function clipLines(lines, extent) {
  const inside = ([e, n]) => e >= extent.minE && e <= extent.maxE && n >= extent.minN && n <= extent.maxN;
  const result = [];
  for (const line of lines) {
    let current = [];
    for (const point of line) {
      if (inside(point)) current.push(point);
      else { if (current.length > 1) result.push(current); current = []; }
    }
    if (current.length > 1) result.push(current);
  }
  return result;
}

function ribbonGeometry(line, width, lift, terrain, frame) {
  const points = [];
  for (let i = 1; i < line.length; i++) {
    const [e1, n1] = line[i - 1], [e2, n2] = line[i];
    const parts = Math.max(1, Math.ceil(Math.hypot(e2 - e1, n2 - n1) / RIBBON_STEP));
    for (let k = 0; k < parts; k++) points.push(frame.toLocal(e1 + (e2 - e1) * k / parts, n1 + (n2 - n1) * k / parts));
  }
  const last = line[line.length - 1];
  points.push(frame.toLocal(last[0], last[1]));
  const positions = [], indices = [];
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / length * width / 2, nz = (b.x - a.x) / length * width / 2;
    for (const side of [-1, 1]) {
      const x = p.x + nx * side, z = p.z + nz * side;
      positions.push(x, (terrain.heightAt(x, z) ?? terrain.heightAt(p.x, p.z) ?? 0) + lift, z);
    }
    if (i) { const v = i * 2; indices.push(v - 2, v - 1, v, v - 1, v + 1, v); }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

// Geländefolgende Bänder statt Textur: bei jedem Zoom scharf und auf der Strassenbreite.
export function buildRibbons(items, terrain, frame) {
  const group = new THREE.Group();
  group.name = "ribbons";
  const material = (color, opacity, order) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -4 - order, polygonOffsetUnits: -4 - order,
  });
  for (const { lines, color, opacity = 1, width = RIBBON_WIDTH } of items) {
    const casing = material("#ffffff", 0.9, 0), fill = material(color, opacity, 1);
    for (const line of lines) {
      const outer = new THREE.Mesh(ribbonGeometry(line, width + 3, RIBBON_LIFT, terrain, frame), casing);
      const inner = new THREE.Mesh(ribbonGeometry(line, width, RIBBON_LIFT + 0.15, terrain, frame), fill);
      outer.renderOrder = 9; inner.renderOrder = 10;
      outer.frustumCulled = inner.frustumCulled = false;
      group.add(outer, inner);
    }
  }
  return group;
}

export function buildConstructionRibbons(sites, terrain, frame) {
  const today = new Date().toISOString().slice(0, 10);
  return buildRibbons(sites.filter((site) => constructionStatus(site, today) !== "abgeschlossen").map((site) => ({
    lines: site.lines, color: CONSTRUCTION_LEVELS[site.level].color, opacity: constructionStatus(site, today) === "geplant" ? 0.6 : 1,
  })), terrain, frame);
}

export function renderConstructionInfo(container, site) {
  container.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = site.name;
  const status = constructionStatus(site);
  const rows = [
    ["Status", status === "laufend" ? "Laufende Baustelle" : status === "geplant" ? "Geplante Baustelle" : "Abgeschlossen"],
    ["Bauzeit", [site.start, site.end].filter(Boolean).join(" bis ")],
    ["Arbeiten", site.description],
    ["Verkehr", site.impact],
    ["Bauleitung", site.contact],
    ["Tiefbauamt", site.authority],
  ].filter(([, value]) => value);
  const list = document.createElement("dl");
  for (const [label, value] of rows) {
    const term = document.createElement("dt"), detail = document.createElement("dd");
    term.textContent = label; detail.textContent = value; list.append(term, detail);
  }
  container.append(heading, list);
  if (site.link) {
    const link = document.createElement("a");
    link.href = site.link; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Beilage öffnen";
    container.append(link);
  }
  const note = document.createElement("p");
  note.textContent = "Quelle: Tiefbauamt Kanton Schwyz, Baustellen auf Kantonsstrassen (länger als 5 Tage). Gemeindestrassen sind nicht enthalten.";
  container.append(note);
}

export function renderConstructionLegend(container, extra = []) {
  renderLegend(container, [...extra, ...Object.values(CONSTRUCTION_LEVELS)], "Blasser: noch nicht begonnen");
}

export function renderLegend(container, entries, footnote) {
  const list = document.createElement("ul");
  list.className = "construction-legend";
  list.style.cssText = "list-style:none;margin:6px 0 0;padding:0;font-size:0.72rem;line-height:1.4";
  for (const level of entries) {
    const item = document.createElement("li");
    const swatch = document.createElement("i");
    swatch.style.cssText = `display:inline-block;width:22px;height:10px;border-radius:3px;margin-right:8px;vertical-align:middle;background:${level.color}`;
    item.append(swatch, level.label);
    list.append(item);
  }
  if (footnote) {
    const planned = document.createElement("li");
    planned.textContent = footnote;
    list.append(planned);
  }
  container.append(list);
}
