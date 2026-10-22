const MOUSE_STEPS = [
  "Ziehen zum Verschieben",
  "Blickwinkel drehen und neigen",
  "Scrollen zum Zoomen",
];

const TOUCH_STEPS = [
  "Ziehen zum Verschieben",
  "Mit zwei Fingern drehen und neigen",
  "Mit zwei Fingern zoomen",
];

export function initNavigationHint({ root, canvas }) {
  const instruction = root.querySelector("#navigation-hint-instruction");
  const gesture = root.querySelector(".hint-gesture");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touchInput = matchMedia("(pointer: coarse)").matches;
  const steps = touchInput ? TOUCH_STEPS : MOUSE_STEPS;
  const timers = new Set();
  let animationFrame = 0;
  let state = "waiting";

  function schedule(callback, delay) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  }

  function clearTimers() {
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
  }

  function removeListeners() {
    canvas.removeEventListener("pointerdown", onInteraction);
    canvas.removeEventListener("wheel", onInteraction);
    canvas.removeEventListener("touchstart", onInteraction);
    canvas.removeEventListener("keydown", onInteraction);
  }

  function cleanup() {
    clearTimers();
    if (animationFrame) cancelAnimationFrame(animationFrame);
    removeListeners();
    root.remove();
    state = "removed";
  }

  function beginExit() {
    if (state !== "visible") return;
    state = "leaving";
    root.classList.remove("is-visible");
    root.classList.add("is-leaving");
    schedule(cleanup, 850);
  }

  function dismiss() {
    if (state === "leaving" || state === "removed") return;
    removeListeners();
    if (root.hidden) {
      cleanup();
      return;
    }
    clearTimers();
    state = "leaving";
    root.classList.remove("is-visible");
    root.classList.add("is-leaving");
    schedule(cleanup, reducedMotion ? 0 : 850);
  }

  function onInteraction() {
    dismiss();
  }

  function setPhase(index) {
    if (state !== "visible") return;
    gesture.dataset.phase = ["pan", "orbit", "zoom"][index];
    if (index === 0) return;
    instruction.classList.add("is-changing");
    schedule(() => {
      if (state !== "visible") return;
      instruction.textContent = steps[index];
      instruction.classList.remove("is-changing");
    }, 140);
  }

  canvas.addEventListener("pointerdown", onInteraction, { passive: true });
  canvas.addEventListener("wheel", onInteraction, { passive: true });
  canvas.addEventListener("touchstart", onInteraction, { passive: true });
  canvas.addEventListener("keydown", onInteraction);

  function show() {
    if (state !== "waiting") return;
    schedule(() => {
      if (state !== "waiting") return;
      state = "visible";
      root.dataset.input = touchInput ? "touch" : "mouse";
      root.dataset.reduced = String(reducedMotion);
      root.hidden = false;
      root.setAttribute("aria-hidden", "false");
      instruction.textContent = reducedMotion
        ? (touchInput ? "Ziehen, drehen und zoomen" : "Ziehen, drehen und scrollen")
        : steps[0];
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        if (state === "visible") root.classList.add("is-visible");
      });

      if (reducedMotion) {
        gesture.dataset.phase = "static";
        schedule(dismiss, 2600);
        return;
      }

      schedule(() => setPhase(0), 600);
      schedule(() => setPhase(1), 1800);
      schedule(() => setPhase(2), 3000);
      schedule(beginExit, 4200);
    }, 500);
  }

  return { show, dismiss };
}