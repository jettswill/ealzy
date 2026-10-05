import { inTelegramWebView } from "./theme";

export function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone) return true;
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

function syncVisualViewport() {
  const viewport = window.visualViewport;
  const height = Math.round(viewport?.height ?? window.innerHeight);
  const offset = Math.round(viewport?.offsetTop ?? 0);
  const root = document.documentElement;
  root.style.setProperty("--vv-height", `${height}px`);
  root.style.setProperty("--vv-top", `${offset}px`);
}

function syncAppHeight() {
  const height = Math.round(window.visualViewport?.height ?? window.innerHeight);
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

export function enableStandaloneApp() {
  if (typeof window === "undefined") return;
  const standalone = isStandaloneApp();
  document.documentElement.classList.toggle("is-standalone", standalone);

  if (standalone) {
    const viewport = document.querySelector('meta[name="viewport"]');
    viewport?.setAttribute(
      "content",
      "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover",
    );
  }

  syncVisualViewport();
  window.visualViewport?.addEventListener("resize", syncVisualViewport);
  window.visualViewport?.addEventListener("scroll", syncVisualViewport);
  window.addEventListener("resize", syncVisualViewport);

  if (!inTelegramWebView()) {
    syncAppHeight();
    window.visualViewport?.addEventListener("resize", syncAppHeight);
    window.visualViewport?.addEventListener("scroll", syncAppHeight);
    window.addEventListener("resize", syncAppHeight);
  }

  document.addEventListener("click", (event) => {
    if (!standalone) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest("a");
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.target !== "_blank" && link.target !== "_system") return;
    if (new URL(link.href, window.location.href).origin !== window.location.origin) return;
    event.preventDefault();
    window.location.assign(link.href);
  });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    syncVisualViewport();
    if (!inTelegramWebView()) syncAppHeight();
  });
}
