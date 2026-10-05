import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readReleaseFromHtml, writeReleaseManifest } from "../../release-manifest";

describe("release manifest", () => {
  it("reads the hashed entry and stylesheet from the built HTML", () => {
    expect(
      readReleaseFromHtml(
        `<script type="module" crossorigin src="/assets/index-abc.js"></script>
         <link rel="stylesheet" href="/assets/index-xyz.css">`,
      ),
    ).toEqual({ entry: "/assets/index-abc.js", css: "/assets/index-xyz.css" });
  });

  it("writes version.json and a stable CSS fallback for stale iOS shells", () => {
    const dir = mkdtempSync(join(tmpdir(), "ealzy-release-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets/index-abc.css"), "body{color:red}");
    writeFileSync(join(dir, "assets/index-abc.js"), "export{};");
    writeFileSync(join(dir, "boot-fallback.js"), "");
    writeFileSync(
      join(dir, "index.html"),
      `<script type="module" src="/assets/index-abc.js"></script>
       <link rel="stylesheet" href="/assets/index-abc.css">`,
    );

    const release = writeReleaseManifest(dir, 1_000);
    expect(release).toEqual({ entry: "/assets/index-abc.js", css: "/assets/index-abc.css", v: "rs" });
    expect(JSON.parse(readFileSync(join(dir, "version.json"), "utf8"))).toEqual(release);
    expect(readFileSync(join(dir, "assets/app.css"), "utf8")).toBe("body{color:red}");
    const precache = JSON.parse(readFileSync(join(dir, "precache.json"), "utf8")) as {
      v: string;
      files: string[];
    };
    expect(precache.v).toBe("rs");
    expect(precache.files).toEqual(
      expect.arrayContaining(["/", "/index.html", "/assets/index-abc.js", "/assets/app.css"]),
    );
    rmSync(dir, { recursive: true, force: true });
  });
});
