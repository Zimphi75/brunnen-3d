// Informationspanel für ausgewählte Objekte. Alle Texte werden maskiert (Daten stammen aus externen Quellen).
import { buildYear, typeGroup } from "./buildings.js";
import { formatLv95, lv95ToWgs84 } from "./geo.js";

export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (value, digits = 0) => Number(value).toLocaleString("de-CH", { maximumFractionDigits: digits, minimumFractionDigits: digits });

const OBJECT_TYPES = {
  "Gebaeude Einzelhaus": "Gebäude (Einzelhaus)", "Lagertank": "Lagertank", "Im Bau": "Gebäude im Bau", "Mauer gross": "Grosse Mauer",
  "Kapelle": "Kapelle", "Hochhaus": "Hochhaus", "Treibhaus": "Treibhaus", "Sakrales Gebaeude": "Sakralgebäude",
  "Bruecke gedeckt": "Gedeckte Brücke", "Hochkamin": "Hochkamin", "Sakraler Turm": "Sakraler Turm", "Turm": "Turm",
};
const MISSING = '<span class="tag">nicht erfasst</span>';

export function createInspector({ panel, body, closeButton, codes, onClose }) {
  closeButton.addEventListener("click", () => { hide(); onClose?.(); });

  function hide() { panel.hidden = true; }

  function render({ title, sub, tags = [], sections = [], source, links = [] }) {
    body.innerHTML = `
      <h3>${esc(title)}</h3>
      <div class="sub">${esc(sub ?? "")}</div>
      ${tags.length ? `<div>${tags.map((t) => `<span class="tag ${t.warn ? "warn" : ""}">${esc(t.text)}</span>`).join(" ")}</div>` : ""}
      ${sections.map((rows) => `<dl>${rows.map(([k, v, raw]) => `<dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd>`).join("")}</dl>`).join("")}
      ${links.length ? `<p>${links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(" · ")}</p>` : ""}
      ${source ? `<div class="src">Quelle: ${esc(source)}</div>` : ""}`;
    panel.hidden = false;
  }

  function showBuilding(record, { addresses = [], elevationOffset = 0 } = {}) {
    const gwr = record.gwr ?? {};
    const year = buildYear(record);
    const group = typeGroup(record);
    const classText = gwr.class ? codes.GKLAS?.[gwr.class] ?? `Code ${gwr.class}` : null;
    const categoryText = gwr.category ? codes.GKAT?.[gwr.category] ?? `Code ${gwr.category}` : null;
    const heat = gwr.heatGenerator ? codes.GWAERZH1?.[gwr.heatGenerator] ?? `Code ${gwr.heatGenerator}` : null;
    const wgs = lv95ToWgs84(record.center[0], record.center[1]);
    const row = (label, value, digits) => [label, value == null ? MISSING : digits === undefined ? value : fmt(value, digits), value == null];
    render({
      title: addresses[0] ?? record.name ?? OBJECT_TYPES[record.type] ?? record.type,
      sub: addresses.length > 1 ? `${addresses.length} Adressen: ${addresses.slice(1, 4).join("; ")}${addresses.length > 4 ? " …" : ""}` : OBJECT_TYPES[record.type] ?? record.type,
      tags: [
        ...(group ? [{ text: group.label }] : []),
        ...(record.inMunicipality ? [] : [{ text: "Ausserhalb Ingenbohl", warn: true }]),
        ...(!record.gwr ? [{ text: "Kein GWR-Eintrag verknüpft", warn: true }] : []),
      ],
      sections: [
        [
          ["Gebäudeklasse", classText ?? MISSING, !classText],
          ["Kategorie", categoryText ?? MISSING, !categoryText],
          ["Baujahr", year ? (year.exact ? String(year.year) : `Periode ${year.label}`) : MISSING, !year],
          row("Stockwerke", gwr.floors),
          row("Wohnungen", gwr.dwellings),
          ["Heizung", heat ?? MISSING, !heat],
        ],
        [
          row("Gesamthöhe (m)", record.height, 1),
          row("Dachhöhe max. (m ü. M.)", record.roofMax, 1),
          row("Gelände am Gebäude (m ü. M.)", record.groundElevation, 1),
          row("Grundfläche 3D-Modell (m²)", record.footprintArea, 0),
          row("Grundfläche GWR (m²)", gwr.footprintAreaGwr, 0),
          row("Volumen GWR (m³)", gwr.volumeGwr, 0),
        ],
        [
          ["EGID", record.egid ?? MISSING, record.egid == null],
          ["LV95", formatLv95(record.center[0], record.center[1])],
          ["WGS84", `${wgs.lat.toFixed(5)}, ${wgs.lon.toFixed(5)}`],
        ],
      ],
      links: [{ label: "map.geo.admin.ch", href: `https://map.geo.admin.ch/#/map?lang=de&center=${record.center[0]},${record.center[1]}&z=12&bgLayer=ch.swisstopo.swissimage` }],
      source: "swisstopo swissBUILDINGS3D 3.0 beta, BFS GWR (Gebäude- und Wohnungsregister)",
    });
  }

  return { render, showBuilding, hide, showGeneric: render };
}
