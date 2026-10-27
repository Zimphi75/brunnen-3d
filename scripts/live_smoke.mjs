// Startprüfung der Live-Seite in Chromium, Firefox und WebKit (Safari-Engine).
// Aufruf: node scripts/live_smoke.mjs [URL] [browser,browser]
// Schreibt live-check/smoke.json und je Browser einen Screenshot. Exit 1, wenn ein Browser nicht startet.
import { chromium, firefox, webkit } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2] ?? "https://brunnen.multikanal.ch/";
const wanted = (process.argv[3] ?? "chromium,firefox,webkit").split(",");
const engines = { chromium, firefox, webkit };
const READY_TEXT = "Brunnen 3D bereit";
const TIMEOUT_MS = 150_000;
const outDir = "live-check";
mkdirSync(outDir, { recursive: true });

async function check(name) {
  const result = { browser: name, ok: false, readyMs: null, info: "", pageErrors: [], consoleErrors: [], failedRequests: [] };
  let browser;
  try {
    browser = await engines[name].launch(name === "chromium" ? { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    // Intro-Angebot unterdrücken, damit es den Start nicht überdeckt.
    await page.addInitScript(() => { try { localStorage.setItem("brunnen3d-intro", "seen"); } catch {} });
    page.on("pageerror", (error) => result.pageErrors.push(String(error.message ?? error).slice(0, 300)));
    page.on("console", (message) => {
      if (message.type() === "error") result.consoleErrors.push(message.text().slice(0, 300));
      if (message.text().startsWith(READY_TEXT)) result.info = message.text();
    });
    page.on("requestfailed", (request) => {
      if (request.url().startsWith(new URL(url).origin)) result.failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ""}`);
    });
    const start = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForEvent("console", { predicate: (m) => m.text().startsWith(READY_TEXT), timeout: TIMEOUT_MS });
    result.readyMs = Date.now() - start;
    result.ok = result.pageErrors.length === 0;
    await page.waitForTimeout(3000);
    // Screenshot nur als Beilage: Mit Software-Rendering kann er lange dauern und entscheidet nicht über das Ergebnis.
    await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 60_000 }).catch(() => { result.screenshot = "nicht erstellt"; });
  } catch (error) {
    result.info = `Start fehlgeschlagen: ${String(error.message ?? error).split("\n")[0]}`;
  } finally {
    await browser?.close();
  }
  return result;
}

const results = [];
for (const name of wanted) {
  const result = await check(name);
  console.log(`${result.ok ? "OK  " : "FEHLER"} ${name}: ${result.readyMs ? `${(result.readyMs / 1000).toFixed(1)} s` : "-"} ${result.info}`);
  for (const e of result.pageErrors) console.log(`   Fehler: ${e}`);
  results.push(result);
}
writeFileSync(`${outDir}/smoke.json`, JSON.stringify({ url, checked: new Date().toISOString(), results }, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
