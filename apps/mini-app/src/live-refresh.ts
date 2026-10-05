import { useEffect, useRef } from "react";

export const LIVE_REFRESH_MS = 8_000;

export function useLiveRefresh(refresh: () => void, enabled = true) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      refreshRef.current();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", run);
    const timer = window.setInterval(run, LIVE_REFRESH_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", run);
      window.clearInterval(timer);
    };
  }, [enabled]);
}
