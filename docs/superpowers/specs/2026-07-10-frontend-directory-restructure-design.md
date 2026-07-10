# Design: Restructure Frontend into `frontend/`

**Date:** 2026-07-10
**Status:** Approved, not yet implemented

## 1. Background & scope

`backend/` is a self-contained directory (its own `manage.py`, `requirements.txt`, `Dockerfile`, apps). Frontend source, by contrast, still lives loose at the repo root (`App.jsx`, `main.jsx`, `hooks/`, `mocks/`, `test/`, `apiClient.js`, `package.json`, `vite.config.js`, `vercel.json`, etc.), mixed in with project-level files (`docs/`, `docker-compose.yml`, `.mcp.json`, `.vscode/`). This spec moves every frontend-specific file into a new `frontend/` directory, mirroring `backend/`'s pattern, for a clean, well-layered monorepo structure.

**Out of scope:** no code/behavior changes of any kind — this is a pure structural move. No new features, no refactoring beyond what the move requires.

## 2. What moves

Everything currently at repo root that is frontend-specific:
`App.jsx`, `main.jsx`, `index.html`, `apiClient.js`, `apiClient.test.js`, `Card.test.jsx`, `MapView.test.jsx`, `hooks/`, `mocks/`, `test/`, `package.json`, `package-lock.json`, `vite.config.js`, `vercel.json`, `.env.example`, `favicon.svg`, `manifest.json`, `sw.js`, `node_modules/` (regenerated via `npm install`, not moved), `dist/` (regenerated via `npm run build`, not moved).

All move together as a unit into `frontend/`, preserving relative structure — internal relative imports (`./hooks/...`, `../apiClient.js`, `./App.jsx`, `../mocks/server.js`, etc.) require no path rewriting since every file's relative position to every other moved file is unchanged.

**What stays at repo root:** `backend/`, `docs/`, `docker-compose.yml` (never referenced frontend — only orchestrates `db`/backend `web` services), `.gitignore`, `.mcp.json`, `.vscode/`, `CLAUDE.md` (content updated, file stays at root), `.gitattributes`, `.superpowers/` (scratch/process files), `.claude/`.

## 3. Follow-up required outside this repo (cannot be done by this change)

Since `vercel.json` moves into `frontend/`, the Vercel project's dashboard **"Root Directory" setting must be changed to `frontend`** for deployments to keep finding `package.json`/`vercel.json`/the build output. This is a manual Vercel dashboard action — flagged clearly, not something a code change can do.

## 4. Documentation update

`CLAUDE.md`'s "Commands" section (currently bare `npm install`/`npm run dev`/etc., implying repo-root execution) gets `cd frontend &&` prefixes (or a note that commands run from `frontend/`). Its "Project structure" section (currently describes "flat-layout Vite + React app — there is no `src/` directory... Source files live at the repo root") gets rewritten to describe the new `frontend/`-rooted layout.

## 5. Verification

- `cd frontend && npm install && npm run test` → 16/16 tests pass (unchanged test count, just relocated).
- `npm run build` → clean build, same output as before the move.
- `git status` at repo root shows no leftover frontend files outside `frontend/`.
- `docker compose config` (or a dry run) confirms `docker-compose.yml` is unaffected (it never referenced frontend paths).

## 6. Open questions

None — confirmed during brainstorming (2026-07-10): full move (not source-files-only), `frontend/` as the directory name (mirrors `backend/`).
