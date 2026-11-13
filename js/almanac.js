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
  const rows = [...file.votes].sort((a, b) => b.date.localeCompare(a.date));
  return { rows, retrieved: file.retrieved };
}

const voteDate = (date) => `${date.slice(6)}.${date.slice(4, 6)}.${date.slice(0, 4)}`;
const voteShare = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
const isTieBreak = (row) => /Stichfrage/i.test(row.title);
const localDecision = (row) => isTieBreak(row) || !voteShare(row.local) ? "unknown" : row.local > 50 ? "accepted" : "rejected";

export function voteTitle(title) {
  const short = title.trim().match(/\(([^()]+)\)[»\s]*$/)?.[1];
  return short?.replace(/,\s*[A-ZÄÖÜ][A-ZÄÖÜ\d-]*$/, "") ?? title.replace(/^(?:Volksinitiative\s+|Änderung des |Bundesgesetz über |Bundesbeschluss über )/, "").replace(/^«|»\s*$/g, "");
}

export function renderVote(row) {
  const decision = localDecision(row), local = voteShare(row.local), swiss = voteShare(row.swiss);
  const tieBreak = isTieBreak(row);
  const result = decision === "accepted" ? "Angenommen" : decision === "rejected" ? "Abgelehnt" : tieBreak ? "Stichfrage" : "Ergebnis fehlt";
  const delta = local && swiss ? Math.round((row.local - row.swiss) * 10) / 10 : null;
  const comparison = tieBreak ? "Kein Ja-/Nein-Vergleich bei Stichfragen" : delta == null ? "Schweizer Vergleich nicht verfügbar" : delta === 0 ? "Gleicher Ja-Anteil wie die Schweiz" : `${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta), 1)} Prozentpunkte Ja gegenüber der Schweiz`;
  const shares = (value) => `<span>Ja <strong class="num">${fmt(value, 1)} %</strong></span><span>Nein <strong class="num">${fmt(100 - value, 1)} %</strong></span>`;
  return `<article class="vote" data-decision="${decision}">
    <div class="vote-heading"><h3>${esc(voteTitle(row.title))}</h3><time datetime="${row.date.slice(0, 4)}-${row.date.slice(4, 6)}-${row.date.slice(6)}">${voteDate(row.date)}</time></div>
    <div class="vote-local"><strong>Ingenbohl</strong><strong class="vote-result">${result}</strong></div>
    ${local && !tieBreak ? `<div class="vote-shares">${shares(row.local)}</div><div class="vote-bar" aria-hidden="true"><span style="width:${row.local}%"></span></div>` : `<p class="note">${tieBreak ? "Die Quelle ordnet den erfassten Anteil keiner Antwortoption zu." : "Kein Gemeindeanteil verfügbar."}</p>`}
    <p class="vote-delta">${comparison}</p>
    ${swiss && !tieBreak ? `<div class="vote-swiss"><span>Schweiz · Ja <span class="num">${fmt(row.swiss, 1)} %</span></span><div class="vote-bar" aria-hidden="true"><span style="width:${row.swiss}%"></span></div></div>` : ""}
    <details class="vote-details"><summary>Details und Volltitel</summary>
      <p class="vote-full-title">${esc(row.title)}</p>
      <dl><dt>Abstimmungsdatum</dt><dd>${voteDate(row.date)}</dd>
        <dt>Stimmbeteiligung Ingenbohl</dt><dd>${row.turnout != null ? `${fmt(row.turnout, 1)} %` : "Keine Angabe"}</dd>
        <dt>${tieBreak ? "Ingenbohl · erfasster Anteil" : "Ingenbohl · Entscheid"}</dt><dd>${tieBreak ? `${fmt(row.local, 1)} % (Antwortoption unbekannt)` : result}${row.local === 50 && !tieBreak ? " (keine Ja-Mehrheit)" : ""}</dd>
        <dt>Schweiz · ${tieBreak ? "erfasster Anteil" : "Stimmenanteile"}</dt><dd>${tieBreak ? `${fmt(row.swiss, 1)} % (Antwortoption unbekannt)` : swiss ? shares(row.swiss) : "Keine Angabe"}</dd>
        ${!tieBreak ? `<dt>Schweiz · nationaler Entscheid</dt><dd>${row.accepted == null ? "Keine Angabe" : row.accepted ? "Angenommen" : "Abgelehnt"}</dd>` : ""}
        <dt>Kanton Schwyz · ${tieBreak ? "erfasster Anteil" : "Ja-Anteil"}</dt><dd>${voteShare(row.canton) ? `${fmt(row.canton, 1)} %` : "Keine Angabe"}</dd>
      </dl>
    </details>
  </article>`;
}

