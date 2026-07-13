# Design: Frontend Modernization — Hero, Navbar, Componentization

**Date:** 2026-07-12
**Status:** Approved
**Sub-project:** Third of three sub-projects retrofitted from a single ungoverned working-tree session (2026-07-12) into the repo's normal spec/plan/worktree/PR pipeline — see `docs/superpowers/plans/2026-07-12-frontend-modernization-plan.md` for the retrofit context. Third and last in the chain (branched after `worktree-billing-credit-dashboards` merged), landing on top of the `/staff` routing and dashboard-wiring work rather than in parallel, to avoid conflicting `App.jsx` edits.

## 1. Background & scope

Implements `docs/FRONTEND_MODERNIZATION.md` §2–5 — the componentization/Hero/Navbar spec written in an earlier planning pass but never executed until this session. §6 (React 19 bump) required no action: `frontend/package.json` was already on `react`/`react-dom` `^19.0.0` by the time this landed.

**In scope:** extract `Navbar`/`Hero`/`Flag` out of `App.jsx` into `frontend/components/`, move the `C` palette to `frontend/theme.js`, add `pureBlack`/`white` to the palette, add a Navbar hamburger/mobile menu, replace the Hero's single static background with a `KUMASI_PHOTOS` carousel.

**Out of scope (per the spec, unchanged by this pass):** any further extraction beyond Hero/Navbar/Flag — the rest of `App.jsx`'s ~3,600 lines stays as-is, a much larger and separately-scoped future refactor. No new dependencies (no animation library, no CSS framework, no router).

## 2. Componentization

- `frontend/theme.js` — the `C` color palette, extracted verbatim from the top of `App.jsx`, plus two additive keys (`pureBlack:"#000000"`, `white:"#ffffff"`) per §5 of the spec. Single source of truth so `App.jsx` and the new components import the same object rather than duplicating it (extracting to its own module, rather than leaving it inline in `App.jsx` and having components import from there, avoids a circular `App.jsx` ⇄ `components/` dependency).
- `frontend/components/Flag.jsx` — the Ghana-flag SVG badge, extracted alongside Navbar/Hero since both `Navbar` and several places still in `App.jsx` use it.
- `frontend/components/Navbar.jsx` — extracted from the inline `Header` closure. `App.jsx` still owns all state and passes everything down as props (`page`/`setPage`, `lang`/`setLang`, `currency`/`setCurrency`, `user`, `auth`, `handleLogoClick`, `setAuthModal`, `setShowNotifs`, `setShowMessaging`, `setShowFavs`, `favourites`, `unreadMessages`, `setShowBizDash`, `setShowPayments`, `T`) — no new state management library, matching the spec's explicit constraint.
- `frontend/components/Hero.jsx` — extracted from the inline hero JSX in the `page==="home"` branch, same prop-drilling pattern.

## 3. Navbar hamburger/mobile menu

CSS `@media` breakpoint (760px) via a component-local `<style>` tag — the same convention `LoadingScreen` already uses for its `@keyframes` loading-bar animation, not a new styling mechanism. Below the breakpoint, the desktop action row (`.ah-navbar-actions`) hides and a hamburger toggle shows; the mobile dropdown mirrors the same actions stacked vertically.

## 4. Hero carousel

- Multi-slide carousel over all `KUMASI_PHOTOS` entries (not just `manhyiaPalace`) as layered, absolutely-positioned slides.
- CSS-only crossfade (`opacity` transition, 1.2s) plus a `heroKenBurns` `@keyframes` scale drift (1 → 1.08 over 9s, alternating) — no animation library, per the spec's zero-dependency constraint.
- Auto-advance every ~5.5s via `setInterval`, plus manual prev/next buttons and slide dots.
- `prefers-reduced-motion` respected via a `usePrefersReducedMotion` hook (`matchMedia('(prefers-reduced-motion: reduce)')` with a change listener) — when set, auto-advance never starts and each slide's `animation` is `"none"`.
- Preserved unchanged: the Ghana-flag-stripe bottom bar, kente-gradient overlay, search bar (with its debounced `filters.search` wiring), and quick-action buttons — only the background mechanism changed from static image to carousel.

## 5. Testing

`frontend/Navbar.test.jsx` / `frontend/Hero.test.jsx` — new render tests following the existing root-level `*.test.jsx` convention (`Card.test.jsx`, `MapView.test.jsx`), not `hooks/__tests__/`.

## 6. Open questions

None — this executes an already-approved prior spec (`docs/FRONTEND_MODERNIZATION.md`) with no new design decisions; the only judgment call (theme.js as a separate module vs. keeping `C` inline) is explained in §2 above.
