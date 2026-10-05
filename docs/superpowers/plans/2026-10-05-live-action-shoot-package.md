# Live-Action Shoot Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the two marketing scripts and the shoot package so every AshantiHub video and still is filmed for real, with a checker that keeps them consistent.

**Architecture:** The scripts (`docs/marketing/business-script.md`, `docs/marketing/customer-script.md`) say what each beat shows; the shoot package (`docs/marketing/shoot-package.md`) says where and how each beat is captured, organised by location and setup. A dependency-free Node checker (`docs/marketing/check-shoot-package.mjs`) is the test: it fails on the current screen-led docs and passes once the rewrite is complete, and it keeps the three files from drifting later.

**Tech Stack:** Markdown; Node 20 (no dependencies) for the checker; git.

**Spec:** `docs/superpowers/specs/2026-10-05-live-action-shoot-package-design.md`

## Global Constraints

- Filmed for real: no AI-generated people or places, no stock footage (DESIGN.md: *real Kumasi photography only*).
- The app appears only as a phone insert filmed in camera, where the words on screen carry the claim. No screen recordings, scrolling, animated, mocked-up or composited UI. The only graphics are text supers and the logo end card.
- No direct contact with businesses; enquiries go to AshantiHub Support.
- No payment brands (Mobile Money, Hubtel, card logos), no app-store buttons or "download the app", no invented numbers. Prices only as "plans from GHS 10/month" and "first billing cycle free". Lending partners only ever "coming soon".
- A *Demo store* super on every insert showing a demo store. Every end card carries one line of fine print per demo store in that video: *"Akosua Ntoma is a demonstration store, portrayed by a Bonwire weaver."*, and the same form, with the name it has on staging, for each other demo store.
- The voiceover column is not changed. (No VO change is needed by this plan; if one becomes necessary, list it with its reason in the commit message and pass its beat ID in `ALLOW_VO`.)
- The `"Is this still available?" × 47` super stays.
- IDs: videos `CP`, `BP`, `CC1`–`CC3`, `BC1`–`BC3`; a beat is `<video> <time>` (`BP 0–6s`) or `<video> hook|cta` for a clip's labelled rows (`BC3 hook`); setups `<location code>-<nn>` (`BW-04`); stills `S01`…`S21`. Times use an en dash (`–`), as the scripts already do.
- Uncast roles (host, Kejetia trader, demo customer, scout, Support agent) are written without gendered pronouns. Akosua is "she".
- Commit messages follow the repo convention (`docs(marketing): …`) and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01YPfKHC4q3GjCvKggjVs8v1
  ```

## Review Focus

The checker pins each of these; the owning task runs the failing case.

1. A video shows a demo store but its end card has no fine print → `R8` (Task 3 runs the failing case).
2. A payment brand or app-store wording creeps into a visual → `R1` brand list (Task 3).
3. A number in a visual that isn't one of the scripts' real figures (GHS 0, Order #1, GHS 10, × 47) → `R1` number allowlist (Task 3).
4. A setup that is never scheduled on the call sheet, or a typo in a `Serves` ID → `R9` and `R3` (Task 4).
5. A voiceover line silently edited while rewriting the visuals → `R6` (Task 3).

## Files

| File | Responsibility | Task |
|---|---|---|
| `docs/marketing/check-shoot-package.mjs` (create) | The checker: rules R0–R9 below | 1 |
| `docs/marketing/business-script.md` (modify) | Visual column of the business promo and clips 1–3; production notes | 2 |
| `docs/marketing/customer-script.md` (modify) | Visual column of the customer promo and clips 1–3; production notes | 3 |
| `docs/marketing/shoot-package.md` (rewrite) | Location-ordered setups, call sheet, stills, protocol, releases, post, delivery | 4 |
| `docs/superpowers/specs/2026-10-05-live-action-shoot-package-design.md` (modify) | Status line → implemented | 5 |

Checker rules:

| Rule | Checks |
|---|---|
| R0 | Every beat table sits under a promo or `### Clip N` heading |
| R1 | No visual cell describes a screen recording, scrolling, animation, compositing or a mock-up, names a payment or app-store brand, or shows a number other than 0, 1, 10, 47 |
| R2 | Every beat except a pure end card (visual starts with `**End card.**`) is served by at least one setup |
| R3 | Every setup serves at least one beat or still, every ID it serves exists, and no setup ID is defined twice |
| R4 | Every still is served by a setup |
| R5 | The package has no `App` / `Gap` / `Graphic` rows and no `marketing/video/public/screens` or `marketing/video/captions` paths |
| R6 | Every beat's voiceover equals `BASE_REF` (default `origin/righteoushack`) unless listed in `ALLOW_VO`; no beat added or removed |
| R8 | A video showing a demo store has an end card mentioning the fine print |
| R9 | Every setup ID appears outside its own row (i.e. on the call sheet) |

---

### Task 1: The checker

**Files:**
- Create: `docs/marketing/check-shoot-package.mjs`

**Interfaces:**
- Produces: `node docs/marketing/check-shoot-package.mjs [--scripts-only]`; env `BASE_REF`, `ALLOW_VO`. Prints a summary line (`beats: N (end-card only: E)[, setups: S, stills: T]`), then either `All checks pass.` (exit 0) or one line per failure (`<rule>  <message>`) and `<n> failure(s)` (exit 1). Later tasks rely on these exact strings.

- [ ] **Step 1: Make sure the base ref is current**

Run: `git fetch origin righteoushack`
Expected: no error. (R6 compares the voiceover against `origin/righteoushack`.)

- [ ] **Step 2: Create the checker**

Create `docs/marketing/check-shoot-package.mjs` with exactly this content:

```js
// Checks the marketing scripts and the shoot package against the live-action
// rules in docs/superpowers/specs/2026-10-05-live-action-shoot-package-design.md.
//
// Usage: node docs/marketing/check-shoot-package.mjs [--scripts-only]
//   --scripts-only  check the two scripts (R1, R6, R8) and skip the shoot package
// Env:   BASE_REF   git ref the voiceover is compared against (default origin/righteoushack)
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
  /screen[- ]record/i, /scroll/i, /animat/i, /composit/i, /built in the edit/i, /mock-?up/i,
  /builds itself/i, /dial climb/i, /stack up/i, /app opens/i, /logo resolves/i,
  /mobile money/i, /\bmomo\b/i, /hubtel/i, /\bvisa\b/i, /mastercard/i, /app store/i,
  /play store/i, /google play/i, /download the app/i,
];
// R1: the only figures a visual cell may show (GHS 0, Order #1, GHS 10/month, × 47).
const ALLOWED_NUMBERS = new Set(["0", "1", "10", "47"]);
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
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
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
    for (const n of b.visual.match(/\d+/g) || []) {
      if (!ALLOWED_NUMBERS.has(n)) fail("R1", `${script.file} ${b.id}: visual shows the number ${n}`);
    }
  }
  // R6: the voiceover stays as it was unless a beat is listed in ALLOW_VO.
  const base = baseText(script.file);
  if (base === null) {
    console.log(`note  ${baseRef} not available; voiceover comparison skipped for ${script.file}`);
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
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const c = cells(line);
    if (SETUP.test(c[0])) setups.push({ id: c[0], serves: c[3] ?? "" });
    if (/^S\d{2}$/.test(c[0])) stills.add(c[0]);
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
    // R9: every setup is scheduled, so its ID appears again outside its own row.
    const count = text.split(s.id).length - 1;
    if (count < 2) fail("R9", `${s.id}: not on the call sheet`);
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
```

- [ ] **Step 3: Run it against the current, screen-led docs and confirm it fails for the right reasons**

Run: `node docs/marketing/check-shoot-package.mjs; echo "exit=$?"`
Expected: exit 1. The first lines are exactly:

```
beats: 41 (end-card only: 0), setups: 0, stills: 0
R1  business-script.md BP 14–25s: visual mentions "builds itself"
R1  business-script.md BP 25–38s: visual mentions "stack up"
R1  business-script.md BP 48–60s: visual mentions "dial climb"
R1  business-script.md BC1 3–20s: visual mentions "Screen record"
R1  customer-script.md CP 6–15s: visual mentions "scroll"
R1  customer-script.md CP 15–26s: visual mentions "app opens"
R1  customer-script.md CP 15–26s: visual mentions "logo resolves"
R1  customer-script.md CC1 3–20s: visual mentions "Scroll"
```

