# Design: Staff Dashboard Shell (RBAC-driven, light/dark theme)

**Date:** 2026-07-11
**Status:** Approved
**Sub-project:** Second of the dashboards/RBAC initiative, following `2026-07-11-login-session-design.md`. Unblocks nothing further by itself, but is the template the future business-owner-dashboard-rewire and customer-dashboard sub-projects will likely follow for permission/role-driven UI.

## 1. Background & scope

The backend's `Role`/`Permission` RBAC (seeded in `accounts/migrations/0002_seed_roles_permissions.py` and `0006_seed_zones_manage_permission.py`) has existed since the roles-registration-kyc sub-project, and staff can now actually log in (`2026-07-11-login-session-design.md`) — but the frontend has never used any of it. Logging in as any staff role and reaching the dashboard (via the existing hidden 5-click-logo gesture) still renders `AdminDashboard`, a single component built entirely from fictional mock data (delivery riders, grocery-concierge orders, a flat customer list) that doesn't correspond to anything in the real schema, regardless of which role logged in.

This spec replaces `AdminDashboard` with a new `StaffDashboard`: a permission-gated shell where the sidebar navigation and every panel are driven by the specific `Permission` codenames the logged-in staff member's `Role` actually holds — mirroring exactly how the backend already gates each endpoint, so the two can never drift out of sync via a hardcoded frontend role→UI mapping.

**Actual permission matrix** (confirmed against the seed migrations):

| Role | Permissions |
| --- | --- |
| `super_admin` | all 14 (every permission below, plus `zones.manage`) |
| `admin` | `kyc.approve`, `listings.moderate`, `users.view`, `zones.manage` |
| `marketing` | `promotions.manage`, `analytics.view`, `categories.manage`, `zones.manage` |
| `accountant` | `escrow.view`, `escrow.release`, `disputes.resolve_financial`, `transactions.report` |
| `support` | `messaging.manage`, `disputes.flag`, `users.view` |

**Real vs. placeholder, per permission:**

| Permission | Backend today | Dashboard panel |
| --- | --- | --- |
| `kyc.approve` | Real (`KYCPendingQueueView`, `KYCDetailView`, `KYCApproveView`, `KYCRejectView`) | Real |
| `listings.moderate` | Real (`ModerationPendingQueueView`, `ModerationListingDetailView`, `ModerationApproveView`, `ModerationRejectView`) | Real |
| `users.view` | **Gap — this spec adds it** (§2.2) | Real |
| `categories.manage` / `zones.manage` | Real (`CategoryListView`/`ZoneListView`, `ListCreateAPIView`, POST gated) | Real |
| `staff.manage` | Partial — invite/resend exist, no roster view — **this spec adds the list** (§2.2) | Real |
| `escrow.view` / `escrow.release` | None — explicitly a separate future sub-project | Placeholder |
| `disputes.resolve_financial` / `disputes.flag` | None | Placeholder |
| `transactions.report` | None | Placeholder |
| `promotions.manage` | None | Placeholder |
| `analytics.view` | None | Placeholder |
| `messaging.manage` | None | Placeholder |

**In scope:** exposing `role`/`permissions` on staff auth responses; three new small list endpoints (`users.view`-gated customer/business-owner lists, `staff.manage`-gated staff roster); the new `StaffDashboard` shell (sidebar nav, 6 real panels, 6 honest placeholder panels); a light/dark theme toggle, scoped to this new component only.

**Out of scope:** escrow/promotions/analytics/messaging backends themselves (separate future sub-projects); retrofitting light/dark theming onto any *existing* component (marketplace, Hero, Navbar, `CreditDashboard`, `PaymentDashboard`, `BusinessDashboard`) — that's a separate, much larger sub-project given the whole app is ~3,600 lines of hardcoded inline styles with zero theming infrastructure today; introducing real URL routing (still not needed — staff continue reaching the dashboard via the existing hidden-gesture bridge from the login-session sub-project, unchanged by this spec).

## 2. Backend

### 2.1 Expose role/permissions on staff auth responses

`StaffLoginView` (`backend/accounts/views.py`) and `me()` gain two additional response fields, **only when the account is a `StaffUser`**:

```json
{"token": "...", "account_type": "staff", "id": 4, "full_name": "Akosua Support",
 "role": "support", "permissions": ["messaging.manage", "disputes.flag", "users.view"]}
```

`role` is `Role.name`; `permissions` is `list(request.user.role.permissions.values_list("codename", flat=True))` (or the equivalent at login time via the freshly-fetched `StaffUser` instance). Customer and business-owner responses are completely unchanged — no `role`/`permissions` keys appear for those account types, not even as `null`, since the concept doesn't apply to them.

### 2.2 Three new list endpoints

All three follow the existing `ListAPIView` + `PageNumberPagination` pattern already used by `PublicListingListView` (page size 20).

| Endpoint | Gate | Returns |
| --- | --- | --- |
| `GET /api/accounts/customers/` | `users.view` | paginated `Customer`: `id, full_name, phone, email, created_at` |
| `GET /api/accounts/business-owners/` | `users.view` | paginated `BusinessOwner`: `id, full_name, login_phone, email, kyc_status, created_at` (new serializer, not reusing `BusinessOwnerKYCSerializer`, to avoid rippling a field change into the unrelated KYC-queue view) |
| `GET /api/accounts/staff/` | `staff.manage` | paginated `StaffUser`: `id, full_name, email, phone, role` (name), `status`, `created_at` |

`status` on the staff roster is computed, not stored: `"active"` if `invite_token is None`, else `"invite_expired"` if `invite_expires_at < now`, else `"invited"`.

No new models, no new migrations beyond what's implied by nothing — all three endpoints read existing tables.

## 3. Frontend

### 3.1 `useAuth` extension

`user` (from `frontend/hooks/useAuth.js`) gains optional `role`/`permissions` fields, present only when `account_type === "staff"` (mirrors the backend exactly — no default/placeholder values invented client-side). `useAuth()`'s return value gains one new helper:

```js
hasPermission(codename) // => user?.permissions?.includes(codename) ?? false
```

### 3.2 Theme infrastructure (scoped to `StaffDashboard` only)

New hook, `frontend/hooks/useTheme.js`: `useTheme()` returns `{ theme, toggleTheme }`. `theme` is `"light" | "dark"`, persisted to `localStorage` (key `"ashantihub.theme"`), defaulting on first load to `window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light"` if nothing is stored.

No React Context is introduced. `StaffDashboard` calls `useTheme()` once and passes `theme` down as a prop to its child panel components (at most 2–3 levels deep) — consistent with this codebase's existing "state lives at the top, passed down via props" convention (`CLAUDE.md` "Architecture"; the same pattern `FRONTEND_MODERNIZATION.md` explicitly reaffirms). If theming later expands beyond this one component tree, revisit Context then — not justified for a single subtree today.

A small token object (new file-local const in `App.jsx`, colocated with `StaffDashboard`) maps `theme` to concrete values:

```js
const DASHBOARD_THEME = {
  light: { pageBg:"#f0f2f5", sidebarBg:C.cream, sidebarText:C.darkBrown, cardBg:"#ffffff", text:C.darkBrown, textMuted:"#666", border:"#e0e0e0" },
  dark:  { pageBg:"#14161c", sidebarBg:"#0d0e12", sidebarText:C.cream, cardBg:"#1c1f26", text:C.cream, textMuted:"#9aa0aa", border:"#2a2d35" },
};
```

Only neutral surface/text colors change between themes; brand accent colors (`C.gold`, `C.kente1/2/3`, status colors) stay constant across both, matching how those hues are already used elsewhere in the app.

### 3.3 `StaffDashboard` component

Replaces `AdminDashboard` (`App.jsx:2203-2354`ish) entirely, along with its associated dead mock arrays (`mockCustomers`, `mockBusinesses`, `mockOrders`, `mockRiders`, `mockPartners`, `mockDeliveryOrders`) — none of it maps to the real schema, so nothing is preserved. New `export function StaffDashboard({ auth, onExit })`, following the same `export function` pattern as `Card`/`MapView`/`AuthModal` for testability, added to `App.jsx`.

