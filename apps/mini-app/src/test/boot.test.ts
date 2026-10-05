import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hideBootLoader, markBootStuck } from "../boot";

describe("boot overlay", () => {
  it("hides the HTML splash only after the app marks itself ready", () => {
    document.documentElement.classList.remove("is-booted");
    document.body.innerHTML = '<div id="ealzy-boot" class="boot-loader"></div><div id="root"></div>';
    markBootStuck();
    expect(document.getElementById("ealzy-boot")?.classList.contains("is-stuck")).toBe(true);
    hideBootLoader();
    expect(document.getElementById("ealzy-boot")?.classList.contains("is-done")).toBe(true);
    expect(document.documentElement.classList.contains("is-booted")).toBe(true);
    expect(window.__EALZY_BOOTED).toBe(true);
  });

  it("dismisses the HTML splash as soon as React mounts", () => {
    expect(readFileSync(join(process.cwd(), "src/main.tsx"), "utf8")).toContain("hideBootLoader()");
  });

  it("waits longer than a slow Telegram fetch before showing the stuck screen", () => {
    const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
    expect(html).toContain("25000");
    expect(html).not.toContain("12000");
  });
});
