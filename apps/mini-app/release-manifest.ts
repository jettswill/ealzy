import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ReleaseManifest {
  entry: string;
  css: string;
  v: string;
}

export interface PrecacheManifest {
  v: string;
  files: string[];
}

const SHELL_FILES = [
  "/",
  "/index.html",
  "/version.json",
  "/precache.json",
  "/boot-fallback.js",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/apple-touch-icon-180x180.png",
  "/apple-touch-icon-precomposed.png",
  "/apple-touch-icon-180x180-precomposed.png",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/app.css",
];

export function readReleaseFromHtml(html: string): Pick<ReleaseManifest, "entry" | "css"> {
  return {
    entry: html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1] ?? "",
    css: html.match(/<link[^>]+href="(\/assets\/[^"]+\.css)"/)?.[1] ?? "",
  };
}

function assetFiles(distDir: string): string[] {
  const dir = path.join(distDir, "assets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /\.(js|css)$/.test(name))
    .map((name) => `/assets/${name}`);
}

export function precacheFiles(distDir: string, release: Pick<ReleaseManifest, "entry" | "css">): string[] {
  const files = new Set<string>([
    ...SHELL_FILES,
    release.entry,
    release.css,
    ...assetFiles(distDir),
  ]);
  return [...files].filter((file) => {
    if (file === "/" || file === "/precache.json") return true;
    return existsSync(path.join(distDir, file.replace(/^\//, "")));
  });
}

export function writeReleaseManifest(distDir: string, now = Date.now()) {
  const html = readFileSync(path.join(distDir, "index.html"), "utf8");
  const { entry, css } = readReleaseFromHtml(html);
  const release: ReleaseManifest = { entry, css, v: now.toString(36) };
  writeFileSync(path.join(distDir, "version.json"), `${JSON.stringify(release)}\n`);
  if (css) {
    const cssFile = path.join(distDir, css.replace(/^\//, ""));
    const fallback = path.join(distDir, "assets/app.css");
    mkdirSync(path.dirname(fallback), { recursive: true });
    copyFileSync(cssFile, fallback);
  }
  const precache: PrecacheManifest = { v: release.v, files: precacheFiles(distDir, release) };
  writeFileSync(path.join(distDir, "precache.json"), `${JSON.stringify(precache)}\n`);
  return release;
}