followed by 41 `R2` lines (one per beat), three `R5` lines (an App/Gap/Graphic row, `marketing/video/public/screens`, `marketing/video/captions`) and `52 failure(s)`. There are no `R6` lines: the voiceover matches `origin/righteoushack`. If `beats:` is not 41, the table parsing is wrong; fix that before going on.

- [ ] **Step 4: Commit**

```bash
git add docs/marketing/check-shoot-package.mjs
git commit -F - <<'EOF'
docs(marketing): checker for the live-action scripts and shoot package

Fails while any script visual describes a screen recording, scrolling, a
payment brand or an invented figure, while any beat lacks a setup or any
setup is off the call sheet, and when a voiceover line changes. It fails on
today's screen-led docs; the rewrite that follows makes it pass.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YPfKHC4q3GjCvKggjVs8v1
EOF
```

---

### Task 2: Business script visuals and production notes

**Files:**
- Modify: `docs/marketing/business-script.md` (the *Visual / on-screen text* cell of all 21 rows in the promo and Clips 1–3 tables; the *Production notes* bullet that begins `- **Akosua Ntoma is a fictional demo business**`)

**Interfaces:**
- Consumes: the checker from Task 1.
- Produces: the beat IDs `BP 0–6s` … `BP 80–88s`, `BC1 hook` … `BC3 cta`, which Task 4's setups reference. The voiceover cells are unchanged.

- [ ] **Step 1: Confirm the failing state for this file**

Run: `node docs/marketing/check-shoot-package.mjs --scripts-only | grep business-script`
Expected: the four `business-script.md` R1 lines from Task 1 Step 3.

- [ ] **Step 2: Save the new visual cells**

Write this JSON to a temporary file, e.g. `$(mktemp -d)/business-visuals.json`. Keys are beat IDs; values are the complete new *Visual / on-screen text* cells.

```json
{
  "BP 0–6s": "Akosua at her loom in Bonwire · a Suame mechanic under a bonnet · a chop-bar cook stirring a pot (real businesses, as themselves). **On-screen:** *Your craft. Your name.*",
  "BP 6–14s": "Akosua at her stall in Bonwire as foot traffic passes without stopping. **On-screen:** *But can the world find you?*",
  "BP 14–25s": "Akosua photographs a finished kente strip in her shop on her phone. Insert: her storefront, with the *Demo store* super. **On-screen:** *Your verified storefront*",
  "BP 25–38s": "Akosua's phone buzzes on the loom bench; she glances at it and smiles. Insert: a new order (Order #1), *Demo store* super. Quick cuts: a braider with a client in the chair · friends walking up to an event gate. A rider loads a parcel onto a motorbike outside her shop. **On-screen:** *Sell · Take bookings · Sell tickets*",
  "BP 38–48s": "Akosua keeps weaving while a real AshantiHub Support agent answers a chat at the office. Insert: the chat on the agent's laptop. **On-screen:** *We handle the enquiries. You do the work.*",
  "BP 48–60s": "Akosua checks her dashboard on her phone at the loom bench. Insert: her orders, then her Credit Score with *Lending partners coming soon*, as the app shows them, *Demo store* super. **On-screen:** *Your trading becomes your track record*",
  "BP 60–70s": "At a Kumasi café, a customer browses theashantihub.com on a laptop; the homepage Hero shows Akosua's shop (a staff-approved placement, *Demo store* super). **On-screen:** *Every plan is Hero-spotlight eligible*",
  "BP 70–80s": "A Kejetia trader signs up on a phone at the stall. Insert: the plan step, *🎉 Your first billing cycle is FREE.* **On-screen:** *Nothing to pay to join · Plans from GHS 10/month*",
  "BP 80–88s": "Akosua looks up from the loom and smiles. Then the end card: logo + URL, with the demo-store fine print. **On-screen:** *Register your business — theashantihub.com*",
  "BC1 hook": "The host at a Kejetia trader's stall holds up an empty wallet, grinning, to camera. **On-screen:** *GHS 0 to join*",
  "BC1 3–20s": "The trader registers on a phone with the host alongside. Inserts: account → business details → plan, on a staging account with test details. **On-screen:** *Register · Get verified · Pick a plan*",
  "BC1 20–32s": "The trader's phone lights up at the stall, and a smile. Inserts: the trader's storefront, live, then its first order, *Demo store* super. **On-screen:** *Plans from GHS 10/month*",
  "BC1 cta": "**End card.** Logo + URL, with the demo-store fine print.",
  "BC2 hook": "At Bonwire, Akosua holds a loan form with *Financial records* circled in red (a prop: no bank name or logo), the host beside her, to camera. **On-screen:** *\"Bring your records.\"* 😩",
  "BC2 3–18s": "Montage at a Kejetia stall: goods handed over, cash changing hands, nothing written down.",
  "BC2 18–32s": "Akosua checks her dashboard at the loom bench. Inserts: her orders, then her Credit Score card with its grade and *Lending partners coming soon*, *Demo store* super. **On-screen:** *Your trading → your Credit Score · Lending partners coming soon*",
  "BC2 cta": "**End card.** Logo + URL, with the demo-store fine print.",
  "BC3 hook": "At Bonwire, Akosua's phone buzzes again and again on the loom bench, the screen unreadable; the host, to camera. **On-screen:** *\"Is this still available?\" × 47*",
  "BC3 3–20s": "Akosua turns the phone face-down and goes back to weaving. At the office, a Support agent answers the enquiry. Insert: the chat on the agent's laptop. **On-screen:** *AshantiHub Support handles it*",
  "BC3 20–32s": "Insert: Akosua's orders in her dashboard, *Demo store* super · a braider with a client in the chair · the rider loads a parcel outside her shop. **On-screen:** *Real customers order and book from your page*",
  "BC3 cta": "**End card.** Logo + URL, with the demo-store fine print."
}
```

- [ ] **Step 3: Save the throwaway apply script**

In the same temporary directory, create `apply-visuals.mjs` (not committed):

```js
// Throwaway: replaces the Visual cell of each listed beat in one script.
// Usage: node apply-visuals.mjs <script.md> <visuals.json>
import fs from "node:fs";

const [file, mapFile] = process.argv.slice(2);
const visuals = JSON.parse(fs.readFileSync(mapFile, "utf8"));
const codes = file.includes("business") ? ["BP", "BC"] : ["CP", "CC"];
let video = null;
let inTable = false;
const used = new Set();
const out = fs.readFileSync(file, "utf8").split("\n").map((line) => {
  const clip = line.match(/^### Clip (\d)\b/);
  if (/^## Promo video/.test(line)) video = codes[0];
  else if (clip) video = `${codes[1]}${clip[1]}`;
  else if (/^#{1,2} /.test(line)) video = null;
  if (/^\| (Time|Beat) \| Visual/.test(line)) {
    inTable = true;
    return line;
  }
  if (inTable && /^\|\s*-/.test(line)) return line;
  if (inTable && line.startsWith("|")) {
    const c = line.split("|").slice(1, -1).map((s) => s.trim());
    const label = c[0].match(/^(Hook|CTA),\s*(.+)$/);
    const id = `${video} ${label ? label[1].toLowerCase() : c[0]}`;
    if (!(id in visuals)) return line;
    used.add(id);
    c[1] = visuals[id];
    return `| ${c.join(" | ")} |`;
  }
  inTable = false;
  return line;
});
const missing = Object.keys(visuals).filter((id) => !used.has(id));
if (missing.length) {
  console.error(`Not found: ${missing.join(", ")}`);
  process.exit(1);
}
fs.writeFileSync(file, out.join("\n"));
console.log(`${file}: replaced ${used.size} visual cells`);
```

- [ ] **Step 4: Apply the visual cells**

Run: `node <tmpdir>/apply-visuals.mjs docs/marketing/business-script.md <tmpdir>/business-visuals.json`
Expected: `docs/marketing/business-script.md: replaced 21 visual cells`

Then `git diff --stat docs/marketing/business-script.md` shows 21 lines changed, and `git diff docs/marketing/business-script.md` changes only the middle cell of each row.

- [ ] **Step 5: Replace the Akosua production-note bullet**

In `docs/marketing/business-script.md`, replace this bullet (3 lines):

