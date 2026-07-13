# `/staff` URL Deep Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff a real, bookmarkable `/staff` URL that opens the staff login modal (or the dashboard, if already authenticated) instead of only reachable via the hidden 5-click-logo gesture, per `docs/superpowers/specs/2026-07-12-staff-url-routing-design.md`.

**Retrofit note:** this plan documents work that was actually implemented in a single ungoverned session on 2026-07-12 (directly in the working tree, no worktree/spec/PR) alongside two other sub-projects (`billing`/`credit` backend + dashboard wiring, and Hero/Navbar componentization). The user flagged the process deviation from this repo's established pipeline (every prior sub-project: spec → plan → `worktree-<feature>` branch → PR into `righteoushack` → review → merge). This plan — and its two sibling plans, `2026-07-12-billing-credit-dashboards-plan.md` and `2026-07-12-frontend-modernization-plan.md` — retroactively document that work in the normal format and route it through `worktree-staff-url-routing`, `worktree-billing-credit-dashboards`, `worktree-frontend-modernization` respectively, chained in that order (each branched from `righteoushack` after the previous one merged, since the original changes were layered on top of each other in the same file with no intermediate commits to split cleanly any other way).

**Architecture:** Two `useEffect`s added inside `AshantiHub` (`frontend/App.jsx`) — no new files, no new dependencies. See the design doc §2 for the exact mechanism.

**Tech Stack:** React 19 (no new dependencies — explicitly no router library, per design doc's out-of-scope).

## Global Constraints

- No router library, no dependency added.
- No change to `handleLogoClick`, `StaffDashboard`'s `onExit`, or the auth-success handler — the new effects react to `isAdmin`/`auth` state that those call sites already set.
- `frontend/vercel.json` unchanged — its existing catch-all rewrite already serves `/staff`.

## File Structure

```
frontend/
  App.jsx                    # modified: two new useEffects inside AshantiHub
docs/
  PWA_STAFF_DASHBOARD.md      # modified: §4 status update, §6 sequencing item marked done
CLAUDE.md                     # modified: Architecture section documents the /staff exception
```

## Tasks

- [x] Add `staffUrlHandled` ref + mount-time `useEffect` inside `AshantiHub` that checks `window.location.pathname === "/staff"` once `auth.isLoading` settles, and either `setIsAdmin(true)` or `setAuthModal("staff-login")`.
- [x] Add a second `useEffect` watching `[isAdmin]` that keeps the URL in sync via `window.history.pushState`.
- [x] Update `docs/PWA_STAFF_DASHBOARD.md` §4 (status update) and §6 (sequencing item 3 marked done).
- [x] Update `CLAUDE.md`'s Architecture section: the "no routing library" sentence gains its narrow exception, the `isAdmin` bullet notes the `/staff` alternate entry point (and fixes a pre-existing stale `AdminDashboard`→`StaffDashboard` reference in the same sentence, unrelated rename that had already landed in commit `d0733c8` but was never reflected in this doc), and a new `/staff` URL exception bullet is added.
- [x] Verify: `cd frontend && npm run build && npm run test` clean in the isolated worktree (72/72 tests, matching the pre-existing baseline — no regressions, no new tests needed per the design doc's testing section).
- [ ] Write retroactive spec+plan docs (this plan + its sibling design doc) — done as part of this same task.
- [ ] Commit, push `worktree-staff-url-routing`, open PR into `righteoushack`.
- [ ] Run `code-review` on the PR before merge.
- [ ] Merge into `righteoushack`.

## Verification

- `cd frontend && npm run build` — clean build.
- `cd frontend && npm run test` — 72/72 passing (baseline preserved, no new failures).
- Manual trace-through (documented in the design doc §3): direct `/staff` visit logged-out and logged-in-as-staff, post-login URL sync, `StaffDashboard` exit URL sync, old 5-click gesture still works and now also pushes `/staff`.
