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
  ["overview", "Übersicht"], ["environment", "Umgebung"], ["building", "Gebäude"], ["energy", "Energie"], ["compare", "Vergleich"], ["data", "Daten & Quellen"],
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

export function createInspector({ panel, body, closeButton, codes, onClose, onCenterPoi, onActivateDemographicCell, onDeactivateDemographicCell, onActivateWalking, onActivateOfficialRoute, onRatingPreferenceChange }) {
  let buildingProfile = null;
  let suspendedBuildingProfile = null;
  let activeTab = "overview";
  let suspendedTab = "overview";
  closeButton.addEventListener("click", () => { hide(); onClose?.(); });

  function showPoi(poi) {
    buildingProfile = null;
    body.classList.remove("building-profile");
    panel.classList.add("poi-detail");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", "poi-detail-title");
    const properties = poi.properties ?? {};
    const propertyLabels = [
      ["cuisine", "Angebot", (value) => value.replaceAll(";", ", ")],
      ["wheelchair", "Rollstuhlgängig", (value) => ({ yes: "Ja", no: "Nein", limited: "Eingeschränkt", designated: "Ja" }[value] ?? value)],
      ["outdoorSeating", "Aussenplätze", (value) => ({ yes: "Vorhanden", no: "Keine" }[value] ?? value)],
      ["takeaway", "Take-away", (value) => ({ yes: "Ja", no: "Nein" }[value] ?? value)],
      ["operator", "Betreiber"],
      ["fee", "Gebühren", (value) => ({ yes: "Gebührenpflichtig", no: "Kostenlos" }[value] ?? value)],
      ["access", "Zugang", (value) => ({ yes: "Öffentlich", public: "Öffentlich", permissive: "Öffentlich", customers: "Für Kundschaft", private: "Privat", no: "Nicht öffentlich" }[value] ?? value)],
      ["capacity", poi.subtype === "charging_station" ? "Ladepunkte" : "Kapazität"],
      ["maxStay", "Maximale Parkdauer"], ["power", "Ladeleistung"], ["socketTypes", "Steckertypen"],
    ];
    const propertyRows = propertyLabels.filter(([key]) => properties[key]).map(([key, label, format]) => [label, format ? format(properties[key]) : properties[key]]);
    const safeWebsite = (() => {
      try { const url = new URL(poi.website); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; }
    })();
    const phone = (poi.phone ?? "").trim();
    const safePhone = /^[+\d][\d\s()./-]{4,}$/.test(phone) ? phone.replace(/[\s()./-]/g, "") : "";
    const email = (poi.email ?? "").trim();
    const safeEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : "";
    const osmTypes = { node: "node", way: "way", relation: "relation" };
    const osmType = osmTypes[poi.osmType];
    const osmLink = osmType && /^\d+$/.test(String(poi.osmId)) ? `https://www.openstreetmap.org/${osmType}/${poi.osmId}` : "https://www.openstreetmap.org/";
    const actions = [
      safeWebsite ? `<a class="poi-action" href="${esc(safeWebsite)}" target="_blank" rel="noopener noreferrer">Website öffnen</a>` : "",
      safePhone ? `<a class="poi-action" href="tel:${esc(safePhone)}">Anrufen</a>` : "",
      safeEmail ? `<a class="poi-action" href="mailto:${esc(safeEmail)}">E-Mail schreiben</a>` : "",
      onCenterPoi ? `<button type="button" class="poi-action" data-center-poi>Auf Karte zentrieren</button>` : "",
    ].filter(Boolean).join("");
    const rows = [
      ...(poi.address ? [["Adresse", poi.address]] : []),
      ...(poi.openingHours ? [["Öffnungszeiten", poi.openingHours]] : []),
      ...propertyRows,
    ];
    body.innerHTML = `
      <button type="button" class="poi-sheet-handle" aria-label="Detailansicht erweitern" aria-expanded="false"><span></span></button>
      <header class="poi-detail-head"><div><span class="profile-eyebrow">${esc(poi.category)}</span><h3 id="poi-detail-title">${esc(poi.name)}</h3><p class="sub">${esc(poi.subtypeLabel || (poi.subtype ? poi.subtype.replaceAll("_", " ") : poi.category))}</p></div></header>
      <div class="poi-detail-content">
        ${actions ? `<nav class="poi-actions" aria-label="Kontaktinformationen">${actions}</nav>` : ""}
        ${rows.length ? `<dl>${rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>` : ""}
        ${poi.description ? `<p class="poi-description">${esc(poi.description)}</p>` : ""}
        <details class="poi-more"><summary>Weitere Angaben</summary><dl>${poi.lat != null && poi.lon != null ? `<dt>Koordinaten</dt><dd>${esc(Number(poi.lat).toFixed(5))}, ${esc(Number(poi.lon).toFixed(5))}</dd>` : ""}<dt>OpenStreetMap</dt><dd><a href="${osmLink}" target="_blank" rel="noopener noreferrer">Informationen auf OpenStreetMap ansehen</a></dd></dl></details>
        <footer class="poi-source">Daten: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap-Mitwirkende</a> · ODbL</footer>
      </div>`;
    panel.classList.add("poi-compact");
    panel.hidden = false;
    const handle = body.querySelector(".poi-sheet-handle");
    handle.addEventListener("click", () => {
      const expanded = panel.classList.toggle("poi-expanded");
      panel.classList.toggle("poi-compact", !expanded);
      handle.setAttribute("aria-expanded", String(expanded));
      handle.setAttribute("aria-label", expanded ? "Detailansicht verkleinern" : "Detailansicht erweitern");
    });
    handle.addEventListener("pointerdown", (event) => { handle.dataset.dragY = String(event.clientY); });
    handle.addEventListener("pointerup", (event) => {
      const start = Number(handle.dataset.dragY);
      if (!Number.isFinite(start) || Math.abs(event.clientY - start) < 36) return;
      if (event.clientY < start) {
        panel.classList.add("poi-expanded"); panel.classList.remove("poi-compact"); handle.setAttribute("aria-expanded", "true");
      } else if (panel.classList.contains("poi-expanded")) {
        panel.classList.remove("poi-expanded"); panel.classList.add("poi-compact"); handle.setAttribute("aria-expanded", "false");
      } else { hide(); onClose?.(); }
      delete handle.dataset.dragY;
    });
    body.querySelector("[data-center-poi]")?.addEventListener("click", () => onCenterPoi(poi));
  }

  function hide() { panel.hidden = true; buildingProfile = null; panel.classList.remove("poi-detail", "poi-expanded", "poi-compact"); panel.removeAttribute("role"); panel.removeAttribute("aria-labelledby"); }
  body.addEventListener("click", async (event) => {
    const routeButton = event.target.closest("[data-activate-official-route]");
    if (routeButton && buildingProfile?.record) {
      const profile = buildingProfile;
      routeButton.disabled = true;
      const active = await onActivateOfficialRoute?.(profile.record, routeButton.dataset.activateOfficialRoute);
      if (buildingProfile === profile && active) panel.hidden = true;
      return;
    }
    const walkingButton = event.target.closest("[data-activate-walking]");
    if (walkingButton && buildingProfile?.record) {
      const profile = buildingProfile;
      walkingButton.disabled = true;
      const active = await onActivateWalking?.(profile.record);
      if (buildingProfile === profile && active) panel.hidden = true;
      return;
    }
    const demographicButton = event.target.closest("[data-activate-demographic-cell]");
    if (demographicButton && buildingProfile?.record) {
      const profile = buildingProfile;
      if (profile.demographicCellActive) {
        onDeactivateDemographicCell?.(profile.record);
        profile.demographicCellActive = false;
      } else {
        demographicButton.disabled = true;
        profile.demographicCellActive = Boolean(await onActivateDemographicCell?.(profile.record));
      }
      if (buildingProfile === profile) {
        renderBuildingProfile();
        if (profile.demographicCellActive) panel.hidden = true;
        body.querySelector("[data-activate-demographic-cell]")?.focus({ preventScroll: true });
      }
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
  body.addEventListener("change", (event) => {
    const select = event.target.closest("[data-rating-priority]");
    if (!select || !buildingProfile?.rating) return;
    const profile = buildingProfile;
    const preferences = { ...profile.rating.preferences, [select.dataset.ratingPriority]: Number(select.value) };
    const rating = onRatingPreferenceChange?.(profile.record, preferences);
    if (rating) profile.rating = rating;
    renderBuildingProfile();
    body.querySelector(`[data-rating-priority="${select.dataset.ratingPriority}"]`)?.focus({ preventScroll: true });
  });

  function render({ title, sub, tags = [], sections = [], source, links = [] }) {
    buildingProfile = null;
    panel.classList.remove("poi-detail", "poi-expanded", "poi-compact");
    panel.removeAttribute("role"); panel.removeAttribute("aria-labelledby");
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
    const ratingHue = p.rating?.score == null ? null : Math.round(45 + (Math.max(0, Math.min(100, p.rating.score)) / 100) * 85);
    const ratingTone = ratingHue == null ? "#8a9290" : `hsl(${ratingHue} 55% 38%)`;
    const ratingUnrated = p.rating?.score == null;
    const ratingMarkup = p.rating ? `<button type="button" class="profile-rating${ratingUnrated ? " is-unrated" : ""}" style="--rating-tone:${ratingTone}" data-rating-toggle aria-expanded="${p.ratingOpen}" aria-controls="profile-rating-details">
      <span class="profile-rating-score">${p.rating.score == null ? "–" : fmt(p.rating.score)}<small>Orientierung / 100</small></span>
      <span class="profile-rating-copy"><b>${esc(p.rating.label)}</b><small>Wohnumfeld-Orientierung · ${p.rating.availableDimensions} von ${p.rating.totalDimensions} Bereichen erfasst</small></span>
      <span class="profile-rating-meter${ratingUnrated ? " is-unrated" : ""}" style="--rating-position:${ratingUnrated ? 50 : p.rating.score}%" aria-hidden="true"><i></i></span>
      <span class="profile-rating-scale" aria-hidden="true"><small>grössere Distanzen</small><small>kürzere Distanzen</small></span>
      <span class="profile-rating-action"><span>${p.ratingOpen ? "Details schliessen" : "Details und Quellen anzeigen"}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>
    </button>${p.ratingOpen ? `<section id="profile-rating-details" class="profile-rating-details" aria-label="Berechnung und Quellen der Standortbewertung">
      <p>${esc(p.rating.model)} ${p.rating.reason ? esc(p.rating.reason) : ""}</p>
      <p class="profile-note">Gelb bedeutet grössere Luftlinien-Distanzen, grün kürzere. Grau bedeutet, dass für zu wenige Bereiche Daten vorliegen.</p>
      <p class="profile-note">Der Orientierungswert startet mit gleich gewichteten Bereichen. Du kannst die Prioritäten unten ändern. Die Stufen beruhen auf Luftlinien: bis 250 m, 500 m, 1 km und 2 km. Das ist keine amtliche oder professionelle Immobilienbewertung.</p>
      <p class="profile-note">${p.rating.availableDimensions} von ${p.rating.totalDimensions} Bereichen und ${p.rating.factors.length} von 6 Ortstypen enthalten Daten. Fehlende Einträge werden nicht als schlechte Eigenschaft gewertet.</p>
      <fieldset class="profile-rating-priorities"><legend>Was ist dir wichtiger?</legend>${p.rating.dimensions.map((dimension) => `<label><span>${esc(dimension.label)}</span><select data-rating-priority="${esc(dimension.id)}" aria-label="Priorität: ${esc(dimension.label)}"><option value="1"${dimension.priority === 1 ? " selected" : ""}>Gleich wichtig</option><option value="1.5"${dimension.priority === 1.5 ? " selected" : ""}>Wichtig</option><option value="2"${dimension.priority === 2 ? " selected" : ""}>Besonders wichtig</option></select></label>`).join("")}</fieldset>
      ${p.rating.factors.length ? `<h4>Erfasste Orte in der Nähe</h4><ul class="profile-rating-list">${p.rating.factors.map((factor) => `<li><span><b>${esc(factor.label)} · ${esc(factor.name)}</b><small>${esc(factor.dimensionLabel)} · ${fmt(factor.distance)} m Luftlinie · ${esc(factor.sourceLabel)}</small><small>${esc(factor.source?.provider ?? "OpenStreetMap-Mitwirkende")}${factor.source?.retrieved ? ` · Abruf ${esc(factor.source.retrieved)}` : ""}${factor.source?.license ? ` · ${esc(factor.source.license)}` : ""}</small></span></li>`).join("")}</ul>` : `<p class="profile-empty">Für diese Bereiche sind noch zu wenige Orte erfasst.</p>`}
      ${p.rating.dataCaveat ? `<p class="profile-note">${esc(p.rating.dataCaveat)}</p>` : ""}
      ${p.rating.excluded.length ? `<h4>Nicht in dieser Orientierung enthalten</h4><ul class="profile-rating-list profile-rating-excluded">${p.rating.excluded.map((item) => `<li><span><b>${esc(item.label)}</b><small>${esc(item.detail)}</small><small>Mögliche Quelle: ${esc(item.possibleSource)}</small></span></li>`).join("")}</ul>` : ""}
    </section>` : ""}` : "";
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
      ["Geschosse", p.gwr.floors], ["Wohnungen", p.gwr.dwellings],
    ].map(([label, value]) => `<div class="profile-kpi"><span>${esc(label)}</span><strong>${value == null ? MISSING : esc(String(value))}</strong></div>`).join("");
    const demographicMarkup = p.demographics?.status === "loading"
      ? `<section class="profile-demographics"><h4>Leben in der Nachbarschaft</h4><p class="profile-empty">Angaben zur Umgebung werden geladen …</p></section>`
      : p.demographics?.status === "ready"
        ? `<section class="profile-demographics"><h4>Leben in der Nachbarschaft</h4>
          <div class="profile-demographic-grid">
            <div><strong>${p.demographics.population?.value != null ? fmt(p.demographics.population.value) : "–"}</strong><span>Menschen in der 100-m-Zelle</span></div>
            <div><strong>${p.demographics.employment?.value != null ? fmt(p.demographics.employment.value) : "–"}</strong><span>Vollzeit-Arbeitsplätze in der 100-m-Zelle</span></div>
          </div></section>`
        : `<section class="profile-demographics"><h4>Leben in der Nachbarschaft</h4><p class="profile-empty">Für die Umgebung sind derzeit keine Angaben verfügbar.</p></section>`;
    const nearby = p.nearby.length ? `<section class="profile-section"><div class="profile-section-title"><h4>Orte in der Nähe</h4><span>Weg oder Luftlinie</span></div><ul class="profile-nearby">${p.nearby.map((item) => `<li><span><b>${esc(item.label)}</b><small>${esc(item.name)} · ${item.walkMinutes != null ? `ca. ${item.walkMinutes} min zu Fuss` : "keine passende Fussroute"}</small></span><strong>${item.walkMinutes != null ? `${fmt(item.distance)} m Weg` : `${fmt(item.distance)} m Luftlinie`}</strong></li>`).join("")}</ul><p class="profile-note">Gehzeiten sind aus dem vorbereiteten OSM-Wegenetz und einer mittleren Gehgeschwindigkeit geschätzt. Fehlende Wege und Zugangsbeschränkungen können das Ergebnis beeinflussen.</p></section>` : `<section class="profile-section"><h4>Orte in der Nähe</h4><p class="profile-empty">Im vorbereiteten Ausschnitt wurden keine passenden Orte gefunden.</p></section>`;
    const departure = p.nextDeparture?.status === "ready"
      ? `<section class="profile-section"><h4>Nächste ÖV-Abfahrt</h4><p class="profile-highlight">${esc(p.nextDeparture.stop)} · ${esc(p.nextDeparture.time)} · ${esc(p.nextDeparture.line)}</p><p class="profile-note">${esc(p.nextDeparture.kind)} · transport.opendata.ch. Abfahrtszeit, keine Aussage, ob die Haltestelle noch rechtzeitig erreichbar ist.</p></section>`
      : "";
    const environmentalMarkup = p.environmental?.status === "loading"
      ? `<section class="profile-section"><h4>Umwelt und Belastungen</h4><p class="profile-empty">Amtliche Umweltkarten werden abgefragt …</p></section>`
      : p.environmental?.status === "ready"
        ? `<section class="profile-section"><h4>Umwelt und Belastungen</h4><p class="profile-note">Das sind Modell- und Rasterwerte, keine Messungen am Gebäude. Bei jedem Wert steht, wie er berechnet oder räumlich übertragen wurde.</p>
          ${p.environmental.indicators.some((item) => item.available) ? `<ul class="profile-rating-list profile-environment-list">${p.environmental.indicators.map((item) => `<li><span><b>${esc(item.label)}</b><small>${item.available ? `${fmt(item.value, item.unit === "%" ? 0 : 1)} ${esc(item.unit)}${item.resolutionM ? ` · Raster ca. ${fmt(item.resolutionM)} m` : ""}` : esc(item.reason)}</small>${item.available ? `<small>Berechnung / Aussage: ${esc(item.detail)}</small><small>${esc(item.source)}</small>` : ""}</span></li>`).join("")}</ul>` : `<p class="profile-empty">Für diesen Punkt lieferten die Umweltkarten keine Werte.</p>`}
          ${p.environmental.fetchedAt ? `<p class="profile-note">Abfrage ${esc(new Date(p.environmental.fetchedAt).toLocaleString("de-CH"))}.</p>` : ""}</section>`
        : "";
    const environmentActions = `<section class="profile-section"><h4>Karte erkunden</h4><div class="profile-demographic-actions"><button type="button" class="btn primary" data-activate-walking>Was erreiche ich zu Fuss?</button><button type="button" class="btn" data-activate-official-route="hiking">Wanderwege entdecken</button><button type="button" class="btn" data-activate-official-route="cycling">Velorouten ansehen</button><button type="button" class="btn" data-activate-official-route="roadNoise">Strassenlärm ansehen</button><button type="button" class="btn" data-activate-official-route="railNoise">Bahnlärm ansehen</button><button type="button" class="btn" data-activate-official-route="flood">Hochwasserübersicht ansehen</button><button type="button" class="btn" data-activate-demographic-cell aria-pressed="${p.demographicCellActive}">${p.demographicCellActive ? "Zurück zum Gebäude" : "Einwohner und Arbeitsplätze auf Karte ansehen"}</button></div></section>`;
    let content = "";
    if (activeTab === "overview") {
      const pvSummary = p.pvPlants.length ? `<p class="profile-highlight">Photovoltaik · ${fmt(p.pvPlants.reduce((sum, entry) => sum + (entry.plant.kw ?? 0), 0), 1)} kW registriert</p>` : "";
      content = `<div class="profile-content">${ratingMarkup}<div class="profile-kpis">${kpis}</div>${p.ageMarkup}<button type="button" class="btn primary" data-profile-tab="environment">Umgebung entdecken</button>${pvSummary}</div>`;
    } else if (activeTab === "environment") {
      content = `<div class="profile-content">${demographicMarkup}${departure}${environmentActions}${environmentalMarkup}</div>`;
    } else if (activeTab === "building") {
      content = `<div class="profile-content">${p.ageMarkup}<section class="profile-section"><h4>Gebäude</h4>
        <div class="profile-building-metrics"><div><span>GWR-Geschosse</span><strong>${p.gwr.floors == null ? MISSING : fmt(p.gwr.floors)}</strong></div><div><span>Gebäudehöhe</span><strong>${p.record.height == null ? MISSING : `${fmt(p.record.height, 1)} m`}</strong></div></div>
        ${p.floorStack}</section>${areaCompare}<section class="profile-section"><h4>Wohnnutzung</h4>${rowsMarkup(p.buildingRows)}</section></div>`;
    } else if (activeTab === "energy") {
      const solar = p.solarPotential?.status === "loading"
        ? `<section class="profile-section"><h4>Solarpotenzial dieses Dachs</h4><p class="profile-empty">BFE-Dachmodell wird abgefragt …</p></section>`
        : p.solarPotential?.status === "ready"
          ? `<section class="profile-section"><h4>Solarpotenzial dieses Dachs</h4><p class="profile-highlight">${fmt(p.solarPotential.roofAreaM2, 0)} m² erfasst · ${fmt(p.solarPotential.annualKwh)} kWh/Jahr modelliert</p>
            <ul class="profile-rating-list">${p.solarPotential.features.map((feature) => `<li><span><b>${esc(feature.suitability)}</b><small>${fmt(feature.areaM2, 0)} m² Dachfläche · ${fmt(feature.annualKwh)} kWh/Jahr</small>${feature.slopeDeg == null ? "" : `<small>${fmt(feature.slopeDeg, 0)}° Neigung${feature.slopeDeg > 0 && feature.azimuthDeg != null ? ` · Ausrichtungswinkel ${fmt(feature.azimuthDeg, 0)}°` : ""}</small>`}</span></li>`).join("")}</ul>
            <p class="profile-note">BFE-Modellwert, kein gemessener Ertrag und keine Garantie für eine Anlage. Datenstand ${esc(p.solarPotential.dataStatus)}. Bestehende Anlagen siehe oben.</p>
            <button type="button" class="btn" data-activate-official-route="solar">Solarpotenzial auf der Karte ansehen</button></section>`
          : `<section class="profile-section"><h4>Solarpotenzial dieses Dachs</h4><p class="profile-empty">${esc(p.solarPotential?.reason ?? "Für dieses Gebäude liegt kein zuordenbarer BFE-Dachwert vor.")} Ein fehlender Eintrag bedeutet nicht, dass kein Potenzial besteht.</p></section>`;
      content = `<div class="profile-content"><section class="profile-section"><h4>Heizung</h4>${rowsMarkup(p.energyRows)}</section>
        ${p.pv.length ? p.pv.map((rows, index) => `<section class="profile-section"><h4>${p.pv.length > 1 ? `Photovoltaikanlage ${index + 1}` : "Photovoltaik"}</h4>${rowsMarkup(rows)}</section>`).join("") : `<p class="profile-empty">Keine Photovoltaikanlage ist diesem Gebäude im BFE-Register zugeordnet. Daraus folgt keine Aussage zum theoretischen Solarpotenzial.</p>`}
        ${p.pv.length ? `<p class="profile-note">Leistung und Anlagenmerkmale stammen aus dem Register. Anzahl und Lage der dargestellten Module sind simuliert; ein Jahresertrag ist nicht verfügbar.</p>` : ""}${solar}</div>`;
    } else if (activeTab === "compare") {
      const metrics = p.comparison?.metrics ?? [];
      const headline = metrics.find((metric) => metric.label === "Grundfläche GWR") ?? metrics[0];
      const compareHeadline = headline
        ? (() => {
          const close = Math.abs(headline.value - headline.median) <= Math.max(1, Math.abs(headline.median) * 0.1);
          const comparison = close ? "liegt nahe am typischen Wert" : headline.value < headline.median ? "ist kleiner als der typische Wert" : "ist grösser als der typische Wert";
          const subject = headline.label === "Grundfläche GWR" ? "Die Grundfläche dieses Gebäudes" : `Der Wert für ${headline.label.toLowerCase()}`;
          return `<p class="profile-compare-summary">${subject} ${comparison} vergleichbarer Gebäude in Ingenbohl.</p>`;
        })()
        : `<p class="profile-empty">Für dieses Gebäude liegen keine passenden Vergleichsdaten vor.</p>`;
      content = `<div class="profile-content">${compareHeadline}<p class="profile-note">Verglichen mit Gebäuden derselben GWR-Klasse innerhalb Ingenbohls. Perzentil = Anteil der Vergleichsgebäude mit gleichem oder kleinerem Wert. Der rote Balken enthält dieses Gebäude.</p>
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
        <section class="profile-section"><h4>Daten zur Umgebung</h4>${rowsMarkup([
          ["Einwohner · STATPOP", p.demographics?.population?.value != null ? fmt(p.demographics.population.value) : "Kein Wert verfügbar"],
          ["Datenjahr Einwohner", p.demographics?.population?.year ?? "Nicht verfügbar"],
          ["Beschäftigte · STATENT", p.demographics?.employment?.value != null ? fmt(p.demographics.employment.value) : "Kein Wert verfügbar"],
          ["Datenjahr Beschäftigte", p.demographics?.employment?.year ?? "Nicht verfügbar"],
          ["Räumliche Auflösung", "100 × 100 m"],
          ["Quelle", "Bundesamt für Statistik via GeoAdmin"],
        ])}</section>
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

  function showBuilding(record, { addresses = [], elevationOffset = 0, pv = [], comparison = null, nearby = [], rating = null, environmental = null, demographics = null, nextDeparture = null, solarPotential = null, gwrExportDate = null } = {}) {
    suspendedBuildingProfile = null;
    suspendedTab = "overview";
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
    const profileSource = `swisstopo swissBUILDINGS3D 3.0 beta, BFS GWR (Gebäude- und Wohnungsregister)${parcelSections.length ? ", Amtliche Vermessung Kanton Schwyz (räumliche Mittelpunktzuordnung)" : ""}${landUseSections.length ? ", ÖREB-Fachdaten Nutzungsplanung Kanton Schwyz (räumliche Mittelpunktzuordnung)" : ""}${pv.length ? ", BFE Elektrizitätsproduktionsanlagen (Photovoltaik). Anzahl und Lage der Module sind simuliert" : ""}${solarPotential ? ", BFE Solar-Dacheignung (modellierte Potenzialwerte, getrennt vom Anlagenregister)" : ""}`;
    const ageLabel = year ? (year.exact ? String(year.year) : year.label) : null;
    const ageMarkup = year ? `<section class="profile-age"><div class="profile-section-title"><h4>Bauzeit</h4><span>${year.exact ? "GWR-Baujahr" : "GWR-Bauperiode"}</span></div>
      <strong class="profile-age-value">${esc(year.exact ? String(year.year) : year.label)}</strong>
      ${year.exact ? "" : `<p class="profile-note">Ein genaues Baujahr ist nicht erfasst.</p>`}</section>` : `<section class="profile-age"><h4>Bauzeit</h4><p class="profile-empty">Baujahr und Bauperiode sind im GWR nicht erfasst.</p></section>`;
    const floors = gwr.floors;
    const floorStack = floors >= 1 && floors <= 14 ? `<div class="profile-floor-stack" role="img" aria-label="${fmt(floors)} Geschosse gemäss GWR">${Array.from({ length: floors }, () => "<span></span>").join("")}</div>` : "";
    const availableTabs = PROFILE_TABS.filter(([id]) => id !== "energy" || energyRows.some(([, value, missing]) => !missing) || pv.length || solarPotential)
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
      record, gwr, ageLabel, ageMarkup, floorStack, buildingRows, energyRows, pvPlants: pv, pv: pvSections(pv), nearby, comparison, rating, ratingOpen: false, environmental, demographics, nextDeparture, solarPotential, demographicCellActive: false,
      dataRows: [
        ["EGID", record.egid ?? MISSING, record.egid == null],
        ["LV95", formatLv95(record.center[0], record.center[1])],
        ["WGS84", `${wgs.lat.toFixed(5)}, ${wgs.lon.toFixed(5)}`],
        ["ÖV-Haltestellen", "BAV via GeoAdmin; OSM als Fallback"],
        ["Fusswege", "OpenStreetMap · vorbereiteter Gemeindeausschnitt mit 300-m-Puffer"],
        ...(solarPotential ? [["Solarpotenzial", `BFE · ${solarPotential.source ?? "ch.bfe.solarenergie-eignung-daecher"} · Modellstand ${solarPotential.dataStatus ?? "2023-02-21"}`]] : []),
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
    const profile = buildingProfile ?? suspendedBuildingProfile;
    if (!profile) return;
    profile.environmental = environmental;
    if (buildingProfile === profile && (profile.ratingOpen || activeTab === "environment")) {
      const wasHidden = panel.hidden;
      renderBuildingProfile();
      panel.hidden = wasHidden;
    }
  }

  function updateBuildingDemographics(demographics) {
    const profile = buildingProfile ?? suspendedBuildingProfile;
    if (!profile) return;
    profile.demographics = demographics;
    if (buildingProfile === profile && (activeTab === "overview" || activeTab === "environment")) {
      const wasHidden = panel.hidden;
      renderBuildingProfile();
      panel.hidden = wasHidden;
    }
  }

  function updateBuildingLocation({ nearby, rating, nextDeparture } = {}) {
    const profile = buildingProfile ?? suspendedBuildingProfile;
    if (!profile) return;
    if (nearby) profile.nearby = nearby;
    if (rating) profile.rating = rating;
    if (nextDeparture) profile.nextDeparture = nextDeparture;
    if (buildingProfile !== profile) return;
    const wasHidden = panel.hidden;
    renderBuildingProfile();
    panel.hidden = wasHidden;
  }

  function updateBuildingSolarPotential(solarPotential) {
    const profile = buildingProfile ?? suspendedBuildingProfile;
    if (!profile) return;
    profile.solarPotential = solarPotential;
    if (buildingProfile !== profile) return;
    const wasHidden = panel.hidden;
    renderBuildingProfile();
    panel.hidden = wasHidden;
  }

  function setDemographicCellActive(active) {
    const profile = buildingProfile ?? suspendedBuildingProfile;
    if (!profile) return;
    profile.demographicCellActive = active;
    if (buildingProfile === profile && (activeTab === "overview" || activeTab === "environment")) {
      const wasHidden = panel.hidden;
      renderBuildingProfile();
      panel.hidden = wasHidden;
    }
  }

  function suspendBuildingProfile() {
    if (!buildingProfile) return false;
    suspendedBuildingProfile = buildingProfile;
    suspendedTab = activeTab;
    return true;
  }

  function restoreBuildingProfile() {
    if (!suspendedBuildingProfile) return false;
    buildingProfile = suspendedBuildingProfile;
    activeTab = suspendedTab;
    suspendedBuildingProfile = null;
    panel.classList.remove("poi-detail", "poi-expanded", "poi-compact");
    panel.removeAttribute("role");
    panel.removeAttribute("aria-labelledby");
    renderBuildingProfile();
    return true;
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.hidden || !panel.classList.contains("poi-detail")) return;
    hide(); onClose?.();
  });

  return { render, showPoi, showBuilding, updateBuildingEnvironment, updateBuildingDemographics, updateBuildingLocation, updateBuildingSolarPotential, setDemographicCellActive, suspendBuildingProfile, restoreBuildingProfile, hide, showGeneric: render };
}
