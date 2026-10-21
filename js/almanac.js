// Almanach: Zahlen zur Gemeinde, Gebäude, Energie, Abstimmungen, Datenqualität und Quellen.
import { loadOptionalJson } from "./api.js";
import { esc } from "./inspector.js";
import { heatingGroup, buildYear } from "./buildings.js";

const fmt = (value, digits = 0) => (value == null || Number.isNaN(Number(value)) ? "–" : Number(value).toLocaleString("de-CH", { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const percent = (value, digits = 1) => (value == null ? "–" : `${fmt(value * 100, digits)} %`);
const stat = (value, label) => `<div class="stat"><div class="num">${value}</div><div class="note">${label}</div></div>`;

function bars(entries, color = "var(--accent)") {
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return `<div class="bars">${entries.map(([label, value, c]) => `<div class="bar"><div class="t"><i style="width:${(100 * value) / max}%;background:${c ?? color}"></i><span>${esc(label)}</span></div><div class="v num">${fmt(value)}</div></div>`).join("")}</div>`;
}
const count = (list, key) => [...list.reduce((m, x) => { const k = key(x); if (k != null) m.set(k, (m.get(k) ?? 0) + 1); return m; }, new Map())].sort((a, b) => b[1] - a[1]);

async function loadVotes() {
  const file = await loadOptionalJson("votes.json");
  if (!file) return { rows: [], retrieved: null };
  const rows = file.votes.map((v) => ({ ...v, date: `${v.date.slice(6)}.${v.date.slice(4, 6)}.${v.date.slice(0, 4)}` }));
  return { rows, retrieved: file.retrieved };
}

export async function initAlmanac(ctx) {
  const { $, meta, records } = ctx;
  const [statistics, sources, manifest] = await Promise.all([loadOptionalJson("statistics.json"), loadOptionalJson("sources.json"), loadOptionalJson("manifest.json")]);
  const modal = $("#almanac"), body = $("#almanac-body"), tabs = $("#almanac-tabs");
  const TABS = ["Übersicht", "Gebäude", "Energie", "Abstimmungen", "Datenqualität", "Quellen"];
  let votes = null;

  function overview() {
    const g = statistics?.gwr, m = ctx.municipality, b = meta.buildings;
    return `<div class="stats">
      ${stat(fmt(m?.areaHa), "Hektaren Gemeindefläche")}
      ${stat(fmt(g?.buildingsExisting), "bestehende Gebäude (GWR)")}
      ${stat(fmt(g?.dwellingsInExistingBuildings), "Wohnungen in Gebäuden mit Angabe")}
      ${stat(fmt(b?.count), "Gebäude im 3D-Modell")}
      ${stat(fmt(meta.trees?.count), "Bäume im Modell")}
      ${stat(`${fmt(meta.dem?.minHeight)}–${fmt(meta.dem?.maxHeight)} m`, "Höhenbereich im Modell")}
    </div>
    <p id="wiki" class="note">Einleitung wird geladen …</p>
    <p class="note">Alle Zahlen stammen aus offenen Quellen (Details unter «Quellen»). Fassaden und Fenster der Dorfansicht sind gestalterisch und keine Messung.</p>`;
  }
  function buildingsTab() {
    const g = statistics?.gwr;
    if (!g) return "<p>statistics.json fehlt (Pipeline: python -m pipeline.run_all export).</p>";
    return `<div class="cols"><div><h3>Gebäude nach Bauperiode (GWR)</h3>${bars(Object.entries(g.byPeriod).sort())}</div>
      <div><h3>Gebäude nach Klasse</h3>${bars(Object.entries(g.byClass).slice(0, 10))}</div></div>
      <p class="note">GWR-Stand ${esc(g.exportDate)}; nur bestehende Gebäude in ${esc(g.municipality)}.</p>`;
  }
  function energyTab() {
    const entries = count(records.filter((r) => r.inMunicipality), (r) => heatingGroup(r)?.label ?? "Keine Angabe im GWR");
    const years = records.filter((r) => buildYear(r)?.exact).length;
    return `<h3>Hauptenergieträger der Heizung (Gebäude im 3D-Modell)</h3>${bars(entries)}
      <p class="note">Für ${fmt(records.filter((r) => r.gwr?.heatEnergy).length)} von ${fmt(records.length)} Gebäuden ist der Energieträger im GWR erfasst. Solarpotenzial und installierte Leistung (BFE) sind in dieser Version nur über die Verknüpfung auf map.geo.admin.ch erreichbar (${fmt(years)} Gebäude mit exaktem Baujahr).</p>`;
  }
  async function votesTab() {
    body.innerHTML = '<p class="note">Lade Resultate der eidgenössischen Abstimmungen …</p>';
    votes ??= await loadVotes();
    if (!votes.rows.length) return '<p>Abstimmungsdaten fehlen (Pipeline: python -m pipeline.run_all votes). Resultate: <a href="https://www.bfs.admin.ch/bfs/de/home/statistiken/politik/abstimmungen.html" target="_blank" rel="noopener">BFS Abstimmungen</a>.</p>';
    return `<p class="note">Ja-Anteil in der Gemeinde (Balken) gegenüber Kanton Schwyz (Strich). Quelle: BFS voteinfo (Open Data), Stand der Datenabfrage ${votes.retrieved}. Einzelne Abstimmungstage fehlen, wenn die Quelle sie nicht liefert.</p>${votes.rows.map((r) => `
      <div class="vote"><div><div class="t">${esc(r.title)}</div><div class="note">${r.date}${r.turnout != null ? `, Stimmbeteiligung ${fmt(r.turnout, 1)} %` : ""}${r.accepted != null ? `, national ${r.accepted ? "angenommen" : "abgelehnt"}` : ""}</div></div>
      <div><div class="vbar"><i style="width:${r.local}%"></i>${r.canton != null ? `<b style="left:${r.canton}%"></b>` : ""}</div><div class="vlbl num"><span>${fmt(r.local, 1)} %</span><span>CH ${fmt(r.swiss)} %</span></div></div></div>`).join("")}`;
  }
  function quality() {
    const b = meta.buildings ?? {}, m = b.match ?? {}, t = meta.trees ?? {}, o = meta.osm ?? {};
    return `<div class="stats">
      ${stat(percent(m.coverageResidential?.rate), `Wohngebäude mit 3D-Modell (${fmt(m.coverageResidential?.covered)} von ${fmt(m.coverageResidential?.total)})`)}
      ${stat(percent(m.coverageFootprintOver40m2?.rate), "Gebäude ab 40 m² Grundfläche mit 3D-Modell")}
      ${stat(percent(m.coverageRate), "alle bestehenden GWR-Gebäude mit 3D-Modell")}
      ${stat(fmt(m.gwrWithout3dModel), "Registergebäude ohne 3D-Modell")}
      ${stat(fmt(m.demolishedStillIn3d), "als abgebrochen registrierte Gebäude, ausgeblendet")}
      ${stat(percent(t.validation?.osmTreesWithModelTreeWithin4m, 0), "OSM-Einzelbäume mit Modellbaum ≤ 4 m")}
    </div>
    <p class="note">Warum nicht 100 %: swissBUILDINGS3D enthält kaum Kleinbauten. Die fehlenden Registergebäude haben im Median 14 m² Grundfläche (meist Klasse «Sonstige Hochbauten» und Garagen). Sie sind unter «Register ohne 3D-Modell» schematisch zuschaltbar.</p>
    <dl class="src"><dt>Zuordnung 3D ↔ GWR</dt><dd>${fmt(m.joinedByEgid)} über EGID, ${fmt(m.joinedByLocation)} über die Lage (GWR-Koordinate im Grundriss)</dd>
      <dt>Dachfarbe</dt><dd>${fmt(b.withRoofColor)} Gebäude aus dem Luftbild abgeleitet</dd>
      <dt>Bäume</dt><dd>${fmt(t.fromVegetationModel)} aus dem Vegetationshöhenmodell, ${fmt(t.addedFromOsm)} aus OSM ergänzt (Kronenradius geschätzt)</dd>
      <dt>Strassenlaternen</dt><dd>${fmt(o.lamps?.osm)} aus OSM, ${fmt(o.lamps?.modelled)} entlang von Strassen mit «lit=yes» modelliert</dd>
      <dt>Eingabedateien</dt><dd>${manifest ? `${fmt(manifest.files.length)} Dateien mit SHA-256 in manifest.json (${esc(manifest.generated)})` : "manifest.json fehlt"}</dd></dl>`;
  }
  function sourcesTab() {
    if (!sources) return "<p>sources.json fehlt.</p>";
    return `<dl class="src">${sources.datasets.map((d) => `<dt>${esc(d.title)}</dt><dd>${esc(d.provider)} · ${esc(d.license)} · <a href="${esc(d.terms)}" target="_blank" rel="noopener">Bedingungen</a><br><span class="note">${esc(d.coverage ?? "")}${d.notes ? ` · ${esc(d.notes)}` : ""}</span></dd>`).join("")}</dl>`;
  }

  async function show(tab) {
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    if (tab === "Abstimmungen") body.innerHTML = await votesTab();
    else body.innerHTML = { "Übersicht": overview, "Gebäude": buildingsTab, "Energie": energyTab, "Datenqualität": quality, "Quellen": sourcesTab }[tab]();
    if (tab === "Übersicht") {
      fetch("https://de.wikipedia.org/api/rest_v1/page/summary/Ingenbohl").then((r) => (r.ok ? r.json() : null)).then((w) => {
        const el = $("#wiki");
        if (el && w?.extract) el.innerHTML = `${esc(w.extract)} <a href="https://de.wikipedia.org/wiki/Ingenbohl" target="_blank" rel="noopener">Wikipedia (CC BY-SA)</a>`; else if (el) el.textContent = "";
      }).catch(() => { const el = $("#wiki"); if (el) el.textContent = ""; });
    }
  }
  tabs.innerHTML = TABS.map((t) => `<button type="button" role="tab" data-tab="${t}" aria-selected="false">${t}</button>`).join("");
  tabs.addEventListener("click", (event) => { const t = event.target.closest("button")?.dataset.tab; if (t) show(t); });
  const open = (tab = "Übersicht") => { modal.hidden = false; show(tab); };
  $("#btn-almanac").addEventListener("click", () => open());
  $("#almanac-close").addEventListener("click", () => { modal.hidden = true; });
  modal.addEventListener("click", (event) => { if (event.target === modal) modal.hidden = true; });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") modal.hidden = true; });
  ctx.almanac = { open };
}
