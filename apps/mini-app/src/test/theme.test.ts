import { afterEach, describe, expect, it } from "vitest";
import { applyAppearance, currentAppearance, deviceAppearance } from "../theme";

function stubMatchMedia(matches: Record<string, boolean>) {
  window.matchMedia = ((query: string) =>
    ({
      matches: Boolean(matches[query]),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
}

describe("appearance", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  it("defaults to dark when the system theme is unknown", () => {
    stubMatchMedia({});
    expect(deviceAppearance()).toBe("dark");
  });

  it("follows a light system theme", () => {
    stubMatchMedia({ "(prefers-color-scheme: light)": true });
    expect(deviceAppearance()).toBe("light");
  });

  it("follows a dark system theme", () => {
    stubMatchMedia({ "(prefers-color-scheme: dark)": true });
    expect(deviceAppearance()).toBe("dark");
  });

  it("writes a matching color-scheme onto the document", () => {
    applyAppearance("light");
    expect(currentAppearance()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    applyAppearance("dark");
    expect(currentAppearance()).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