```markdown
- **Akosua Ntoma is a fictional demo business** (a Bonwire kente weaver) set up on staging for
  these videos. Any screen showing it carries a small "Demo store" label. Feature real AshantiHub
  businesses only with their permission.
```

with these two bullets:

```markdown
- **Filmed for real.** Every scene is live action in Kumasi and Bonwire, captured as set out in
  [`shoot-package.md`](shoot-package.md). No screen recordings, no scrolling and no illustrated
  or composited UI: the app appears only as a short phone insert filmed in camera, where the
  words on screen carry the claim. The only graphics are text supers and the end card. One host
  fronts the social clips and voices every promo and clip.
- **Akosua Ntoma is a fictional demo business** (a Bonwire kente weaver) set up on staging for
  these videos and portrayed on camera by a Bonwire weaver. A Kejetia trader portrays a second
  demo store for the sign-up beats. Every phone insert showing a demo store carries a *Demo
  store* super, and every end card carries one line of fine print per demo store in that video:
  *"Akosua Ntoma is a demonstration store, portrayed by a Bonwire weaver."*, and the same form,
  with the name it has on staging, for each other demo store. Feature real AshantiHub businesses
  only with their permission, and never show their orders, revenue or credit figures.
```

- [ ] **Step 6: Run the checker on the scripts**

Run: `node docs/marketing/check-shoot-package.mjs --scripts-only; echo "exit=$?"`
Expected: exit 1, with only the customer script still failing:

```
beats: 41 (end-card only: 3)
R1  customer-script.md CP 6–15s: visual mentions "scroll"
R1  customer-script.md CP 15–26s: visual mentions "app opens"
R1  customer-script.md CP 15–26s: visual mentions "logo resolves"
R1  customer-script.md CC1 3–20s: visual mentions "Scroll"
4 failure(s)
```

No `business-script.md` line and no `R6` line.

- [ ] **Step 7: Commit**

```bash
git add docs/marketing/business-script.md
git commit -F - <<'EOF'
docs(marketing): business script as real scenes

Every beat of the business promo and clips 1-3 is now a filmed scene in
Kumasi or Bonwire, with an in-camera phone insert only where the words on
screen carry the claim: Akosua's storefront, Order #1, her Credit Score with
lending partners coming soon, the free first billing cycle. Bookings and
tickets become live cuts of a braider and an event gate, since a weaver takes
neither. End cards carry the demo-store fine print. Voiceover unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YPfKHC4q3GjCvKggjVs8v1
EOF
```

---

### Task 3: Customer script visuals and production notes

**Files:**
- Modify: `docs/marketing/customer-script.md` (the *Visual / on-screen text* cell of 19 rows in the promo and Clips 1–3 tables; `CP 64–76s` is already live action and stays as it is; the *Production notes* bullet that begins `- **Akosua Ntoma is a fictional demo business**`)

**Interfaces:**
- Consumes: the checker from Task 1.
- Produces: the beat IDs `CP 0–6s` … `CP 76–88s`, `CC1 hook` … `CC3 cta`, which Task 4's setups reference. The voiceover cells are unchanged.

- [ ] **Step 1: Confirm the failing state for this file**

Run: `node docs/marketing/check-shoot-package.mjs --scripts-only`
Expected: the four `customer-script.md` R1 lines and `4 failure(s)` (Task 2 Step 6).

- [ ] **Step 2: Save the new visual cells**

Write this JSON to a temporary file, e.g. `$(mktemp -d)/customer-visuals.json`:

```json
{
  "CP 0–6s": "Kejetia from a high rooftop at dawn, busy and bright. **On-screen:** *Akwaaba.*",
  "CP 6–15s": "At home, a customer frowns at a phone, the screen facing away from camera, then sets it down. **On-screen:** *Is this seller even real?*",
  "CP 15–26s": "A real AshantiHub scout visits a weaver's shop in Bonwire, checks the GhanaPost GPS plate against the signboard and talks with the owner. Insert: the staff app marking the business **✓ Visited**. **On-screen:** *Ghana Card · Digital address · Physical check*",
  "CP 26–38s": "Quick cuts: at home, the customer adds a kente stole to the cart (insert: the cart, *Demo store* super) · a braider at work in the salon (insert: a booking confirmation, *Demo store* super) · the customer and friends walking up to the gate of a real AshantiHub-listed event (insert: the real ticket). **On-screen:** *Shop · Book · Get tickets*",
  "CP 38–50s": "A delivery rider pulls up at a gate, parcel in hand. Then, on the customer's phone, a chat headed *AshantiHub Support · Re: Handwoven kente stole* (insert, *Demo store* super).",
  "CP 50–64s": "Insert: a review with a *Verified Purchase* tag. At the event, the customer's ticket QR is scanned at the gate and checked in. At the office, a Support agent reviews a dispute (insert: the dispute). **On-screen:** *Protected, start to finish*",
  "CP 76–88s": "**End card.** Logo, gold on deep brown, with the demo-store fine print. **On-screen:** *Create your free account — theashantihub.com*",
  "CC1 hook": "The host reads a message aloud from a phone, the screen facing away, with an eye-roll to camera. **On-screen:** *Pay first?? 🚩*",
  "CC1 3–20s": "A scout's visit to a weaver's shop in Bonwire: checking the GhanaPost GPS plate and talking with the owner. Insert: a verified listing on the customer's phone, *Demo store* super. **On-screen:** *Ghana Card ✓ Digital address ✓ Physical check ✓*",
  "CC1 20–32s": "At home, the customer checks out (insert: checkout), then opens the order and taps *Raise a dispute* (insert), *Demo store* super.",
  "CC1 cta": "**End card.** Logo + URL, with the demo-store fine print.",
  "CC2 hook": "The host in the arrivals hall at Prempeh I Airport, Kumasi, with a travel bag, to camera. **On-screen:** *Coming home for December? ✈️*",
  "CC2 3–22s": "Quick cuts, each filmed live: a barber at work · a braider with a client · a caterer serving at a chop bar · kente cloth at a Bonwire shop. Inserts: a booking, and the kente stole in the cart, *Demo store* super.",
  "CC2 22–34s": "At the gate of a real AshantiHub-listed event, the customer's ticket QR is scanned and checked in. **On-screen:** *Held safely until you're checked in*",
  "CC2 cta": "**End card.** Logo + URL, with the demo-store fine print.",
  "CC3 hook": "The host, to camera at home, mock-confused. **On-screen:** *\"Why can't I WhatsApp the seller?\"*",
  "CC3 3–22s": "At home, the customer taps *🎧 Contact Support* on a kente stole listing (insert); a chat opens: *AshantiHub Support · Re: Handwoven kente stole* (insert, *Demo store* super).",
  "CC3 22–34s": "At the office, the Support agent replies (insert: the reply on the agent's laptop). At home, the customer reads it and adds the stole to the cart (insert: the cart, *Demo store* super).",
  "CC3 cta": "**End card.** Logo + URL, with the demo-store fine print."
}
```

- [ ] **Step 3: Save the throwaway apply script**

In the same temporary directory, create `apply-visuals.mjs` (not committed; the same script as Task 2, repeated so this task stands alone):

```js
// Throwaway: replaces the Visual cell of each listed beat in one script.
// Usage: node apply-visuals.mjs <script.md> <visuals.json>
import fs from "node:fs";

const [file, mapFile] = process.argv.slice(2);
const visuals = JSON.parse(fs.readFileSync(mapFile, "utf8"));
const codes = file.includes("business") ? ["BP", "BC"] : ["CP", "CC"];
let video = null;
let inTable = false;
const used = new Set();
const out = fs.readFileSync(file, "utf8").split("\n").map((line) => {
  const clip = line.match(/^### Clip (\d)\b/);
  if (/^## Promo video/.test(line)) video = codes[0];
  else if (clip) video = `${codes[1]}${clip[1]}`;
  else if (/^#{1,2} /.test(line)) video = null;
  if (/^\| (Time|Beat) \| Visual/.test(line)) {
    inTable = true;
    return line;
  }
  if (inTable && /^\|\s*-/.test(line)) return line;
  if (inTable && line.startsWith("|")) {
    const c = line.split("|").slice(1, -1).map((s) => s.trim());
    const label = c[0].match(/^(Hook|CTA),\s*(.+)$/);
    const id = `${video} ${label ? label[1].toLowerCase() : c[0]}`;
    if (!(id in visuals)) return line;
    used.add(id);
    c[1] = visuals[id];
    return `| ${c.join(" | ")} |`;
  }
  inTable = false;
  return line;
});
const missing = Object.keys(visuals).filter((id) => !used.has(id));
if (missing.length) {
  console.error(`Not found: ${missing.join(", ")}`);
  process.exit(1);
}
fs.writeFileSync(file, out.join("\n"));
console.log(`${file}: replaced ${used.size} visual cells`);
```

