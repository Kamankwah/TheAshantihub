# UI Modernization & Trust/Navigation Fixes — Phased Roadmap

**Status:** Planning only at time of writing — implemented phase by phase in the same worktree/branch as `docs/BUSINESS_EVENTS_ROADMAP.md`, before that branch merges to `main`.

## 0. Why this pass exists

Following the 7-phase Business/Events roadmap, a second round of changes was requested:

1. **Trust/safety**: remove WhatsApp as a contact channel from every business — a fraud-prevention decision, not a bug fix.
2. **Business tab cleanup**: search moves into `Sidebar`; the Map View toggle, Saved button, and currency selector come out of the top row; Saved/favourites move to the account panel. (The "missing" hero carousel is confirmed *not* a bug — `HeroCarousel` intentionally renders nothing when there's no approved, non-expired hero-media submission yet.)
3. **A real navigation bug**: `page` is local `useState` with zero URL sync — `Navbar` calls `setPage`, nothing touches `window.location`/history except a hand-rolled, single-purpose `/staff` deep-link hack. Visiting `/business` directly or hard-reloading on it always bounces to home.
4. **A real gap**: a working light/dark theme system already exists (`useTheme` hook + `DASHBOARD_THEME`) but is wired up only inside `StaffDashboard` — never surfaced on the customer-facing Navbar.
5. **Modernize the CTA band and footer** with shadcn/ui + Tailwind + TypeScript, per a reference image (two-panel promo: business signup + a literal "download our app" panel) and a pasted shadcn `Footer2` component adapted to AshantiHub. Footer contact info and social links become editable by `system_admin`/`admin` from the staff dashboard.
6. **Tooling**: **incremental adoption** — set up TypeScript + Tailwind + shadcn/ui now, use them for all new work going forward, but leave the existing ~4,000-line `App.jsx` and its extracted components in JS + inline styles (the `C` palette system) for now. Bounds risk on a codebase with 460+ backend / 264+ frontend tests already green.

## 1. Scope decisions (already made, not re-litigated during execution)

- **Dark mode coverage**: toggle lives on the Navbar, lifts `useTheme()` to app root, toggles a `dark` class on `<html>`. Fully re-themes every **new** Tailwind-built surface (footer, CTA band). Does **not** retrofit existing inline-style `C`-palette surfaces (Card, Sidebar, PDP, etc.) this pass — those migrate to Tailwind incrementally later.
- **Footer app-store/play-store buttons**: created (per instructions) but rendered in the **CTA band** (Phase H), not duplicated in the footer — avoids two non-functional "get the app" prompts on one page.
- **MapView removal**: deleted outright (function + test), not hidden — nothing else references it; matches this project's established "no dead code" convention.
- **Currency selector removal**: removed from the Business tab, no relocation — backend is GHS-only everywhere already.
- **`/staff` route**: migrated onto the new router, replacing its current 3-effect hand-rolled `pushState`/`popstate` dance.
- **Not in scope this pass**: `isAdmin`/`showBizDash`/`showPayments`/`showCredit`/`selectedListingId`/`selectedEventId` stay local state, not real routes — only the five top-level nav pages plus `/staff` and `/register` get real URLs this pass.

## 2. Phases

### Phase A — Tooling: TypeScript + Tailwind CSS + shadcn/ui
- `tsconfig.json` with `allowJs: true`, `@types/react`, `@types/react-dom` — existing `.jsx` files keep working untouched.
- Run the shadcn CLI init flow to scaffold Tailwind + `components.json` together. `frontend/` has **no `src/`** (flat layout) — path aliases point at `frontend/` root, not `frontend/src/`.
- `frontend/lib/utils.ts` (the `cn()` helper every shadcn component expects).
- `frontend/components/ui/` created as a dedicated subfolder for shadcn's generic primitives, separate from the existing hand-built `frontend/components/*.jsx` app components — keeps future `npx shadcn add ...` non-destructive and avoids naming collisions.
- Verify: `npm run build` and `npm run test -- --run` both pass unmodified.

### Phase B — Backend: editable footer content
- New `backend/core/models.py`: `SiteSettings` singleton (`contact_email`, `contact_phone`, `contact_address`, `facebook_url`, `instagram_url`, `linkedin_url`, `twitter_url`, all blank-allowed).
- `GET /api/core/site-settings/` — public. `PATCH /api/core/site-settings/` — staff-only, gated by new `site_settings.manage` permission, seeded onto `admin` + `super_admin` via a migration pattern-matching `accounts/migrations/0009_seed_hero_and_event_approve_permissions.py`.
- New `StaffDashboard` "Site Settings" tab, gated by `auth.hasPermission("site_settings.manage")`, mirroring `CategoriesZonesPanel`'s CRUD-form shape.

### Phase C — Frontend: shadcn `Footer2`, adapted
- Install `lucide-react`, `@radix-ui/react-slot`, `class-variance-authority` (+ `clsx`/`tailwind-merge` if not already present).
- `components/ui/button.tsx`, `components/ui/app-store-button.tsx`, `components/ui/play-store-button.tsx` (created here, rendered in Phase H).
- `components/ui/footer-2.tsx`: real AshantiHub link groups (reusing `setLegalDoc` for Terms/Privacy/Business Agreement), social icons + contact info sourced live from a new `useSiteSettings()` hook against Phase B's endpoint — empty social fields don't render an icon.
- Swap `App.jsx`'s footer render from `components/Footer.jsx` to the new `Footer2`; delete the old `Footer.jsx` + its test.

### Phase D — Routing: real URLs + reload persistence
- Add `react-router-dom`; `<BrowserRouter>` in `main.jsx`.
- `AshantiHub`'s `page` state becomes derived from `useLocation().pathname`; `Navbar` keeps its exact `setPage`-shaped prop (now backed by `useNavigate()`) — **zero changes needed to `Navbar.jsx`/`Navbar.test.jsx`**.
- Routes: `/`, `/business`, `/events`, `/about`, `/contact`, `/register`, `/staff` (replacing the hand-rolled pushState dance), catch-all → `NotFoundPage`.
- New routing test (App-level navigation currently has zero coverage). Browser-verify hard reload stays on `/business` etc., and `/staff` deep link still works.

### Phase E — Theme toggle on the Navbar
- Lift `useTheme()` to `AshantiHub` root; `useEffect` toggling a `dark` class on `document.documentElement`.
- Toggle button added to `Navbar.jsx`'s utility row (desktop + mobile), `theme`/`toggleTheme` as new props. Update `Navbar.test.jsx`.

### Phase F — Remove WhatsApp everywhere
- Remove `WABtn`, `handleWA`, every `wa.me` link, the floating WhatsApp bubble, `Hero.jsx` copy mentioning it.
- Where `Message`/`ChatLauncher` already sits alongside WhatsApp (`Card`, `ListingDetailPage`) — remove the WhatsApp half only.
- Where WhatsApp is currently the *only* contact path (floating bubble, Contact page, `EventDetailPage` enquiry, referral share, staff "Reply on WhatsApp") — replace with the equivalent in-app `ChatLauncher`/`MessagingCenter` action.

### Phase G — Business tab restructuring
- `search`/`onSearchChange` props + input added to `Sidebar.jsx`; Business tab's search moves there (Events tab's separate search is untouched).
- Remove Map View toggle + render; delete dead `MapView` function + `MapView.test.jsx`.
- Remove "Saved (N)" button from the top row — favouriting (heart icon on `Card`) untouched; saved businesses reachable only via `AccountPanel`'s existing entry (already wired to `FavsDrawer`).
- Remove currency `<select>` from the Business tab, no relocation.

