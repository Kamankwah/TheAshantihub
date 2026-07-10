# Frontend Directory Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every frontend-specific file from the repo root into a new `frontend/` directory, mirroring `backend/`'s already-self-contained pattern, per `docs/superpowers/specs/2026-07-10-frontend-directory-restructure-design.md`.

**Architecture:** A pure structural move — `git mv` every frontend file/directory into `frontend/` as one unit, preserving relative structure so no internal import paths change. No new code, no behavior changes. `docker-compose.yml` is untouched (it never referenced frontend paths). `CLAUDE.md` gets its "Commands"/"Project structure" sections updated to describe the new layout.

**Tech Stack:** No new dependencies. Same Vite/React/Vitest stack, just relocated.

## Global Constraints

- No code/behavior changes of any kind beyond path relocation — this is a pure move.
- Every moved file's relative position to every other moved file stays identical, so internal relative imports (`./hooks/...`, `../apiClient.js`, `./App.jsx`, `../mocks/server.js`, `./test/setup.js`, etc.) require zero edits.
- `backend/`, `docs/`, `docker-compose.yml`, `.gitignore`, `.mcp.json`, `.vscode/` stay at the repo root, untouched.
- After the move, all frontend commands (`npm install`, `npm run dev`, `npm run build`, `npm run test`) run from inside `frontend/`, not the repo root.
- The Vercel dashboard's "Root Directory" setting needs a manual change to `frontend` after this lands — flagged to the user, not something this plan's tasks can do (no dashboard access).

---

## File Structure

```
frontend/                    # new directory, receives everything below
  App.jsx
  main.jsx
  index.html
  apiClient.js
  apiClient.test.js
  Card.test.jsx
  MapView.test.jsx
  hooks/
  mocks/
  test/
  package.json
  package-lock.json
  vite.config.js
  vercel.json
  .env.example
  favicon.svg
  manifest.json
  sw.js
  node_modules/               # regenerated via `npm install`, not moved (gitignored)
  dist/                       # regenerated via `npm run build`, not moved (gitignored)
CLAUDE.md                     # modified: Commands + Project structure sections updated
```

---

### Task 1: Move frontend files into `frontend/`, verify tests/build/docker unaffected

**Files:**
- Move: `App.jsx`, `main.jsx`, `index.html`, `apiClient.js`, `apiClient.test.js`, `Card.test.jsx`, `MapView.test.jsx`, `hooks/`, `mocks/`, `test/`, `package.json`, `package-lock.json`, `vite.config.js`, `vercel.json`, `.env.example`, `favicon.svg`, `manifest.json`, `sw.js` → all into `frontend/`
- Delete: root-level `node_modules/`, `dist/` (regenerable, gitignored, would otherwise be orphaned dead weight at the repo root)

