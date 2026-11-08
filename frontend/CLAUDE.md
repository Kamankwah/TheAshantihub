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
- **Every page has a dark mode.** Surfaces and text use the theme tokens — `C.canvas`/`surface`/
  `surface2`/`ink`/`inkDim`/`line`/`price`/`trust`/`okBg`… or `D.pageBg`/`panelBg`/`text`… — which
  are `var(--ah-*)` (index.css; mirrored in `THEME_TOKENS`, checked by `__tests__/theme.test.jsx`).
  Brand keys (`C.gold`, `C.darkBrown`, `C.cream`, `C.white`, kente) are fixed: use them only for brand
  marks, fixed fills and the text on those fills (`D.darkBrown` on gold, `D.cream` on dark fills).
  Never append a hex alpha to a token (`${D.green}22` is invalid CSS now) — use `tint(color, "22")`.
  `__tests__/darkModeLiterals.test.js` fails on any hardcoded white/cream background; QR codes use
  `C.paper` (allowlisted). `__tests__/darkModeSmoke.test.jsx` renders key pages in dark mode.
- **Exception, new work only:** `components/ui/*.tsx` use real Tailwind + shadcn CSS-variable
  tokens. `index.css` deliberately has **no global `body`/`html` reset** (no font/margin/background
  reset) so it doesn't fight the inline-styled UI. It does carry two global `html, body` pieces: tabular
  figures (`font-variant-numeric: tabular-nums`) and, under `:root[data-theme="dark"]`, the themed
  canvas/ink (`--ah-canvas`/`--ah-ink`; light mode sets no background) — which means **every Tailwind/shadcn component's root must be wrapped in
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
- **Map tiles come from one place.** Every Leaflet map renders `components/maps/BaseTileLayers.jsx` (never a raw
  `TileLayer`); `lib/mapTiles.js` `tileLayers(provider)` picks the source. Build env `VITE_MAP_TILES_PROVIDER`
  (`mapbox` | `osm`, default `osm`) and `VITE_MAPBOX_TOKEN` (a public, URL-restricted Mapbox token, never a secret
  one) come from the build environment (Vercel project env for staging, the production server's build env), never a
  committed value or `frontend/.env`. Unset or no token falls back to today's OSM street tiles with no satellite
  layer and no Streets/Satellite switch. `noMapboxTokenInSource.test.js` fails on a literal token. Reverse
  geocoding is `lib/reverseGeocode.js` (Nominatim, a suggestion for an editable field; never store its text, never
  point it at Mapbox). A map wrapper that holds the Streets/Satellite switch is `role="group"` with an `aria-label`,
  never `role="img"` (an image role hides the radios from assistive tech; `MapWrappersA11y.test.jsx` guards it).
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
- **`/business/confirm` is a page too.** `App.jsx` excludes it from `/business/:id` like `claim`.
  `OwnerConfirmPage` reads the token from the URL fragment (falls back to `?token=` for links already sent), strips it
  with `history.replaceState` and keeps it in component state only - never in a query key, cache, storage or log. It
  calls the public endpoints through `apiPostPublic` (no session, no view-as, never ends a stored session), all POST.
  The General Manager menu has no Register, Prospects or Client listings (a checker, not a maker).
  The preview query key is constant (the token rides only in the closure), with `gcTime: 0`.
- **`/share-location` is a public page too** (`ShareLocationPage`, the owner's texted "share my shop location" link). Token from
  the URL fragment only (no `?token=`), stripped at once, kept in state only; preview and capture are POSTs through
  `apiPostPublic` (`hooks/useLocationLink.js`). It reuses `useDevicePosition` (its `errorKind` names why a fix failed, so the
  page can word "unsupported" without the scout's "place the pin by hand"). A fix over 100 m is refused locally with nothing
  sent, and one between 50 and 100 m (`VERIFY_ACCURACY_M`) is held back with a warning ("Try again" primary, "Save this one
  anyway" posts it; `ShopLocationCard` does the same) because the link is single use and staff need 50 m to verify. It shows
  no coordinates, only the accuracy, and never a default pin. `AddressPinMap` keys its `MapContainer` by the pin (react-leaflet
  reads `center` once).
- **Prospects work for Operations and Super Admin too.** They list every scout's (`?scout=<id>` narrows; the card names
  the scout), the add sheet needs a scout picker for non-scouts, and the header shows the listings-live figure only when
  the server sends it (a one-scout list). `AskOwnerAgain` offers the registration re-ask only when
  `owner_confirmation.can_ask_again` is true; Resend on a draft only when `confirmation.can_resend` is true.
- **`ProposeChangeForm` diffs against the business it opened with**, not the live query data.
- **The public claim page retries once after a 401** (`lib/withoutStaleSignIn.js`): an expired
  sign-in stored in the browser must not block it. Never use that helper on the hand-over, whose
  token is bound to the scout's session.
- **Only an explicit staff Sign out clears registration drafts** (`clearRegisterDrafts`); idle and
  "ended" sign-outs keep them so the scout can carry on.
- **`useFraudFlags` is an infinite query** (read `data.pages[n].results`; "Show more" fetches DRF's
  `next`), unlike the other queue hooks.
- **Never read a multipart request body that holds a jsdom `File` in a test**; spy on
  `FormData.prototype.append` instead.
- **Duplicate-match copy lives in `registrationCheckCopy.js`** - don't re-word it per screen.
- **Step-up codes are handled in `apiClient.js`, not per screen.** A `403 step_up_required` retries
  once with `X-Step-Up-Token`; `StepUpPrompt` (mounted in `main.jsx`) supplies the code, so a screen
  just does a plain `apiPost`/`apiPatch`. A customer/owner `two_factor_required` goes to
  `/api/otp/sign-in/verify/`, a staff one to the staff two-factor endpoint. The trusted-device token
  lives in `ashantihub.deviceToken` (customers only) and survives sign-out.

## Wallet screens (Plan 3F)

- **The wallet components are holder-agnostic.** `components/wallet/*` take `tone` (`light` = customer, `C`;
  `dashboard` = business and staff, `D`) and, where they call the API, `basePath` (default `/api/wallet`;
  a rider mounts the same parts on its own path). All inline styling comes from `walletStyles(tone)`. The
  staff panels (`WalletsPanel`, `WithdrawalsPanel`, `WalletReconciliationPanel`) are read-and-resolve only.
- **A withdrawal's `request_id` is minted when `WithdrawForm` mounts** and reused by every submit of the same
  destination and amount (double click, retry, the step-up retry) so the server never pays twice. It changes
  only when the destination or amount changes, or after success. **Never remount the form between attempts**
  (no changing `key`, no conditional unmount around the step-up prompt) or the id is lost.
- **Step-up is `apiClient`'s.** Destination add/remove and withdrawals are forced while the ledger is on; a
  component does a plain `apiPost` and never reads or stores the token.
- **Money is the server's string.** Show `formatGhs(str)`; sums and comparisons use the integer-pesewas
  helpers in `walletMoney.js` (`ghsToPesewas`, `addGhs`), never float maths. Charge, you-receive, processing
  and refusal text come from the server (`walletMessage`); never invent a fee, limit or reason. Amounts use
  the price token (`C.price`/`D.price`), tabular figures, never brand gold.
- **`409 ledger_off` is one honest line, not an error screen.** `retryUnlessLedgerOff` stops the retries. The
  MSW wallet defaults in `mocks/handlers.js` are "ledger on, empty"; override with `server.use(...)`.
  `WalletNoInventionSweep.test.jsx` is the conformance contract for every wallet screen: add a new wallet
  screen to its list.
- **Rider wallet and dispatch money screens (Plan 5F).** `RiderWalletHome` and `RiderWalletHistory` mount 3F's
  destination, withdrawal and history components on `RIDER_WALLET_BASE` (`/api/delivery/rider/wallet`). The rider
  Earnings tab (`RiderEarningsTab`) branches on `rider/me.rider.wallet`, then on the wallet's own 409 (`ledger_off`
  or `wallet_disabled` falls back to the payroll earnings); no wallet call is made for an AshantiHub rider. The MSW default for `/api/delivery/rider/wallet/*` is 409 `ledger_off` (unlike 3F's "ledger on, empty" wallet defaults), so a test that wants the wallet must register its own handlers.
  `RiderMoneyPanel` (staff) renders `acct-rider-payouts` and falls back to `AccountingShellPanel` on `ledger_off`,
  so the shell's "No rider rate exists" text is only the ledger-off fallback. Balances that can go below zero use
  `signedGhs`. `RiderMoneyNoInventionSweep.test.jsx` is the conformance contract for these screens.
- **Verification and pickup screens (Plan 1F).** The Pickup Desk's overview is the desk (`PickupDeskPanel`, also the
  Super Admin's `pickup-desk` item); Support's queues are `VerificationCallsPanel`. Query-key roots are
  `ledger-verification` and `ledger-pickup`. The collection code is shown only on the customer's own order
  (`PickupCollectionNote`); the desk asks for it and no staff payload carries it. The pickup office address comes
  only from site settings (`pickup_office_address`) and reads "address to be confirmed" while blank. Customer pay
  screens (service, tickets, stay) go through `useBookingPayment` and never compute a charge. Amount elements in
  1F's staff panels (pickup desk, verification calls, booking cancel, call outcome form) carry `data-amount` (tabular figures, never gold); `LedgerScreensSweep.test.jsx` is their contract and checks that every GH₵ amount sits inside one.
  The Pickup Desk's exhaustive menu also has a Desk group holding 5F's Re-deliveries (gated by `orders.redeliver`).
- **Booking money states come from the server's `money` block;** a refund amount is shown only from `cancel-quote`,
  `wallet_refund` or `money.refunded`; `components/bookings/` holds the bars. `BookingNoInventionSweep.test.jsx`
  is the conformance contract for them.
- **The vendor tab is "Money"** (`id: "money"`, one tab for payouts and the wallet), not "Payouts".
- **Vendor money screens (`components/dashboard/money/`) are owner-only.** They show platform fees, so nothing
  outside `components/dashboard/` may import the folder (`MoneyNoInventionSweep.test.jsx` scans for it). `VendorMoney`
  is the one Money tab, with Payouts (3F's `VendorPayouts`) as a sub-tab. Every money value sits in a `data-amount`
  element styled `walletStyles("dashboard").amount`; signed amounts use `signedGhs` (`walletMoney.js`). Release hours
  come only from booking-terms (`useBookingTerms`), never a literal "24/48/72 hours". Booking sales are read from
  `vendor/bookings/`, not the order sales list. The sweep test is the conformance contract: add a new Money screen to it.

## Shopper pages (marketplace Plan 4)

- **`components/shop/` and `components/account/` are themed and light/dark** (`var(--ah-*)` through `C`), unlike the
  old fixed-dark detail bodies. `ListingDetailPage` is a chooser: goods (the backend's deliverable test: not a stay,
  and food or `kind === "product"`) render `shop/ProductPage`; services and stays keep the old fixed-dark body.
  Questions-and-answers are gone from listing pages (event Q&A is untouched).
- **The cart lives at `/cart`** (`shop/CartPage`); `CartDrawer` is only a mini-cart opened after a product-page add
  (`onAddedToCart`) and has no checkout step. Checkout is `/checkout` (`shop/CheckoutPage`); `/checkout/verify`
  is `shop/PaymentVerifyPage`, which also serves `/payment/return` for **every** checkout-session kind (orders,
  service requests, bookings, tickets, top-ups), so keep its per-kind destinations. Cart, checkout and verify amounts
  are always GHS (what is charged); `PriceTag` converts for display only.
- **Account hub routes:** `/my-account/<section>` and `/my-account/payments/<tab>` (`accountNav.js` is the one list;
  `AccountHub` parses the path itself). App-owned pieces (Bookings, Service requests, Tickets, My events,
  MessagingCenter) arrive as props. Your Orders carries those four as tabs.
- **The wallet hooks and components are holder-agnostic** (`useWallet`, `TopUpForm`, `WithdrawForm`,
  `PaymentMethodPicker`, ...): the shopper wallet tabs (`account/wallet/`) compose 3F's parts and never re-implement
  them. **Never build a second step-up prompt** - the one `StepUpPrompt` mounted in `main.jsx` handles every step-up challenge.
- **`useWishlist` owns the single `['wishlist']` query key** shared by card hearts, the product page's "Add to list"
  and Your Lists; do not add a parallel favourites source for signed-in customers.
- **`ShopperNoInventionSweep.test.jsx` (`components/__tests__/`) is the conformance contract** for the shopper pages
  (no `tel:`/`wa.me`, no Prime/gift-card/ETA/"bought in past month" text, no "0.0" rating, tabular figures on every
  price, no "not available yet" placeholder). Add any new shopper page or wallet tab to its list.

## Browse rail

- **The browse rail replaced `Sidebar` on /business and /events** (`components/storefront/BrowseRail.jsx`, sections in
  `rail/`, pure rules in `browseRailSections.js`). App owns the filters; the rail owns its data hooks (tree, zones,
  categories). Sections come from `sectionsFor({mode, kind})`, and a section with no data never renders, not even its
  collapsed icon. A context change drops filters whose section is now hidden. Collapse state is
  `localStorage["ah-browse-rail-collapsed"]`. Sticky top reads `--ah-top-offset` + `--ah-header-h` (published by
  `StorefrontHeader`), so **no ancestor of the rail may set `overflow`**.

## Owner listing panels and `basePath`

Owner listing panels (`ListingsPanel`, the variants, revision and discount editors) take a `basePath` prop, default
`"/api/listings/mine"`. Ashanti Direct mounts the same panels on `"/api/direct/listings"`, whose URLs mirror the
`mine/` subtree exactly, so the swap needs no other change. The promotion hub takes `promoteBase` (default
`"/api/listings"`) and a `direct` prop; for Direct it hides the hero, free-delivery and flash-invitation cards (hero
ads are Marketing's). Never hardcode `/api/listings/mine` in a panel.

## Catalogue screens (Plan 6F)

- **Catalogue widgets render only on the default `basePath`.** `NeedsRestockingPanel`, the card chips, `GroupingCard` and
  `StockLineEditor` are for `/api/listings/mine`; Ashanti Direct (`basePath` `/api/direct/listings`) gets none of them yet.
- **Card chips come only from the server's Needs restocking pages** (`useNeedsRestocking`: `low` / `sold_out`), never from
  a `stock_quantity` count rule. An uncounted stock gets no low/sold-out chip and reads "Stock not counted".
- **`catalogue-queue` is the live key** (`useCatalogueQueue`); the `catalogue` row in `realtime` `QUEUE_INVALIDATIONS` refreshes
  it and `staff-badges`; the badge itself only polls its own count. Nav id `catalogue` ("Product grouping").
- **Never build a second barcode formatter:** `displayBarcode` (`catalogueFormat.js`) is the one. `formatPrice` there
  delegates to `walletMoney.formatGhs`.
- **`components/catalogue/__tests__/CatalogueNoInventionSweep.test.jsx` is the conformance contract** (no contact links, no
  distance, no null shown, tabular prices, no gold on prices or the verified mark). Add every new catalogue screen to it
  (`OtherSellersPanel`, in `components/shop/`, is already covered; its `ShortfallPrompt` sits beside BuyBox's low and out-of-stock lines).

## Home departments and "Deliver to"

- **The home's department section is `DepartmentShowcase`** (cards, one per department from the home feed, up to four
  sub-category picture tiles each, "See all") followed later by `DepartmentShelves` (a product row per department,
  each shelf asking for its own `useListings({kind:"product", category})` and hiding itself when empty). The tiles carry no
  heading of their own. A category with no picture shows its icon
  on a wash of its own `color`; never invent a picture.
- **Category and zone pictures are uploaded in the staff panel** (`CategoryPictures`, `PictureSlot`; Marketing,
  Operations and Super Admin hold `categories.manage` / `zones.manage`). The server validates the file; show its message.
- **`DeliverTo` is the header's location control.** The choice (`ashantihub.deliverTo`: country code + Ghana region) is
  stored only on a tap; detection (`useDeliveryPlace`) only suggests, and only after the shopper taps "Use my current location"
  (it never asks the browser for the location on arrival and never opens the popover by itself). Door-to-door delivery is Ashanti only (`lib/deliveryPlace.js` `deliveryNote`); never add a delivery time or fee
  there. Reverse geocoding is `reverseGeocodePlace` (Nominatim, a suggestion).

## Accent colours, targets and landmarks (UX redesign, 2026-11)

- **Gold, amber and purple as TEXT use the ink tokens** (`C.goldInk`/`amberInk`/`purpleInk`, `D.goldInk`/`amberInk`/`purpleInk`, or
  `inkOf(color)` from `components/dashboard/theme.js` for a variable colour). Plain `gold`/`amber`/`green` stay for fills, borders and
  chart series. A solid green button with white text uses `D.greenFill`/`C.trustFill`; text on a gold or amber fill is `D.onGold`.
  Fixed-dark surfaces (business sidebar, detail pages, headers, the Messages header) keep brand gold text. A badge on an arbitrary
  accent fill takes `readableOn(fill)` from `theme.js` (dark brown or white, whichever has more contrast), never a fixed white.
- **Phone baseline:** every `.command-center` (staff shell, business dashboard, account hub) gets 44px controls under 760px from
  `index.css` (`!important`, because many panels set a smaller inline `minHeight`). Elsewhere give a small control `className="ah-tap"`
  (24px, 44px on a phone). Breadcrumb links use `ah-crumb-link`. Desktop and tablet staff UI follows WCAG 2.5.8 (24px).
- **Every page has one `<main id="main-content">` and one `<h1>`.** Standalone early returns in `App.jsx` wrap in `<MainRegion own={false}>`;
  the skip link targets it. A scroll wrapper over a table is `role="region" tabIndex={0} aria-label="... (scrolls sideways)"`.
- **The footer reads the saved Site Settings** (`Footer2`, `useSiteSettings`): email, phone, address, support hours, WhatsApp and social
  links render only when a Super Admin has filled them in. `/terms` and `/business-agreement` are real pages (`LegalDocPage`); the Terms
  page does not publish the draft text, it links to the Privacy Notice, the Business Agreement and Support.
- **Listing views are recorded only after the visitor accepts cookies** (`useRecordView` reads `ashantihub.cookie_consent`).
- **Run the dev server from the worktree you edit.** Vite's file watcher can go stale under WSL after bulk `sed -i` edits: if a CSS or
  JSX change does not show up in the browser, restart Vite (or `touch` the file) before trusting an audit.

## Resilience and safety conventions (principal review FE track)

- **Every lazy page sits in a `PageBoundary`** (`ErrorBoundary` + `Suspense`, defined in `App.jsx`), and the whole app sits in
  `<ErrorBoundary fullPage>`. A render error shows "Something went wrong / Try again", never a white page. New `React.lazy`
  imports use `lazyWithRetry` (`lib/lazyWithRetry.js`, aliased as `lazy` in `App.jsx`): one retry, then a single guarded reload
  (30 s window, `sessionStorage` `ah_chunk_reload`) when a deploy has replaced the chunk. Do not add a bare `<Suspense>` around a page.
- **Never assign `window.location` from an API value.** Hosted-checkout redirects go through `goToCheckout(url)` (`lib/safeRedirect.js`):
  https `hubtel.com` hosts or same-origin only, otherwise it throws `UntrustedCheckoutUrlError` into the caller's existing `catch`.
  Pass `"assign"` as the second argument where the call site used `location.assign`.
- **`createQueryClient()` (`lib/queryClient.js`) owns the Query defaults**: 30 s `staleTime`, no retry on 4xx, mutations never retried.
  A write must invalidate its keys explicitly (it already does by convention). `apiFetch(path, { signal })` takes the AbortSignal
  React Query passes a `queryFn`; hooks adopt it one at a time.
- **Map marker icons come from `lib/leafletIcons.js`** (bundled), never from a CDN.
- **Security headers live in `infra/hestia/templates/ashantihub-spa.stpl` and `vercel.json`**; the CSP is *Report-Only* until the
  console is clean. `__tests__/securityHeaders.test.js` keeps the copies identical and the inline-script hash current: editing the
  inline script in `index.html` means updating the hash in both files.
- **Browser error reporting is `lib/telemetry.js`**: off unless `VITE_SENTRY_DSN` is set at build time, SDK loaded lazily, and every event
  passes `scrub()` (no user, cookies, headers, bodies, query strings, e-mails, phone numbers or tokens). `ErrorBoundary` reports through it.
  Never call `Sentry.setUser` or attach customer data; add a field to the scrubber's tests before sending anything new.
- **Listing photos render through `pictureProps(variants, original, {sizes, eager})`** (`lib/responsiveImage.js`): `srcset` from the API's
  `main_photo_variants` / `photos[].variants` (thumb 320, medium 800, large 1600), lazy by default, `eager` only for the one image above the
  fold. `cardPhoto(item)` picks the main photo else the first gallery photo. Pass the width the image is really shown at as `sizes`;
  don't point an `<img>` at the original when a variant exists.