- [ ] **Step 4: Apply the visual cells**

Run: `node <tmpdir>/apply-visuals.mjs docs/marketing/customer-script.md <tmpdir>/customer-visuals.json`
Expected: `docs/marketing/customer-script.md: replaced 19 visual cells`

- [ ] **Step 5: Replace the Akosua production-note bullet**

In `docs/marketing/customer-script.md`, replace this bullet (3 lines):

```markdown
- **Akosua Ntoma is a fictional demo business** (a Bonwire kente weaver) set up on staging for
  these videos. Any screen showing it carries a small "Demo store" label. Swap in real AshantiHub
  businesses only with their permission.
```

with these two bullets:

```markdown
- **Filmed for real.** Every scene is live action in Kumasi and Bonwire, captured as set out in
  [`shoot-package.md`](shoot-package.md). No screen recordings, no scrolling and no illustrated
  or composited UI: the app appears only as a short phone insert filmed in camera, where the
  words on screen carry the claim. The only graphics are text supers and the end card. One host
  fronts the social clips and voices every promo and clip.
- **Akosua Ntoma is a fictional demo business** (a Bonwire kente weaver) set up on staging for
  these videos and portrayed on camera by a Bonwire weaver; the demo service business is a demo
  store too. Every phone insert showing a demo store carries a *Demo store* super, and every end
  card carries one line of fine print per demo store in that video: *"Akosua Ntoma is a
  demonstration store, portrayed by a Bonwire weaver."*, and the same form, with the name it has
  on staging, for each other demo store. Swap in real AshantiHub businesses only with their
  permission.
```

- [ ] **Step 6: Run the checker on the scripts**

Run: `node docs/marketing/check-shoot-package.mjs --scripts-only; echo "exit=$?"`
Expected: exit 0:

```
beats: 41 (end-card only: 7)
All checks pass.
```

- [ ] **Step 7: Run the Review Focus failing cases (R1, R6, R8), then restore**

```bash
cp docs/marketing/customer-script.md /tmp/customer-script.md.bak
sed -i 's/^| CTA, 34–40s | \*\*End card.\*\* Logo + URL, with the demo-store fine print. | Safer/| CTA, 34–40s | **End card.** Logo + URL. | Safer/' docs/marketing/customer-script.md
sed -i 's/Get tickets to the next big event. All in one place./Get tickets to the next big event. All in one place now./' docs/marketing/customer-script.md
sed -i 's/Kejetia from a high rooftop at dawn, busy and bright./Kejetia from a high rooftop at dawn, 500 stalls busy and bright, Mobile Money kiosks./' docs/marketing/customer-script.md
node docs/marketing/check-shoot-package.mjs --scripts-only
cp /tmp/customer-script.md.bak docs/marketing/customer-script.md
node docs/marketing/check-shoot-package.mjs --scripts-only
```

Expected from the first run (exit 1):

```
R1  customer-script.md CP 0–6s: visual mentions "Mobile Money"
R1  customer-script.md CP 0–6s: visual shows the number 500
R6  customer-script.md CP 26–38s: voiceover changed
R8  CC3: shows a demo store but no end card carries the fine print
4 failure(s)
```

Expected from the second run, after the restore: `All checks pass.` Then `git diff --stat` shows only the intended changes to `customer-script.md`.

- [ ] **Step 8: Commit**

```bash
git add docs/marketing/customer-script.md
git commit -F - <<'EOF'
docs(marketing): customer script as real scenes

Every beat of the customer promo and clips 1-3 is now a filmed scene: a real
scout's field visit for "physical check", a real event gate for the ticket
scan (a real production ticket), Prempeh I Airport for the diaspora clip, and
the host for every hook. The app appears only as in-camera inserts of the
cart, the Support chat, a verified review and a dispute. End cards carry the
demo-store fine print. Voiceover unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YPfKHC4q3GjCvKggjVs8v1
EOF
```

---

### Task 4: The live-action shoot package

**Files:**
- Rewrite: `docs/marketing/shoot-package.md` (the whole file)

**Interfaces:**
- Consumes: every beat ID produced by Tasks 2 and 3; the checker from Task 1.
- Produces: 46 setups (`KJ-01` … `HT-01`) and 21 stills (`S01` … `S21`), each referenced from the call sheet.

- [ ] **Step 1: Confirm the failing state**

Run: `node docs/marketing/check-shoot-package.mjs | tail -4`
Expected: the three `R5` lines and `37 failure(s)`: 34 `R2` lines remain (every beat except the 7 pure end cards) plus the 3 `R5` lines.

- [ ] **Step 2: Replace the whole file**

Overwrite `docs/marketing/shoot-package.md` with exactly this content:

````markdown
# AshantiHub — Shoot Package (live action)

What a small Kumasi crew needs to film every AshantiHub video and still for real: the two
60–90s promos and the six 30–45s social clips in [`customer-script.md`](customer-script.md) and
[`business-script.md`](business-script.md), plus the stills. The scripts say what each beat
shows; this package says where and how each one is captured. The design behind it is
[`2026-10-05-live-action-shoot-package-design.md`](../superpowers/specs/2026-10-05-live-action-shoot-package-design.md).

After editing the scripts or this package, run `node docs/marketing/check-shoot-package.mjs`. It
checks that every beat is captured by a setup, every setup is on the call sheet, and the scripts
describe no screen recordings or invented figures.

---

## Summary

| | |
|---|---|
| **Deliverables** | 16 video masters: the customer and business promos (about 88s each) and six social clips (30–40s), each cut 16:9 (web) and 9:16 (iOS / Android social). 21 stills. |
| **Approach** | Everything is filmed. App moments are real-world scenes, plus short phone inserts filmed in camera where the words on screen carry the claim. No screen recordings, no scrolling, no composited or illustrated UI. |
| **Crew** | 1 camera operator (mirrorless, gimbal, lav mics, basic lights), 1 producer (releases, permissions, call sheet), optional 1 sound person |
| **Shoot days** | 3 days (Kumasi city · Bonwire · office and Kumasi), plus pickups: a real event, a remote diaspora self-shoot, Manhyia, a hotel |
| **Beat names** | `CP` / `BP` = customer / business promo. `CC1`–`CC3` / `BC1`–`BC3` = customer / business clips 1–3. A beat is the video plus its script time, or `hook` / `cta` for a clip's first and last beat: `BP 0–6s`, `BC3 hook`. `S01`… are stills. |
| **Setup names** | A setup is one camera position at one location: `<location code>-<number>`, e.g. `BW-04`. Codes are in *Locations and permissions*. |

---

## Content rules (non-negotiable)

- **Real footage only.** Real places, real people, real work in Kumasi and Bonwire. No stock
  footage and no AI-generated people or places (DESIGN.md: *real Kumasi photography only*).
- **No direct contact with businesses.** Never show anyone WhatsApp-ing, calling or chatting with
  a seller. Enquiries go to AshantiHub Support.
- **No payment brands** (Mobile Money, Hubtel, card logos), **no app-store buttons or "download
  the app"**, and no third-party platform branding on any screen or signboard in shot.
- **Frame out third-party branding.** MTN MoMo kiosks, bank logos and telecom signboards are
  everywhere at Kejetia. Reframe or move rather than blur.
- **No invented numbers.** Prices only as in the scripts: "plans from GHS 10/month", "first
  billing cycle free". Lending partners are only ever "coming soon". Counts on screen come from
  real staging data, never typed in.
- **No real identity data on screen.** No legible Ghana Card, no real phone numbers, no real
  customers' names in inserts. Demo data only.
- **Demo stores are labelled as portrayals.** A *Demo store* super on every insert showing a demo
  store. Every end card carries one line of fine print per demo store in that video:
  *"Akosua Ntoma is a demonstration store, portrayed by a Bonwire weaver."*, and the same form,
  with the name it has on staging, for the Kejetia trader's store and the demo service business.
