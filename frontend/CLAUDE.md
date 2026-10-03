# frontend/ — conventions and gotchas

Everything here is a convention that **differs from the framework default**, or a failure
contract the code alone would not teach. The actual structure (which component lives where,
what props it takes, which endpoint it calls) is derivable — read the files.

## Layout

Flat: no `src/`. `index.html` → `main.jsx` → `App.jsx`. `App.jsx` is still a ~4,000-line
monolith holding most components, with extractions living in `components/`,
`components/dashboard/`, `components/admin/`, and `components/ui/`.

## Hard rules

- **`components/**` must never import from `App.jsx`.** When an extracted component needs
  something that still lives there, `App.jsx` threads it down as a prop — this is why
  `CardComponent`, `PaymentComponent`, and `WhatsAppButton` are props rather than imports.
  Shared values go in `theme.js` (`C`, `CURRENCIES`) or `components/dashboard/theme.js` (`D`)
  instead.
- **Mutations are not wrapped in `useMutation`.** The established pattern everywhere is a plain
  `apiPost`/`apiPatch`/`apiDelete` from `apiClient.js` inside the component's own event handler,
  in a `try/catch` that sets a local `actionError` and calls the query's `refetch()` on success.
  Don't introduce `useMutation` into this codebase without a reason.
- **A component owns its own data source.** Extracted panels and drawers call their own hook
  (`useCart`, `useListing`, `useMyEventTicketTypes`, …) rather than receiving data as a prop.
  Two call sites of the same hook share React Query's cache, which is fine and intended.
- **Styling is inline `style={{...}}` off the shared `C` palette** (`theme.js`) — no CSS
  framework, no CSS modules, no stylesheet. Reuse `C`; don't hardcode new colors. The only other
  mechanism in use is a component-local `<style>` tag for raw `@keyframes`/`@media` rules.
- **Exception, new work only:** `components/ui/*.tsx` use real Tailwind + shadcn CSS-variable
  tokens. `index.css` deliberately has **no global `body`/`html` reset** so it doesn't fight the
  inline-styled UI — which means **every Tailwind/shadcn component's root must be wrapped in
  `<div className="shadcn-scope">`** or it picks up no theme tokens at all. This exception is
  additive, not a migration; existing `C`-palette surfaces stay inline-styled.
- **Read `DESIGN.md` (repo root) before any visual or UI decision.** It is the source of truth
  for palette, typography, spacing, motion, and the trust-surface/anti-slop rules. Don't deviate
  without explicit user approval, and flag non-conforming code in review.

## Gotchas that have already bitten

- **Staff PWA is scoped, not global.** The service worker (`vite-plugin-pwa`, `vite.config.js`)
  registers from `lib/staffPwa.js` with `scope: "/staff"`, and the `staff.webmanifest` link is
  injected only on `/staff*` paths (`ensureStaffHead`). Never add a global `<link rel="manifest">`
  to `index.html` or `runtimeCaching` for API routes — staff data must not persist on devices.
  Static PWA files live in `frontend/public/`. Registration lazy-imports
  `workbox-window` inside `lib/staffPwa.js` (keeping it out of the public bundle); under Vitest
  the service worker is off and tests inject a fake via `startStaffPwa({ createWorkbox })`.
  Offline state comes from `lib/networkStatus.js` (`navigator.onLine` OR a network-level API
  failure via `apiClient`'s `request()`). An accepted update reloads only the accepting tab;
  other tabs get an "updated in another tab" notice.
- **Staff shell breakpoints** come from `hooks/useBreakpoint.js` (phone ≤760, tablet ≤1199,
  else desktop; jsdom → desktop). Phone-only CSS lives in `components/admin/shell/
  StaffShellStyles.jsx`; `scripts/staff-layout-audit.js` is the overflow audit for every panel.
- **Paginated vs unpaginated hooks are inconsistent.** Some queue hooks return a DRF envelope and
  must be read as `data?.results` (`useReviewsModerationQueue`, `useContactMessagesQueue`,
  `useDeliveryQueue`, `useEscrowLedger`, `useDisputesQueue`, `useStaffMessagingQueue`); their
  siblings (`useModerationQueue`, `useHeroModerationQueue`, `useOrders`, `useMyEvents`,
  `useMyConversations`, `useScoutAssignments`, `useScouts`, `useMyScoutAssignments`) return a
  plain array (`ScoutAssignmentsPanel` once read `.results` on one and always showed "No
  assignments yet"). Check the backing view before assuming.
  `ModerationQueueTabs`' `itemsOf()` normalizes both, so panels on that shell don't care.
- **Leaflet does not render under jsdom.** `DeliveryRouteMap.jsx` and `LocationPicker.jsx` are
  `vi.mock`-stubbed globally in `test/setup.js`; their real behaviour is only ever verified
  manually in a browser, never in Vitest. Points without coordinates are skipped, never faked at
  `0,0`.
- **Run Vitest from this directory** (`cd frontend && npx vitest run`). From the repo root it
  globs stale `.worktrees/**` copies that lack `node_modules` and reports a spurious mass
  failure. A second mass-failure shape — hundreds of `[MSW] intercepted a request without a
  matching request handler` lines — means a local `frontend/.env` points `VITE_API_BASE_URL`
  somewhere other than the `http://localhost:8000` that `mocks/handlers.js` hardcodes. Both are
  local-environment artifacts, not regressions.
- **`StaffDashboard.test.jsx` (~60–100 assertions) and `BusinessDashboard.test.jsx` are treated as
  behavioural contracts.** Only change them when the behaviour change is intentional, and say why.
- **Reuse `components/admin/ModerationQueueTabs.jsx` for any moderated queue** rather than
  hand-rolling Pending/Approved/Rejected. Copy the panel preamble from `KYCQueuePanel`.
- **No "fabricated 0.0" ratings:** a rating row is hidden entirely when `review_count` is 0
  (`Card`, `EventCard`, `SellerRatingBadge`, `OrganizerRatingSection` all follow this).
- **Businesses cannot be contacted directly** — see the root `CLAUDE.md`. There is no
  business-to-customer WhatsApp link or chat anywhere; "🎧 Contact Support" is always framed as a
  conversation with AshantiHub Support *about* a business.
