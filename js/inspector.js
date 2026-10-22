// Informationspanel für ausgewählte Objekte. Alle Texte werden maskiert (Daten stammen aus externen Quellen).
import { buildYear, heatingGroup, typeGroup } from "./buildings.js";
import { formatLv95, lv95ToWgs84 } from "./geo.js";

export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (value, digits = 0) => Number(value).toLocaleString("de-CH", { maximumFractionDigits: digits, minimumFractionDigits: digits });

const OBJECT_TYPES = {
  "Gebaeude Einzelhaus": "Gebäude (Einzelhaus)", "Lagertank": "Lagertank", "Im Bau": "Gebäude im Bau", "Mauer gross": "Grosse Mauer",
  "Kapelle": "Kapelle", "Hochhaus": "Hochhaus", "Treibhaus": "Treibhaus", "Sakrales Gebaeude": "Sakralgebäude",
  "Bruecke gedeckt": "Gedeckte Brücke", "Hochkamin": "Hochkamin", "Sakraler Turm": "Sakraler Turm", "Turm": "Turm",
};
const MISSING = '<span class="tag">nicht erfasst</span>';
const PROFILE_TABS = [
  ["overview", "Übersicht"], ["building", "Gebäude"], ["energy", "Energie"], ["compare", "Vergleich"], ["data", "Daten & Quellen"],
];

const PV_ORIENTATION = { 1: "Norden", 2: "Nordost", 3: "Osten", 4: "Südost", 5: "Süden", 6: "Südwest", 7: "Westen", 8: "Nordwest", 9: "Zenit (flach)" };

function pvSections(entries) {
  return entries.map(({ plant, placed, requested, onRoof, facadeKw }, i) => {
    const parts = plant.parts ?? [];
    const orientation = [...new Set(parts.map((p) => p[2]).filter(Boolean).map((o) => PV_ORIENTATION[o]))].join(", ");
    const inclination = [...new Set(parts.map((p) => p[1]).filter((v) => v != null).map((v) => `${Math.round(v)}°`))].join(", ");
    const rows = [
      [entries.length > 1 ? `Photovoltaikanlage ${i + 1}` : "Photovoltaikanlage", `${fmt(plant.kw, plant.kw < 10 ? 1 : 0)} kW`],
      ["Inbetriebnahme", plant.year ?? MISSING, plant.year == null],
      ["Bauart", { angebaut: "angebaut (auf dem Dach)", integriert: "dachintegriert", freistehend: "freistehend" }[plant.cat] ?? MISSING, !plant.cat],
      ["Ausrichtung (Register)", orientation || MISSING, !orientation],
      ["Neigung (Register)", inclination || MISSING, !inclination],
    ];
    rows.push(onRoof && requested > 0
      ? ["Darstellung", `${placed} von ${requested} Modulen simuliert${placed < requested ? " (Dachfläche reicht nicht)" : ""}`]
      : ["Darstellung", "freistehend, nicht auf dem Dach gezeichnet"]);
    if (facadeKw) rows.push(["Fassadenanteil", `${fmt(facadeKw, 1)} kW (Neigung 60° und mehr), nicht gezeichnet`]);
    return rows;
  });
}

function rowsMarkup(rows) {
  return rows.length ? `<dl>${rows.map(([key, value, raw]) => `<dt>${esc(key)}</dt><dd>${raw ? value : esc(value)}</dd>`).join("")}</dl>` : "";
}

