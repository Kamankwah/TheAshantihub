# Frontend Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute `docs/FRONTEND_MODERNIZATION.md` §2–5 (Hero/Navbar componentization, palette extension, carousel), per `docs/superpowers/specs/2026-07-12-frontend-modernization-design.md`.

**Retrofit note:** this plan documents work that was actually implemented in a single ungoverned session on 2026-07-12 (directly in the working tree, no worktree/spec/PR) alongside two sibling sub-projects. See `docs/superpowers/plans/2026-07-12-staff-url-routing-plan.md` for the full retrofit context. This is the third and last of three sequential, chained worktree branches: `worktree-frontend-modernization`, branched from `righteoushack` after `worktree-billing-credit-dashboards` merged (PR #14) — landing last specifically so this componentization pass didn't conflict with the dashboard-wiring `App.jsx` edits that came before it (they touch disjoint functions, but both being mid-flight in the same uncommitted tree at once was the original process problem being corrected here).

**Architecture:** `frontend/theme.js` (palette) + `frontend/components/{Navbar,Hero,Flag}.jsx`, all pure extractions with props passed down from `App.jsx`, which keeps owning all state. No new dependencies.

## Global Constraints

- No new npm dependencies (no animation library, no CSS framework, no router) — matches the app's existing zero-dependency styling convention.
- Scope discipline: only Hero/Navbar/Flag extracted. The rest of `App.jsx` is untouched.
- Do not touch `StaffDashboard`, `BusinessDashboard`, `PaymentDashboard`, `CreditDashboard`, or the `/staff` routing effects — those landed in the two prior chained worktrees.

## File Structure

```
frontend/
  theme.js                    # new: C palette (+ pureBlack/white)
  components/
    Flag.jsx                  # new
    Navbar.jsx                 # new: extracted Header, + hamburger menu
    Hero.jsx                   # new: extracted hero JSX, + carousel
  App.jsx                      # modified: C/Flag/Header/hero-JSX removed,
                                # theme/component imports + <Navbar/>/<Hero/> added
  Navbar.test.jsx               # new
  Hero.test.jsx                 # new
CLAUDE.md                       # modified: Project structure + Styling sections
docs/FRONTEND_MODERNIZATION.md  # modified: status line
```

## Tasks

- [x] Extract `C` palette to `frontend/theme.js`, add `pureBlack`/`white`.
- [x] Extract `Flag` to `frontend/components/Flag.jsx`.
- [x] Extract `Header` → `frontend/components/Navbar.jsx`, taking all closed-over state/callbacks as props; add hamburger/mobile menu via component-local `<style>` `@media` breakpoint (760px).
- [x] Extract hero JSX → `frontend/components/Hero.jsx`; add multi-slide carousel over `KUMASI_PHOTOS` (CSS crossfade + Ken-Burns `@keyframes`), auto-advance + manual controls, `usePrefersReducedMotion` gating.
- [x] Update `App.jsx`: remove inline `C`/`Flag`/`Header`/hero JSX, add imports, render `<Navbar .../>`/`<Hero .../>` with explicit props, compute `unreadMessages` in `App.jsx` (still-mock `MOCK_CONVERSATIONS`, passed down rather than the whole array).
- [x] Add `Navbar.test.jsx`/`Hero.test.jsx` render tests (root-level `*.test.jsx` convention, matching `Card.test.jsx`/`MapView.test.jsx`).
- [x] Update `CLAUDE.md` (Project structure: `frontend/components/`, `frontend/theme.js`; Styling: palette now in `theme.js`, `<style>`-tag `@keyframes`/`@media` convention).
- [x] Update `docs/FRONTEND_MODERNIZATION.md` status line.
- [x] Verify: `cd frontend && npm run build && npm run test` (98/98 across 25 files, up from the 87-test baseline after billing/credit dashboard wiring — 11 new tests, zero regressions).
- [ ] Write retroactive spec+plan docs (this plan + its sibling design doc) — done as part of this same task.
- [ ] Commit, push `worktree-frontend-modernization`, open PR into `righteoushack`.
- [ ] Run `code-review` on the PR before merge.
- [ ] Merge into `righteoushack`.
- [ ] Once merged: open the final `righteoushack` → `main` PR (the deploy trigger) — pause for explicit user confirmation first, since this is what actually ships to `theashantihub.com`.

## Verification

- `cd frontend && npm run build` — clean build.
- `cd frontend && npm run test` — 98/98 passing.
- Manual reasoning (per design doc §2–4, browser testing not run in this environment): every `page` state (home/events/about) still renders correctly with the extracted `Navbar` (rendered above the `page==="home"` conditional, so `events`/`about` are unaffected by the `Hero` extraction); all four dashboard early-returns happen before `Navbar`/`Hero` are reached, so they're structurally uninvolved; hamburger menu appears below 760px via the CSS rule; `prefers-reduced-motion` on/off changes both auto-advance and Ken-Burns drift per the `usePrefersReducedMotion` hook.
