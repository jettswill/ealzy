import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enableStandaloneApp, isStandaloneApp } from "../standalone";
import { appShellMode, registerAppShell } from "../offline";

const root = process.cwd();

describe("offline app shell", () => {
  it("does not throw when service workers are unavailable", () => {
    expect(() => registerAppShell()).not.toThrow();
  });

  it("caches a versioned app shell so home-screen launches work offline", () => {
    const source = readFileSync(join(root, "public/sw.js"), "utf8");
    expect(source).toContain("ealzy-shell-");
    expect(source).toContain("/precache.json");
    expect(source).toContain("event.respondWith");
    expect(source).toContain("skipWaiting()");
    expect(source).toContain("clients.claim");
    expect(source).toContain("AbortController");
    expect(source).toContain('url.pathname === "/sw.js"');
    expect(source).not.toContain("unregister()");
    expect(source).not.toContain("client.navigate");
  });

  it("recovers stale hashed scripts from the current release instead of reloading", () => {
    const nginx = readFileSync(join(root, "nginx.conf"), "utf8");
    const fallback = readFileSync(join(root, "public/boot-fallback.js"), "utf8");
    expect(nginx).toContain("gzip on");
    expect(nginx).toContain("application/javascript");
    expect(nginx).toContain("@stale-js");
    expect(nginx).toContain("try_files /boot-fallback.js =404");
    expect(nginx).toContain("location = /precache.json");
    expect(nginx).toContain("location = /version.json");
    expect(nginx).toContain("@stale-css");
    expect(nginx).toContain("no-cache, must-revalidate");
    expect(nginx).not.toContain("self.location.replace");
    expect(fallback).toContain("/version.json");
    expect(fallback).toContain("import(release.entry)");
    expect(fallback).toContain("tries >= 1");
  });

  it("chooses Telegram, production, and local shell modes", () => {
    expect(appShellMode({ telegram: true, prod: true })).toBe("clear");
    expect(appShellMode({ telegram: false, prod: true })).toBe("register");
    expect(appShellMode({ telegram: false, prod: false })).toBe("none");
  });

  it("unregisters a service worker inside Telegram instead of installing one", async () => {
    const unregister = vi.fn(async () => true);
    const getRegistrations = vi.fn(async () => [{ unregister }]);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistrations, register: vi.fn() },
    });
    window.Telegram = { WebApp: { initData: "query_id=1" } };

    registerAppShell();
    await Promise.resolve();
    await Promise.resolve();

    expect(getRegistrations).toHaveBeenCalled();
    expect(unregister).toHaveBeenCalled();
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();
    delete window.Telegram;
  });
});

describe("iPhone home screen app", () => {
  afterEach(() => {
    document.documentElement.classList.remove("is-standalone");
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  const originalMatchMedia = window.matchMedia;

  it("declares a standalone web app that iOS can install", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const manifest = readFileSync(join(root, "public/manifest.webmanifest"), "utf8");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('name="apple-mobile-web-app-capable"');
    expect(html).toContain('content="black-translucent"');
    expect(html).toContain("display-mode: standalone");
    expect(html).toContain('id="ealzy-boot-retry"');
    expect(html).toContain("ealzy.boot.reload");
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('sizes="180x180"');
    expect(html).toContain("/apple-touch-icon-180x180.png");
    expect(html).toContain("/apple-touch-icon.png");
    expect(html).toContain("serviceWorker");
    expect(html).toContain("tgAuthResult=");
    expect(html).toContain("/auth/telegram");
    expect(html).toContain("tgWebAppData");
    expect(html).toContain("webApp.ready");
    expect(html).toContain("ealzy-boot");
    expect(html).toContain("html:not(.is-booted)");
    expect(html).toContain("boot-loader");
    expect(html).toContain("Открываю Ealzy");
    expect(html).toContain("Открыть снова");
    expect(html).toContain("boot-pulse");
    expect(html).toContain('rel="modulepreload"');
    expect(html).toContain("25000");
    expect(readFileSync(join(root, "src/main.tsx"), "utf8")).toContain("inTelegramWebView()");
    expect(readFileSync(join(root, "src/telegram-login.ts"), "utf8")).not.toContain(
      "telegram.org/js",
    );
    expect(readFileSync(join(root, "src/App.tsx"), "utf8")).toContain(
      'import("./pages/NotePage")',
    );
    expect(readFileSync(join(root, "src/styles.css"), "utf8")).toContain("--app-height: 100dvh");
    expect(readFileSync(join(root, "src/styles.css"), "utf8")).toContain("html.is-telegram");
    expect(readFileSync(join(root, "src/styles.css"), "utf8")).not.toContain(
      "env(safe-area-inset-bottom, 0px) + var(--tg-viewport-safe-area-inset-bottom",
    );
    expect(manifest).toContain('"display": "standalone"');
    expect(manifest).toContain('"start_url": "/"');
    expect(manifest).toContain("/icon-512.png");
    expect(manifest).toContain("180x180");
    expect(manifest).toContain("?v=");
    const png = readFileSync(join(root, "public/apple-touch-icon-180x180.png"));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(180);
    expect(png.readUInt32BE(20)).toBe(180);
    const edge = readFileSync(join(root, "../../deploy/nginx-ealzy.conf"), "utf8");
    expect(edge).not.toContain('Connection "upgrade"');
    expect(edge).toContain("gzip_proxied any");
    expect(edge).toContain("application/javascript");
  });

  it("marks the document as a standalone app when iOS reports it", () => {
    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement("meta");
      viewport.setAttribute("name", "viewport");
      document.head.appendChild(viewport);
    }
    viewport.setAttribute("content", "width=device-width, initial-scale=1.0, viewport-fit=cover");
    window.matchMedia = ((query: string) =>
      ({
        matches: String(query).includes("display-mode: standalone"),
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeListener: () => undefined,
        addListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;

    const addEventListener = vi.spyOn(window, "addEventListener");
    expect(isStandaloneApp()).toBe(true);
    enableStandaloneApp();
    expect(document.documentElement.classList.contains("is-standalone")).toBe(true);
    expect(viewport.getAttribute("content")).toContain("maximum-scale=1");
    expect(addEventListener).toHaveBeenCalledWith("pageshow", expect.any(Function));
    expect(readFileSync(join(root, "src/standalone.ts"), "utf8")).not.toContain(
      "window.location.reload",
    );
  });

  it("keeps the home-screen service worker instead of retiring it", async () => {
    const unregister = vi.fn(async () => true);
    const register = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistrations: vi.fn(async () => [{ unregister }]), register },
    });
    Object.defineProperty(window.navigator, "standalone", { configurable: true, value: true });

    registerAppShell();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(unregister).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
});
