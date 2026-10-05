// Renders clips to out/<id>.mp4 (H.264, yuv420p — plays on iOS, Android and the web).
// Usage: npm run render:all            → all six
//        npm run render -- <id> [<id>]  → just those (e.g. cust-why-support-vertical)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { getCompositions, renderMedia } from "@remotion/renderer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wanted = process.argv.slice(2);

const serveUrl = await bundle({
  entryPoint: path.join(root, "src/index.ts"),
  rootDir: root,
  publicDir: path.join(root, "public"),
});
const comps = (await getCompositions(serveUrl)).filter((c) => c.id !== "Placeholder");
const unknown = wanted.filter((id) => !comps.some((c) => c.id === id));
if (unknown.length) {
  console.error(`Unknown composition(s): ${unknown.join(", ")}\nAvailable: ${comps.map((c) => c.id).join(", ")}`);
  process.exit(1);
}

for (const composition of comps.filter((c) => !wanted.length || wanted.includes(c.id))) {
  const started = Date.now();
  const outputLocation = path.join(root, "out", `${composition.id}.mp4`);
  let lastPct = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    crf: 18,
    pixelFormat: "yuv420p",
    // Tags the stream BT.709 limited range; without it the JPEG frames yield full-range yuvj420p.
    colorSpace: "bt709",
    imageFormat: "jpeg",
    jpegQuality: 95,
    // Silent AAC track: some upload paths (WhatsApp Status, older players) reject video with no audio stream.
    enforceAudioTrack: true,
    outputLocation,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`\r${composition.id}: ${pct}%   `);
      }
    },
  });
  console.log(`\r${composition.id}: done in ${((Date.now() - started) / 1000).toFixed(1)}s → ${path.relative(root, outputLocation)}`);
}