- **Real businesses appear as themselves, with permission.** Their own storefront appears in an
  insert only with explicit consent. Their orders, revenue or credit figures never appear.

---

## Cast

| Role | Who | Days | Appears in |
|---|---|---|---|
| Host | Talent: warm, Twi-fluent. Fronts all six clip hooks and voices every promo and clip | 1, 2, 3 | `CC1`–`CC3`, `BC1`–`BC3`; all VO |
| "Akosua" | A real Bonwire weaver portraying the fictional *Akosua Ntoma* demo store. Must genuinely weave | 2, 3 | `BP`, `BC2`, `BC3`, `CP`, `CC1`, stills |
| Kejetia trader | Talent portraying a second demo store (named when it is created on staging) | 1, 3 | `BP 70–80s`, `BC1`, `BC2 3–18s` |
| Demo customer | Talent. Also buys a real ticket on production for the event pickup | 3, pickup | `CP`, `CC1`–`CC3`, `BP 60–70s` |
| Scout | A real AshantiHub scout | 2, 3 | `CP 15–26s`, `CC1 3–20s` |
| Support agent | A real AshantiHub Support staffer | 3 | `BP 38–48s`, `BC3 3–20s`, `CP 50–64s`, `CC3 22–34s` |
| Real businesses, as themselves | A Suame mechanic, a chop-bar cook, a braider, a barber, an event organiser; ideally all listed on AshantiHub | 1, pickup | `BP 0–6s`, `BP 25–38s`, `BC3 20–32s`, `CP 26–38s`, `CC2` |
| Delivery rider | A real rider | 1, 2 | `CP 38–50s`, `BP 25–38s`, `BC3 20–32s` |
| Family | A real Kumasi family | 1 | `CP 64–76s` |
| Diaspora talent | Self-films abroad from a brief | Remote | `CP 64–76s` |
| Friends at the event | Extras, each under release | Pickup | `CP 26–38s` |

Before filming, swap any example category (barber, braider, caterer, fabric) for one actually
listed on the site, as the customer script requires.

---

## Locations and permissions

| Code | Location | Day | Permission needed |
|---|---|---|---|
| KJ | Kejetia: a high rooftop, and a trader's stall at Kejetia or Adum | 1 | Kumasi Metropolitan Assembly filming permission; the rooftop owner's property release; a GCAA permit only if a drone is used |
| SU | A Suame Magazine workshop | 1 | Workshop owner's property release |
| CB | A chop bar | 1 | Owner's property release |
| SL | A braider's salon and an adjacent barbershop | 1 | Property releases from both |
| GT | A residential gate (Ahodwo or Santasi) | 1 | Homeowner's property release |
| FH | A family home in Kumasi | 1 | Homeowner's property release |
| BW | Bonwire: Akosua's loom, stall and shop | 2 | A courtesy visit to the Bonwire chief and elders before filming; the owner's property release |
| OF | The AshantiHub office | 3 | — |
| AP | An apartment in Kumasi | 3 | Owner's property release |
| CF | A café in Kumasi | 3 | Owner's property release |
| AR | Prempeh I Airport arrivals hall | 3 | Ghana Airports Company permission |
| EV | A real AshantiHub-listed event | Pickup | The organiser's permission |
| RM | Remote: the diaspora talent abroad | Pickup | Talent release (self-shot) |
| MH | Manhyia Palace | Pickup | Manhyia Palace permission |
| HT | A hotel listed on AshantiHub | Pickup | The hotel's consent and property release |

---

## Call sheet

### Day 1 — Kumasi city

| Time | Location | Setups | On call |
|---|---|---|---|
| 06:00–07:45 | KJ rooftop (crew call 06:00, first shot 06:30) | KJ-01 | Crew |
| 08:00–10:00 | KJ trader's stall | KJ-02, KJ-04, KJ-03, KJ-05, KJ-06 | Host, Kejetia trader |
| 10:30–11:45 | SU | SU-01 | The mechanic |
| 12:15–13:30 | CB (lunch on location) | CB-01, CB-02 | The cook |
| 14:00–15:30 | SL | SL-01, SL-02 | The braider and a client, the barber |
| 16:00–16:45 | GT | GT-01 | Rider |
| 17:15–18:15 | FH | FH-01 | The family |

### Day 2 — Bonwire

| Time | Location | Setups | On call |
|---|---|---|---|
| 06:45 | Leave Kumasi (allow an hour) | — | Crew, host, scout, rider |
| 08:00–08:30 | Courtesy visit to the chief and elders, arranged by the producer in advance | — | Producer |
| 08:30–10:30 | BW loom | BW-01, BW-06, BW-04, BW-07, BW-08 | Akosua |
| 10:30–11:30 | BW stall and shop | BW-02, BW-03, BW-13 | Akosua |
| 11:30–12:30 | BW loom | BW-09, BW-10 | Host, Akosua |
| 13:15–14:30 | BW shop door | BW-11, BW-12 | Scout, Akosua |
| 14:30–15:15 | BW outside the shop | BW-05 | Rider |
| 15:15–16:30 | Bonwire B-roll, then back to Kumasi | — | Crew |

### Day 3 — Office and Kumasi

| Time | Location | Setups | On call |
|---|---|---|---|
| 08:00–11:00 | OF | OF-01, OF-02, OF-03, OF-04, OF-05, OF-06 | Support agent; Akosua, the Kejetia trader, the scout and the demo customer for their own inserts, in the same sleeves as their scenes |
| 11:00–11:45 | OF, a quiet room | Host VO recording (see *Audio*) | Host |
| 12:30–14:30 | AP | AP-01, AP-02, AP-03 | Demo customer, host |
| 15:00–16:00 | CF | CF-01, CF-02 | Demo customer |
| 16:30–17:30 | AR (the slot agreed with Ghana Airports Company) | AR-01 | Host |

### Pickups

| When | Location | Setups | On call |
|---|---|---|---|
| The date of the chosen AshantiHub-listed event | EV | EV-01, EV-02, EV-03, EV-04 | Demo customer and friends; the organiser |
| Any time before the edit | RM | RM-01 | Diaspora talent (brief and release sent in advance) |
| An Akwasidae day (the exterior any day) | MH | MH-01, MH-02 | Camera operator, producer |
| When a listed hotel consents | HT | HT-01 | Camera operator |

---

## Setups by location

`Both` = shoot a separate vertical take. `Centre-safe` = shoot 16:9 and keep the subject inside
the centre third (the 9:16 crop of a 16:9 frame is its middle 31.6%). `Vertical` = shoot 9:16 only.

### KJ — Kejetia and Adum (Day 1)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| KJ-01 | Kejetia from a high rooftop at dawn: the market waking, traffic, stalls; a wider frame across the city | Wide, slow push-in or slow pan right; locked-off alternative. Drone only with a GCAA permit | `CP 0–6s`, `S02`, `S08` | 20s × 3 | Both (vertical take: tilt down over the stalls) |
| KJ-02 | Host at a busy stall reads a message aloud from a phone, screen facing away, then an eye-roll to camera; then a portrait with room for a headline | Medium close, eye-level, host centred; stall life behind, faces incidental | `CC1 hook`, `S09` | 15s × 5 | Both |
| KJ-03 | The Kejetia trader signs up on a phone at the stall. Take A alone; take B with the host alongside | Medium, then close on hands. The screen is not legible here; its inserts are OF-04 | `BP 70–80s`, `BC1 3–20s` | 20s × 3 per take | Both |
| KJ-04 | Host at the trader's stall holds up an empty wallet, grinning, to camera | Medium close, host centred | `BC1 hook` | 15s × 5 | Both |
| KJ-05 | The trader's phone lights up; a smile at it | Over-the-shoulder, then reverse on the face | `BC1 20–32s`, `S16` | 15s × 3 | Both |
| KJ-06 | Stall montage: goods handed over, cash changing hands, nothing written down | Tight details on hands and goods, handheld; buyers' faces out of frame or out of focus | `BC2 3–18s`, `S12` | 10s × 6 details | Both |

