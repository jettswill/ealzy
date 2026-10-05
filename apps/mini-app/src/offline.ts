import { inTelegramWebView } from "./theme";

export type AppShellMode = "register" | "clear" | "none";

export function appShellMode(
  options: { prod?: boolean; telegram?: boolean } = {},
): AppShellMode {
  const telegram = options.telegram ?? inTelegramWebView();
  const prod = options.prod ?? import.meta.env.PROD;
  if (telegram) return "clear";
  if (prod) return "register";
  return "none";
}

async function clearAppShell() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("ealzy-shell-retired") || key.startsWith("ealzy-shell-"))
          .map((key) => caches.delete(key)),
      );
    }
  } catch {
    // Telegram still loads from the network without a worker.
  }
}

function installAppShell() {
  const register = () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  };
  const start = () => {
    window.setTimeout(register, 1200);
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

export function registerAppShell() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  const mode = appShellMode();
  if (mode === "clear") void clearAppShell();
  if (mode === "register") installAppShell();
}
