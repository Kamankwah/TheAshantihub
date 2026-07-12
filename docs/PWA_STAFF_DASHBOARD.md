# PWA Spec — Staff Dashboards

**Status:** Spec only — no code changes made yet.

**Owner agent:** `.claude/agents/frontend-engineer.md`

## 1. Goal

Make the staff-facing surfaces — `AdminDashboard`, `BusinessDashboard`, `PaymentDashboard` (`App.jsx:925`), `CreditDashboard` (`App.jsx:91`) — installable as a Progressive Web App, distinct from (or layered on top of) the public marketplace PWA experience, so staff/business-owner users get an app-like, offline-tolerant surface for day-to-day operations (approvals, payment monitoring, credit review).

## 2. Current state — the core bug to fix first

- `sw.js` exists (14 lines, cache name `ashantihub-v1`, precaches `["/", "/favicon.svg", "/manifest.json"]`, falls back to cached `/` on failed navigation fetches) but **is never registered**. A repo-wide grep for `serviceWorker`/`register`/`vite-plugin-pwa` found zero matches in `main.jsx` or `App.jsx` — this file is dead code today.
- `manifest.json` is referenced from `index.html` and has correct theming (`background_color` matches `C.cream`, `theme_color` matches `C.darkBrown`) but only ships **one icon** (`/favicon.svg`, `sizes:"any"`) — most install prompts (especially Android/Chrome) expect a 192×192 and 512×512 PNG set, not SVG-only.
- A `PWAInstallBanner` component exists (`App.jsx:2916-2945`) with a `handleInstall` reference, implying install-prompt UI was already designed — but without an active service worker registration, the `beforeinstallprompt` event this relies on may never fire correctly in all browsers. This needs verifying once registration is fixed, not assumed working.

**First fix, before any staff-specific scoping work:** register the service worker. Two options:

| Option | Tradeoff |
| --- | --- |
| Hand-register `sw.js` via `navigator.serviceWorker.register('/sw.js')` in `main.jsx` | Minimal change, keeps the existing hand-rolled cache file — but that file has no versioned cache-cleanup on `activate` and only a 3-URL precache list, so it stays a minimal offline-shell, not real asset caching |
| Migrate to `vite-plugin-pwa` | Recommended — handles precache manifest generation, versioned cache invalidation on deploy, and Workbox strategies out of the box; replaces the hand-rolled `sw.js` rather than layering on top of it |

**Recommendation:** migrate to `vite-plugin-pwa`. The hand-rolled `sw.js` was never wired up in the first place, so there's no working behavior to preserve — better to start the real implementation on a maintained tool than to first fix, then later replace, the manual version.

## 3. Icon set gap

Add a proper PWA icon set (192×192, 512×512 PNG, plus a maskable variant) — `vite-plugin-pwa`'s manifest generation can produce these from a single source image if supplied, or they can be exported manually and referenced in `manifest.json`'s `icons` array alongside the existing SVG entry.

## 4. Staff-scoping question (needs a decision before implementation)

The app currently has **zero URL routing** — no `react-router`, no `window.history` usage, purely in-memory `useState` (`CLAUDE.md` "Architecture" section). This creates a real design fork for "installable staff dashboard":

| Approach | What it requires | Tradeoff |
| --- | --- | --- |
| **A — Single manifest/app, staff reaches dashboards via the existing hidden-gesture/button flow after install** | No routing change. Staff installs the same PWA as the public marketplace, then navigates in-app to `isAdmin`/`showBizDash`/etc. as they do today | Simplest, ships fastest — but "install the marketplace app" doesn't read as "install the staff dashboard app," and there's no way to deep-link straight into a dashboard from the home-screen icon |
| **B — Second manifest + start_url scoped to a staff entry route (e.g. `/staff`)** | Requires introducing **real URL routing** (at minimum a lightweight router or hash-based routing) so `/staff` is an addressable entry point that boots straight into the dashboard state | Staff gets a distinct home-screen icon that opens straight into their tool — better product fit for "PWA for staff," but is a materially bigger change since it means adding routing to an app that has deliberately avoided it so far |

**Recommendation:** Option B is the better product outcome (a real "Staff Dashboard" app icon, not "install the marketplace and then find the hidden staff menu"), but it has a real prerequisite — introducing routing — that should be called out and agreed to explicitly before implementation starts, since it's a bigger architectural change than the PWA wrapper itself. This decision should be confirmed with the user at the start of the implementation session, not assumed here.

**Status update:** the minimal `/staff` entry point half of Option B has now landed — `AshantiHub` (`frontend/App.jsx`) checks `window.location.pathname` on mount and uses `window.history.pushState` to keep the URL in sync with the `isAdmin` "route" (see `CLAUDE.md` "Architecture" for the exact mechanism). This is a narrow, deliberate exception scoped to this one path — no router library was added, and no other screen in the app is URL-addressable. What's still open from this section: the second manifest + `start_url` scoped to `/staff` (the PWA-installability half of Option B) has not been built yet — the service-worker registration fix in §2 and the icon set in §3 are also still outstanding prerequisites for that.

## 5. Offline / staff-specific needs

- Cache the **last-seen** transaction list (`PaymentDashboard`) and credit-score data (`CreditDashboard`) for spotty-connectivity use — staff should be able to see the last known state even if the network drops, clearly marked as "last synced at …" rather than presented as live.
- Consider background sync (where supported) for payment-status polling once real Hubtel webhook data exists (`docs/HUBTEL_INTEGRATION.md`) — queue a refresh for when connectivity returns rather than silently failing.
- No offline **write** support planned (e.g. approving a business while offline and syncing later) — that's a materially harder consistency problem, explicitly out of scope for this spec; staff actions require connectivity.

## 6. Sequencing relative to other work

1. Fix service worker registration (`vite-plugin-pwa` migration) + icon set — this benefits the whole app, not just staff, and should land regardless of the Option A/B decision.
2. Resolve the Option A vs. B scoping decision with the user.
3. If B: introduce minimal routing (scoped narrowly to enabling `/staff` as an entry point — not a full app-wide router rewrite, which is its own separate, larger decision). **Done** — see the status update in §4; the manifest/`start_url` half of Option B is still outstanding.
4. Build the offline caching behavior for `PaymentDashboard`/`CreditDashboard`.

This work has no hard dependency on `docs/HUBTEL_INTEGRATION.md` or `docs/FRONTEND_MODERNIZATION.md` landing first, but sequencing after the React 19 bump (`docs/FRONTEND_MODERNIZATION.md` §6) avoids doing PWA/service-worker verification twice against two different React versions.