### SU — Suame Magazine (Day 1)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| SU-01 | A Suame mechanic, as themselves, working under a bonnet; tools on the bench | Low medium, light handheld; then a tight detail of hands and spanner | `BP 0–6s`, `S05`, `S17` | 20s × 3 | Centre-safe |

### CB — Chop bar (Day 1)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| CB-01 | The cook stirring a large pot, steam rising | Medium close, side light from the doorway | `BP 0–6s`, `S07` | 20s × 3 | Centre-safe |
| CB-02 | Bowls served to a full bench: the chop bar as caterer | Medium; customers' faces incidental or released | `CC2 3–22s` | 15s × 3 | Both |

### SL — Salon and barbershop (Day 1)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| SL-01 | A braider, as themselves, at work with a client in the chair | Medium, then a tight detail of the hands braiding | `CP 26–38s`, `BP 25–38s`, `BC3 20–32s`, `CC2 3–22s`, `S19` | 20s × 3 | Both |
| SL-02 | A barber, as themselves, at work: clippers, a finished fade | Medium close; no product branding in frame | `CC2 3–22s` | 20s × 3 | Both |

### GT — Residential gate (Day 1)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| GT-01 | A delivery rider pulls up on a motorbike at a Kumasi residential gate, parcel in hand | Medium-wide from the gate side; the rider enters frame, stops, lifts the parcel. Plate out of shot unless released | `CP 38–50s`, `S14` | 20s × 3 | Both |

### FH — Family home (Day 1)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| FH-01 | A Kumasi family laughing together at home | Framed vertically for the split screen; eye-level, natural light at dusk | `CP 64–76s`, `S20` | 20s × 3 | Vertical |

### BW — Bonwire (Day 2)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| BW-01 | Akosua weaving: hands, shuttle, the strip growing | Tight on hands, then medium; slow slider or handheld drift | `BP 0–6s`, `S03` | 30s × 3 | Both |
| BW-02 | Akosua at her stall as foot traffic passes without stopping | Wide, locked off, Akosua in the centre third | `BP 6–14s` | 20s × 3 | Centre-safe |
| BW-03 | Akosua photographs a finished kente strip on her phone in the shop | Medium over the shoulder, then on her face | `BP 14–25s` | 20s × 3 | Both |
| BW-04 | Akosua's phone on the loom bench. Take A: it buzzes once; she glances and smiles. Take B: it buzzes again and again, screen unreadable; she turns it face-down and weaves | Close on the bench with the loom behind; focus pull to Akosua | `BP 25–38s`, `BC3 hook`, `BC3 3–20s`, `S18` | 15s × 3 per take | Both |
| BW-05 | The rider loads a parcel onto a motorbike outside the shop, turns and leaves frame | Medium-wide | `BP 25–38s`, `BC3 20–32s` | 20s × 3 | Both |
| BW-06 | Akosua keeps weaving | Wide over the shoulder, with room above her for headline text | `BP 38–48s`, `BC3 3–20s`, `S15` | 20s × 3 | Both |
| BW-07 | Akosua at the loom bench checks her dashboard on her phone | Medium. The screen is not legible here; its inserts are OF-03 | `BP 48–60s`, `BC2 18–32s` | 15s × 3 | Both |
| BW-08 | Akosua looks up from the loom and smiles | Medium close, eye-level, hold 3s after the smile | `BP 80–88s`, `S10` | 15s × 5 | Both |
| BW-09 | Akosua holds a loan form with *Financial records* circled in red (a prop: no bank name or logo); the host beside her, to camera | Medium two-shot | `BC2 hook` | 15s × 5 | Both |
| BW-10 | Host at the loom, to camera, as the phone buzzes behind | Medium close, host centred, loom soft behind | `BC3 hook` | 15s × 5 | Both |
| BW-11 | A real AshantiHub scout arrives at Akosua's shop and checks the GhanaPost GPS plate against the signboard | Wide, then a detail of the plate. No third-party logos on the signboard | `CP 15–26s`, `CC1 3–20s` | 20s × 3 | Both |
| BW-12 | The scout talks with Akosua at the shop door | Medium two-shot. No Ghana Card legible at any point | `CP 15–26s`, `CC1 3–20s`, `S21` | 20s × 3 | Both |
| BW-13 | Finished kente cloth on display in the shop | Slow tilt across the cloth, then tight textures | `CC2 3–22s`, `S13` | 15s × 3 | Both |

### OF — AshantiHub office (Day 3)

Every phone and laptop insert is filmed here under controlled light, following the
*Phone-insert protocol*.

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| OF-01 | A real AshantiHub Support agent answers enquiries and reviews a dispute at a desk | Medium on the agent, practical desk light | `BP 38–48s`, `BC3 3–20s`, `CP 50–64s`, `CC3 22–34s` | 20s × 3 | Centre-safe |
| OF-02 | The agent's laptop: the staff inbox reply, then the dispute | Over-the-shoulder insert, browser fullscreen, screen legible | `BP 38–48s`, `BC3 3–20s`, `CP 50–64s`, `CC3 22–34s` | 10s × 3 per screen | Centre-safe |
| OF-03 | Akosua's phone: her storefront, Order #1, her orders, her Credit Score with *Lending partners coming soon* | Insert; Akosua's own hands and Day 2 sleeve | `BP 14–25s`, `BP 25–38s`, `BP 48–60s`, `BC2 18–32s`, `BC3 20–32s` | 10s × 3 per screen | Both |
| OF-04 | The trader's phone: the registration steps on the throwaway account, the plan step with *Your first billing cycle is FREE*, then the second demo store's storefront and its first order | Insert; the trader's own hands and Day 1 sleeve | `BP 70–80s`, `BC1 3–20s`, `BC1 20–32s` | 10s × 3 per screen | Both |
| OF-05 | The demo customer's phone: the kente stole listing and *🎧 Contact Support*, the Support chat and its reply, the cart, checkout, *Raise a dispute*, a verified listing, a review with *Verified Purchase*, the demo service booking | Insert; the demo customer's own hands and Day 3 sleeve | `CP 26–38s`, `CP 38–50s`, `CP 50–64s`, `CC1 3–20s`, `CC1 20–32s`, `CC2 3–22s`, `CC3 3–22s`, `CC3 22–34s` | 10s × 3 per screen | Both |
| OF-06 | The scout's phone: the staff app marking Akosua's shop **✓ Visited** | Insert; the scout's own hands and Day 2 sleeve | `CP 15–26s`, `CC1 3–20s` | 10s × 3 | Both |

### AP — Apartment (Day 3)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| AP-01 | The demo customer frowns at a phone, screen facing away from camera, then sets it down | Medium close, window light | `CP 6–15s` | 20s × 3 | Both |
| AP-02 | The demo customer on the sofa with a phone: adds to cart, checks out, raises a dispute, taps Contact Support, reads the reply | Medium, then over-the-shoulder. The screen is not legible here; its inserts are OF-05 | `CP 26–38s`, `CC1 20–32s`, `CC3 3–22s`, `CC3 22–34s` | 15s × 3 per action | Both |
| AP-03 | Host to camera, mock-confused | Medium close, host centred | `CC3 hook` | 15s × 5 | Both |

### CF — Café (Day 3)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| CF-01 | The demo customer at a café table browsing theashantihub.com on a laptop | Medium | `BP 60–70s` | 15s × 3 | Centre-safe |
| CF-02 | The laptop: the homepage Hero showing Akosua's shop | Over-the-shoulder insert, browser fullscreen, screen legible | `BP 60–70s` | 10s × 3 | Centre-safe |

### AR — Prempeh I Airport (Day 3)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| AR-01 | Host in the arrivals hall with a travel bag, to camera | Medium; travellers incidental or out of focus; no airline or bank logos in frame | `CC2 hook`, `S11` | 15s × 5 | Both |

### EV — A real AshantiHub-listed event (pickup)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| EV-01 | The demo customer and friends walk up to the gate | Medium-wide from inside the gate | `CP 26–38s`, `BP 25–38s` | 20s × 3 | Both |
| EV-02 | The demo customer's real ticket on the phone | Insert, following the *Phone-insert protocol* | `CP 26–38s` | 10s × 3 | Both |
| EV-03 | The ticket QR is scanned at the gate | Close-up of the phone and the scanner hand, shallow focus | `CP 50–64s`, `CC2 22–34s` | 15s × 3 | Centre-safe |
| EV-04 | The organiser's check-in screen confirming the check-in | Insert, with the organiser's consent; no other attendee's details visible | `CP 50–64s`, `CC2 22–34s` | 10s × 3 | Centre-safe |

