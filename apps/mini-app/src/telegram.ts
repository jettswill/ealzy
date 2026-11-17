import { init, miniApp, themeParams, viewport } from "@telegram-apps/sdk-react";
import {
  applyAppearance,
  appearanceChoice,
  deviceAppearance,
  resolveAppearance,
  themeBackground,
  inTelegramWebView,
  type Appearance,
} from "./theme";

const VIEWPORT_MOUNT_TIMEOUT_MS = 1_200;

function ignoreTelegramError(run: () => void) {
  try {
    run();
  } catch {
    // Older Telegram clients reject individual Mini App methods.
  }
}

function nativeWebApp() {
  return (
    window as Window & {
      Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } };
    }
  ).Telegram?.WebApp;
}

export function tellTelegramReady() {
  ignoreTelegramError(() => {
    if (miniApp.ready.isAvailable()) miniApp.ready();
  });
  ignoreTelegramError(() => {
    nativeWebApp()?.ready?.();
  });
}

function telegramAppearance(): Appearance | null {
  if (!inTelegramWebView()) return null;
  try {
    return miniApp.isDark() ? "dark" : "light";
  } catch {
    return null;
  }
}

function syncAppearance() {
  const theme = resolveAppearance(appearanceChoice(), telegramAppearance() ?? deviceAppearance());
  applyAppearance(theme);
  const bg = themeBackground(theme);
  ignoreTelegramError(() => {
    if (miniApp.setBackgroundColor.isAvailable()) miniApp.setBackgroundColor(bg);
  });
  ignoreTelegramError(() => {
    if (miniApp.setHeaderColor.isAvailable()) miniApp.setHeaderColor(bg);
  });
  ignoreTelegramError(() => {
    if (miniApp.setBottomBarColor.isAvailable()) miniApp.setBottomBarColor(bg);
  });
}

function watchAppearance() {
  ignoreTelegramError(() => {
    const webApp = (
      window as Window & {
        Telegram?: { WebApp?: { onEvent?: (event: string, handler: () => void) => void } };
      }
    ).Telegram?.WebApp;
    webApp?.onEvent?.("themeChanged", syncAppearance);
  });
  window.addEventListener("ealzy:appearance", syncAppearance);
  try {
    const light = window.matchMedia?.("(prefers-color-scheme: light)");
    if (typeof light?.addEventListener === "function") {
      light.addEventListener("change", syncAppearance);
    } else {
      light?.addListener?.(syncAppearance);
    }
  } catch {
    // matchMedia is optional.
  }
}

function withTimeout(promise: Promise<unknown>, ms: number) {
  return Promise.race([
    promise,
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    }),
  ]);
}

export async function initializeTelegram(): Promise<void> {
  try {
    init();
  } catch {
    // Already initialized, or this is a regular browser — still try ready().
  }

  ignoreTelegramError(() => {
    if (themeParams.mount.isAvailable()) themeParams.mount();
  });
  ignoreTelegramError(() => {
    if (miniApp.mount.isAvailable()) miniApp.mount();
  });

  // iOS Telegram keeps its own spinner until ready(). Viewport mount can hang,
  // so never wait on it before telling the client the app is up.
  tellTelegramReady();
  ignoreTelegramError(() => {
    nativeWebApp()?.expand?.();
  });

  try {
    if (viewport.mount.isAvailable()) {
      await withTimeout(Promise.resolve(viewport.mount()), VIEWPORT_MOUNT_TIMEOUT_MS);
    }
  } catch {
    // Viewport is optional; the app must still have called ready().
  }
  ignoreTelegramError(() => {
    if (viewport.bindCssVars.isAvailable()) viewport.bindCssVars();
  });
  ignoreTelegramError(() => {
    if (viewport.expand.isAvailable()) viewport.expand();
  });
  document.documentElement.classList.add("is-telegram");
  applyViewportHeight();
  window.visualViewport?.addEventListener("resize", applyViewportHeight);
  window.addEventListener("resize", applyViewportHeight);

  syncAppearance();
  watchAppearance();
  tellTelegramReady();
}

function measuredHeight() {
  return Math.round(Math.max(window.visualViewport?.height ?? 0, window.innerHeight || 0));
}

function applyViewportHeight() {
  let telegram = 0;
  try {
    const stable = viewport.stableHeight();
    if (typeof stable === "number" && Number.isFinite(stable)) telegram = stable;
  } catch {
    // Keep the 100dvh default when Telegram reports nothing.
  }
  const height = Math.max(measuredHeight(), telegram);
  if (height > 80) {
    document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`);
  }
}
