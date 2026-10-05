function readParam(source: string, key: string) {
  try {
    return new URLSearchParams(source.replace(/^[?#]/, "")).get(key) ?? "";
  } catch {
    return "";
  }
}

export function getTelegramInitData(): string {
  try {
    const fromWindow = window.Telegram?.WebApp?.initData ?? "";
    if (fromWindow) return fromWindow;
    return (
      readParam(window.location.hash, "tgWebAppData") ||
      readParam(window.location.search, "tgWebAppData")
    );
  } catch {
    return "";
  }
}

export async function waitForTelegramInitData(timeoutMs = 1200): Promise<string> {
  const immediate = getTelegramInitData();
  if (immediate) return immediate;
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const data = getTelegramInitData();
      if (data || Date.now() - started >= timeoutMs) {
        resolve(data);
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
        expand?: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        onEvent?: (event: string, handler: () => void) => void;
      };
    };
  }
}