### RM — Remote (pickup)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| RM-01 | The diaspora talent in a winter coat, outdoors abroad, smiling at a phone | Self-shot on a phone, eye-level, natural light; brief and release sent in advance | `CP 64–76s` | 20s × 3 | Vertical |

### MH — Manhyia Palace (pickup)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| MH-01 | Manhyia Palace exterior | Wide, morning light | `S01` | Stills | — |
| MH-02 | Akwasidae: the procession and celebration | Wide and medium, as the palace permits | `S04` | Stills | — |

### HT — A hotel listed on AshantiHub (pickup)

| Setup | Subject / action | Framing & movement | Serves | Capture | Crops |
|---|---|---|---|---|---|
| HT-01 | The hotel's exterior and lobby | Wide, with the hotel's consent | `S06` | Stills | — |

---

## Phone-insert protocol

- **One clean phone per character**, no case, the same handset in that character's scenes and
  inserts. Notifications silenced, brightness matched to the scene, shutter 1/50 to avoid
  flicker.
- **The hands are the character's own**, in the same sleeve as their scenes. Akosua, the Kejetia
  trader, the scout and the demo customer attend Day 3 for their inserts.
- **The app runs as the installed PWA**, so no browser bar shows `test.theashantihub.com`. The
  laptop runs the browser fullscreen.
- **Accounts:** demo-store and demo-customer inserts use the staging demo accounts. Real-business
  inserts use production, with consent. The event ticket is a real production ticket.
- **Hold each insert 2–3s**, centre-safe for the 9:16 crop, with the words that carry the claim
  readable.
- **Test identity data only.** No Ghana Card on screen, no real phone numbers, no real customers'
  names.
- **If an insert is unreadable, reshoot it.** Never replace a screen in post.
- The *Demo store* super is added in the edit to every insert that shows a demo store.

---

## Staging prep for phone inserts

The inserts show the real app, so these must exist on staging before Day 3, created the same way
as the existing demo data (`seed_demo.py` and real flows).

| Needed for | On staging |
|---|---|
| `CP 26–38s`, `CC2 3–22s` | A demo service business + listing, booked by the demo customer |
| `CP 50–64s`, `BP 14–25s` | A real review by the demo customer on Order #1, approved through moderation |
| `CP 50–64s`, `CC1 20–32s` | A dispute raised by the demo customer on a demo order |
| `BP 60–70s` | A Hero submission by Akosua Ntoma, approved by staff |
| `CP 15–26s`, `CC1 3–20s` | A scout assignment for Akosua Ntoma, ready to mark **Visited** on camera |
| `BC1 3–20s`, `BP 70–80s` | A throwaway business account for the registration inserts (stopped before submitting), with test identity data |
| `BC1 20–32s` | The second demo store: approved, one listing, one demo order from the demo customer |

**On production, with consent (not staging):** the demo customer buys a real ticket for a real
AshantiHub-listed event, and the organiser checks that ticket in at the gate (`CP 26–38s`,
`CP 50–64s`, `CC2 22–34s`). The organiser consents to the gate and their check-in screen being
filmed.

---

## Stills shot list

Shot alongside the video by the same crew. Full-resolution JPEG plus RAW, with releases logged
per frame.

| Still | Use | Subject | Formats |
|---|---|---|---|
| S01 | Website: Manhyia Palace | The palace exterior | 16:9 |
| S02 | Website: Kejetia market | The market from the rooftop at dawn | 16:9 |
| S03 | Website: kente weaving | Akosua's hands at the loom | 16:9, 4:5 |
| S04 | Website: Akwasidae | The festival at Manhyia | 16:9 |
| S05 | Website: Suame | The mechanic at work | 16:9 |
| S06 | Website: hotel | A listed hotel that consents | 16:9 |
| S07 | Website: chop bar | The cook at the pot | 16:9 |
| S08 | Website: Kumasi aerial | The city from the rooftop | 16:9 |
| S09 | Poster / thumbnail | The host at a Kejetia stall, room for a headline | 16:9, 4:5, 9:16 |
| S10 | Poster / thumbnail | Akosua's smile at the loom, room for a headline | 16:9, 4:5, 9:16 |
| S11 | WhatsApp Status | The host at arrivals | 9:16 |
| S12 | WhatsApp Status | Kejetia stall life | 9:16 |
| S13 | WhatsApp Status | Kente cloth close-up | 9:16 |
| S14 | WhatsApp Status | The rider at the gate | 9:16 |
| S15 | Headline: *Let the world find you.* | Akosua weaving, wide, room above her | 16:9, 4:5 |
| S16 | Headline: *Nothing to pay to join. Your first billing cycle is on us.* | The trader smiling at the phone | 16:9, 4:5 |
| S17 | Headline: *Your hustle deserves a track record.* | The mechanic at work | 16:9, 4:5 |
| S18 | Headline: *Less chasing. More selling.* | The phone face-down on the loom bench, Akosua weaving | 16:9, 4:5 |
| S19 | Headline: *Sell. Take bookings. Sell tickets. All from one page.* | The braider with a client | 16:9, 4:5 |
| S20 | Headline: *From Kejetia to the diaspora, in one tap.* | The family at home | 16:9, 4:5 |
| S21 | Headline: *Verified. Trusted. Found.* | The scout and Akosua at the shop door | 16:9, 4:5 |

The website stills replace the third-party photos that `frontend/App.jsx` (`KUMASI_PHOTOS`)
hotlinks today; swapping them in is a separate change.

---

## B-roll (grab whenever there's a spare minute)

| Location | Shots |
|---|---|
| Kejetia / Adum | Stall details (cloth, produce, sandals), hands exchanging goods, trotros, a seller arranging a display |
| Bonwire | Finished kente strips stacked, shuttles and heddles close-up, threads on spools, the village signboard (if no third-party logos) |
| Suame | Tools on a bench, sparks or a welding glow (safe distance), a finished repair driving off |
| Chop bar | Bowls being served, fufu being pounded, a full bench of customers (releases or faces out of focus) |
| Salon and barbershop | Combs, braiding hair, clippers on a shelf (no product branding) |
| Streets | An okada or rider passing, a gate opening, evening lights in Kumasi |
| Airport | Luggage trolleys, a welcome hug (released); no airline logos |

---

## Audio

- **No music on set.** The music beds and the voiceover are added in the edit.
- Capture clean **natural sound** with every shot: loom shuttle clack, market hubbub, spanner on
  metal, pot stirring and sizzle, clippers, a motorbike arriving, the gate scanner.
- Record **30s of room tone** at every location (everyone silent, same mic position).
- **The host's hooks are sync sound:** a lav on the host plus a backup recorder; slate every take.
- **Host VO, Day 3, 11:00–11:45**, in a quiet room at the office: both promos and all six clips,
  three passes of each, on the lav plus the backup recorder, 48 kHz WAV.
- No talking behind the camera during takes. Note any noisy takes in the log.

---

## Release-form checklist

- [ ] **Host:** a paid talent release covering AshantiHub web and social video ads, with a stated
  term of use.
- [ ] **Akosua:** a portrayal release stating she plays the fictional *Akosua Ntoma* demo store.
- [ ] **Kejetia trader:** a portrayal release stating they play the second demo store.
- [ ] **Real businesses** (mechanic, cook, braider, barber, organiser, hotel): a personal release
  plus the business's consent to show its premises, name and signboard. Their storefront appears
  in an insert only with explicit consent; their orders, revenue or credit figures never appear.
- [ ] **Everyone else on camera:** scout, Support agent, rider, demo customer, friends at the
  event, the family, the diaspora talent. A release each.
- [ ] **Guardian consent** for anyone under 18.
- [ ] **Riders' plates** out of shot unless consented.
- [ ] **Property releases:** the rooftop, workshop, chop bar, salon, barbershop, the gate's home,
  the family home, the Bonwire shop, the apartment, the café, the hotel.
- [ ] **Permissions:** Kumasi Metropolitan Assembly (Kejetia), GCAA (drone, if used), Ghana
  Airports Company (Prempeh I), Manhyia Palace, the Bonwire chief and elders (courtesy visit), the
  event organiser.
