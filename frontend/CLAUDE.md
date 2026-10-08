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
- **Staff menus are per role.** A new panel goes into `NAV_ITEMS` in
  `components/admin/shell/navModel.js` and its id into the right group of each role in
  `ROLE_MENUS` (and `DEFAULT_GROUPS`); anything a role's menu doesn't place shows under "More
  tools". Group labels must not repeat an item label.
- **Live updates refetch by query key.** `lib/realtime.js` (through `hooks/useRealtime.js` in the
  staff shell) calls `invalidateQueries({queryKey: [key]})` for each key the server names, so a
  staff hook's first query-key element is what `backend/realtime/publish.py` must send. The MSW
  default for `/api/realtime/ticket/` answers 503 so tests never open a socket.
- **Password re-entry is automatic.** A `403 {code: "sudo_required"}` from any `apiClient` call
  opens `SudoPrompt` and retries once; panels just show their usual error if it's cancelled.
- **`components/admin/panels/panelStyles.js` is the shared style source for staff panels.**
  `chip()` never appends alpha to an rgba colour (only to `#hex`); other colours get the neutral
  tint.
- **The staff notification bell is a `NotificationsSlot` prop** threaded from `App.jsx`, which is
  how `components/**` avoids importing `App.jsx`.
- **`lib/saveBlob.js` is the one file-save helper** (report exports); don't hand-roll anchors.
- **Staff 2-step and activation flows return a challenge object instead of storing a session**
  (`useAuth`); the caller shows the code step and only the final call stores the session.
- **Idle sign-out is shared across tabs** (`ashantihub.staffLastInput` in `useIdleSignOut`), and a
  `storage` event that clears `ashantihub.auth` signs the other tabs out.
- **The staff shell signs out ("ended") when it mounts without a stored staff session**, and on any
  `UNAUTHORIZED_EVENT` (a 401 that ended no stored session) while none is stored — a session can
  end during "View site". A test that mounts `AdminCommandCenter` and counts `onExit` must
  `setStoredAuth({token, account_type: 'staff', …})` first.
- **A scout's phone bar is `ScoutBottomBar`** (Businesses, Register, Calls, Menu), chosen in
  `AdminCommandCenter` for `role === "scout"` on a phone; it shows only slots whose id is in the
  role's nav. Every other role keeps `StaffBottomBar`.
- **Menu items arrive with their screen.** Don't add a `NAV_ITEMS` entry for a panel that isn't
  built yet - `isPermittedTab` would route to it and the menu would show a dead end.
- **`/business/claim` is a page, not a listing.** `App.jsx` excludes `claim` from the
  `/business/:id` match. `OwnerClaimForm` (shared by the public claim page and the scout's
  hand-over) keeps the password in its own state only and clears it after submitting; never lift
  it into a parent, a query cache or storage. The hand-over overlay holds a same-URL history guard
  against Back and its password fields use `autocomplete="off"`.
- **`ProposeChangeForm` diffs against the business it opened with**, not the live query data.
- **Never read a multipart request body that holds a jsdom `File` in a test**; spy on
  `FormData.prototype.append` instead.
- **Duplicate-match copy lives in `registrationCheckCopy.js`** - don't re-word it per screen.
