import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Mapbox token is a build-environment value (public, URL-restricted). It must never be written
// into the repo. Mapbox tokens are "pk." / "sk." followed by a base64 JWT header starting "eyJ".
// The pattern is assembled from pieces so this file does not match itself.
const TOKEN = new RegExp(["[ps]", "k\\.", "eyJ"].join(""));
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", "dev-dist", ".vite", ".git"]);
const SKIP_EXT = /\.(png|jpe?g|gif|webp|avif|ico|svg|woff2?|ttf|otf|mp4|webm|pdf|zip|gz|map)$/i;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) yield* walk(path);
    else if (!SKIP_EXT.test(name) && st.size < 2_000_000) yield path;
  }
}

describe("no literal Mapbox token in the frontend source", () => {
  it("finds none under frontend/ (excluding node_modules, dist, coverage)", () => {
    const hits = [];
    for (const file of walk(process.cwd())) {
      if (TOKEN.test(readFileSync(file, "utf8"))) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});
