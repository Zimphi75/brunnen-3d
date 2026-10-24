// Intro-Video: beim ersten Besuch im Ladebildschirm angeboten, danach über die Werkzeugleiste, den Almanach
// oder den Link #intro erreichbar. Die eigene Seite intro/ ist zum Teilen gedacht (Vorschau mit Titelbild).
const SEEN_KEY = "brunnen3d-intro";
const VERSION = "v1"; // erhöhen, wenn ein neues Intro allen einmal angeboten werden soll
const VIDEO_BASE = "public/video/";
const SHARE_PATH = "intro/";

const $ = (selector) => document.querySelector(selector);

function hasSeen() {
  try { return localStorage.getItem(SEEN_KEY) === VERSION; } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, VERSION); } catch {}
}

/** Kleinere Datei für schmale Bildschirme oder Datensparmodus. */
function videoSource() {
  const small = matchMedia("(max-width: 900px)").matches || navigator.connection?.saveData === true;
  return `${VIDEO_BASE}intro-${small ? "720" : "1080"}.mp4`;
}

export function initIntro({ onOpenChange } = {}) {
  const dialog = $("#intro-dialog");
  const video = $("#intro-video");
  const offer = $("#intro-offer");
  const chip = $("#intro-chip");
  const readyButton = $("#intro-ready");
  const shareButton = $("#intro-share");
  const shareStatus = $("#intro-share-status");
  let sceneReady = false;
  let chipTimer = null;

  function open() {
    offer.hidden = true;
    hideChip();
    if (!video.src) { video.src = videoSource(); }
    if (!dialog.open) dialog.showModal();
    onOpenChange?.(true);
    if (location.hash !== "#intro") history.replaceState(null, "", "#intro");
    const playing = video.play();
    playing?.catch(() => {}); // Autoplay-Sperre: Steuerelemente bleiben sichtbar
  }

  function close() {
    video.pause();
    markSeen();
    if (dialog.open) dialog.close();
  }

  function hideChip() {
    clearTimeout(chipTimer);
    chip.hidden = true;
  }

  function updateReady() {
    readyButton.disabled = !sceneReady;
    readyButton.textContent = sceneReady ? "Karte ist bereit – zur Karte" : "Karte wird geladen …";
    readyButton.classList.toggle("primary", sceneReady);
  }

  async function share() {
    const url = new URL(SHARE_PATH, location.href).href;
    const data = { title: "Brunnen 3D – Intro", text: "Brunnen und Ingenbohl als digitaler Zwilling im Browser (1:32 min Video).", url };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(url);
      shareStatus.textContent = "Link kopiert";
    } catch (error) {
      if (error?.name === "AbortError") return; // Teilen-Menü abgebrochen
      shareStatus.textContent = url;
    }
    setTimeout(() => { shareStatus.textContent = ""; }, 4000);
  }

  dialog.addEventListener("close", () => {
    video.pause();
    markSeen();
    onOpenChange?.(false);
    if (location.hash === "#intro") history.replaceState(null, "", location.pathname + location.search);
  });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); }); // Klick neben das Video
  $("#intro-close").addEventListener("click", close);
  readyButton.addEventListener("click", close);
  shareButton.addEventListener("click", share);
  video.addEventListener("ended", () => { markSeen(); if (sceneReady) close(); });

  $("#intro-offer-play").addEventListener("click", open);
  $("#intro-offer-skip").addEventListener("click", () => { offer.hidden = true; markSeen(); });
  $("#intro-chip-play").addEventListener("click", open);
  $("#intro-chip-close").addEventListener("click", () => { hideChip(); markSeen(); });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-intro-open]")) { event.preventDefault(); open(); }
  });
  window.addEventListener("hashchange", () => { if (location.hash === "#intro") open(); });

  updateReady();
  if (location.hash === "#intro") open();
  else if (!hasSeen()) offer.hidden = false;

  return {
    open,
    /** Vom Startablauf aufgerufen, sobald die 3D-Karte bereit ist. */
    sceneReady() {
      sceneReady = true;
      updateReady();
      // Angebot im Ladebildschirm nicht angenommen: noch kurz als Hinweis unten anzeigen, dann als gesehen merken.
      if (!offer.hidden && !dialog.open) {
        offer.hidden = true;
        chip.hidden = false;
        chipTimer = setTimeout(() => { hideChip(); markSeen(); }, 15000);
      }
    },
  };
}
