import { useEffect, useState } from "react";

export const DESKTOP_NAV = "(min-width: 860px)";

export function readDesktopNav() {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(DESKTOP_NAV).matches
      : false;
  } catch {
    return false;
  }
}

export function useDesktopNav() {
  const [desktop, setDesktop] = useState(readDesktopNav);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    try {
      const media = window.matchMedia(DESKTOP_NAV);
      const sync = () => setDesktop(media.matches);
      sync();
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", sync);
        return () => media.removeEventListener("change", sync);
      }
      media.addListener(sync);
      return () => media.removeListener(sync);
    } catch {
      // Older Telegram / Safari webviews reject matchMedia listeners.
    }
  }, []);
  return desktop;
}