export function createInspector({ panel, body, closeButton, codes, onClose, onActivateDemographicCell }) {
  let buildingProfile = null;
  let activeTab = "overview";
  closeButton.addEventListener("click", () => { hide(); onClose?.(); });

  function hide() { panel.hidden = true; buildingProfile = null; }

  body.addEventListener("click", (event) => {
    const demographicButton = event.target.closest("[data-activate-demographic-cell]");
    if (demographicButton && buildingProfile?.record) {
      onActivateDemographicCell?.(buildingProfile.record);
      return;
    }
    const ratingButton = event.target.closest("[data-rating-toggle]");
    if (ratingButton && buildingProfile?.rating) {
      buildingProfile.ratingOpen = !buildingProfile.ratingOpen;
      renderBuildingProfile();
      body.querySelector("[data-rating-toggle]")?.focus({ preventScroll: true });
      return;
    }
    const button = event.target.closest("[data-profile-tab]");
    if (!button || !buildingProfile) return;
    activeTab = button.dataset.profileTab;
    renderBuildingProfile();
    body.querySelector(`[data-profile-tab="${activeTab}"]`)?.focus({ preventScroll: true });
  });
  body.addEventListener("keydown", (event) => {
    if (!buildingProfile || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const tabs = [...body.querySelectorAll("[data-profile-tab]")];
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length].click();
  });

  function render({ title, sub, tags = [], sections = [], source, links = [] }) {
    buildingProfile = null;
    body.classList.remove("building-profile");
    body.innerHTML = `
      <h3>${esc(title)}</h3>
      <div class="sub">${esc(sub ?? "")}</div>
      ${tags.length ? `<div>${tags.map((t) => `<span class="tag ${t.warn ? "warn" : ""}">${esc(t.text)}</span>`).join(" ")}</div>` : ""}
      ${sections.map((rows) => `<dl>${rows.map(([k, v, raw]) => `<dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd>`).join("")}</dl>`).join("")}
      ${links.length ? `<p>${links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(" · ")}</p>` : ""}
      ${source ? `<div class="src">Quelle: ${esc(source)}</div>` : ""}`;
    panel.hidden = false;
  }

  function renderBuildingProfile() {
    const p = buildingProfile;
    const tabs = p.tabs.map(([id, label]) => `<button type="button" role="tab" data-profile-tab="${id}" aria-controls="inspector-profile-panel" aria-selected="${activeTab === id}" tabindex="${activeTab === id ? 0 : -1}">${label}</button>`).join("");
    const ratingMarkup = p.rating ? `<button type="button" class="profile-rating" data-rating-toggle aria-expanded="${p.ratingOpen}" aria-controls="profile-rating-details">
      <span class="profile-rating-score">${p.rating.score == null ? "–" : fmt(p.rating.score, 1)}<small>von 5</small></span>
      <span class="profile-rating-copy"><b>${esc(p.rating.label)}</b><small>Standortnähe · ${p.rating.factors.length} von ${p.rating.totalFactors} Modellkriterien · ${fmt(p.rating.coverage)} % Gewicht</small></span>
      <span class="profile-rating-meter" aria-hidden="true">${Array.from({ length: 5 }, (_, index) => `<i class="${p.rating.score != null && index < Math.round(p.rating.score) ? "on" : ""}"></i>`).join("")}</span>
      <span class="profile-rating-action"><span>${p.ratingOpen ? "Details schliessen" : "Details und Quellen anzeigen"}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>
    </button>${p.ratingOpen ? `<section id="profile-rating-details" class="profile-rating-details" aria-label="Berechnung und Quellen der Standortbewertung">
      <p>${esc(p.rating.model ?? "Standortnähe-Modell")} · ${esc(p.rating.reason ?? "Score auf eine Dezimalstelle gerundet.")}</p>
      <p class="profile-note">Distanzstufen: bis 250 m = 5, bis 500 m = 4, bis 1'000 m = 3, bis 2'000 m = 2, darüber = 1.</p>
      ${p.rating.factors.length ? `<h4>Im Rating berücksichtigt</h4><ul class="profile-rating-list">${p.rating.factors.map((factor) => `<li><span><b>${esc(factor.label)} · ${esc(factor.name)}</b><small>${fmt(factor.distance)} m Luftlinie · Gewicht ${fmt(factor.weight)} % · ${esc(factor.sourceLabel)}</small><small>${esc(factor.source?.provider ?? "OpenStreetMap-Mitwirkende")}${factor.source?.retrieved ? ` · Abruf ${esc(factor.source.retrieved)}` : ""}${factor.source?.license ? ` · ${esc(factor.source.license)}` : ""}</small></span><strong>${factor.score} / 5</strong></li>`).join("")}</ul>` : `<p class="profile-empty">Keine Ratingkriterien mit ausreichender Datenbasis.</p>`}
      ${p.environmental?.status === "loading" ? `<p class="profile-empty">BAG-/BAFU-Umweltkarten werden abgefragt …</p>` : ""}
      ${p.environmental?.status === "ready" ? `<h4>Umweltindikatoren · nicht im Nähe-Score</h4><p class="profile-note">Die Werte ergänzen das Gebäudeprofil, werden wegen unterschiedlicher Mess- und Modellgrundlagen aber nicht in die Zahl oben eingerechnet.${p.environmental.fetchedAt ? ` GeoAdmin-Abfrage ${esc(new Date(p.environmental.fetchedAt).toLocaleString("de-CH"))}.` : ""}</p>
        ${p.environmental.indicators.some((item) => item.available) ? `<ul class="profile-rating-list profile-environment-list">${p.environmental.indicators.map((item) => `<li><span><b>${esc(item.label)}</b><small>${item.available ? `${fmt(item.value, item.unit === "%" ? 0 : 1)} ${esc(item.unit)}${item.resolutionM ? ` · Raster ca. ${fmt(item.resolutionM)} m` : ""}` : esc(item.reason)}</small>${item.available ? `<small>${esc(item.detail)}</small><small>${esc(item.source)}</small>` : ""}</span></li>`).join("")}</ul>` : `<p class="profile-empty">Für diesen Punkt lieferten die Umweltkarten keine Werte.</p>`}
      ` : ""}
      ${p.rating.dataCaveat ? `<p class="profile-note">${esc(p.rating.dataCaveat)}</p>` : ""}
      ${p.rating.excluded.length ? `<h4>Nicht eingerechnet</h4><ul class="profile-rating-list profile-rating-excluded">${p.rating.excluded.map((item) => `<li><span><b>${esc(item.label)}</b><small>${esc(item.detail)}</small><small>Mögliche Quelle: ${esc(item.possibleSource)}</small></span></li>`).join("")}</ul>` : ""}
    </section>` : ""}` : "";
    let content = "";
    if (activeTab === "overview") {
      const modelArea = p.record.footprintArea;
      const gwrArea = p.gwr.footprintAreaGwr;
      const areaMetric = p.comparison?.metrics.find((metric) => metric.label === "Grundfläche GWR");
      const areaDifference = modelArea != null && gwrArea != null ? Math.abs(modelArea - gwrArea) : null;
      const areaCompare = modelArea != null || gwrArea != null ? `<section class="profile-section"><h4>Grundfläche</h4><div class="profile-area-compare">
        ${modelArea == null ? "" : `<div><span>3D-Modell</span><b>${fmt(modelArea, 1)} m²</b></div>`}
        ${gwrArea == null ? "" : `<div><span>GWR-Grundfläche</span><b>${fmt(gwrArea, 0)} m²</b></div>`}
        </div>${areaDifference == null ? "" : `<p class="profile-area-delta">Abweichung der beiden Angaben: ${fmt(areaDifference, 1)} m².</p>`}
        ${areaMetric ? `<div class="profile-area-reference"><b>Einordnung in Ingenbohl</b><span>${areaMetric.percentile}. Perzentil · Median ${fmt(areaMetric.median)} m²</span><small>Vergleichsgruppe: ${fmt(areaMetric.count)} Gebäude derselben GWR-Klasse</small></div>` : ""}
        <p class="profile-note">3D-Modell und GWR haben unterschiedliche Datenquellen und Definitionen; die Werte werden separat verglichen.</p></section>` : "";
      const kpis = [
        ["Geschosse", p.gwr.floors], ["Wohnungen", p.gwr.dwellings], ["Gebäudehöhe", p.record.height == null ? null : `${fmt(p.record.height, 1)} m`], ["Grundfläche GWR", gwrArea == null ? null : `${fmt(gwrArea)} m²`],
      ].map(([label, value]) => `<div class="profile-kpi"><span>${esc(label)}</span><strong>${value == null ? MISSING : esc(String(value))}</strong></div>`).join("");
      const demographicMarkup = p.demographics?.status === "loading"
        ? `<section class="profile-demographics"><h4>Umfeld · 100-m-Rasterzelle</h4><p class="profile-empty">BFS-Rasterwerte werden geladen …</p></section>`
        : p.demographics?.status === "ready"
          ? `<section class="profile-demographics"><div class="profile-section-title"><h4>Umfeld · 100-m-Rasterzelle</h4><span>Zellwerte, keine Gebäudewerte</span></div>
            <div class="profile-demographic-grid">
              <div><strong>${p.demographics.population ? fmt(p.demographics.population.value) : "–"}</strong><span>Einwohner · STATPOP ${p.demographics.population?.year ?? "kein Wert"}</span></div>
              <div><strong>${p.demographics.employment ? fmt(p.demographics.employment.value) : "–"}</strong><span>VZÄ · STATENT ${p.demographics.employment?.year ?? "kein Wert"}</span></div>
            </div>
            <p class="profile-note">Die Werte gelten für die Rasterzelle, nicht für dieses Gebäude oder dessen Bewohner. Quelle: Bundesamt für Statistik via GeoAdmin.</p>
            <button type="button" class="btn" data-activate-demographic-cell>Rasterzelle auf Karte zeigen</button></section>`
          : "";
      const nearby = p.nearby.length ? `<section class="profile-section"><div class="profile-section-title"><h4>In der Nähe</h4><span>Luftlinie</span></div><ul class="profile-nearby">${p.nearby.map((item) => `<li><span><b>${esc(item.label)}</b><small>${esc(item.name)}</small></span><strong>${fmt(item.distance)} m</strong></li>`).join("")}</ul></section>` : "";
      const pvSummary = p.pvPlants.length ? `<p class="profile-highlight">Photovoltaik · ${fmt(p.pvPlants.reduce((sum, entry) => sum + (entry.plant.kw ?? 0), 0), 1)} kW registriert</p>` : "";
      content = `<div class="profile-content">${ratingMarkup}<div class="profile-kpis">${kpis}</div>${demographicMarkup}${p.ageMarkup}${areaCompare}${nearby}${pvSummary}</div>`;
    } else if (activeTab === "building") {
      content = `<div class="profile-content">${p.ageMarkup}<section class="profile-section"><h4>Gebäude</h4>
        <div class="profile-building-metrics"><div><span>GWR-Geschosse</span><strong>${p.gwr.floors == null ? MISSING : fmt(p.gwr.floors)}</strong></div><div><span>Gebäudehöhe</span><strong>${p.record.height == null ? MISSING : `${fmt(p.record.height, 1)} m`}</strong></div></div>
        ${p.floorStack}</section><section class="profile-section"><h4>Wohnnutzung</h4>${rowsMarkup(p.buildingRows)}</section></div>`;
    } else if (activeTab === "energy") {
      content = `<div class="profile-content"><section class="profile-section"><h4>Heizung</h4>${rowsMarkup(p.energyRows)}</section>
        ${p.pv.length ? p.pv.map((rows, index) => `<section class="profile-section"><h4>${p.pv.length > 1 ? `Photovoltaikanlage ${index + 1}` : "Photovoltaik"}</h4>${rowsMarkup(rows)}</section>`).join("") : `<p class="profile-empty">Keine Photovoltaikanlage ist diesem Gebäude im BFE-Register zugeordnet. Daraus folgt keine Aussage zum theoretischen Solarpotenzial.</p>`}
        ${p.pv.length ? `<p class="profile-note">Leistung und Anlagenmerkmale stammen aus dem Register. Anzahl und Lage der dargestellten Module sind simuliert; ein Jahresertrag ist nicht verfügbar.</p>` : ""}</div>`;
    } else if (activeTab === "compare") {
      const metrics = p.comparison?.metrics ?? [];
      content = `<div class="profile-content"><p class="profile-note">Verglichen mit Gebäuden derselben GWR-Klasse innerhalb Ingenbohls. Perzentil = Anteil der Vergleichsgebäude mit gleichem oder kleinerem Wert. Der rote Balken enthält dieses Gebäude.</p>
        ${metrics.map((metric) => {
          const bins = metric.histogram ?? [];
          const maxCount = Math.max(1, ...bins.map((bin) => bin.count));
          return `<section class="profile-compare"><div class="profile-section-title"><h4>${esc(metric.label)}</h4><strong>${metric.percentile}. Perzentil</strong></div>
            <div class="profile-histogram" role="group" aria-label="Empirische Häufigkeitsverteilung für ${esc(metric.label)}">${bins.map((bin) => `<div class="profile-histogram-bin ${bin.selected ? "is-current" : ""}" role="img" aria-label="${esc(bin.label)}: ${fmt(bin.count)} Gebäude${bin.selected ? ", enthält dieses Gebäude" : ""}"><b>${fmt(bin.count)}</b><i style="height:${Math.max(2, 68 * bin.count / maxCount)}px"></i><small>${esc(bin.label)}</small></div>`).join("")}</div>
            <p>Dieses Gebäude: ${fmt(metric.value, metric.digits ?? 0)} ${esc(metric.unit)} · Median: ${fmt(metric.median, metric.digits ?? 0)} ${esc(metric.unit)} · n = ${fmt(metric.count)}</p>
            <p class="profile-note">Empirische Säulenverteilung · ${esc(metric.distribution ?? "Form nicht bestimmt")} · keine Normalverteilungskurve angenommen.</p></section>`;
        }).join("")}
        <p class="profile-note">Vergleichsgruppe: ${esc(p.comparison?.group ?? "GWR-Gebäudeklasse")} · ${fmt(p.comparison?.count ?? 0)} Gebäude. Fehlende Werte werden nicht als null gewertet.</p></div>`;
    } else {
      content = `<div class="profile-content"><section class="profile-section"><h4>Register und Standort</h4>${rowsMarkup(p.dataRows)}</section>
        ${p.parcels.length ? `<section class="profile-section"><h4>Grundstück</h4>${p.parcels.map(rowsMarkup).join("")}</section>` : ""}
        ${p.landUse.length ? `<section class="profile-section"><h4>Nutzungsplanung</h4>${p.landUse.map(rowsMarkup).join("")}<p class="profile-note">Die abgerufenen Features enthalten keine Angaben zu Rechtsverbindlichkeit oder Gültigkeit.</p></section>` : ""}
        ${p.links.length ? `<p>${p.links.map((link) => `<a href="${esc(link.href)}" target="_blank" rel="noopener">${esc(link.label)}</a>`).join(" · ")}</p>` : ""}
        <p class="profile-source">Quelle: ${esc(p.source)}${p.gwrExportDate ? ` · GWR-Export ${esc(p.gwrExportDate)}` : ""}</p></div>`;
    }
    body.classList.add("building-profile");
    body.innerHTML = `<header class="profile-header"><span class="profile-eyebrow">Gebäudeprofil</span><h3>${esc(p.title)}</h3><p class="sub">${esc(p.subtitle)}</p>
      <div class="profile-tags">${p.tags.map((tag) => `<span class="tag ${tag.warn ? "warn" : ""}">${esc(tag.text)}</span>`).join("")}</div>
      <nav class="profile-tabs" role="tablist" aria-label="Gebäudeprofil">${tabs}</nav></header>
      <div id="inspector-profile-panel" class="profile-panel" role="tabpanel" aria-live="polite">${content}</div>`;
    panel.hidden = false;
  }

  function showBuilding(record, { addresses = [], elevationOffset = 0, pv = [], comparison = null, nearby = [], rating = null, environmental = null, demographics = null, gwrExportDate = null } = {}) {
    const gwr = record.gwr ?? {};
    const year = buildYear(record);
    const group = typeGroup(record);
    const classText = gwr.class ? codes.GKLAS?.[gwr.class] ?? `Code ${gwr.class}` : null;
    const categoryText = gwr.category ? codes.GKAT?.[gwr.category] ?? `Code ${gwr.category}` : null;
    const heat = gwr.heatGenerator ? codes.GWAERZH1?.[gwr.heatGenerator] ?? `Code ${gwr.heatGenerator}` : null;
    const wgs = lv95ToWgs84(record.center[0], record.center[1]);
    const row = (label, value, digits) => [label, value == null ? MISSING : digits === undefined ? value : fmt(value, digits), value == null];
    const parcelSections = Array.isArray(record.parcels) ? [
      record.parcels.length
        ? record.parcels.map((parcel, index) => [`Grundstück ${index + 1}`, `${parcel.number ?? "Nummer nicht erfasst"}${parcel.areaM2 == null ? "" : ` · ${fmt(parcel.areaM2)} m²`}`])
        : [["Grundstück", "Keine Parzelle über den Gebäudemittelpunkt zugeordnet"]],
      [["Zuordnung", "Gebäudemittelpunkt innerhalb der Parzellengeometrie; kein EGRID im WFS"]],
    ] : [];
    const landUseSections = Array.isArray(record.landUse) ? [
      record.landUse.length
        ? record.landUse.map((entry) => [entry.kind === "grundnutzung" ? "Grundnutzung" : "Überlagernde Festlegung", entry.label ?? entry.type ?? "Typ nicht erfasst"])
        : [["Nutzungsplanung", "Keine Festlegung über den Gebäudemittelpunkt zugeordnet"]],
      [["Hinweis", "Rechtsverbindlichkeit und Gültigkeit sind im abgerufenen Feature-Schema nicht enthalten"]],
    ] : [];
    const planLinks = (record.landUse ?? []).filter((entry) => /^https?:\/\//i.test(entry.link ?? ""))
      .map((entry, index) => ({ label: `Nutzungsplan ${index + 1}`, href: entry.link }));
    const areaRows = [
      row("Grundfläche 3D-Modell (m²)", record.footprintArea, 1),
      row("Grundfläche GWR (m²)", gwr.footprintAreaGwr, 0),
      row("Volumen GWR (m³)", gwr.volumeGwr, 0),
      row("Gesamthöhe (m)", record.height, 1),
      row("Dachhöhe max. (m ü. M.)", record.roofMax, 1),
      row("Gelände am Gebäude (m ü. M.)", record.groundElevation, 1),
    ];
    const buildingRows = [
      ["Gebäudeklasse (GWR)", classText ?? MISSING, !classText],
      ["Nutzungskategorie (GWR)", categoryText ?? MISSING, !categoryText],
      ["Registerstatus", gwr.status ? codes.GSTAT?.[gwr.status] ?? `Code ${gwr.status}` : MISSING, !gwr.status],
      row("EGID", record.egid),
      ["3D-Objekttyp", OBJECT_TYPES[record.type] ?? record.type],
      ...areaRows,
    ];
    const energyRows = [
      ["Energieträger", heatingGroup(record)?.label ?? MISSING, !heatingGroup(record)],
      ["Heizsystem", heat ?? MISSING, !heat],
    ];
    const profileSource = `swisstopo swissBUILDINGS3D 3.0 beta, BFS GWR (Gebäude- und Wohnungsregister)${parcelSections.length ? ", Amtliche Vermessung Kanton Schwyz (räumliche Mittelpunktzuordnung)" : ""}${landUseSections.length ? ", ÖREB-Fachdaten Nutzungsplanung Kanton Schwyz (räumliche Mittelpunktzuordnung)" : ""}${pv.length ? ", BFE Elektrizitätsproduktionsanlagen (Photovoltaik). Anzahl und Lage der Module sind simuliert" : ""}`;
    const ageLabel = year ? (year.exact ? String(year.year) : year.label) : null;
    const ageMarkup = year ? `<section class="profile-age"><div class="profile-section-title"><h4>Bauzeit</h4><span>${year.exact ? "GWR-Baujahr" : "GWR-Bauperiode"}</span></div>
      <strong class="profile-age-value">${esc(year.exact ? String(year.year) : year.label)}</strong>
      ${year.exact ? "" : `<p class="profile-note">Ein genaues Baujahr ist nicht erfasst.</p>`}</section>` : `<section class="profile-age"><h4>Bauzeit</h4><p class="profile-empty">Baujahr und Bauperiode sind im GWR nicht erfasst.</p></section>`;
    const floors = gwr.floors;
    const floorStack = floors >= 1 && floors <= 14 ? `<div class="profile-floor-stack" role="img" aria-label="${fmt(floors)} Geschosse gemäss GWR">${Array.from({ length: floors }, () => "<span></span>").join("")}</div>` : "";
    const availableTabs = PROFILE_TABS.filter(([id]) => id !== "energy" || energyRows.some(([, value, missing]) => !missing) || pv.length)
      .filter(([id]) => id !== "compare" || (comparison?.metrics?.length ?? 0) > 0);
    const title = addresses[0] ?? record.name ?? OBJECT_TYPES[record.type] ?? record.type;
    const subtitle = classText ?? (group ? group.label : OBJECT_TYPES[record.type] ?? record.type);
    buildingProfile = {
      title,
      subtitle: addresses.length > 1 ? `${subtitle} · ${addresses.length} Adressen` : subtitle,
      tags: [
        ...(group ? [{ text: group.label }] : []),
        ...(gwr.status ? [{ text: codes.GSTAT?.[gwr.status] ?? "GWR-Eintrag" }] : []),
        ...(record.inMunicipality ? [] : [{ text: "Ausserhalb Ingenbohl", warn: true }]),
        ...(!record.gwr ? [{ text: "Kein GWR-Eintrag", warn: true }] : []),
        ...(pv.length ? [{ text: "Photovoltaik" }] : []),
      ],
      record, gwr, ageLabel, ageMarkup, floorStack, buildingRows, energyRows, pvPlants: pv, pv: pvSections(pv), nearby, comparison, rating, ratingOpen: false, environmental, demographics,
      dataRows: [
        ["EGID", record.egid ?? MISSING, record.egid == null],
        ["LV95", formatLv95(record.center[0], record.center[1])],
        ["WGS84", `${wgs.lat.toFixed(5)}, ${wgs.lon.toFixed(5)}`],
      ],
      parcels: parcelSections,
      landUse: landUseSections,
      links: [{ label: "map.geo.admin.ch", href: `https://map.geo.admin.ch/#/map?lang=de&center=${record.center[0]},${record.center[1]}&z=12&bgLayer=ch.swisstopo.swissimage` }, ...planLinks],
      source: profileSource,
      gwrExportDate,
      tabs: availableTabs,
    };
    activeTab = "overview";
    renderBuildingProfile();
    void elevationOffset;
  }

  function updateBuildingEnvironment(environmental) {
    if (!buildingProfile) return;
    buildingProfile.environmental = environmental;
    if (buildingProfile.ratingOpen) renderBuildingProfile();
  }

  function updateBuildingDemographics(demographics) {
    if (!buildingProfile) return;
    buildingProfile.demographics = demographics;
    if (activeTab === "overview") renderBuildingProfile();
  }

  return { render, showBuilding, updateBuildingEnvironment, updateBuildingDemographics, hide, showGeneric: render };
}
