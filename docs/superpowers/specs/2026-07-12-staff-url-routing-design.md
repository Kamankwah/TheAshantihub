# Design: `/staff` URL Deep Link

**Date:** 2026-07-12
**Status:** Approved
**Sub-project:** First of three sub-projects retrofitted from a single ungoverned working-tree session (2026-07-12) into the repo's normal spec/plan/worktree/PR pipeline — see `docs/superpowers/plans/2026-07-12-staff-url-routing-plan.md` for the retrofit context. Resolves the routing decision `docs/superpowers/specs/2026-07-11-login-session-design.md` §3.4 and `docs/PWA_STAFF_DASHBOARD.md` §4 both explicitly deferred to "the future staff-dashboard-shell sub-project."

## 1. Background & scope

Staff have only ever been able to reach `StaffDashboard` via a hidden 5-click-logo gesture (`handleLogoClick`) — a deliberate temporary bridge documented in the login-session spec, not a real entry point. `docs/PWA_STAFF_DASHBOARD.md` §4 lays out an "Option A vs. B" routing decision (no routing vs. a real `/staff` URL) and recommends Option B, but flags that it requires introducing URL routing to an app that has zero routing library and deliberately avoided one. This spec implements the routing half of Option B — a real, bookmarkable `/staff` URL — without pulling in a router library or doing the PWA-installability half (second manifest/`start_url`), which stays deferred.

**In scope:** `window.location.pathname`/`window.history` based detection and sync for exactly one path, `/staff`.

**Out of scope:** any router library (react-router, etc.), any other URL-addressable route, the manifest/`start_url`/installability half of PWA_STAFF_DASHBOARD.md §4 Option B, service worker registration (§2 of that doc, separate outstanding prerequisite), icon set (§3).

## 2. Design

`AshantiHub` (`frontend/App.jsx`) already gates `StaffDashboard` behind `isAdmin` (boolean state) and reaches the staff login modal via `setAuthModal("staff-login")`. Two `useEffect`s are added, both scoped inside `AshantiHub`, no new files:

1. **Mount-time path check.** Guarded by a `useRef` (`staffUrlHandled`) so it fires at most once, and by `auth.isLoading` so it waits for the session-restore fetch (`useAuth`'s `GET /api/accounts/me/` on load) to settle before deciding — checking `auth.user` synchronously on mount would see `null` even for an already-authenticated staff member mid-refresh, incorrectly showing the login modal. Once settled: if `pathname === "/staff"`, either `setIsAdmin(true)` (staff already logged in, same condition `handleLogoClick` uses) or `setAuthModal("staff-login")` (skips the 5-click requirement entirely for a direct `/staff` visit).
2. **URL sync effect**, watching `[isAdmin]`. `pushState("/staff")` when it becomes `true` — regardless of *how* it became true (gesture, direct `/staff` visit, or the existing post-login `onSuccess` handler that already sets `isAdmin` for staff accounts) — and `pushState("/")` when it becomes `false` (`StaffDashboard`'s `onExit`). One effect reacting to state, rather than scattering `pushState` calls at every `isAdmin`-setting call site.

No changes needed at `handleLogoClick`, `onExit`, or the auth-success handler — they already just set `isAdmin`, which the sync effect reacts to.

No backend or `frontend/vercel.json` change: the existing catch-all SPA rewrite (`"/(.*)" → "/index.html"`) already serves `/staff` correctly.

## 3. Testing

No new automated test added — this is a thin integration behavior (two effects wrapping existing, already-tested state transitions) rather than new business logic with a clean unit boundary. Verified via the existing Vitest suite staying green (`AuthModal.test.jsx`, `StaffDashboard.test.jsx` are the most relevant, both exercise the states these effects toggle) plus manual trace-through of: direct `/staff` visit while logged out (login modal opens), direct `/staff` visit while already logged in as staff (dashboard renders immediately, no login-modal flash), successful staff login from `/staff` (URL stays `/staff`), `StaffDashboard` exit (URL returns to `/`), and the old 5-click gesture from `/` (unchanged behavior, now additionally pushes `/staff` on success).

## 4. Open questions

None — this closes the routing decision the login-session and staff-dashboard-shell specs both explicitly deferred; no new ambiguity introduced.
