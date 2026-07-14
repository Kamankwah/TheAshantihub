# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All frontend commands run from the `frontend/` directory:

- `cd frontend && npm install` — install dependencies
- `cd frontend && npm run dev` — start the Vite dev server
- `cd frontend && npm run build` — production build (this is what Vercel runs via `frontend/vercel.json`, output to `frontend/dist/`)
- `cd frontend && npm run preview` — serve the built `dist/` output locally
- `cd frontend && npm run test` — run the Vitest suite

Backend commands (Django/DRF, under `backend/`) run via `docker compose` from the repo root — see `docker-compose.yml`.

## Project structure

The repo is a monorepo with two self-contained top-level directories:

- `backend/` — Django/DRF/Postgres backend (see `backend/` for its own structure: `accounts/`, `listings/`, `core/`, `billing/`, `credit/` apps). `billing/` (`SubscriptionPlan`, `Subscription`, `Transaction`) and `credit/` (`CreditScore`) are minimal stub apps backing the `BusinessDashboard`/`PaymentDashboard`/`CreditDashboard` frontend dashboards with real (if naive/placeholder) data — not real Hubtel payment processing (`docs/HUBTEL_INTEGRATION.md`) or the real Phase-3 credit-scoring engine (`docs/PROJECT_SCOPE.md` §6), both of which remain future work.
- `frontend/` — the Vite + React app. Still a flat layout within `frontend/` — no `src/` subdirectory:
  - `frontend/index.html` — Vite entry HTML, loads `/main.jsx` as a module script and mounts to `#root`.
  - `frontend/main.jsx` — React root bootstrap (`ReactDOM.createRoot` + `<App />`, wrapped in `QueryClientProvider`).
  - `frontend/App.jsx` — the bulk of the application (~3,600+ lines). Most components, mock data, and business logic still live in this single file; `Navbar`/`Hero` (see `frontend/components/` below) are the first extractions out of it, per `docs/FRONTEND_MODERNIZATION.md` §2 — everything else stays in `App.jsx` until a future, separately-scoped extraction pass.
  - `frontend/components/` — small, standalone components extracted out of `App.jsx`. `App.jsx` still owns all state (`page`, `isAdmin`, `showBizDash`, search/filter state, etc.) and passes it down as props/callbacks; these components hold no app-level state of their own beyond purely local UI state (e.g. the mobile menu's open/closed flag).
    - `Navbar.jsx` — extracted from the old inline `Header` closure. Adds a hamburger/mobile menu (CSS `@media` breakpoint at 760px via a component-local `<style>` tag, same convention as `LoadingScreen`'s `@keyframes`) that collapses the language/currency/nav/notifications/messages/favourites/auth/Biz/Pay action row into a slide-down dropdown on narrow viewports.
    - `Hero.jsx` — extracted from the old inline hero JSX in the `page==="home"` branch. Replaced the single static `KUMASI_PHOTOS.manhyiaPalace` background with a multi-slide carousel over all `KUMASI_PHOTOS` entries (CSS opacity crossfade + a `heroKenBurns` `@keyframes` scale drift), with auto-advance (~5.5s) and manual prev/next/dot controls. Respects `prefers-reduced-motion`: auto-advance is paused and the Ken-Burns drift is skipped when the user's OS/browser has that preference set. The kente-gradient overlay, Ghana-flag-stripe bottom bar, search bar, and quick-action buttons are unchanged from before the carousel.
    - `Flag.jsx` — the small Ghana-flag SVG badge, extracted alongside Navbar/Hero (it's used by both `Navbar` and several places still in `App.jsx`) so it isn't duplicated across modules.
  - `frontend/theme.js` — exports the shared `C` color palette object (previously defined inline at the top of `App.jsx`). Single source of truth so `App.jsx` and `frontend/components/*` can import the same palette without a circular `App.jsx` ⇄ `components/` dependency.
  - `frontend/apiClient.js` — shared `fetch` helper for calling the backend API.
  - `frontend/hooks/` — `@tanstack/react-query` data-fetching hooks: public marketplace data (`useCategories`, `useZones`, `useListings`, `useListing`, `useActiveHero`), staff-dashboard queues (`useKYCQueue`, `useModerationQueue`, `useHeroModerationQueue`, `useCustomers`, `useBusinessOwners`, `useStaffRoster`), and business-owner self-service data (`useMyListings`, `useBusinessProfile`, `useSubscriptionPlans`, `useMySubscription`, `useMyTransactions`, `useMyCreditScore`, `useMyHeroSubmission`). Mutations are not wrapped in `useMutation` hooks — the established pattern is a plain `apiPost`/`apiPatch` call (from `apiClient.js`) inside the consuming component's event handler, in a `try/catch` that sets a local `actionError` state and calls the query's `refetch()` on success (see `KYCQueuePanel`, `BusinessDashboard`'s `saveEdit`).
  - `frontend/mocks/`, `frontend/test/` — MSW request handlers and Vitest setup for the test suite.
  - `frontend/sw.js` — a service worker (not currently registered anywhere in `main.jsx`/`App.jsx`, so it's inert dead code unless registration is added).
  - `frontend/manifest.json` — PWA manifest, referenced from `index.html`.
  - `frontend/vercel.json` — Vercel build/routing config. **Vercel's dashboard "Root Directory" setting must be `frontend` for this to be picked up.**

## Architecture

`App.jsx` is a monolith: dozens of components are defined as top-level `function` declarations before the single `export default function AshantiHub()` at the bottom of the file, which is the actual app root. There is no React Router or any routing library — navigation is done entirely with local `useState` in `AshantiHub`, with one narrow, deliberate exception for `/staff` (see below).

- `page` (`"home" | "events" | "about"`) switches sections within the main return via `page==="..."` conditionals.
- Several boolean flags (`isAdmin`, `showBizDash`, `showPayments`, `showCredit`) act like full-screen "routes": each one, if true, causes an **early return** of a different full-page component (`StaffDashboard`, `BusinessDashboard`, `PaymentDashboard`, `CreditDashboard`) instead of rendering the normal marketplace UI. `isAdmin` is toggled by a hidden gesture (`handleLogoClick` — 5 clicks on the logo), or by visiting `/staff` directly (see below).
- Other flags (`showMessaging`, `showNotifs`, `showReferral`, `showMap`, cookie banner) render as overlays/modals on top of the normal page rather than replacing it.
- **`/staff` URL exception:** per `docs/PWA_STAFF_DASHBOARD.md` §4 Option B, `AshantiHub` uses raw `window.location.pathname`/`window.history.pushState` (no router library, no dependency added) so staff can land directly on `/staff` instead of only via the 5-click gesture. On mount, once the session-restore fetch (`auth.isLoading`) settles, if `pathname === "/staff"` it either sets `isAdmin` true (staff already logged in) or opens the staff login modal (`setAuthModal("staff-login")`). A second effect watches `[isAdmin]` and keeps the URL in sync — `pushState("/staff")` when it becomes true (gesture, direct visit, or post-login `onSuccess`), `pushState("/")` when `StaffDashboard`'s `onExit` sets it back to false. No other route in the app is URL-addressable; `frontend/vercel.json`'s catch-all SPA rewrite already serves `/staff` correctly with no config changes.

Most of `StaffDashboard` and the business-owner-facing dashboards (`BusinessDashboard`, `PaymentDashboard`, `CreditDashboard`) are wired to real backend data via the hooks above — `BusinessDashboard`'s Overview/Listings & Prices/Subscription tabs, `PaymentDashboard`, and `CreditDashboard` all read/write through `billing/`, `credit/`, `listings/`, and `accounts/` endpoints rather than local mock arrays. `CreditDashboard` shows only the signed-in business owner's own score (the backend has no aggregate/multi-business endpoint), so the old multi-business browsing UI (score cards grid, business-selector dropdown) was replaced with a single-score view. `PaymentDashboard` dropped its Invoices tab and "Revenue by Network"/"Active Subscribers" aggregate stats — there is no backend `Invoice` model and `Transaction` has no per-network breakdown, so these were removed rather than left as unbacked mock UI. `StaffDashboard` also has a "Hero Approval" tab (`HeroApprovalPanel`, gated by the `hero_media.approve` permission) approving/rejecting `HeroMediaSubmission` rows via `useHeroModerationQueue()` — clones `ListingsModerationPanel`'s shape exactly (`docs/BUSINESS_EVENTS_ROADMAP.md` Phase 2). `BusinessDashboard`'s Listings & Prices tab shows each listing's `photos` gallery (`OwnerListingSerializer` on `/api/listings/mine/` returns it) with a "Submit for Hero" action per photo (calls `POST /api/hero/submit/`), plus an inline status card sourced from `useMyHeroSubmission()` (`GET /api/hero/mine/` — the owner's outstanding submission if one exists, else their most recent one, else `{}`; absence of an `id` key, not response status, is the "nothing yet" signal, mirroring `useMySubscription`'s "no subscription yet" convention) with an "Extend" action once `status==="approved"` (reuses `MoMoPayment`'s simulated-payment flow, then `POST /api/hero/{id}/extend/`, then `refetch()`s the query — same mutation-handling pattern as the rest of this dashboard). Some data is still hardcoded in-file:

- `CATEGORIES` — the marketplace category list (hotels, food, tours, crafts, transport, etc.), each with an id/icon/label/color.
- `LISTINGS` — an object keyed by category id, each value an array of business listings (name, rating, price, location, phone, etc.) — this is the public/anonymous marketplace browse data, distinct from a signed-in business owner's own listings (`useMyListings`).
- `TRANSLATIONS` — i18n string tables, selected via the `lang` state (`T = TRANSLATIONS[lang]`).
- `mockEnquiries` (used by `BusinessDashboard`'s Enquiries tab) and `MOCK_CONVERSATIONS` (used by `MessagingCenter`) — real-time/AI messaging is a separate, larger Phase-2 initiative (`docs/PROJECT_SCOPE.md`) and is deliberately still mock.
- `LENDING_PARTNERS` — static lending-partner directory for `CreditDashboard`; no backend model exists for it (out of scope, frontend-only).
- `MOCK_CREDIT_BUSINESSES`, `SCORE_FACTORS` — leftover mock data still referenced only by `CreditCategoryView`, an inline marketing/explainer component that is defined but not currently rendered anywhere (dead code, pre-existing).
- `Analytics` — an in-memory event tracker (`Analytics.track`/`Analytics.getReport`); it does not send anything to a real endpoint, events just accumulate in a JS array for the session.

Authentication is not actually implemented: `authModal`/`setAuthModal` and `user`/`setUser` state exist and are referenced throughout to gate features (WhatsApp contact, messaging, etc.), but there is no corresponding modal component that renders based on `authModal` — signup/login triggers currently no-op visually.

The "WhatsApp-first" contact pattern is central to the product: most business interactions (`handleWA`, `WABtn`) open a `wa.me` deep link with a prefilled message rather than an in-app contact form.

## Styling

No CSS framework or CSS files are used — all styling is inline `style={{...}}` objects on JSX elements, using a shared color constant object `C` (Ghanaian/Ashanti-themed palette: gold, kente colors, Ghana flag colors, plus `pureBlack`/`white`) exported from `frontend/theme.js` and imported by both `App.jsx` and `frontend/components/*`. Reuse `C` rather than hardcoding new colors. The one other CSS mechanism in use is a component-local `<style>` tag holding raw `@keyframes`/`@media` rules (e.g. `LoadingScreen`'s loading-bar animation, `Hero`'s Ken-Burns drift, `Navbar`'s mobile-menu breakpoint) — still no CSS modules, framework, or external stylesheet.

## Planning & specs

`docs/` holds forward-looking architecture/implementation specs beyond this file's as-is description. Check these before starting work in their area — they carry decisions already made, not just background:

- `docs/PROJECT_SCOPE.md` — full phased roadmap (backend, auth, Hubtel payments, AI messaging, credit scoring, DevOps hardening)
- `docs/HUBTEL_INTEGRATION.md` — Hubtel payment integration technical spec
- `docs/MOBILE_APP_SCOPE.md` — React Native (iOS + Android) mobile app scope
- `docs/TOOLING_SETUP.md` — project agents/skills/plugins/MCP server setup
- `docs/FRONTEND_MODERNIZATION.md` — Hero/Navbar redesign, componentization plan, React 19 upgrade path
- `docs/PWA_STAFF_DASHBOARD.md` — PWA spec for staff-facing dashboards
- `docs/IMPLEMENTATION_INSTRUCTIONS.md` — master index tying the above together, with sequencing and what's not done yet

These are specs, not implemented state — this file's "Architecture"/"Styling" sections above still describe what's actually in `App.jsx` today. Update them when code from these specs actually lands.