### Phase H — CTA band redesign
- New Tailwind/shadcn two-panel component per the reference image: left "Register Your Business", right a genuine "Download Our App" panel (phone input + "Send Link" using Phase C's `AppStoreButton`/`PlayStoreButton`, QR-code placeholder) — "Send Link" shows a coming-soon message since there's no real app yet.
- Replaces the current "Own a Business in Ashanti?" CTA band in `App.jsx`.

## 3. Sequencing

```
Phase A (tooling)
     │
     ▼
Phase B (footer backend) ──────┐
     │                         │
     ▼                         │
Phase C (footer frontend) ─────┤
     │                         │
     ▼                         ▼
Phase D (routing)         Phase H (CTA band, needs A+C)
     │
     ▼
Phase E (theme toggle)
     │
     ▼
Phase F (remove WhatsApp)
     │
     ▼
Phase G (business tab restructuring)
```

D, E, F, G are independent of each other and of B/C once A is done — sequenced here for commit clarity, not because of a hard dependency, except H which needs C's button components.

## 4. Verification

Same rigor as `docs/BUSINESS_EVENTS_ROADMAP.md`: independently re-run the backend/frontend test suites per phase (never trust an agent's self-report alone), and for D/E/F/G/H specifically, do a real browser check with seeded data — this caught three real bugs in the last roadmap that unit tests alone missed.