export async function initAlmanac(ctx) {
  const { $, meta, records } = ctx;
  const [statistics, sources, manifest] = await Promise.all([loadOptionalJson("statistics.json"), loadOptionalJson("sources.json"), loadOptionalJson("manifest.json")]);
  ctx.sources = sources;
  const modal = $("#almanac"), body = $("#almanac-body"), tabs = $("#almanac-tabs");
  const TABS = ["Übersicht", "Gebäude", "Grundstücke", "Energie", "Abstimmungen", "Datenqualität", "Quellen"];
  const imprintAddress = ctx.addresses?.find(([label]) => label === "Parkstrasse 29, 6440 Brunnen");
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
    <p class="note">Alle Zahlen stammen aus offenen Quellen (Details unter «Quellen»). Fassaden und Fenster der Dorfansicht sind gestalterisch und keine Messung.</p>
    <p class="almanac-intro"><button type="button" class="btn" data-intro-open>Intro-Video ansehen (1:32)</button> <a href="intro/">Link zum Teilen</a></p>
    <section class="imprint" aria-labelledby="imprint-title">
      <h3 id="imprint-title">Impressum</h3>
      <p><strong>Brunnen 3D – Eine private 3D-Visualisierung</strong></p>
      <p>Diese Webapplikation wurde von mir, Philipp Zimmermann, als privates Projekt eigenständig entwickelt. Sie dient der interaktiven Erkundung und Visualisierung von Brunnen und der Gemeinde Ingenbohl.</p>
      <p>Das Projekt verfolgt ausschliesslich nichtkommerzielle Zwecke und steht in keiner offiziellen Verbindung zur Gemeinde Ingenbohl oder zu den verwendeten Datenanbietern.</p>
      <h4>Verantwortlich für den Inhalt</h4>
      <address>Philipp Zimmermann<br>
        <span class="imprint-address">Parkstrasse 29
          <button type="button" class="icon-btn imprint-location" data-imprint-action="location" aria-label="Parkstrasse 29 im 3D-Modell anzeigen" title="Parkstrasse 29 im 3D-Modell anzeigen"${imprintAddress && ctx.searchChoose ? "" : " disabled"}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="2.5"/></svg>
          </button>
        </span><br>6440 Brunnen<br>Schweiz
      </address>
      <h4>Kontakt</h4>
      <p>Für Fragen, Anregungen oder Hinweise freue ich mich über eine Nachricht.</p>
      <p class="imprint-contact">E-Mail: <button type="button" class="btn" data-imprint-action="email">E-Mail anzeigen</button></p>
      <h4>Haftung und Datenquellen</h4>
      <p>Die dargestellten geografischen Daten, Gebäudeinformationen und Simulationen können Ungenauigkeiten enthalten. Es besteht kein Anspruch auf Vollständigkeit oder Richtigkeit.</p>
      <p>Die verwendeten Datenquellen und entsprechenden Quellenhinweise werden separat ausgewiesen.</p>
      <h4>Quellcode</h4>
      <p class="imprint-source">Gebaut mit <a href="https://github.com/Zimphi75/brunnen-3d" target="_blank" rel="noopener">brunnen-3d</a> (Open Source, MIT-Lizenz). Eigene Gemeinde damit gebaut? <a href="https://github.com/Zimphi75/brunnen-3d/issues/3" target="_blank" rel="noopener">Zeig deine Welt</a>.</p>
    </section>`;
  }
  function buildingsTab() {
    const g = statistics?.gwr;
    if (!g) return "<p>statistics.json fehlt (Pipeline: python -m pipeline.run_all export).</p>";
    return `<div class="cols"><div><h3>Gebäude nach Bauperiode (GWR)</h3>${bars(Object.entries(g.byPeriod).sort())}</div>
      <div><h3>Gebäude nach Klasse</h3>${bars(Object.entries(g.byClass).slice(0, 10))}</div></div>
      <p class="note">GWR-Stand ${esc(g.exportDate)}; nur bestehende Gebäude in ${esc(g.municipality)}.</p>`;
  }
  function parcelsTab() {
    const p = meta.parcels;
    if (!p?.file) return "<p>Parzellendaten fehlen (Pipeline: python -m pipeline.run_all parcels).</p>";
    const features = ctx.parcels?.planning ?? [];
    const featureCounts = count(features, (feature) => feature.kind === "grundnutzung" ? "Grundnutzung" : "Überlagernde Festlegung");
    const buildingsWithPlanning = records.filter((record) => record.landUse?.length).length;
    return `<div class="stats">
      ${stat(fmt(p.count), "Parzellen im Untersuchungsgebiet")}
      ${stat(`${fmt(p.matchedBuildings)} von ${fmt(records.length)}`, "Gebäude mit zugeordneter Parzelle")}
      ${stat(fmt(p.planning?.features), "Nutzungsplanungsflächen")}
      ${stat(`${fmt(buildingsWithPlanning)} von ${fmt(records.length)}`, "Gebäude mit Planungsfläche am Mittelpunkt")}
    </div>
    <h3>Nutzungsplanungsflächen</h3>${bars(featureCounts)}
    <p class="note">Parzellen- und Planungszuordnung über den LV95-Modellmittelpunkt des Gebäudes. Der AV-WFS liefert kein EGRID. Die Nutzungsplanungs-Features enthalten keine Rechtsverbindlichkeit oder Gültigkeit; daraus wird keine amtliche Rechtsauskunft abgeleitet.</p>
    <p class="note">Quelle: Amtliche Vermessung und ÖREB-Fachdaten Nutzungsplanung, Kanton Schwyz. Abrufstand ${esc(p.retrieved ?? "unbekannt")}.</p>`;
  }
  function energyTab() {
    const entries = count(records.filter((r) => r.inMunicipality), (r) => heatingGroup(r)?.label ?? "Keine Angabe im GWR");
    const pv = ctx.pv?.plants?.filter((p) => records[p.b]?.inMunicipality) ?? [];
    const kwByYear = [...pv.reduce((m, p) => { if (p.year) m.set(p.year, (m.get(p.year) ?? 0) + p.kw); return m; }, new Map())].sort((a, b) => a[0] - b[0]).map(([year, kw]) => [String(year), Math.round(kw)]);
    const pvBlock = pv.length ? `<h3>Photovoltaik in Ingenbohl (BFE-Anlagenregister)</h3>
      <div class="stats">${stat(fmt(pv.length), "registrierte Anlagen auf Gebäuden")}${stat(`${fmt(pv.reduce((s, p) => s + p.kw, 0) / 1000, 1)} MW`, "registrierte Leistung")}
        ${stat(fmt(new Set(pv.map((p) => p.b)).size), "Gebäude mit Photovoltaik")}${stat(fmt(ctx.pv.summary?.modules), "simulierte Module in der 3D-Ansicht")}</div>
      <h3>Zugebaute Leistung nach Inbetriebnahmejahr (kW)</h3>${bars(kwByYear)}
      <p class="note">Gemessen sind Standort, Leistung, Jahr, Bauart und teils Ausrichtung und Neigung. Anzahl und Lage der Module auf dem Dach sind aus der Leistung simuliert. Das Register umfasst ${fmt(ctx.meta.pv?.unmatchedPlantsInMunicipality ?? 0)} weitere Anlagen in der Gemeinde, die keinem Gebäude im 3D-Modell zugeordnet werden konnten.</p>` : "";
    return `<h3>Hauptenergieträger der Heizung (Gebäude im 3D-Modell)</h3>${bars(entries)}
      <p class="note">Für ${fmt(records.filter((r) => r.gwr?.heatEnergy).length)} von ${fmt(records.length)} Gebäuden ist der Energieträger im GWR erfasst. Das BFE-Solarpotenzial wird im Gebäudeprofil modelliert pro Dach ausgewiesen und hier nicht zur Gemeindestatistik aggregiert.</p>${pvBlock}`;
  }
  async function votesTab() {
    body.innerHTML = '<p class="note">Lade Resultate der eidgenössischen Abstimmungen …</p>';
    votes ??= await loadVotes();
    if (!votes.rows.length) return '<p>Abstimmungsdaten fehlen (Pipeline: python -m pipeline.run_all votes). Resultate: <a href="https://www.bfs.admin.ch/bfs/de/home/statistiken/politik/abstimmungen.html" target="_blank" rel="noopener">BFS Abstimmungen</a>.</p>';
    return `<div class="vote-filters" aria-label="Abstimmungen filtern">
      <label>Abstimmungsdatum<select id="vote-date"><option value="all">Alle Daten · neuste zuerst</option>${[...new Set(votes.rows.map((row) => row.date))].map((date) => `<option value="${date}">${voteDate(date)}</option>`).join("")}</select></label>
      <label>Entscheid in Ingenbohl<select id="vote-decision"><option value="all">Alle Vorlagen</option><option value="accepted">Angenommen</option><option value="rejected">Abgelehnt</option></select></label>
    </div><p id="vote-count" class="note" role="status">${votes.rows.length} Vorlagen</p>
    <div id="vote-results">${votes.rows.map(renderVote).join("")}</div>
    <p class="note">Quelle: BFS voteinfo (Open Data). Abfragestand ${esc(votes.retrieved ?? "unbekannt")}. Einzelne Abstimmungstage fehlen, wenn die Quelle sie nicht liefert. Der Entscheid in Ingenbohl bezeichnet die lokale Stimmenmehrheit, nicht den nationalen Entscheid.</p>`;
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
    return `<dl class="src">${sources.datasets.map((d) => {
      const endpoint = String(d.url ?? "").match(/^https?:\/\/\S+/)?.[0] ?? "";
      const reference = endpoint ? String(d.url).slice(endpoint.length).trim() : "";
      const dataLink = endpoint ? `<a href="${esc(endpoint)}" target="_blank" rel="noopener">Datendienst</a>${reference ? ` ${esc(reference)}` : ""}` : esc(d.url ?? "");
      const details = [d.coverage, d.vintage ? `Datenstand ${d.vintage}` : "", d.retrieved ? `Abfrage ${d.retrieved}` : "", d.notes]
        .filter(Boolean).map(esc).join(" · ");
      return `<dt>${esc(d.title)}</dt><dd>${esc(d.provider)} · ${esc(d.license)}<br>${dataLink} · <a href="${esc(d.terms)}" target="_blank" rel="noopener">Bedingungen</a><br><span class="note">${details}</span></dd>`;
    }).join("")}</dl>`;
  }

  async function show(tab) {
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    if (tab === "Abstimmungen") body.innerHTML = await votesTab();
    else body.innerHTML = { "Übersicht": overview, "Gebäude": buildingsTab, "Grundstücke": parcelsTab, "Energie": energyTab, "Datenqualität": quality, "Quellen": sourcesTab }[tab]();
    if (tab === "Übersicht") {
      fetch("https://de.wikipedia.org/api/rest_v1/page/summary/Ingenbohl").then((r) => (r.ok ? r.json() : null)).then((w) => {
        const el = $("#wiki");
        if (el && w?.extract) el.innerHTML = `${esc(w.extract)} <a href="https://de.wikipedia.org/wiki/Ingenbohl" target="_blank" rel="noopener">Wikipedia (CC BY-SA)</a>`; else if (el) el.textContent = "";
      }).catch(() => { const el = $("#wiki"); if (el) el.textContent = ""; });
    }
  }
  tabs.innerHTML = TABS.map((t) => `<button type="button" role="tab" data-tab="${t}" aria-selected="false">${t}</button>`).join("");
  tabs.addEventListener("click", (event) => { const t = event.target.closest("button")?.dataset.tab; if (t) show(t); });
  body.addEventListener("change", (event) => {
    if (!event.target.matches("#vote-date, #vote-decision")) return;
    const date = body.querySelector("#vote-date").value, decision = body.querySelector("#vote-decision").value;
    const rows = votes.rows.filter((row) => (date === "all" || row.date === date) && (decision === "all" || localDecision(row) === decision));
    body.querySelector("#vote-results").innerHTML = rows.length ? rows.map(renderVote).join("") : '<p class="vote-empty">Keine Vorlagen für diese Filter.</p>';
    body.querySelector("#vote-count").textContent = `${rows.length} von ${votes.rows.length} Vorlagen`;
  });
  body.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-imprint-action]");
    if (button?.dataset.imprintAction === "location" && imprintAddress && ctx.searchChoose) {
      const [label, e, n, building] = imprintAddress;
      modal.hidden = true;
      ctx.searchChoose({ type: "Adresse", label, e, n, building });
    } else if (button?.dataset.imprintAction === "email") {
      const mailbox = String.fromCharCode(112, 104, 105, 108, 105, 112, 112);
      const domain = String.fromCharCode(117, 110, 115, 101, 114, 101, 45, 104, 111, 109, 101, 112, 97, 103, 101, 46, 99, 104);
      const link = document.createElement("a");
      link.href = `mailto:${mailbox}@${domain}`;
      link.textContent = `${mailbox} [at] ${domain}`;
      button.replaceWith(link);
      link.focus();
    }
  });
  const open = (tab = "Übersicht") => { modal.hidden = false; return show(tab); };
  $("#btn-almanac").addEventListener("click", () => open());
  $("#almanac-close").addEventListener("click", () => { modal.hidden = true; });
  modal.addEventListener("click", (event) => { if (event.target === modal) modal.hidden = true; });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") modal.hidden = true; });
  ctx.almanac = { open };
}