- [ ] **Crowds:** faces incidental or out of focus. Ghana's Data Protection Act, 2012 (Act 843)
  expects consent for identifiable people used commercially.
- [ ] Scans of every signed release saved with the footage, logged in a sheet (name · setup ·
  date · contact).

---

## Post-production

- **Voiceover:** the host's Day 3 recording. Before then, the editor rough-cuts against a scratch
  VO generated with the local ElevenLabs tooling in `marketing/video/`.
- **Music:** ElevenLabs instrumental highlife beds, generated to each final cut's length (one per
  promo, one per clip). Confirm before publishing that the ElevenLabs plan's terms allow
  commercial use of Eleven Music output.
- **Edit:** the crew's editor in Resolve or Premiere, on 30 fps timelines. The Remotion project is
  not part of the live-action edit; its end card is supplied as a reference render.
- **Style sheet** (from DESIGN.md):
  - Headings and end-card lines: **Fraunces**, weight 500–600. Supers and captions: **Plus
    Jakarta Sans**.
  - Gold `#D4A017` on dark brown `#2C1810` for the end card, with the woven kente edge; cream
    `#FDF6E3` and light gold `#F5DEB3` for supers on dark footage.
  - Supers centre-safe, and in 9:16 clear of the bands where Reels, TikTok and Shorts overlay
    their own controls.
- **Masters:** 16 MP4s (2 promos and 6 clips, each in 16:9 and 9:16). H.264, captions burned in,
  mixed to −14 LUFS integrated with true peaks at or below −1 dBTP. Plus an SRT per video for
  YouTube and the web, and thumbnails from the stills.
- **Review gate:** each rough cut is checked before it is finalised:
  - every claim matches what the app does today
  - *Demo store* supers and the end-card fine print are present
  - no third-party logos in frame
  - every identifiable face has a logged release

  Nothing is published until the checklist passes.

---

## Delivery spec

| | |
|---|---|
| **Resolution** | 3840×2160 (4K UHD) preferred, 1920×1080 minimum. Vertical takes 2160×3840 or 1080×1920 |
| **Frame rate** | **30 fps** for everything (the edit timeline is 30 fps; don't mix 25 and 30) |
| **Shutter** | 1/60 outdoors; **1/50 or 1/100 under indoor mains lighting** to avoid 50 Hz flicker |
| **Codec** | H.264/H.265 at ≥ 50 Mbps, or ProRes. Flat or log profile optional; if log, name the LUT |
| **Audio** | 48 kHz, on-camera or a separate recorder; room tone and VO as separate `.wav` files |
| **File naming** | `<setup>_take<n>.mp4`, with `_v` for a vertical take: `BW-04_take2_v.mp4`. Stills `<still>_<setup>_<frame>.jpg`: `S03_BW-01_0012.jpg`. Room tone `roomtone_<location code>.wav`. VO `vo_<video>_pass<n>.wav`: `vo_BP_pass2.wav` |
| **Hand-off** | One folder per shoot day and pickup, plus a `releases/` folder and the shot log (setup · take · notes · best take) |
````

- [ ] **Step 3: Run the full checker**

Run: `node docs/marketing/check-shoot-package.mjs; echo "exit=$?"`
Expected: exit 0:

```
beats: 41 (end-card only: 7), setups: 46, stills: 21
All checks pass.
```

- [ ] **Step 4: Run the Review Focus failing cases (R2, R3, R9), then restore**

```bash
cp docs/marketing/shoot-package.md /tmp/shoot-package.md.bak
sed -i 's/| `BP 6–14s` | 20s × 3 | Centre-safe |/| `BP 6–41s` | 20s × 3 | Centre-safe |/' docs/marketing/shoot-package.md
sed -i 's/| 16:00–16:45 | GT | GT-01 | Rider |/| 16:00–16:45 | GT | — | Rider |/' docs/marketing/shoot-package.md
node docs/marketing/check-shoot-package.mjs
cp /tmp/shoot-package.md.bak docs/marketing/shoot-package.md
node docs/marketing/check-shoot-package.mjs
```

Expected from the first run (exit 1):

```
R9  GT-01: not on the call sheet
R3  BW-02: serves unknown "BP 6–41s"
R2  BP 6–14s: no setup serves it
3 failure(s)
```

Expected from the second run: `All checks pass.`

- [ ] **Step 5: Read it once as the crew would**

Open the rendered file (e.g. on GitHub after the push in Task 5, or any Markdown preview) and check that every table renders (no broken pipes), and that the links to the two scripts and the spec resolve.

- [ ] **Step 6: Commit**

```bash
git add docs/marketing/shoot-package.md
git commit -F - <<'EOF'
docs(marketing): live-action shoot package

Rewritten around 46 numbered setups across Kejetia, Suame, a chop bar, a
salon and barbershop, a residential gate, a family home, Bonwire, the office,
an apartment, a cafe and Prempeh I Airport, plus pickups (a real event,
remote, Manhyia, a hotel). Each setup lists the beats and stills it serves,
and a three-day call sheet schedules them. Adds the phone-insert protocol,
staging prep, 21 stills (including owned replacements for the site's
hotlinked photos), releases and permissions, and the post-production style
sheet. The App, Gap and Graphic rows are gone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YPfKHC4q3GjCvKggjVs8v1
EOF
```

---

### Task 5: Close out and open the PR

**Files:**
- Modify: `docs/superpowers/specs/2026-10-05-live-action-shoot-package-design.md:4` (status line)

**Interfaces:**
- Consumes: the commits from Tasks 1–4 on `feature/live-action-shoot-package`.
- Produces: a PR into `righteoushack` (not merged).

- [ ] **Step 1: Mark the spec implemented**

In the spec, replace the line `**Status:** Approved design, not yet implemented` with:

```markdown
**Status:** Implemented 2026-10-05 (branch feature/live-action-shoot-package)
```

- [ ] **Step 2: Final check**

Run: `node docs/marketing/check-shoot-package.mjs && git status --short`
Expected: `All checks pass.`; the only change listed is the spec (plus the unrelated `.claude/settings.local.json`, which is never committed).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-05-live-action-shoot-package-design.md
git commit -F - <<'EOF'
docs(marketing): mark the live-action shoot package spec implemented

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YPfKHC4q3GjCvKggjVs8v1
EOF
```

- [ ] **Step 4: Push the branch**

Run: `git push -u origin feature/live-action-shoot-package`
Expected: the branch is created on origin. (Its upstream was `origin/righteoushack` when it was created; `-u` points it at its own remote branch.)

- [ ] **Step 5: Open the PR into `righteoushack`**

`gh pr create` and `gh pr edit` can fail on this repo with a GraphQL "Projects (classic)" error, so use the REST API:

```bash
cat > /tmp/pr-body.md <<'EOF'
Marketing docs only. This changes no app code, and nothing here deploys.

## What's in it
- **`docs/marketing/business-script.md`, `customer-script.md`:** every beat of both promos and all six social clips is now a real, filmed scene. The app appears only as short phone inserts filmed in camera where the words on screen carry a claim. Voiceover unchanged.
- **`docs/marketing/shoot-package.md`:** rewritten around 46 numbered setups by location, a three-day call sheet plus pickups, the phone-insert protocol, staging prep, 21 stills, releases and permissions, post-production and delivery.
- **`docs/marketing/check-shoot-package.mjs`:** `node docs/marketing/check-shoot-package.mjs` checks that every beat has a setup, every setup is scheduled, no visual describes a screen recording or an invented figure, demo stores carry fine print, and the voiceover is unchanged.
- **Spec and plan:** `docs/superpowers/specs/2026-10-05-live-action-shoot-package-design.md`, `docs/superpowers/plans/2026-10-05-live-action-shoot-package.md`.

## Before the shoot (not in this PR)
- Create the staging data in the package's *Staging prep for phone inserts*.
- The screen-led Remotion clips are retired and stay unpublished.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01YPfKHC4q3GjCvKggjVs8v1
EOF
gh api repos/Kamankwah/TheAshantihub/pulls \
  -f title="Marketing: live-action shoot package and scripts" \
  -f head=feature/live-action-shoot-package -f base=righteoushack \
  -F body=@/tmp/pr-body.md --jq .html_url
```

Expected: the PR URL. Do not merge it; merging waits for the user.