**Interfaces:**
- Consumes: nothing — no code changes, just relocation.
- Produces: `frontend/` as a fully self-contained frontend project (mirrors `backend/`'s pattern). `npm install`/`npm run test`/`npm run build`/`npm run dev` all run correctly from inside `frontend/`.

- [ ] **Step 1: Move every frontend file/directory into `frontend/` in one commit**

Run from the repo root:
```bash
mkdir -p frontend
git mv App.jsx frontend/App.jsx
git mv main.jsx frontend/main.jsx
git mv index.html frontend/index.html
git mv apiClient.js frontend/apiClient.js
git mv apiClient.test.js frontend/apiClient.test.js
git mv Card.test.jsx frontend/Card.test.jsx
git mv MapView.test.jsx frontend/MapView.test.jsx
git mv hooks frontend/hooks
git mv mocks frontend/mocks
git mv test frontend/test
git mv package.json frontend/package.json
git mv package-lock.json frontend/package-lock.json
git mv vite.config.js frontend/vite.config.js
git mv vercel.json frontend/vercel.json
git mv .env.example frontend/.env.example
git mv favicon.svg frontend/favicon.svg
git mv manifest.json frontend/manifest.json
git mv sw.js frontend/sw.js
```

- [ ] **Step 2: Remove the now-orphaned root-level build artifacts**

These are gitignored (not tracked), so this is a plain filesystem cleanup, not a git operation:
```bash
rm -rf node_modules dist
```

- [ ] **Step 3: Verify nothing frontend-related remains at the repo root**

Run: `ls` (repo root)
Expected: only `backend/`, `frontend/`, `docs/`, `docker-compose.yml`, `CLAUDE.md`, `.gitignore`, `.gitattributes`, `.mcp.json`, `.vscode/`, `.claude/`, `.superpowers/`, `.git` remain (plus this plan's own worktree/process directories if present) — no `App.jsx`, `main.jsx`, `package.json`, `hooks/`, etc. at the top level.

- [ ] **Step 4: Reinstall dependencies and run the test suite from inside `frontend/`**

Run:
```bash
cd frontend
npm install
npm run test
```
Expected: `npm install` completes cleanly (fresh `frontend/node_modules/`, `frontend/package-lock.json` unchanged or only lockfile-format-refreshed — no dependency version changes). `npm run test` → `Test Files 8 passed (8)`, `Tests 16 passed (16)` (same 16 tests as before the move, now running from the new location).

- [ ] **Step 5: Verify the production build still works**

Run (from `frontend/`): `npm run build`
Expected: clean build, `frontend/dist/` created, same module count as before the move (85 modules).

- [ ] **Step 6: Verify `docker-compose.yml` is unaffected**

Run (from the repo root): `docker compose config`
Expected: valid config output, referencing only `./backend` and `db` — no frontend paths appear anywhere in `docker-compose.yml`, so this should be a no-op verification (docker-compose was never touched by this move).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: move frontend into frontend/ directory, mirroring backend/'s layout"
```

---

### Task 2: Update `CLAUDE.md` for the new directory layout

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the new `frontend/` layout from Task 1.
- Produces: `CLAUDE.md`'s "Commands" and "Project structure" sections accurately describe running commands from `frontend/` and the new file locations. (Note: this task narrowly fixes the *path* staleness this move introduces — it does NOT attempt to fix `CLAUDE.md`'s other, pre-existing staleness, e.g. its "no test setup" claim, which was already inaccurate before this plan started once the test framework landed in the prior sub-project; that's a separate, already-known documentation gap, out of scope here.)

- [ ] **Step 1: Update the "Commands" section**

Find:
```markdown
## Commands

- `npm install` — install dependencies
- `npm run dev` — start the Vite dev server
- `npm run build` — production build (this is what Vercel runs via `vercel.json`, output to `dist/`)
- `npm run preview` — serve the built `dist/` output locally

There is no lint, typecheck, or test setup in this project (no test files, no ESLint/Prettier config, no test script in `package.json`). Verify changes by running `npm run build` and/or `npm run dev` and exercising the UI in a browser.
```

Replace with:
```markdown
## Commands

All frontend commands run from the `frontend/` directory:

- `cd frontend && npm install` — install dependencies
- `cd frontend && npm run dev` — start the Vite dev server
- `cd frontend && npm run build` — production build (this is what Vercel runs via `frontend/vercel.json`, output to `frontend/dist/`)
- `cd frontend && npm run preview` — serve the built `dist/` output locally
- `cd frontend && npm run test` — run the Vitest suite

Backend commands (Django/DRF, under `backend/`) run via `docker compose` from the repo root — see `docker-compose.yml`.
```

- [ ] **Step 2: Update the "Project structure" section**

Find:
```markdown
## Project structure

This is a flat-layout Vite + React app — there is no `src/` directory. Source files live at the repo root:

- `index.html` — Vite entry HTML, loads `/main.jsx` as a module script and mounts to `#root`.
- `main.jsx` — React root bootstrap (`ReactDOM.createRoot` + `<App />`).
- `App.jsx` — the entire application (~3,600 lines). Everything — components, mock data, business logic — lives in this single file.
- `sw.js` — a service worker (not currently registered anywhere in `main.jsx`/`App.jsx`, so it's inert dead code unless registration is added).
- `manifest.json` — PWA manifest, referenced from `index.html`.
- `vercel.json` — Vercel build/routing config: SPA rewrite (`/(.*) → /index.html`) plus security headers.
```

Replace with:
```markdown
## Project structure

The repo is a monorepo with two self-contained top-level directories:

- `backend/` — Django/DRF/Postgres backend (see `backend/` for its own structure: `accounts/`, `listings/`, `core/` apps).
- `frontend/` — the Vite + React app. Still a flat layout within `frontend/` — no `src/` subdirectory:
  - `frontend/index.html` — Vite entry HTML, loads `/main.jsx` as a module script and mounts to `#root`.
  - `frontend/main.jsx` — React root bootstrap (`ReactDOM.createRoot` + `<App />`, wrapped in `QueryClientProvider`).
  - `frontend/App.jsx` — the bulk of the application (~3,600+ lines). Most components, mock data, and business logic still live in this single file.
  - `frontend/apiClient.js` — shared `fetch` helper for calling the backend API.
  - `frontend/hooks/` — `@tanstack/react-query` data-fetching hooks (`useCategories`, `useZones`, `useListings`, `useListing`).
  - `frontend/mocks/`, `frontend/test/` — MSW request handlers and Vitest setup for the test suite.
  - `frontend/sw.js` — a service worker (not currently registered anywhere in `main.jsx`/`App.jsx`, so it's inert dead code unless registration is added).
  - `frontend/manifest.json` — PWA manifest, referenced from `index.html`.
  - `frontend/vercel.json` — Vercel build/routing config. **Vercel's dashboard "Root Directory" setting must be `frontend` for this to be picked up.**
```

- [ ] **Step 3: Run tests one more time to confirm the doc-only change didn't disturb anything**

Run (from `frontend/`): `npm run test`
Expected: `Tests 16 passed (16)` (unchanged — this task only edits a markdown file).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for the new frontend/ directory layout"
```
