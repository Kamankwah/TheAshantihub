// Writes labelled stand-in screenshots to public/screens/ so clips render before
// the real captures exist. Never overwrites a real screenshot unless --force.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");

const PHONE = { w: 1170, h: 2532 }; // 390×844 CSS @3x
const DESKTOP = { w: 2880, h: 1800 }; // 1440×900 CSS @2x

// Every screen the clip configs (src/clips/*.ts) reference.
const SCREENS = {
  "reg-01-account.png": PHONE,
  "reg-02-business-info.png": PHONE,
  "reg-03-plan.png": PHONE,
  "store-listing.png": PHONE,
  "biz-dash-order.png": PHONE,
  "biz-dash-orders.png": PHONE,
  "cust-listing.png": PHONE,
  "cust-support-chat.png": PHONE,
  "cust-support-reply.png": PHONE,
  "cust-cart.png": PHONE,
  "staff-inbox-phone.png": PHONE,
};

const outDir = path.join(root, "public/screens");
fs.mkdirSync(outDir, { recursive: true });
const todo = Object.entries(SCREENS).filter(([name]) => force || !fs.existsSync(path.join(outDir, name)));
if (!todo.length) {
  console.log("All screens already exist (pass --force to overwrite).");
  process.exit(0);
}

const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), rootDir: root, publicDir: path.join(root, "public") });
for (const [name, size] of todo) {
  const inputProps = { label: name.replace(/\.png$/, ""), w: size.w, h: size.h };
  const composition = await selectComposition({ serveUrl, id: "Placeholder", inputProps });
  await renderStill({ composition, serveUrl, inputProps, output: path.join(outDir, name), imageFormat: "png" });
  console.log(`wrote public/screens/${name} (${size.w}×${size.h})`);
}
