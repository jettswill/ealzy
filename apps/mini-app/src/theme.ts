export type Appearance = "dark" | "light";

const darkBg = "#212121";
const lightBg = "#ffffff";

export function deviceAppearance(): Appearance {
  try {
    if (typeof window.matchMedia !== "function") return "dark";
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  } catch {
    // Private mode and older webviews may throw.
  }
  return "dark";
}

export function inTelegramWebView(): boolean {
  try {
    const telegram = window as Window & {
      Telegram?: { WebApp?: { initData?: string } };
      TelegramWebviewProxy?: unknown;
    };
    if (telegram.Telegram?.WebApp?.initData) return true;
    if (telegram.TelegramWebviewProxy) return true;
    const from = `${window.location.hash} ${window.location.search}`;
    return from.includes("tgWebAppData");
  } catch {
    return false;
  }
}

export function applyAppearance(theme: Appearance) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute("content", theme);
  const color = document.querySelector('meta[name="theme-color"]:not([media])');
  if (color) color.setAttribute("content", theme === "dark" ? darkBg : lightBg);
}

export function currentAppearance(): Appearance {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
