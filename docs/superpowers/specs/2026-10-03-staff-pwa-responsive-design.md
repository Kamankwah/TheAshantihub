# Staff PWA + Responsive Staff Dashboard — Design

**Date:** 2026-10-03
**Status:** Approved design, not yet implemented
**Supersedes:** the open items in `docs/PWA_STAFF_DASHBOARD.md` §2–§5 (update that doc when this lands)

## 1. Goal

Staff install a dedicated **"AshantiHub Staff"** app from `/staff` on phones, tablets, laptops,
and desktops. The app opens straight into the staff dashboard. Every staff view lays out and
scrolls correctly from 320px phones up to wide desktops.

### Decisions already made (with the user)

| Question | Decision |
| --- | --- |
| Offline behaviour | App shell opens from cache and shows an offline notice. **No API or staff data is cached on the device.** |
| Phone navigation | Slide-over drawer (full grouped nav) **plus** a bottom bar: Overview, 3 badge-priority panels, More. |
| Panel URLs | Each panel is addressable at `/staff/<panel>` (e.g. `/staff/kyc`). |
| SW tooling | `vite-plugin-pwa` (Workbox `generateSW`), SW scoped to `/staff`. |

### Scope

**In scope:**
- `AdminCommandCenter` and all 26 of its panels
- the staff sign-in modal (`authState === "staff-login"`)
- `/staff/activate`

**Out of scope:**
- offline writes (staff actions require connectivity)
- push notifications and background sync
- making the public marketplace installable
- the business-owner dashboard (`BusinessCommandCenter`) and the customer Account Center

### Current state this fixes

- `frontend/manifest.json` and `frontend/sw.js` sit at the frontend root with no `public/`
  directory, so Vite never copies them into `dist/`. The `<link rel="manifest">` 404s in every
  build, and nothing ever registers `sw.js`.
- The only icon is an SVG, but Android/Chrome install needs 192/512 PNGs plus a maskable icon.
- `AdminCommandCenter` always renders a 240px sidebar. On a 375px phone, panels get about 135px.
- Many panels lay out rows with fixed `width`/`minWidth` of 100–200px.
- The shell uses `100vh`, which jumps under mobile URL bars.

## 2. PWA layer

### 2.1 Build

