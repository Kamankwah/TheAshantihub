// Checks the marketing scripts and the shoot package against the live-action
// rules in docs/superpowers/specs/2026-10-05-live-action-shoot-package-design.md.
//
// Usage: git fetch origin righteoushack && node docs/marketing/check-shoot-package.mjs [--scripts-only]
//   --scripts-only  check the two scripts (R1, R6, R8, R10, R11) and skip the shoot package
// Env:   BASE_REF   git ref the voiceover is compared against (default origin/righteoushack).
//                   A ref that can't be read fails R6. BASE_REF=none skips the comparison:
//                   use it once when beats are deliberately retimed or reworded, and list
//                   the change in the commit message.
//        ALLOW_VO   comma-separated beat IDs whose voiceover may differ from BASE_REF
// Exits 0 when every rule passes, 1 otherwise.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = [
  { file: "business-script.md", promo: "BP", clip: "BC" },
  { file: "customer-script.md", promo: "CP", clip: "CC" },
];
const PACKAGE = "shoot-package.md";
// R1: what a visual cell may not describe (spec §4, §7.3).
const BANNED = [
  /screen[- ]record/i, /scroll/i, /\banimat(?:e|ed|es|ing|ion|ions)\b/i, /composit/i,
  /built in the edit/i, /mock-?up/i, /builds itself/i, /dial climb/i, /stack up/i, /app opens/i,
  /logo resolves/i,
  // Payment brands, including Ghana's mobile-money and gateway names, and app-store wording.
  /mobile money/i, /\bmomo\b/i, /hubtel/i, /\bVisa\b/, /mastercard/i, /\bMTN\b/, /telecel/i,
  /vodafone/i, /airteltigo/i, /\bAT Money\b/i, /paystack/i, /flutterwave/i, /zeepay/i,
  /\bg-?money\b/i, /expresspay/i, /app store/i, /play store/i, /google play/i,
  /download\b[^.]*\bapp\b/i,
];
// R1: the only figures a visual cell may show, as whole phrases. Anything else with a
// digit in it is an invented number.
const ALLOWED_FIGURES = ["GHS 0", "Order #1", "GHS 10/month", "× 47"];
// R10: app features the visuals may not depict, because the app doesn't have them
// (checked against the source on 2026-10-05). Remove a line when its feature ships.
const NOT_IN_APP = [
  [/\bQR\b/, "tickets carry a typed code (EventCheckinPanel); there is no QR"],
  [/\bscan(?:s|ned|ner|ning)?\b/i, "the organiser types the ticket code; nothing is scanned"],
  [/raise a dispute/i, "customers have no dispute button yet (the backend endpoint has no UI)"],
  [/\blights up\b|\bnotification/i, "business owners get no new-order notification"],
  [/\bbuzz(?:es|ing)?\b(?![^.]*again and again)/i, "only the repeated-enquiries shot buzzes; orders don't notify"],
];
// R11: an insert shows a demo store, and carries the *Demo store* super, unless the cell
// says it shows something real or store-less (a real ticket or check-in, the plan step,
// a staging account's test details).
const INSERT_EXEMPT = /real ticket|Checked in|plan step|test details/;
const ID = /\b(?:[BC]P \d+–\d+s|[BC]C[1-3] (?:hook|cta|\d+–\d+s))|\bS\d{2}\b/g;
const SETUP = /^[A-Z]{2}-\d{2}$/;

const scriptsOnly = process.argv.includes("--scripts-only");
const baseRef = process.env.BASE_REF || "origin/righteoushack";
const allowVo = new Set((process.env.ALLOW_VO || "").split(",").map((s) => s.trim()).filter(Boolean));
const failures = [];
const fail = (rule, msg) => failures.push(`${rule}  ${msg}`);
const cells = (line) => line.split("|").slice(1, -1).map((c) => c.trim());

