// Kanton Schwyz, A083a Baustellen (Kantonsstrassen); WFS-Layer ms:ch.sz.a083a.baustellen.erweitert
const WFS_URL = "https://map.geo.sz.ch/mapserv_proxy";
const LAYER = "ms:ch.sz.a083a.baustellen.erweitert";
const MS_NS = "http://mapserver.gis.umn.edu/mapserver";
const GML_NS = "http://www.opengis.net/gml/3.2";

export const CONSTRUCTION_LEVELS = Object.freeze({
  gering: { label: "Geringe Behinderung", color: "#f2c230" },
  mittel: { label: "Mittlere Behinderung", color: "#f08a24" },
  stark: { label: "Starke Behinderung", color: "#d62828" },
  unbekannt: { label: "Behinderung nicht angegeben", color: "#8a8f98" },
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

export function drawConstructionSites(canvas, sites, extent) {
  const ctx = canvas.getContext("2d");
  const scale = canvas.width / (extent.maxE - extent.minE);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const path = (site) => {
    ctx.beginPath();
    for (const line of site.lines) line.forEach(([e, n], i) => {
      const x = (e - extent.minE) * scale, y = (extent.maxN - n) * scale;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
  };
  const today = new Date().toISOString().slice(0, 10);
  for (const site of sites) {
    if (constructionStatus(site, today) === "abgeschlossen") continue;
    const planned = constructionStatus(site, today) === "geplant";
    path(site); ctx.setLineDash([]); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(7, 22 * scale); ctx.globalAlpha = 0.95; ctx.stroke();
    path(site); ctx.strokeStyle = CONSTRUCTION_LEVELS[site.level].color; ctx.lineWidth = Math.max(4, 14 * scale);
    ctx.setLineDash(planned ? [ctx.lineWidth * 1.6, ctx.lineWidth] : []); ctx.stroke();
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
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

export function renderConstructionLegend(container) {
  const list = document.createElement("ul");
  list.className = "construction-legend";
  for (const level of Object.values(CONSTRUCTION_LEVELS)) {
    const item = document.createElement("li");
    const swatch = document.createElement("i");
    swatch.style.cssText = `display:inline-block;width:22px;height:6px;border-radius:3px;margin-right:8px;vertical-align:middle;background:${level.color}`;
    item.append(swatch, level.label);
    list.append(item);
  }
  const planned = document.createElement("li");
  planned.textContent = "Gestrichelt: noch nicht begonnen";
  list.append(planned);
  container.append(list);
}