- Add the `vite-plugin-pwa` dev dependency (confirm the version supports the repo's Vite 5).
  Configure it in `frontend/vite.config.js`:
  - `strategies: "generateSW"`, `registerType: "prompt"`, `injectRegister: false` (we register
    manually, see 2.3), and `manifest: false`, because the manifest is a static file (2.2).
  - Workbox settings:
    - `globPatterns` covers the built JS, CSS, HTML, SVG, PNG, and woff2 files.
    - `navigateFallback: "/index.html"` with `navigateFallbackAllowlist: [/^\/staff/]`.
    - `cleanupOutdatedCaches: true`.
    - **No `runtimeCaching` entries.** API requests (`VITE_API_BASE_URL`) are never cached;
      they go straight to the network.
- Create `frontend/public/`. It holds `staff.webmanifest`, the icons, and `favicon.svg`. Move
  `favicon.svg` there and keep the `/favicon.svg` URL unchanged.
- Delete `frontend/manifest.json` and `frontend/sw.js`. They have never shipped, so this is not a
  behaviour change. Remove the global `<link rel="manifest">` from `index.html` (see 2.2).

### 2.2 Manifest — `public/staff.webmanifest`

```json
{
  "id": "/staff",
  "name": "AshantiHub Staff",
  "short_name": "AH Staff",
  "start_url": "/staff",
  "scope": "/staff",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#FDF6E3",
  "theme_color": "#2C1810",
  "lang": "en-GH",
  "icons": [
    { "src": "/icons/pwa-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/pwa-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/maskable-icon-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "KYC Queue", "url": "/staff/kyc" },
    { "name": "Messaging", "url": "/staff/messaging" },
    { "name": "Listings Moderation", "url": "/staff/moderation" }
  ]
}
```

- `background_color` and `theme_color` reuse the existing `C.cream` and `C.darkBrown` values.
  Verify them against `DESIGN.md`.
- Shortcuts to panels the staffer lacks permission for land on Overview, per the fallback rule in
  §3.
- **The manifest link is added only on staff paths.** A small `useStaffAppHead()` effect runs in
  the `/staff*` render branch of `App.jsx`. It injects these tags and removes them on unmount, so
  public pages are never installable:
  - `<link rel="manifest" href="/staff.webmanifest">`
  - `<link rel="apple-touch-icon">`
  - `<meta name="apple-mobile-web-app-capable">`
  - `<meta name="apple-mobile-web-app-title">`

### 2.3 Registration — `frontend/lib/staffPwa.js`

- Call `registerSW` from `virtual:pwa-register`. The plugin config sets `scope: "/staff"`, so the
  generated registration is `navigator.serviceWorker.register("/sw.js", { scope: "/staff" })`.
  This is narrower than the script's directory, which needs no `Service-Worker-Allowed` header.
- Register **only when `location.pathname` starts with `/staff`**. Skip registration in
  `import.meta.env.DEV` unless `devOptions.enabled` is turned on explicitly.
- Expose a tiny store (module-level subscribe/getSnapshot, consumed via `useSyncExternalStore`)
  for:
  - `needRefresh` (a new SW is waiting)
  - `installPrompt` (the deferred `beforeinstallprompt` event)
  - `isStandalone` (`matchMedia("(display-mode: standalone)")` or `navigator.standalone`)
- The SW scope `/staff` controls `/staff`, `/staff/*`, and `/staff/activate`. Subresources those
  pages fetch (`/assets/*`) still pass through the SW, because a controlled client's fetches do.
  Public pages are never controlled.

### 2.4 Install, update, and offline UI

These are components under `frontend/components/admin/` and use the inline `D` palette.

- **`InstallAppButton`:**
  - Shown when `installPrompt` exists and the app is not running standalone. Clicking it calls
    `prompt()`.
  - On iOS Safari (no `beforeinstallprompt`, not standalone), it instead opens a one-time hint:
    "Tap Share → Add to Home Screen". Dismissal is remembered in `localStorage`, wrapped in
    try/catch.
  - It renders in the header on desktop and tablet, and in the drawer on phones.
- **`UpdateToast`:** when `needRefresh` is true, shows "New version available" with a
  **Reload** button that calls `updateSW(true)`. It never auto-reloads.
- **`OfflineBanner`:** subscribes to `online`/`offline` events and `navigator.onLine`. While
  offline it shows a non-dismissable strip under the header: "You're offline — staff actions
  need a connection." There is no fabricated data and no "last synced" state, since nothing is
  cached.
- **Session survives an offline launch.** `useAuth`'s session restore currently clears the stored
  login on *any* `/me` failure, network errors included. That would sign a staffer out every time
  the installed app opens on a dead connection.
  - Only a 401 or 403 clears the session.
  - A network error or any other status keeps the stored session (the merged login + last `/me`
    payload, permissions included). The shell then renders with the offline banner, and panel
    queries show their normal error states.
  - This applies app-wide; customers benefit the same way.
- **Standalone exit:** when `isStandalone`, the header's "← Exit" button becomes **"Sign out"**
  (logout, then `/staff`, which shows the staff login). Leaving `/staff` in standalone would drop
  the user into the marketplace with browser chrome.

### 2.5 Icons

- **Source artwork:** a new `public/icons/staff-icon.svg`, which is `favicon.svg`'s artwork plus a
  gold "STAFF" banner.
- **Generation:** `@vite-pwa/assets-generator` (a devDependency, and the plugin's own companion
  tool) renders the artwork via `pwa-assets.config.js` using the `minimal-2023` preset. Maskable
  and apple variants get a `#2C1810` background, so the art sits inside the maskable safe zone.
- **Output:** `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, and
  `apple-touch-icon-180x180.png` in `public/icons/`.
- **Rerunning:** generated PNGs are committed. Rerun with `npm run generate-pwa-assets` whenever
  the SVG changes. Icon design follows `DESIGN.md`.

## 3. Panel URLs

- **The router mapping lives in `App.jsx`.** A `useMatch("/staff/:panel")` reads the panel, and
  `/staff/activate` is still matched first via `PATH_TO_PAGE`. `KNOWN_PATHS`/`show404` accept
  `/staff` and `/staff/:panel`.
- **`AdminCommandCenter` stays router-agnostic.** It gains optional `activeTab` and `onTabChange`
  props:
  - Controlled when they are provided.
  - When absent it falls back to its current internal `useState("overview")`, so
    `StaffDashboard.test.jsx` (rendered without a router) passes **unmodified**.
- App.jsx passes `activeTab = panel ?? "overview"` and
  `onTabChange = id => navigate(id === "overview" ? "/staff" : "/staff/" + id)`. Panel changes
  use push, so Android back steps through panels.
- **Fallback:** if `:panel` is not in the staffer's permitted nav items (from `buildNavGroups`,
  exported for reuse), `navigate("/staff", { replace: true })`. Unknown ids get the same
  treatment. Overview never needs a permission.
- A signed-out user at `/staff/<panel>` sees the staff login (existing `/staff` effect, extended
  to the prefix). After login the URL is unchanged, so they land on that panel.
- The `components/** must never import App.jsx` rule holds. URL knowledge flows in through props
  only.

## 4. Responsive shell

### 4.1 Breakpoints — `frontend/hooks/useBreakpoint.js`

```
phone   : (max-width: 760px)            — matches DESIGN.md's existing ≤760px mobile breakpoint
tablet  : (min-width: 761px) and (max-width: 1199px)
desktop : (min-width: 1200px)
```

`useBreakpoint()` is built on `matchMedia` with change listeners. It returns `"desktop"` when
`matchMedia` is missing or the stub reports no match. The `test/setup.js` stub returns
`matches: false`, so existing tests see today's desktop layout.

### 4.2 Layout per breakpoint

| | Phone | Tablet | Desktop |
| --- | --- | --- | --- |
| Sidebar | Hidden; full grouped nav in a slide-over **drawer** (☰ in header, "More" in bottom bar) | 64px **icon rail** with badge dots; ☰ expands the full nav as an overlay | 240px sidebar, collapsible to 60px (today's behaviour) |
| Header | ☰, panel title (ellipsised), role chip. Name, Install, and Sign out move into the drawer | Title, role chip, name, Install, Exit | Unchanged |
| Bottom bar | Yes (4.3) | No | No |

Extract shell pieces from `AdminCommandCenter.jsx` (currently 251 lines) into
`components/admin/shell/`:

- `StaffNavList.jsx`: the grouped buttons, shared by the sidebar, rail, and drawer
- `StaffDrawer.jsx`
- `StaffBottomBar.jsx`
- `StaffHeader.jsx`

`AdminCommandCenter` composes these. Every nav `id`, `label`, and permission `show` check stays
byte-identical, as required by the contract test.

### 4.3 Bottom bar slot selection (phone)

The bar has 5 slots: **Overview**, three panel slots, and **More**.

The three panel slots are chosen as follows:
1. Take the staffer's permitted nav items in nav order.
2. Items with a badge count > 0 come first, still in nav order (not by count, so icons don't
   reshuffle on every 60s badge poll).
3. Fill the remaining slots with the first permitted items without badges.

If the active panel isn't in the bar, "More" shows as active. Fewer than 3 permitted items means
fewer slots; the bar never pads with placeholders. Badges render as dots with
`aria-label="N pending"`. This is a pure function `pickBottomBarItems(navGroups, badgeFor)` and
is unit-tested.

### 4.4 Scrolling and viewport

- The shell root uses `minHeight: 100dvh` (with a `100vh` fallback). The sidebar uses
  `height: 100dvh`, `position: sticky`, and its own `overflowY: auto`.
- The document scrolls the main column; there is no nested scroll container for panel content,
  so browser back restores scroll and pull-to-refresh keeps working.
- Drawer open:
  - lock body scroll (`overflow: hidden` on `<html>`, restored on close)
  - drawer gets `overscroll-behavior: contain`
  - focus trap; close on Esc, backdrop tap, and after selecting an item
  - return focus to ☰ on close
- On panel change (`activeTab` changes, not initial mount): `window.scrollTo({ top: 0, behavior: "instant" })`.
  Always instant; a panel swap is not an animated scroll.
- **Phone padding:** main content gets
  `paddingBottom: calc(64px + env(safe-area-inset-bottom))` to clear the bottom bar.
- **Safe-area insets:**
  - `index.html` viewport gets `viewport-fit=cover`.
  - The header pads `env(safe-area-inset-top)` and the bottom bar pads
    `env(safe-area-inset-bottom)`.
  - Left and right insets apply to the shell in landscape.
- No horizontal page scroll at any width ≥320px. This is enforced by the Playwright check in §7.

## 5. Panel pass

Applies to all 26 panels in `components/admin/panels/`, `ModerationQueueTabs.jsx`, the staff
sign-in modal, and `/staff/activate`.

**Rules:**

1. **Fixed-width rows wrap.** Rows built from fixed `width`/`minWidth` cells (Escrow, Subscription
   Plans, Staff Management, Disputes, Events Moderation, Event Pricing, Credit, Promotions, Scout
   Assignments, Delivery Manager, Transactions, Categories & Zones) get `flexWrap: "wrap"` with
   `flex: "1 1 <basis>"` cells.
   - On phone, each row becomes a stacked card, and each value gets the visible label its column
     header used to provide.
   - Header rows that only label columns are hidden on phone (`useBreakpoint`) rather than
     wrapping into nonsense.
2. **True tables scroll inside their own container.** A table that must stay tabular (e.g. a
   transaction report) sits in an `overflowX: "auto"` wrapper with a visible edge shadow. The page
   itself never scrolls horizontally.
3. **Touch targets on phone:** interactive elements are ≥44×44px. Approve/Reject/action button
   groups go full-width and stack.
4. **Form inputs on phone** use `fontSize: 16px` (prevents iOS focus-zoom). Text fields go
   `width: 100%`.
5. **Overlays:** any `position: fixed` modal or overlay inside a panel renders as a bottom sheet
   on phone, at `maxHeight: 90dvh` with internal scroll. The `✓ Saved!` toast moves above the
   bottom bar on phone.
6. **Charts:** recharts already uses `ResponsiveContainer`. Verify that axis labels and legends
   don't clip at 320px, and reduce tick density on phone where needed.
7. **Grids:** existing `repeat(auto-fit, minmax(X, 1fr))` grids keep their form, but any
   `minmax` X > 280 is capped with `min(X, 100%)` so a single column never overflows a 320px
   viewport.

**Mechanics:**
- Inline `style={{}}` on the `D`/`C` palette, per `frontend/CLAUDE.md`.
- Breakpoint-dependent values come from `useBreakpoint()`. Pure-CSS concerns that inline styles
  can't express (`env()` fallbacks, `:focus-visible`, `@supports (height: 100dvh)`) go in a
  component-local `<style>` tag, the mechanism `frontend/CLAUDE.md` already sanctions.
- No Tailwind migration and no new colors.
- Spacing, typography, and motion follow `DESIGN.md`.

**Behavioural invariant:** no panel's text, permission gating, data flow, or mutation handling
changes. This is a layout-only pass. `StaffDashboard.test.jsx` must pass unmodified.

## 6. Hosting

- **Production (nginx, `infra/hestia/templates/ashantihub-spa.tpl` and `.stpl`):** add
  `location = /sw.js` and `location = /staff.webmanifest` with
  `add_header Cache-Control "no-cache"`, plus `location /assets/` with
  `Cache-Control "public, max-age=31536000, immutable"`.
  - Re-add the existing security headers inside each new location, since nginx `add_header` does
    not inherit into a location that sets its own.
  - **Do not add any `^~ /.well-known/` location.** Re-install the templates via
    `infra/scripts/install-hestia-templates.sh` as part of the staging deploy.
- **Staging (Vercel, `frontend/vercel.json`):** add matching `headers` entries for `/sw.js`,
  `/staff.webmanifest`, and `/assets/(.*)`.
  - The SPA rewrite `/(.*) → /index.html` only applies when no file matches, so `/sw.js` is served
    as a file.
  - Verify `Content-Type: application/manifest+json` for the manifest on both hosts.

## 7. Testing and verification

**Vitest** (run from `frontend/`):
- `useBreakpoint`:
  - desktop fallback with no `matchMedia`
  - each breakpoint with a mocked `matchMedia`
  - updates on change events
- `pickBottomBarItems`:
  - badge priority keeps nav order
  - stable ordering across count changes
  - fewer than 3 permitted items
  - active panel outside the bar marks "More" active
- `AdminCommandCenter` on phone:
  - drawer opens via ☰ and via More
  - closes on Esc, backdrop, and item select
  - body scroll lock applied and restored
  - focus returns to ☰
- Controlled `activeTab`/`onTabChange` props work, and the uncontrolled fallback still works.
- `App.routing.test.jsx` additions:
  - `/staff/kyc` renders the KYC panel for a permitted staffer
  - an unpermitted or unknown panel replaces to `/staff`
  - `/staff/activate` still renders the activation page
  - `/staff/whatever` is not a 404
- Install, update, and offline UI:
  - `InstallAppButton` is hidden when standalone and shown with a deferred prompt
  - the iOS hint path
  - `OfflineBanner` toggles on `offline`/`online` events
  - `UpdateToast` calls `updateSW(true)`
  - Mock `virtual:pwa-register` in tests.
- **Contracts:** `StaffDashboard.test.jsx` and `BusinessDashboard.test.jsx` pass unmodified, and
  so does the full suite.

**Playwright**, against the local stack (docker `web` + `npm run preview` so the real SW is
built):
- Seed a staff account with all permissions.
- Visit every panel at 375×812, 768×1024, 1024×768, and 1440×900.
- On each, assert `document.documentElement.scrollWidth <= innerWidth` and capture a screenshot.
- Also cover the staff login modal and `/staff/activate` at 375px.

**Chrome DevTools, manual:**
- the manifest parses and is installable from `/staff`
- `/` is **not** controlled by the SW, and the manifest is absent there
- an offline reload of `/staff/kyc` shows the shell and offline banner
- a new build triggers `UpdateToast`

**Real devices before production:** an Android phone (Chrome install, back-gesture through
panels, shortcuts) and an iPhone (Add to Home Screen, safe areas). Then a tablet and a desktop
Chrome/Edge install.

## 8. Rollout

1. Implement on a feature branch, run the verify-before-merge gate (`deploy` skill), then deploy
   to **staging only**.
2. Real-device checks against staging.
3. **Production promotion happens only on the user's explicit instruction.**
4. On landing:
   - update `docs/PWA_STAFF_DASHBOARD.md` (mark §2–§4 done, and record the no-data-caching
     decision that replaces §5's "last-seen" idea)
   - add the SW-scope and manifest-only-on-staff conventions to `frontend/CLAUDE.md`