// One entry per script table row: { id, visual, vo }. The id is the video code
// plus the row's time ("BP 0–6s"), or hook/cta for labelled clip rows ("BC3 hook").
function parseScript(text, { promo, clip }) {
  const beats = [];
  let video = null;
  let inTable = false;
  for (const line of text.split("\n")) {
    const clipHeading = line.match(/^### Clip (\d)\b/);
    if (/^## Promo video/.test(line)) video = promo;
    else if (clipHeading) video = `${clip}${clipHeading[1]}`;
    else if (/^#{1,2} /.test(line)) video = null;
    if (/^\| (Time|Beat) \| Visual/.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable && /^\|\s*-/.test(line)) continue;
    if (inTable && line.startsWith("|")) {
      const [first, visual, vo] = cells(line);
      const label = first.match(/^(Hook|CTA),\s*(.+)$/);
      beats.push({ id: `${video} ${label ? label[1].toLowerCase() : first}`, visual, vo });
      continue;
    }
    inTable = false;
  }
  return beats;
}

function baseText(file) {
  try {
    return execFileSync("git", ["show", `${baseRef}:docs/marketing/${file}`], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

// R10: a cell that depicts an app feature the app doesn't have.
function checkInApp(where, text) {
  for (const [re, why] of NOT_IN_APP) {
    const m = text.match(re);
    if (m) fail("R10", `${where}: "${m[0]}" — ${why}`);
  }
}

const beats = [];
for (const script of SCRIPTS) {
  const parsed = parseScript(fs.readFileSync(path.join(dir, script.file), "utf8"), script);
  for (const b of parsed) {
    if (b.id.startsWith("null ")) fail("R0", `${script.file}: a beat table sits outside a promo or clip heading`);
    for (const re of BANNED) {
      const m = b.visual.match(re);
      if (m) fail("R1", `${script.file} ${b.id}: visual mentions "${m[0]}"`);
    }
    const stripped = ALLOWED_FIGURES.reduce((t, phrase) => t.split(phrase).join(""), b.visual);
    for (const n of stripped.match(/\d+/g) || []) fail("R1", `${script.file} ${b.id}: visual shows the number ${n}`);
    checkInApp(`${script.file} ${b.id}`, b.visual);
    if (/\binsert/i.test(b.visual) && !b.visual.includes("*Demo store*") && !INSERT_EXEMPT.test(b.visual)) {
      fail("R11", `${script.file} ${b.id}: an insert with no *Demo store* super`);
    }
  }
  // R6: the voiceover stays as it was unless a beat is listed in ALLOW_VO.
  const base = baseRef === "none" ? null : baseText(script.file);
  if (baseRef === "none") {
    console.log(`note  BASE_REF=none: voiceover comparison skipped for ${script.file}`);
  } else if (base === null) {
    fail("R6", `${script.file}: can't read ${baseRef}; run git fetch origin righteoushack, or set BASE_REF=none to skip`);
  } else {
    const before = new Map(parseScript(base, script).map((b) => [b.id, b.vo]));
    for (const b of parsed) {
      if (!before.has(b.id)) fail("R6", `${script.file} ${b.id}: beat is not in ${baseRef}`);
      else if (before.get(b.id) !== b.vo && !allowVo.has(b.id)) fail("R6", `${script.file} ${b.id}: voiceover changed`);
    }
    for (const id of before.keys()) {
      if (!parsed.some((b) => b.id === id)) fail("R6", `${script.file} ${id}: beat removed`);
    }
  }
  beats.push(...parsed);
}

// R8: a video that shows a demo store carries the fine print on its end card.
for (const video of new Set(beats.map((b) => b.id.split(" ")[0]))) {
  const own = beats.filter((b) => b.id.split(" ")[0] === video);
  if (!own.some((b) => b.visual.includes("Demo store"))) continue;
  if (!own.some((b) => /end card/i.test(b.visual) && /fine print/i.test(b.visual))) {
    fail("R8", `${video}: shows a demo store but no end card carries the fine print`);
  }
}

const endCardOnly = (b) => b.visual.startsWith("**End card.**");
const beatIds = new Set(beats.map((b) => b.id));
let summary = `beats: ${beats.length} (end-card only: ${beats.filter(endCardOnly).length})`;

if (!scriptsOnly) {
  const text = fs.readFileSync(path.join(dir, PACKAGE), "utf8");
  const setups = [];
  const stills = new Set();
  // R9 reads only the Setups column of the tables under "## Call sheet".
  const scheduled = new Set();
  let section = "";
  let setupsCol = -1;
  for (const line of text.split("\n")) {
    if (/^## /.test(line)) section = line;
    if (!line.startsWith("|")) {
      setupsCol = -1;
      continue;
    }
    const c = cells(line);
    if (SETUP.test(c[0])) setups.push({ id: c[0], subject: c[1] ?? "", serves: c[3] ?? "" });
    if (/^S\d{2}$/.test(c[0])) stills.add(c[0]);
    if (section === "## Call sheet") {
      if (setupsCol === -1) setupsCol = c.indexOf("Setups");
      else for (const id of (c[setupsCol] ?? "").match(/\b[A-Z]{2}-\d{2}\b/g) || []) scheduled.add(id);
    }
  }
  const served = new Set();
  const seen = new Set();
  for (const s of setups) {
    if (seen.has(s.id)) fail("R3", `${s.id}: defined twice`);
    seen.add(s.id);
    const ids = s.serves.match(ID) || [];
    if (!ids.length) fail("R3", `${s.id}: serves no beat or still`);
    for (const id of ids) {
      if (!beatIds.has(id) && !stills.has(id)) fail("R3", `${s.id}: serves unknown "${id}"`);
      served.add(id);
    }
    // R9: every setup is scheduled on the call sheet.
    if (!scheduled.has(s.id)) fail("R9", `${s.id}: not on the call sheet`);
    checkInApp(s.id, s.subject);
  }
  // R2: every beat except a pure end card is captured by at least one setup.
  for (const b of beats) {
    if (!endCardOnly(b) && !served.has(b.id)) fail("R2", `${b.id}: no setup serves it`);
  }
  // R4: every still is captured by a setup.
  for (const id of stills) if (!served.has(id)) fail("R4", `${id}: no setup serves it`);
  // R5: the screen-led package is gone.
  if (/^\|[^\n]*\|\s*(?:App|Gap|Graphic)\b/m.test(text)) fail("R5", `${PACKAGE}: has an App, Gap or Graphic row`);
  for (const p of ["marketing/video/public/screens", "marketing/video/captions"]) {
    if (text.includes(p)) fail("R5", `${PACKAGE}: refers to ${p}`);
  }
  summary += `, setups: ${setups.length}, stills: ${stills.size}`;
}

console.log(summary);
if (failures.length) {
  console.log(failures.join("\n"));
  console.log(`${failures.length} failure(s)`);
  process.exit(1);
}
console.log("All checks pass.");