**Layout:** fixed left sidebar, collapsible to icon-only under a narrow-viewport breakpoint. A 4px role-color accent stripe runs down the sidebar's left edge (and repeats as a small badge next to the staff member's name in the header) — one hue per role, drawn from the existing `C` palette (e.g. `super_admin`→`C.gold`, `admin`→`C.kente3`, `accountant`→`C.kente1`, `marketing`→`C.kente2`, `support`→`C.ghGreen`). This is the shell's signature element: it extends the app's existing Ghana-flag-stripe brand motif into the staff tool in a way that's informative (identifies the session's authority level at a glance), not decorative.

**Nav items**, each gated by `hasPermission(codename)` (Overview has no gate — shown to every staff session):

1. Overview — greeting, role badge, list of this session's own permissions (self-documenting; useful for support staff to confirm their own access)
2. KYC Queue (`kyc.approve`) — real
3. Listings Moderation (`listings.moderate`) — real
4. Users (`users.view`) — real, tabbed sub-view (Customers / Business Owners) over §2.2's two new endpoints
5. Categories & Zones (`categories.manage` **or** `zones.manage`) — real; the "create category" form only renders if `categories.manage` is held, "create zone" only if `zones.manage` is held (so `admin`, who has `zones.manage` but not `categories.manage`, sees zone creation only)
6. Staff Management (`staff.manage`) — real: new roster list (§2.2) plus the existing invite/resend-invite actions
7. Escrow Ledger (`escrow.view` or `escrow.release`) — placeholder
8. Disputes (`disputes.resolve_financial` or `disputes.flag`) — placeholder
9. Transactions Report (`transactions.report`) — placeholder
10. Promotions (`promotions.manage`) — placeholder
11. Analytics (`analytics.view`) — placeholder
12. Messaging / Tickets (`messaging.manage`) — placeholder

**Placeholder panels:** a single shared `ComingSoonPanel` component (icon + one line of plain copy: "This is coming soon — `<feature>` isn't built yet.") — never fake/mock data. The nav item itself stays visible (not hidden) whenever the underlying permission is held, so a role's real scope is legible even before that feature ships — hiding it would make e.g. an accountant's entire dashboard look broken (nothing but Overview).

**Theme toggle:** a control in the header (sun/moon icon toggle), calling `toggleTheme()`.

**`AshantiHub` wiring:** no change to `isAdmin`'s own state/gating logic — `if(isAdmin) return <AdminDashboard onExit=.../>` becomes `if(isAdmin) return <StaffDashboard auth={auth} onExit={()=>setIsAdmin(false)}/>`. The existing hidden-gesture bridge from the login-session sub-project (`handleLogoClick`) is unchanged.

## 4. Testing

**Backend** (Django `TestCase`, per-app convention): each of the 3 new list endpoints — correct 403 for a staff account lacking the gating permission, correct 200 + shape for one that holds it, pagination behaves like the existing listings pattern. Login/`me()` tests: `role`/`permissions` present and correct for a staff account, absent for customer/business-owner accounts.

**Frontend** (Vitest + RTL, matching `AuthModal.test.jsx` conventions): `StaffDashboard` — given a mocked `auth.user` with varying `permissions` arrays, the correct nav items render/don't render (e.g. a `support`-shaped user sees Overview/Users/Messaging/Disputes only); each real panel's data-fetching hook is tested with MSW-mocked responses; placeholder panels render `ComingSoonPanel` and never attempt a network call for permissions with no backend; `useTheme` persists to `localStorage` and defaults from `prefers-color-scheme` when nothing is stored.

## 5. Edge cases & error handling

- A staff account whose `Role` is later stripped of every permission (edge case, no UI for this today) sees a dashboard with only "Overview" — not an error state, since Overview has no permission gate.
- `Categories & Zones` panel: an `admin` (has `zones.manage`, not `categories.manage`) must not see the category-creation form even though the panel itself is visible — gated per-form, not per-panel (§3.3 item 5).
- Theme preference is per-browser (`localStorage`), not per-account — logging in as a different staff member on the same browser keeps whatever theme was last set, matching how most consumer apps handle local UI prefs distinct from account data.
- The three new list endpoints return 404-free empty pages (not 403) once a caller has the gating permission but the underlying table is empty — same "publish nothing, don't error" convention as the existing public listings endpoint.

## 6. Open questions

None — all decisions in this spec were confirmed during brainstorming (2026-07-11).
