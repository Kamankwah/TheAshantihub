# Staff PWA + Responsive Staff Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/staff` an installable "AshantiHub Staff" PWA and make every staff view lay out
and scroll correctly on phones, tablets, laptops, and desktops.

**Architecture:**
- `vite-plugin-pwa` generates a Workbox service worker that `lib/staffPwa.js` registers with
  `scope: "/staff"`. A static `staff.webmanifest` is linked into `<head>` only on staff paths, so
  the public marketplace is never controlled or installable.
- `AdminCommandCenter` becomes a breakpoint-aware shell built from small `components/admin/shell/*`
  pieces:
  - desktop: sidebar
  - tablet: icon rail plus drawer
  - phone: drawer plus bottom bar
- The shell takes `activeTab`/`onTabChange` from `App.jsx`, which maps them to `/staff/:panel`
  URLs.
- No API data is ever cached.

**Tech Stack:**
- React 19, react-router-dom 7, TanStack Query 5
- Vite 5 + `vite-plugin-pwa` 2 (Workbox 7), `@vite-pwa/assets-generator`
- Vitest 1 + Testing Library + MSW 2
- Playwright MCP for the layout audit, Chrome DevTools MCP for PWA checks
- nginx (HestiaCP templates), Vercel

**Spec:** `docs/superpowers/specs/2026-10-03-staff-pwa-responsive-design.md`. Read it before
starting any task.

## Global Constraints

- **Breakpoints:**
  - phone `(max-width: 760px)`
  - tablet `(min-width: 761px) and (max-width: 1199px)`
  - desktop is everything else, which is also the fallback when `matchMedia` is missing or matches
    nothing (jsdom)
- **Styling:**
  - Inline `style={{}}` using `D` (`components/admin/theme.js`) or `C` (`theme.js`). No new hex
    colours, no Tailwind classes, no CSS modules.
  - Only CSS that inline styles can't express (`@supports`, `@keyframes`, `:focus-visible`,
    descendant rules) goes in the component-local `<style>` in `StaffShellStyles.jsx`.
- **Contract tests:** `frontend/StaffDashboard.test.jsx` and `frontend/BusinessDashboard.test.jsx`
  must pass **unmodified**. Every nav item `id`, `label`, and permission `show` check stays
  byte-identical.
- **Imports:** `components/**` must never import `App.jsx`; URL knowledge reaches the shell only
  through props.
- **Data and caching:**
  - No API response is ever cached by the service worker: no `runtimeCaching`.
  - No fabricated data and no "last synced" UI.
- **Service worker:** scope is exactly `"/staff"` and the file is `/sw.js`. The manifest is
  `/staff.webmanifest`, with `start_url` and `scope` both `"/staff"`.
- **Updates:** `registerType: "prompt"`; never auto-reload a staffer's page.
- **Touch and inputs on phone:** touch targets ≥44×44px, form inputs at 16px font.
- **Motion:** the drawer slide is 220ms `ease-out`, disabled under `prefers-reduced-motion`
  (`DESIGN.md` Motion).
- **nginx:** never add a `^~ /.well-known/` location to `infra/hestia/templates/*`.
- **Running tests:** run Vitest from `frontend/` (`cd frontend && npx vitest run …`). Never run it
  from the repo root.
- **Committing:** stage explicit paths only. The working tree carries the user's unrelated
  uncommitted work, which must **never** be staged: `.claude/settings.local.json`, `.gitignore`,
  `CLAUDE.md`, `.claude/skills/`, `backend/CLAUDE.md`, `backend/core/management/`, and
  `frontend/CLAUDE.md`.
- **Commit trailer:** every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017kwucfaVoi6X952jkJGouX
  ```
- **Deploys:** none in this plan. Staging and production deploys go through the `deploy` skill
  and need the user's say-so; production needs an explicit instruction.

## Review Focus

1. **Installed app opened offline or on a flaky network.** The staffer must stay signed in and see
   the shell plus the offline banner, not the login modal. *(Task 1 tests: network error and 500
   keep the session; 401 and 403 clear it.)*
2. **Rotating a tablet or resizing a window across a breakpoint with the drawer open.** The drawer
   must close and page scroll must unlock. *(Task 4 test: open at 375px, resize to 1440px.)*
3. **Tapping the already-active nav or bottom-bar item.** This must not push a duplicate history
   entry, or Android back would appear to do nothing. *(Task 3 test: the controlled shell does not
   call `onTabChange` for the active tab.)*
4. **Entering or leaving staff in-session** (logo gesture, staff login, or "← Exit") without a
   reload. The manifest link must appear on `/staff*` and disappear on `/`. *(Task 8 test: Exit
   from `/staff/users` lands on `/` with no manifest link.)*
5. **Long unbroken strings at 320px** (emails, payment references, codes) must not create
   horizontal page scroll. *(Task 9: `overflow-wrap: anywhere` rule plus the 320px audit
   viewport.)*

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `frontend/hooks/useAuth.js` | modify | Session restore clears only on 401/403 |
| `frontend/hooks/useBreakpoint.js` | create | `"phone" \| "tablet" \| "desktop"` from `matchMedia` |
| `frontend/test/matchMedia.js` | create | Test helper: controllable `matchMedia` by viewport width |
| `frontend/test/setup.js` | modify | No-op `window.scrollTo` (jsdom logs "not implemented") |
| `frontend/components/admin/shell/navModel.js` | create | `buildNavGroups` (moved), `BADGE_KEY_BY_TAB` (moved), `makeBadgeFor`, `isPermittedTab`, `pickBottomBarItems` |
| `frontend/components/admin/shell/StaffNavList.jsx` | create | Grouped nav buttons (sidebar, rail, drawer) |
| `frontend/components/admin/shell/StaffHeader.jsx` | create | Sticky header + `RoleChip` |
| `frontend/components/admin/shell/StaffDrawer.jsx` | create | Slide-over dialog: focus trap, Esc, scroll lock |
| `frontend/components/admin/shell/StaffBottomBar.jsx` | create | Phone quick-nav bar |
| `frontend/components/admin/shell/StaffShellStyles.jsx` | create | The shell's one `<style>`: dvh, keyframes, focus ring, phone baseline |
| `frontend/components/admin/shell/InstallAppButton.jsx` | create | Install prompt / iOS hint |
| `frontend/components/admin/shell/UpdateToast.jsx` | create | "New version available — Reload" |
| `frontend/components/admin/shell/OfflineBanner.jsx` | create | Offline strip |
| `frontend/components/admin/AdminCommandCenter.jsx` | modify | Composes the shell; controlled/uncontrolled tab |
| `frontend/lib/staffPwa.js` | create | Head-tag injection, SW registration, install/update store |
| `frontend/test/stubs/pwa-register.js` | create | Vitest alias target for `virtual:pwa-register` |
| `frontend/vite.config.js` | modify | `VitePWA(...)`, test alias |
| `frontend/public/` (new dir) | create | `favicon.svg` (moved), `staff.webmanifest`, `icons/*` |
| `frontend/pwa-assets.config.js` | create | Icon generation config |
| `frontend/index.html` | modify | Drop global manifest link; `viewport-fit=cover` |
| `frontend/manifest.json`, `frontend/sw.js` | delete | Dead, never shipped |
| `frontend/main.jsx` | modify | Boot-time staff head + PWA start |
| `frontend/App.jsx` | modify | `/staff/:panel`, head effect, standalone sign-out |
| `frontend/components/admin/panels/*.jsx` | modify (audit-driven) | Layout-only fixes |
| `frontend/scripts/staff-layout-audit.js` | create | Playwright overflow audit |
| `frontend/test/staffPwaConfig.test.js` | create | Manifest, `vercel.json`, nginx template contract |
| `frontend/vercel.json` | modify | SW/manifest/asset headers |
| `infra/hestia/templates/ashantihub-spa.tpl`, `.stpl` | modify | SW/manifest headers |
| `docs/PWA_STAFF_DASHBOARD.md` | modify | Mark done |

---

### Task 1: Keep the stored session when `/me` fails for a non-auth reason

**Files:**
- Modify: `frontend/hooks/useAuth.js:14-27`
- Test: `frontend/hooks/__tests__/useAuth.test.jsx`

**Interfaces:**
- Consumes: `apiFetch` throws an `Error` with `.status` for HTTP errors; a network failure
  rejects with a `TypeError` that has no `.status`.
- Produces: `useAuth()` is unchanged in shape. Behaviour change: on a restore failure without
  status 401/403, `user` is the stored auth object and the storage is kept.

- [ ] **Step 1: Write the failing tests.** Add them inside `describe('useAuth', …)`, after the
  existing `'clears a stored token that /me/ rejects'` test:

```jsx
  it('keeps the stored session when /me/ fails with a network error (offline launch)', async () => {
    const stored = { token: 'abc123', account_type: 'staff', id: 1, full_name: 'Akosua', permissions: ['users.view'] }
    setStoredAuth(stored)
    server.use(http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.error()))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toEqual(stored)
    expect(JSON.parse(localStorage.getItem('ashantihub.auth'))).toEqual(stored)
  })

  it('keeps the stored session when /me/ fails with a server error', async () => {
    setStoredAuth({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
    server.use(http.get('http://localhost:8000/api/accounts/me/', () => new HttpResponse(null, { status: 500 })))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toMatchObject({ token: 'abc123', full_name: 'Ama' })
  })

  it('clears a stored token that /me/ forbids', async () => {
    setStoredAuth({ token: 'abc123', account_type: 'staff', id: 1, full_name: 'Akosua' })
    server.use(http.get('http://localhost:8000/api/accounts/me/', () => new HttpResponse(null, { status: 403 })))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem('ashantihub.auth')).toBeNull()
  })
```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `cd frontend && npx vitest run hooks/__tests__/useAuth.test.jsx`

  Expected: the two "keeps the stored session" tests FAIL (`user` is `null`). The 403 test
  already passes.

- [ ] **Step 3: Implement.** In `frontend/hooks/useAuth.js`, replace the restore effect's
  `.catch(...)`:

```js
    apiFetch('/api/accounts/me/')
      .then((me) => setUser({ ...stored, ...me }))
      .catch((error) => {
        // Only an auth rejection ends the session. A network failure (no
        // `.status` — e.g. the installed staff app opened offline) or a server
        // error keeps the stored session, which already holds the last /me/
        // payload (login merges it in), so the app can render and show its
        // own offline/error states instead of silently signing the user out.
        if (error?.status === 401 || error?.status === 403) {
          setStoredAuth(null)
          setUser(null)
        } else {
          setUser(stored)
        }
      })
      .finally(() => setIsLoading(false))
```

- [ ] **Step 4: Run the tests to verify they pass.**

  Run: `cd frontend && npx vitest run hooks/__tests__/useAuth.test.jsx App.routing.test.jsx`

  Expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
git add frontend/hooks/useAuth.js frontend/hooks/__tests__/useAuth.test.jsx
git commit -m "fix(auth): keep the stored session when /me fails offline

Only a 401/403 ends a session on restore; a network or server error keeps
the stored login so an installed staff app opened offline isn't signed out.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017kwucfaVoi6X952jkJGouX"
```

---

### Task 2: `useBreakpoint` hook + nav model

**Files:**
- Create: `frontend/hooks/useBreakpoint.js`
- Create: `frontend/test/matchMedia.js`
- Create: `frontend/components/admin/shell/navModel.js`
- Modify: `frontend/components/admin/AdminCommandCenter.jsx`: delete the local `buildNavGroups`
  and `BADGE_KEY_BY_TAB` (lines ~44-129) and import them instead.
- Test: `frontend/hooks/__tests__/useBreakpoint.test.jsx`
- Test: `frontend/components/admin/shell/__tests__/navModel.test.js`

**Interfaces:**
- Produces:
  - `useBreakpoint(): "phone" | "tablet" | "desktop"` (default export), plus named exports
    `PHONE_QUERY` and `TABLET_QUERY`.
  - `installMatchMedia(width: number): { resize(width: number): void, restore(): void }`
  - `buildNavGroups(auth) → Array<{id,label,items:Array<{id,icon,label,show}>}>`
  - `BADGE_KEY_BY_TAB`
  - `makeBadgeFor(staffBadges) → (tabId) => number`
  - `isPermittedTab(navGroups, tabId) → boolean`
  - `pickBottomBarItems(navGroups, badgeFor, slots = 3) → item[]`

- [ ] **Step 1: Write the test helper** `frontend/test/matchMedia.js`:

```js
// Controllable window.matchMedia for viewport-dependent tests. Evaluates
// `(max-width: Npx)` / `(min-width: Npx)` clauses against a fake width and
// fires registered "change" listeners on resize(). The global stub in
// test/setup.js (matches: false for everything) stays the default.
export function installMatchMedia(initialWidth) {
  const original = window.matchMedia
  let width = initialWidth
  const listeners = new Set()
  const evaluate = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
  }
  window.matchMedia = (query) => ({
    media: query,
    get matches() { return evaluate(query) },
    addEventListener: (_type, cb) => listeners.add(cb),
    removeEventListener: (_type, cb) => listeners.delete(cb),
    addListener: (cb) => listeners.add(cb),
    removeListener: (cb) => listeners.delete(cb),
  })
  return {
    resize(nextWidth) {
      width = nextWidth
      listeners.forEach((cb) => cb({ matches: undefined }))
    },
    restore() {
      window.matchMedia = original
    },
  }
}
```

- [ ] **Step 2: Write the failing hook test** `frontend/hooks/__tests__/useBreakpoint.test.jsx`:

```jsx
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import useBreakpoint from '../useBreakpoint.js'
import { installMatchMedia } from '../../test/matchMedia.js'

let mm
afterEach(() => mm?.restore())

describe('useBreakpoint', () => {
  it('falls back to desktop under the global jsdom stub (matches nothing)', () => {
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('desktop')
  })

  it.each([
    [320, 'phone'], [760, 'phone'], [761, 'tablet'], [1199, 'tablet'], [1200, 'desktop'], [1920, 'desktop'],
  ])('width %i → %s', (width, expected) => {
    mm = installMatchMedia(width)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe(expected)
  })

  it('updates when the viewport crosses a breakpoint', () => {
    mm = installMatchMedia(375)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('phone')
    act(() => mm.resize(1024))
    expect(result.current).toBe('tablet')
    act(() => mm.resize(1440))
    expect(result.current).toBe('desktop')
  })
})
```

- [ ] **Step 3: Run it to verify it fails.**

  Run: `cd frontend && npx vitest run hooks/__tests__/useBreakpoint.test.jsx`

  Expected: FAIL, "Failed to resolve import ../useBreakpoint.js".

- [ ] **Step 4: Implement** `frontend/hooks/useBreakpoint.js`:

```js
import { useEffect, useState } from "react";

// Viewport class for the staff shell (docs/superpowers/specs/2026-10-03-
// staff-pwa-responsive-design.md §4.1). Phone matches DESIGN.md's existing
// ≤760px mobile breakpoint. Anything that matches neither query — including
// jsdom's matchMedia stub, which matches nothing — is "desktop", so tests that
// don't opt into a viewport see the desktop layout.
export const PHONE_QUERY = "(max-width: 760px)";
export const TABLET_QUERY = "(min-width: 761px) and (max-width: 1199px)";

function readBreakpoint() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "desktop";
  if (window.matchMedia(PHONE_QUERY).matches) return "phone";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "desktop";
}

export default function useBreakpoint() {
  const [breakpoint, setBreakpoint] = useState(readBreakpoint);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const lists = [window.matchMedia(PHONE_QUERY), window.matchMedia(TABLET_QUERY)];
    const update = () => setBreakpoint(readBreakpoint());
    lists.forEach((list) => list.addEventListener?.("change", update));
    update();
    return () => lists.forEach((list) => list.removeEventListener?.("change", update));
  }, []);
  return breakpoint;
}
```

- [ ] **Step 5: Run the hook test.**

  Run: `cd frontend && npx vitest run hooks/__tests__/useBreakpoint.test.jsx`

  Expected: PASS.

- [ ] **Step 6: Write the failing nav-model test**
  `frontend/components/admin/shell/__tests__/navModel.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { buildNavGroups, isPermittedTab, makeBadgeFor, pickBottomBarItems } from '../navModel.js'

const groups = [
  { id: 'a', label: 'A', items: [
    { id: 'kyc', icon: '🪪', label: 'KYC Queue' },
    { id: 'moderation', icon: '📋', label: 'Listings Moderation' },
  ] },
  { id: 'b', label: 'B', items: [
    { id: 'users', icon: '👥', label: 'Users' },
    { id: 'messaging', icon: '💬', label: 'Messaging / Tickets' },
    { id: 'analytics', icon: '📊', label: 'Analytics' },
  ] },
]
const ids = (items) => items.map((i) => i.id)

describe('pickBottomBarItems', () => {
  it('puts panels with pending work first, in nav order rather than count order', () => {
    const counts = { messaging: 2, moderation: 40 }
    expect(ids(pickBottomBarItems(groups, (id) => counts[id] || 0))).toEqual(['moderation', 'messaging', 'kyc'])
  })

  it('keeps the same order when counts change but stay non-zero', () => {
    const counts = { messaging: 50, moderation: 1 }
    expect(ids(pickBottomBarItems(groups, (id) => counts[id] || 0))).toEqual(['moderation', 'messaging', 'kyc'])
  })

  it('fills with the first permitted panels when nothing is pending', () => {
    expect(ids(pickBottomBarItems(groups, () => 0))).toEqual(['kyc', 'moderation', 'users'])
  })

  it('returns fewer than three when fewer are permitted, never padding', () => {
    expect(ids(pickBottomBarItems([groups[0]], () => 0))).toEqual(['kyc', 'moderation'])
  })
})

describe('isPermittedTab', () => {
  it('always permits overview', () => expect(isPermittedTab([], 'overview')).toBe(true))
  it('permits a tab present in the groups', () => expect(isPermittedTab(groups, 'users')).toBe(true))
  it('rejects an absent or unknown tab', () => {
    expect(isPermittedTab(groups, 'staff')).toBe(false)
    expect(isPermittedTab(groups, 'not-a-panel')).toBe(false)
  })
})

describe('makeBadgeFor', () => {
  it('maps a tab id to its staff-badges key and defaults to 0', () => {
    const badgeFor = makeBadgeFor({ kyc: 3, listings: 0 })
    expect(badgeFor('kyc')).toBe(3)
    expect(badgeFor('moderation')).toBe(0)
    expect(badgeFor('users')).toBe(0)
    expect(makeBadgeFor(undefined)('kyc')).toBe(0)
  })
})

describe('buildNavGroups', () => {
  it('drops groups with no permitted items', () => {
    const auth = { hasPermission: (c) => c === 'messaging.manage' }
    const result = buildNavGroups(auth)
    expect(result.map((g) => g.id)).toEqual(['system'])
    expect(ids(result[0].items)).toEqual(['messaging'])
  })
})
```

- [ ] **Step 7: Run it to verify it fails.**

  Run: `cd frontend && npx vitest run components/admin/shell/__tests__/navModel.test.js`

  Expected: FAIL, unresolved `../navModel.js`.

- [ ] **Step 8: Implement** `frontend/components/admin/shell/navModel.js`.
  - **Move** `buildNavGroups` and `BADGE_KEY_BY_TAB` out of `AdminCommandCenter.jsx`
    **verbatim**, including their comment blocks.
  - Prefix each with `export`, and keep every `id`, `icon`, `label`, and `show` expression
    byte-identical.
  - Then append:

```js
// Badge lookup for a tab id against the GET /api/notifications/staff-badges/
// payload — 0 for tabs with no badge key or no data yet.
export function makeBadgeFor(staffBadges) {
  return (tabId) => {
    const key = BADGE_KEY_BY_TAB[tabId];
    return key ? (staffBadges?.[key] || 0) : 0;
  };
}

// Overview has no permission gate; every other tab must be one of the
// session's permitted nav items. Used to send unpermitted /staff/:panel URLs
// (or manifest shortcuts) back to Overview.
export function isPermittedTab(navGroups, tabId) {
  return tabId === "overview" || navGroups.some((group) => group.items.some((item) => item.id === tabId));
}

// Phone bottom-bar slots (spec §4.3): panels with pending work first, then
// the rest — both in nav order, never sorted by count, so icons only move
// when a queue empties or fills, not on every 60s badge poll.
export function pickBottomBarItems(navGroups, badgeFor, slots = 3) {
  const items = navGroups.flatMap((group) => group.items);
  const withWork = items.filter((item) => badgeFor(item.id) > 0);
  const rest = items.filter((item) => !(badgeFor(item.id) > 0));
  return [...withWork, ...rest].slice(0, slots);
}
```

- [ ] **Step 9: Point `AdminCommandCenter.jsx` at the moved code.**
  - Delete the moved `buildNavGroups` and `BADGE_KEY_BY_TAB` definitions.
  - Add `import { buildNavGroups, makeBadgeFor } from "./shell/navModel.js";`.
  - Replace the component's local `badgeFor` definition with:

```jsx
  const badgeFor = makeBadgeFor(staffBadges);
```

- [ ] **Step 10: Run the new tests plus the contract.**

  Run: `cd frontend && npx vitest run components/admin hooks/__tests__/useBreakpoint.test.jsx StaffDashboard.test.jsx`

  Expected: all PASS.

- [ ] **Step 11: Commit.**

```bash
git add frontend/hooks/useBreakpoint.js frontend/hooks/__tests__/useBreakpoint.test.jsx frontend/test/matchMedia.js frontend/components/admin/shell/navModel.js frontend/components/admin/shell/__tests__/navModel.test.js frontend/components/admin/AdminCommandCenter.jsx
git commit -m "feat(staff): add useBreakpoint and extract the staff nav model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017kwucfaVoi6X952jkJGouX"
```

---

### Task 3: `StaffNavList` + controlled active tab + permission fallback + scroll-to-top

**Files:**
- Create: `frontend/components/admin/shell/StaffNavList.jsx`
- Modify: `frontend/components/admin/AdminCommandCenter.jsx`
- Modify: `frontend/test/setup.js` (append a `scrollTo` stub)
- Modify: `frontend/App.jsx:1554-1556`: `StaffDashboard` passes the new props through
- Test: `frontend/components/admin/__tests__/AdminCommandCenter.test.jsx`

**Interfaces:**
- Consumes (Task 2): `buildNavGroups`, `makeBadgeFor`, `isPermittedTab`.
- Produces:
  - `<StaffNavList navGroups activeTab onSelect collapsed badgeFor roleColor itemMinHeight? />`
    renders `<nav aria-label="Staff panels">`. The active button carries `aria-current="page"`.
    When `collapsed`, every button has `aria-label` and `title` set to its label.
  - `<AdminCommandCenter auth onExit exitLabel="← Exit" activeTab? onTabChange? />`. When
    `activeTab !== undefined` it is controlled.
  - `onTabChange(id)` fires on a user click of a non-active tab.
  - `onTabChange("overview", { replace: true })` fires when the controlled `activeTab` is
    unpermitted or unknown.
  - `StaffDashboard({auth,onExit,activeTab,onTabChange,exitLabel})`.

- [ ] **Step 1: Stub `scrollTo` for jsdom.** Append to `frontend/test/setup.js`:

```js
// jsdom's window.scrollTo only logs "Not implemented". The staff shell scrolls
// to top on every panel change, so give it a silent no-op; tests that care
// spy on it with vi.spyOn(window, 'scrollTo').
if (typeof window !== 'undefined') {
  window.scrollTo = () => {}
}
```

- [ ] **Step 2: Write the failing tests**
  `frontend/components/admin/__tests__/AdminCommandCenter.test.jsx`:

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminCommandCenter from '../AdminCommandCenter.jsx'

const PERMS = ['messaging.manage', 'disputes.flag', 'users.view']
export function makeAuth() {
  return {
    user: { token: 't', account_type: 'staff', id: 1, full_name: 'Akosua Support', role: 'support', permissions: PERMS },
    hasPermission: (c) => PERMS.includes(c),
    logout: vi.fn(),
  }
}
export function renderShell(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminCommandCenter auth={makeAuth()} onExit={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}
const panelNav = () => screen.getByRole('navigation', { name: 'Staff panels' })

afterEach(() => vi.restoreAllMocks())

describe('AdminCommandCenter — tab control', () => {
  it('uncontrolled: clicking a nav item switches panels and marks it current', () => {
    renderShell()
    fireEvent.click(within(panelNav()).getByRole('button', { name: /Users/ }))
    expect(within(panelNav()).getByRole('button', { name: /Users/ })).toHaveAttribute('aria-current', 'page')
  })

  it('controlled: renders the activeTab prop and reports clicks through onTabChange', () => {
    const onTabChange = vi.fn()
    renderShell({ activeTab: 'users', onTabChange })
    expect(within(panelNav()).getByRole('button', { name: /Users/ })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(panelNav()).getByRole('button', { name: /Messaging/ }))
    expect(onTabChange).toHaveBeenCalledWith('messaging')
  })

  it('controlled: clicking the already-active tab does not call onTabChange (no duplicate history entry)', () => {
    const onTabChange = vi.fn()
    renderShell({ activeTab: 'users', onTabChange })
    fireEvent.click(within(panelNav()).getByRole('button', { name: /Users/ }))
    expect(onTabChange).not.toHaveBeenCalled()
  })

  it('controlled: an unpermitted activeTab renders Overview and asks to replace with overview', () => {
    const onTabChange = vi.fn()
    renderShell({ activeTab: 'kyc', onTabChange })
    expect(screen.getByText(/Akwaaba, Akosua/)).toBeInTheDocument()
    expect(onTabChange).toHaveBeenCalledWith('overview', { replace: true })
  })

  it('scrolls to top on a panel change but not on first mount', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo')
    renderShell()
    expect(scrollTo).not.toHaveBeenCalled()
    fireEvent.click(within(panelNav()).getByRole('button', { name: /Users/ }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
  })

  it('uses the exitLabel prop for the exit button', () => {
    renderShell({ exitLabel: 'Sign out' })
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run them to verify they fail.**

  Run: `cd frontend && npx vitest run components/admin/__tests__/AdminCommandCenter.test.jsx`

  Expected: FAIL. There is no `navigation` named "Staff panels", and the props are not supported.

- [ ] **Step 4: Create** `frontend/components/admin/shell/StaffNavList.jsx`. Its markup and
  styles are the current `<nav>` block from `AdminCommandCenter.jsx`, with `aria-current`,
  collapsed `aria-label`/`title`, `type="button"`, and `itemMinHeight` added:

```jsx
import { D } from "../theme.js";

// The grouped staff nav (Overview pinned first, then permission-filtered
// groups). Shared by the desktop sidebar, the tablet icon rail (collapsed),
// and the phone/tablet drawer — markup/text is the pre-extraction sidebar's,
// unchanged, because StaffDashboard.test.jsx asserts on these labels.
export default function StaffNavList({ navGroups, activeTab, onSelect, collapsed, badgeFor, roleColor, itemMinHeight }) {
  const itemStyle = (active) => ({
    display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: itemMinHeight,
    background: active ? `${roleColor}22` : "none",
    border: "none", borderLeft: active ? `3px solid ${roleColor}` : "3px solid transparent",
    color: D.text, padding: "10px 12px", fontSize: "0.78rem",
    fontWeight: active ? 800 : 600, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
  });
  return (
    <nav aria-label="Staff panels">
      {/* Overview — pinned, ungrouped, no permission gate */}
      <button type="button" onClick={() => onSelect("overview")} aria-current={activeTab === "overview" ? "page" : undefined}
        aria-label={collapsed ? "Overview" : undefined} title={collapsed ? "Overview" : undefined} style={itemStyle(activeTab === "overview")}>
        <span>📊</span>{!collapsed && <span>Overview</span>}
      </button>

      {navGroups.map(group => (
        <div key={group.id} style={{ marginTop: 10 }}>
          {!collapsed && <div style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "6px 12px" }}>{group.label}</div>}
          {group.items.map(item => {
            const badgeCount = badgeFor(item.id);
            const active = activeTab === item.id;
            const collapsedName = badgeCount > 0 ? `${item.label}, ${badgeCount} pending` : item.label;
            return (
              <button key={item.id} type="button" onClick={() => onSelect(item.id)} aria-current={active ? "page" : undefined}
                aria-label={collapsed ? collapsedName : undefined} title={collapsed ? item.label : undefined} style={itemStyle(active)}>
                <span style={{ position: "relative", flexShrink: 0 }}>
                  {item.icon}
                  {/* Collapsed: a dot on the icon since the label (and its inline badge) is hidden. */}
                  {collapsed && badgeCount > 0 && (
                    <span style={{ position: "absolute", top: -4, right: -6, background: D.red, borderRadius: "50%", width: 8, height: 8 }} />
                  )}
                </span>
                {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
                {!collapsed && badgeCount > 0 && (
                  <span aria-label={`${badgeCount} pending`} style={{ background: D.red, color: "#fff", borderRadius: 10, minWidth: 18, height: 18, fontSize: "0.62rem", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", flexShrink: 0 }}>
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 5: Wire it into `AdminCommandCenter.jsx`.**
  - Replace the whole `<nav>…</nav>` block in the sidebar with:

```jsx
        <StaffNavList navGroups={navGroups} activeTab={activeTab} onSelect={selectTab} collapsed={sidebarCollapsed} badgeFor={badgeFor} roleColor={roleColor} />
```

  - Change the component signature and tab state. Add `useEffect` and `useRef` to the React
    import, and import `StaffNavList` and `isPermittedTab`:

```jsx
export default function AdminCommandCenter({ auth, onExit, exitLabel = "← Exit", activeTab: activeTabProp, onTabChange }) {
  const { data: staffBadges } = useStaffBadges();
  const badgeFor = makeBadgeFor(staffBadges);
  // Controlled by App.jsx's /staff/:panel route when activeTab is passed;
  // otherwise (StaffDashboard.test.jsx renders without a router) it owns the
  // tab itself, exactly as before.
  const isControlled = activeTabProp !== undefined;
  const [internalTab, setInternalTab] = useState("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [saved, setSaved] = useState(false);
  const role = auth.user?.role;
  const roleColor = ROLE_ACCENTS[role] || D.gold;
  const showToast = () => { setSaved(true); setTimeout(() => setSaved(false), 2500); };

  const navGroups = buildNavGroups(auth);
  const allItems = navGroups.flatMap(g => g.items);
  const requestedTab = isControlled ? activeTabProp : internalTab;
  const activeTab = isPermittedTab(navGroups, requestedTab) ? requestedTab : "overview";
  const activeLabel = activeTab === "overview" ? "Overview" : allItems.find(i => i.id === activeTab)?.label;

  // An unpermitted/unknown panel URL (or manifest shortcut) is sent back to
  // Overview by replacing the history entry, not pushing a new one.
  useEffect(() => {
    if (isControlled && requestedTab !== activeTab) onTabChange?.("overview", { replace: true });
  }, [isControlled, requestedTab, activeTab]);

  const selectTab = (id) => {
    if (id === activeTab) return;
    if (isControlled) onTabChange?.(id);
    else setInternalTab(id);
  };

  // Each panel starts at the top; skipped on first mount so a reload keeps
  // the browser's own scroll restoration.
  const firstTabRender = useRef(true);
  useEffect(() => {
    if (firstTabRender.current) { firstTabRender.current = false; return; }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [activeTab]);
```

  - In the header, change the exit button's text from `← Exit` to `{exitLabel}`.
  - Every `setActiveTab(...)` call left in the file has been replaced by `selectTab(...)` through
    `StaffNavList`. Confirm none remain:
    `grep -n "setActiveTab" frontend/components/admin/AdminCommandCenter.jsx` should print nothing.

- [ ] **Step 6: Pass the props through `StaffDashboard`** in `frontend/App.jsx`:

```jsx
export function StaffDashboard({auth,onExit,activeTab,onTabChange,exitLabel}) {
  return <AdminCommandCenter auth={auth} onExit={onExit} activeTab={activeTab} onTabChange={onTabChange} exitLabel={exitLabel} />;
}
```

- [ ] **Step 7: Run the tests.**

  Run: `cd frontend && npx vitest run components/admin StaffDashboard.test.jsx App.routing.test.jsx`

  Expected: all PASS, with `StaffDashboard.test.jsx` unmodified.

- [ ] **Step 8: Commit.**

```bash
git add frontend/components/admin/shell/StaffNavList.jsx frontend/components/admin/AdminCommandCenter.jsx frontend/components/admin/__tests__/AdminCommandCenter.test.jsx frontend/test/setup.js frontend/App.jsx
git commit -m "feat(staff): controllable active tab with permission fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017kwucfaVoi6X952jkJGouX"
```

---

### Task 4: Responsive shell — header, drawer, bottom bar, tablet rail, viewport CSS

**Files:**
- Create: `frontend/components/admin/shell/StaffHeader.jsx`
- Create: `frontend/components/admin/shell/StaffDrawer.jsx`
- Create: `frontend/components/admin/shell/StaffBottomBar.jsx`
- Create: `frontend/components/admin/shell/StaffShellStyles.jsx`
- Modify: `frontend/components/admin/AdminCommandCenter.jsx` (final shape below)
- Test: `frontend/components/admin/__tests__/AdminCommandCenter.test.jsx` (append)

**Interfaces:**
- Consumes:
  - `useBreakpoint` and `installMatchMedia` (Task 2)
  - `pickBottomBarItems` (Task 2)
  - `StaffNavList` (Task 3)
  - `usePrefersReducedMotion` (default export of `hooks/usePrefersReducedMotion.js`)
- Produces:
  - `<StaffHeader title role roleColor fullName onExit exitLabel breakpoint onOpenMenu menuButtonRef drawerOpen actions? children? />`,
    plus a named export `RoleChip({role, roleColor})`.
    - Phone/tablet header has a `button` named "Open navigation".
  - `<StaffDrawer open onClose>{children}</StaffDrawer>` renders `role="dialog"` named
    "Staff navigation".
    - Locks `<html>` scroll and traps Tab.
    - Closes on Esc and on a backdrop click (`data-testid="staff-drawer-backdrop"`).
    - Restores focus to the element focused before opening.
  - `<StaffBottomBar items activeTab onSelect onMore badgeFor roleColor />` renders
    `<nav aria-label="Quick navigation">`.
  - `<StaffShellStyles />`
  - The shell root has `className="shadcn-scope command-center staff-shell"` and
    `data-bp={breakpoint}`. The panel container is `<main className="staff-content">`.

- [ ] **Step 1: Write the failing tests.** Append to `AdminCommandCenter.test.jsx`, and add
  `act` to the Testing Library import plus
  `import { installMatchMedia } from '../../../test/matchMedia.js'`:

```jsx
describe('AdminCommandCenter — phone', () => {
  let mm
  afterEach(() => { mm?.restore(); document.documentElement.style.overflow = '' })

  it('replaces the sidebar with a bottom bar of Overview, three panels and More', () => {
    mm = installMatchMedia(375)
    renderShell()
    expect(screen.queryByRole('navigation', { name: 'Staff panels' })).not.toBeInTheDocument()
    const bar = screen.getByRole('navigation', { name: 'Quick navigation' })
    const labels = within(bar).getAllByRole('button').map((b) => b.textContent)
    expect(labels).toEqual(['📊Overview', '⚖️Disputes', '👥Users', '💬Messaging / Tickets', '☰More'])
  })

  it('opens the drawer from the header, locks scroll, and closes + restores focus on selection', () => {
    mm = installMatchMedia(375)
    renderShell()
    const menu = screen.getByRole('button', { name: 'Open navigation' })
    menu.focus()
    fireEvent.click(menu)
    const dialog = screen.getByRole('dialog', { name: 'Staff navigation' })
    expect(document.documentElement.style.overflow).toBe('hidden')
    fireEvent.click(within(dialog).getByRole('button', { name: /Users/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.documentElement.style.overflow).toBe('')
    expect(menu).toHaveFocus()
  })

  it('opens the drawer from More and closes it on Escape and on backdrop tap', () => {
    mm = installMatchMedia(375)
    renderShell()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Quick navigation' })).getByRole('button', { name: /More/ }))
    expect(screen.getByRole('dialog', { name: 'Staff navigation' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    fireEvent.click(screen.getByTestId('staff-drawer-backdrop'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the staffer name and exit action inside the drawer, not the header', () => {
    mm = installMatchMedia(375)
    const onExit = vi.fn()
    renderShell({ onExit })
    expect(screen.queryByText('Akosua Support')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const dialog = screen.getByRole('dialog', { name: 'Staff navigation' })
    expect(within(dialog).getByText('Akosua Support')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '← Exit' }))
    expect(onExit).toHaveBeenCalled()
  })

  it('closes the drawer and unlocks scroll when the viewport grows to desktop', () => {
    mm = installMatchMedia(375)
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => mm.resize(1440))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.documentElement.style.overflow).toBe('')
    expect(screen.getByRole('navigation', { name: 'Staff panels' })).toBeInTheDocument()
  })
})

describe('AdminCommandCenter — tablet', () => {
  let mm
  afterEach(() => mm?.restore())

  it('shows a collapsed icon rail with labelled buttons and a menu button, no bottom bar', () => {
    mm = installMatchMedia(1024)
    renderShell()
    const rail = screen.getByRole('navigation', { name: 'Staff panels' })
    expect(within(rail).getByRole('button', { name: 'Users' })).toHaveAttribute('title', 'Users')
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Quick navigation' })).not.toBeInTheDocument()
    expect(screen.queryByText('← Collapse')).not.toBeInTheDocument()
  })
})

describe('AdminCommandCenter — desktop (default)', () => {
  it('keeps the full sidebar, collapse control, and header identity with no menu button', () => {
    renderShell()
    expect(screen.getByText('← Collapse')).toBeInTheDocument()
    expect(screen.getByText('AshantiHub Staff')).toBeInTheDocument()
    expect(screen.getByText('Akosua Support')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument()
  })
})
```

  If the bottom-bar label assertion fails only because MSW's default staff-badges payload has
  non-zero counts, read the `/api/notifications/staff-badges/` handler in
  `frontend/mocks/handlers.js`. Then add a `server.use(...)` in that test returning `{}`, so the
  expected order is the no-badge nav order (Disputes, Users, Messaging).

- [ ] **Step 2: Run them to verify they fail.**

  Run: `cd frontend && npx vitest run components/admin/__tests__/AdminCommandCenter.test.jsx`

  Expected: the phone and tablet tests FAIL, because there is no "Quick navigation" or "Open
  navigation" yet.

- [ ] **Step 3: Create** `frontend/components/admin/shell/StaffShellStyles.jsx`:

```jsx
import { D } from "../theme.js";

// The staff shell's single component-local <style> (frontend/CLAUDE.md
// allows these for what inline styles can't express): dynamic-viewport
// heights so mobile URL bars don't cause a jump, the drawer keyframes, and a
// visible keyboard focus ring.
export default function StaffShellStyles() {
  return (
    <style>{`
.staff-shell { min-height: 100vh; }
.staff-sidebar { height: 100vh; }
@supports (height: 100dvh) {
  .staff-shell { min-height: 100dvh; }
  .staff-sidebar { height: 100dvh; }
}
@keyframes staffDrawerIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
.staff-shell button:focus-visible, .staff-shell a:focus-visible, .staff-shell input:focus-visible,
.staff-shell select:focus-visible, .staff-shell textarea:focus-visible {
  outline: 2px solid ${D.text}; outline-offset: 2px;
}
`}</style>
  );
}
```

- [ ] **Step 4: Create** `frontend/components/admin/shell/StaffHeader.jsx`:

```jsx
import { D, ROLE_BADGE_TEXT } from "../theme.js";

export function RoleChip({ role, roleColor }) {
  return (
    <span style={{ background: roleColor, color: ROLE_BADGE_TEXT[role] || "#fff", borderRadius: 20, padding: "3px 10px", fontSize: "0.62rem", fontWeight: 800, textTransform: "capitalize", whiteSpace: "nowrap" }}>
      {role?.replace("_", " ")}
    </span>
  );
}

// Sticky staff header. Desktop is the pre-responsive header unchanged; tablet
// adds the ☰ drawer button; phone keeps only ☰, the panel title and the role
// chip (name + exit move into the drawer). `children` renders under the bar
// (the offline banner) so it stays sticky with it.
export default function StaffHeader({ title, role, roleColor, fullName, onExit, exitLabel, breakpoint, onOpenMenu, menuButtonRef, drawerOpen, actions, children }) {
  const isPhone = breakpoint === "phone";
  const showMenu = breakpoint !== "desktop";
  return (
    <header style={{
      background: "rgba(253,246,227,0.9)", paddingLeft: isPhone ? 12 : 20, paddingRight: isPhone ? 12 : 20,
      paddingTop: "env(safe-area-inset-top, 0px)",
      position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(44,24,16,0.08)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${D.cardBorder}`,
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#CC0000 33%,#D4A017 33%,#D4A017 66%,#006400 66%)" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: isPhone ? 56 : 60, gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {showMenu && (
            <button ref={menuButtonRef} type="button" aria-label="Open navigation" aria-expanded={drawerOpen} onClick={onOpenMenu}
              style={{ minWidth: 44, minHeight: 44, marginLeft: -8, background: "none", border: "none", color: D.text, fontSize: "1.25rem", cursor: "pointer", fontFamily: "inherit" }}>
              ☰
            </button>
          )}
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {actions}
          <RoleChip role={role} roleColor={roleColor} />
          {!isPhone && <span style={{ color: D.text, fontSize: "0.78rem", fontWeight: 700, whiteSpace: "nowrap" }}>{fullName}</span>}
          {!isPhone && <button type="button" onClick={onExit} style={{ background: "rgba(44,24,16,0.05)", border: `1px solid ${D.divider}`, color: D.textDim, borderRadius: 20, padding: "5px 13px", fontSize: "0.68rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{exitLabel}</button>}
        </div>
      </div>
      {children}
    </header>
  );
}
```

- [ ] **Step 5: Create** `frontend/components/admin/shell/StaffDrawer.jsx`:

```jsx
import { useEffect, useRef } from "react";
import usePrefersReducedMotion from "../../../hooks/usePrefersReducedMotion.js";
import { D } from "../theme.js";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Slide-over navigation for phone/tablet: a modal dialog that locks page
// scroll, traps Tab, closes on Escape or backdrop tap, and hands focus back to
// whatever opened it (☰ or the bottom bar's More).
export default function StaffDrawer({ open, onClose, children }) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    const focusables = () => Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) ?? []);
    focusables()[0]?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      html.style.overflow = previousOverflow;
      if (opener && typeof opener.focus === "function") opener.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200 }}>
      <div data-testid="staff-drawer-backdrop" onClick={() => onCloseRef.current()} style={{ position: "absolute", inset: 0, background: "rgba(44,24,16,0.45)" }} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Staff navigation" style={{
        position: "absolute", top: 0, bottom: 0, left: 0, width: "min(320px, 86vw)",
        background: D.pageBg, boxShadow: D.shadow, overflowY: "auto", overscrollBehavior: "contain",
        paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)",
        animation: reducedMotion ? "none" : "staffDrawerIn 220ms ease-out",
      }}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create** `frontend/components/admin/shell/StaffBottomBar.jsx`:

```jsx
import { D } from "../theme.js";

const visuallyHidden = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

function BarButton({ icon, label, active, count = 0, onClick, roleColor }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} style={{
      flex: 1, minWidth: 0, minHeight: 60, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
      background: "none", border: "none", borderTop: `3px solid ${active ? roleColor : "transparent"}`,
      color: active ? D.text : D.textDim, fontFamily: "inherit", fontSize: "0.62rem", fontWeight: active ? 800 : 600, cursor: "pointer", padding: "4px 2px",
    }}>
      <span aria-hidden="true" style={{ position: "relative", fontSize: "1.15rem", lineHeight: 1 }}>
        {icon}
        {count > 0 && <span style={{ position: "absolute", top: -2, right: -6, width: 8, height: 8, borderRadius: "50%", background: D.red }} />}
      </span>
      <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {count > 0 && <span style={visuallyHidden}>, {count} pending</span>}
    </button>
  );
}

// Phone quick navigation (spec §4.3): Overview, up to three panels picked by
// pickBottomBarItems, and More (opens the drawer). More reads as current when
// the active panel isn't one of the bar's own slots.
export default function StaffBottomBar({ items, activeTab, onSelect, onMore, badgeFor, roleColor }) {
  const inBar = activeTab === "overview" || items.some((item) => item.id === activeTab);
  return (
    <nav aria-label="Quick navigation" style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 110, display: "flex",
      background: "rgba(253,246,227,0.97)", borderTop: `1px solid ${D.cardBorder}`, boxShadow: "0 -2px 12px rgba(44,24,16,0.08)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)",
    }}>
      <BarButton icon="📊" label="Overview" active={activeTab === "overview"} onClick={() => onSelect("overview")} roleColor={roleColor} />
      {items.map((item) => (
        <BarButton key={item.id} icon={item.icon} label={item.label} active={activeTab === item.id} count={badgeFor(item.id)} onClick={() => onSelect(item.id)} roleColor={roleColor} />
      ))}
      <BarButton icon="☰" label="More" active={!inBar} onClick={onMore} roleColor={roleColor} />
    </nav>
  );
}
```

  The phone test's `textContent` expectations assume no pending counts. With a count, the
  visually-hidden ", N pending" text is appended.

- [ ] **Step 7: Rewrite the shell layout in `AdminCommandCenter.jsx`.**
  - Keep the panel imports, the Task 3 tab logic, and every panel line unchanged.
  - Add imports: `useBreakpoint`, `pickBottomBarItems`, `StaffHeader` and `RoleChip`,
    `StaffDrawer`, `StaffBottomBar`, `StaffShellStyles`.
  - Remove `ROLE_BADGE_TEXT` from the theme import, since `RoleChip` owns it now.
  - Add this state after `saved`:

```jsx
  const breakpoint = useBreakpoint();
  const isPhone = breakpoint === "phone";
  const isDesktop = breakpoint === "desktop";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef(null);
```

  - In `selectTab`, close the drawer first:

```jsx
  const selectTab = (id) => {
    setDrawerOpen(false);
    if (id === activeTab) return;
    if (isControlled) onTabChange?.(id);
    else setInternalTab(id);
  };
```

  - Add this after the scroll effect:

```jsx
  // Rotating a tablet / widening a window to desktop retires the drawer
  // (and, via its cleanup, the scroll lock).
  useEffect(() => { if (isDesktop) setDrawerOpen(false); }, [isDesktop]);

  const bottomItems = isPhone ? pickBottomBarItems(navGroups, badgeFor) : [];
```

  - Replace the component's whole `return (...)` with the following. Panel lines are abbreviated
    here as `{/* …all existing activeTab === … panel lines, unchanged… */}`; copy them across
    exactly from the current file.

```jsx
  return (
    <div className="shadcn-scope command-center staff-shell" data-bp={breakpoint} style={{ display: "flex" }}>
      <StaffShellStyles />

      {/* Sidebar — full/collapsible on desktop, a fixed 64px icon rail on tablet, absent on phone */}
      {!isPhone && (
        <div className="staff-sidebar" style={{
          width: isDesktop ? (sidebarCollapsed ? 60 : 240) : 64, flexShrink: 0, position: "sticky", top: 0, overflowY: "auto", overscrollBehavior: "contain",
          background: "rgba(253,246,227,0.95)",
          borderRight: `1px solid ${D.cardBorder}`, transition: "width 0.2s",
        }}>
          <div style={{ padding: "16px 12px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${D.divider}` }}>
            <Flag w={28} h={19} />
            {isDesktop && !sidebarCollapsed && <div style={{ color: D.gold, fontWeight: 900, fontSize: "0.85rem" }}>AshantiHub Staff</div>}
          </div>
          {isDesktop && <button onClick={() => setSidebarCollapsed(s => !s)} style={{ background: "none", border: "none", color: D.textDim, cursor: "pointer", padding: "8px 12px", fontSize: "0.7rem", fontFamily: "inherit", width: "100%", textAlign: "left" }}>{sidebarCollapsed ? "→" : "← Collapse"}</button>}
          <StaffNavList navGroups={navGroups} activeTab={activeTab} onSelect={selectTab} collapsed={!isDesktop || sidebarCollapsed} badgeFor={badgeFor} roleColor={roleColor} />
        </div>
      )}

      {/* Main column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <StaffHeader title={activeLabel} role={role} roleColor={roleColor} fullName={auth.user?.full_name}
          onExit={onExit} exitLabel={exitLabel} breakpoint={breakpoint}
          onOpenMenu={() => setDrawerOpen(true)} menuButtonRef={menuButtonRef} drawerOpen={drawerOpen} />

        {saved && <div role="status" style={{
          position: "fixed", zIndex: 999, background: D.green, color: "#fff", borderRadius: 12, padding: "10px 18px", fontSize: "0.8rem", fontWeight: 800, boxShadow: "0 6px 24px rgba(0,100,0,0.28)",
          ...(isPhone ? { left: 12, right: 12, bottom: "calc(80px + env(safe-area-inset-bottom, 0px))", textAlign: "center" } : { top: 74, right: 20 }),
        }}>✓ Saved!</div>}

        <main className="staff-content" style={{ padding: isPhone ? "16px 12px calc(88px + env(safe-area-inset-bottom, 0px))" : "22px 20px 72px" }}>
          {/* …all existing activeTab === … panel lines, unchanged… */}
        </main>
      </div>

      {isPhone && <StaffBottomBar items={bottomItems} activeTab={activeTab} onSelect={selectTab} onMore={() => setDrawerOpen(true)} badgeFor={badgeFor} roleColor={roleColor} />}

      <StaffDrawer open={drawerOpen && !isDesktop} onClose={() => setDrawerOpen(false)}>
        <div style={{ padding: "12px 8px 12px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${D.divider}` }}>
          <Flag w={28} h={19} />
          <div style={{ color: D.gold, fontWeight: 900, fontSize: "0.85rem", flex: 1 }}>AshantiHub Staff</div>
          <button type="button" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} style={{ minWidth: 44, minHeight: 44, background: "none", border: "none", color: D.textDim, fontSize: "1.1rem", cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${D.divider}`, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>{auth.user?.full_name}</span>
            <RoleChip role={role} roleColor={roleColor} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={onExit} style={{ minHeight: 44, background: "rgba(44,24,16,0.05)", border: `1px solid ${D.divider}`, color: D.text, borderRadius: 20, padding: "0 16px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{exitLabel}</button>
          </div>
        </div>
        <StaffNavList navGroups={navGroups} activeTab={activeTab} onSelect={selectTab} collapsed={false} badgeFor={badgeFor} roleColor={roleColor} itemMinHeight={44} />
      </StaffDrawer>
    </div>
  );
```

  On desktop the drawer never renders, because `open` is gated on `!isDesktop`. The DOM the
  contract test sees is therefore the pre-change sidebar plus header with the same text.

- [ ] **Step 8: Run the tests.**

  Run: `cd frontend && npx vitest run components/admin StaffDashboard.test.jsx App.routing.test.jsx`

  Expected: all PASS.

- [ ] **Step 9: Eyeball it in a browser.** `cd frontend && npx vite --port 5180 --strictPort`
  (port 5173 is taken by another project on this machine). Then open `/staff` with the Playwright
  MCP at 375, 1024 and 1440 wide. A logged-in staff session needs the Task 9 local stack; until
  then, confirm only that the public site is unchanged. Stop the server afterwards.

- [ ] **Step 10: Commit.**

```bash
git add frontend/components/admin/shell/StaffHeader.jsx frontend/components/admin/shell/StaffDrawer.jsx frontend/components/admin/shell/StaffBottomBar.jsx frontend/components/admin/shell/StaffShellStyles.jsx frontend/components/admin/AdminCommandCenter.jsx frontend/components/admin/__tests__/AdminCommandCenter.test.jsx
git commit -m "feat(staff): responsive shell — phone drawer + bottom bar, tablet rail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017kwucfaVoi6X952jkJGouX"
```

---

### Task 5: PWA build pipeline — plugin, `public/`, manifest, icons

**Files:**
- Modify: `frontend/package.json` / `package-lock.json` (via npm)
- Modify: `frontend/vite.config.js`
- Create: `frontend/test/stubs/pwa-register.js`
- Create: `frontend/public/staff.webmanifest`
- Create: `frontend/public/icons/staff-icon.svg`
- Create: `frontend/pwa-assets.config.js`
- Create: `frontend/public/icons/*.png` (generated)
- Move: `frontend/favicon.svg` → `frontend/public/favicon.svg`
- Delete: `frontend/manifest.json`, `frontend/sw.js`
- Modify: `frontend/index.html`
- Test: `frontend/test/staffPwaConfig.test.js`

**Interfaces:**
- Produces:
  - Build output `dist/sw.js` (Workbox, precaching the app shell) and `dist/staff.webmanifest`.
  - `dist/icons/pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`,
    `apple-touch-icon-180x180.png`.
  - The virtual module `virtual:pwa-register` (`registerSW`), aliased to a stub under Vitest.

- [ ] **Step 1: Write the failing config test** `frontend/test/staffPwaConfig.test.js`:

```js
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')

describe('staff PWA manifest', () => {
  const manifest = JSON.parse(read('public/staff.webmanifest'))

  it('is scoped to /staff and opens there', () => {
    expect(manifest).toMatchObject({ id: '/staff', start_url: '/staff', scope: '/staff', display: 'standalone', name: 'AshantiHub Staff' })
  })

  it('ships 192/512 "any" PNGs and a maskable 512 that exist on disk', () => {
    const bySize = (size, purpose) => manifest.icons.find((i) => i.sizes === size && i.purpose === purpose)
    for (const icon of [bySize('192x192', 'any'), bySize('512x512', 'any'), bySize('512x512', 'maskable')]) {
      expect(icon?.type).toBe('image/png')
      expect(existsSync(path.join(root, 'public', icon.src))).toBe(true)
    }
  })

  it('only offers shortcuts into staff panels', () => {
    expect(manifest.shortcuts.map((s) => s.url)).toEqual(['/staff/kyc', '/staff/messaging', '/staff/moderation'])
  })
})

describe('index.html', () => {
  const html = read('index.html')
  it('does not link a manifest globally (the staff one is injected on /staff only)', () => {
    expect(html).not.toMatch(/rel="manifest"/)
  })
  it('lets the staff shell extend under notches', () => {
    expect(html).toMatch(/viewport-fit=cover/)
  })
})

describe('dead pre-PWA files', () => {
  it('are gone from the frontend root', () => {
    expect(existsSync(path.join(root, 'manifest.json'))).toBe(false)
    expect(existsSync(path.join(root, 'sw.js'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails.**

  Run: `cd frontend && npx vitest run test/staffPwaConfig.test.js`

  Expected: FAIL with ENOENT for `public/staff.webmanifest`.

- [ ] **Step 3: Install the dependencies.** The network here can be slow, so allow a long
  timeout.

  Run: `cd frontend && npm install -D vite-plugin-pwa@^2 workbox-window@^7.4.1 @vite-pwa/assets-generator`

  Expected: installs with no peer-dependency errors.

- [ ] **Step 4: Move the favicon and remove the dead files.**

```bash
cd frontend && mkdir -p public/icons && git mv favicon.svg public/favicon.svg && git rm -q manifest.json sw.js
```

- [ ] **Step 5: Edit `frontend/index.html`.**
  - Delete the line `<link rel="manifest" href="/manifest.json" />`.
  - Change the viewport meta to:
    `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />`.
  - Leave `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` as-is. It now resolves
    to `public/favicon.svg`.

- [ ] **Step 6: Create** `frontend/public/staff.webmanifest`:

```json
{
  "id": "/staff",
  "name": "AshantiHub Staff",
  "short_name": "AH Staff",
  "description": "AshantiHub staff dashboard — moderation, finance, field operations and support.",
  "start_url": "/staff",
  "scope": "/staff",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#FDF6E3",
  "theme_color": "#2C1810",
  "lang": "en-GH",
  "categories": ["business", "productivity"],
  "icons": [
    { "src": "/icons/pwa-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/pwa-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/maskable-icon-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "KYC Queue", "url": "/staff/kyc", "icons": [{ "src": "/icons/pwa-192x192.png", "sizes": "192x192" }] },
    { "name": "Messaging", "url": "/staff/messaging", "icons": [{ "src": "/icons/pwa-192x192.png", "sizes": "192x192" }] },
    { "name": "Listings Moderation", "url": "/staff/moderation", "icons": [{ "src": "/icons/pwa-192x192.png", "sizes": "192x192" }] }
  ]
}
```

- [ ] **Step 7: Create the icon source** `frontend/public/icons/staff-icon.svg`. It is the
  favicon's stool/crown artwork scaled to 80% under the kente stripes, plus a gold "STAFF" banner:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#2C1810" rx="20"/>
  <rect x="0" y="0" width="100" height="6" fill="#CE1126"/>
  <rect x="0" y="6" width="100" height="6" fill="#FCD116"/>
  <rect x="0" y="12" width="100" height="6" fill="#006400"/>
  <g transform="translate(50 50) scale(0.8) translate(-50 -48)">
    <rect x="20" y="45" width="60" height="12" rx="6" fill="#D4A017"/>
    <rect x="28" y="57" width="12" height="16" rx="4" fill="#D4A017"/>
    <rect x="44" y="57" width="12" height="16" rx="4" fill="#D4A017"/>
    <rect x="16" y="73" width="68" height="10" rx="5" fill="#D4A017"/>
    <polygon points="35,45 50,25 65,45" fill="#D4A017"/>
    <circle cx="50" cy="22" r="5" fill="#FCD116"/>
  </g>
  <rect x="20" y="79" width="60" height="14" rx="7" fill="#D4A017"/>
  <text x="50" y="89.6" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="9.5" letter-spacing="1.6" fill="#2C1810">STAFF</text>
</svg>
```

- [ ] **Step 8: Create** `frontend/pwa-assets.config.js` and add the script:

```js
import { defineConfig, minimal2023Preset as preset } from '@vite-pwa/assets-generator/config'

// Renders the staff app's PWA icons from public/icons/staff-icon.svg.
// Run `npm run generate-pwa-assets` after changing the SVG; commit the PNGs.
// Maskable/apple variants are padded onto the icon's own dark-brown ground so
// the artwork stays inside the maskable safe zone.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...preset,
    maskable: { ...preset.maskable, resizeOptions: { background: '#2C1810' } },
    apple: { ...preset.apple, resizeOptions: { background: '#2C1810' } },
  },
  images: ['public/icons/staff-icon.svg'],
})
```

  In `frontend/package.json` `"scripts"`, add `"generate-pwa-assets": "pwa-assets-generator"`.

- [ ] **Step 9: Generate the icons, keep the four used, and look at them.**

```bash
cd frontend && npm run generate-pwa-assets && ls public/icons
```

  Expected: `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, and
  `apple-touch-icon-180x180.png`, plus extras such as `pwa-64x64.png` and `staff-icon.ico`.
  - Delete every PNG/ICO except the four listed.
  - Open `pwa-512x512.png` and `maskable-icon-512x512.png` with the Read tool.
  - Check that "STAFF" is legible, and that on the maskable icon all artwork sits inside the
    central ~80% circle.
  - If the text renders as boxes because no font is available to librsvg, change the SVG's
    `font-family` to `sans-serif` and regenerate.

- [ ] **Step 10: Configure the plugin** in `frontend/vite.config.js`. Add
  `import { VitePWA } from 'vite-plugin-pwa'` and replace `plugins` and `test`:

```js
  plugins: [
    react(),
    tailwindcss(),
    // Staff app service worker (docs/superpowers/specs/2026-10-03-staff-pwa-
    // responsive-design.md §2). Registered by lib/staffPwa.js, only on /staff*
    // pages, with scope "/staff" — the public marketplace is never controlled.
    // Precaches the built app shell only: no runtimeCaching, so API responses
    // are never stored on a staff device. Skipped under Vitest, where
    // `virtual:pwa-register` is aliased to a stub instead.
    !process.env.VITEST && VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false, // public/staff.webmanifest, linked only on staff pages
      scope: '/staff',
      filename: 'sw.js',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/staff(\/|$)/],
        cleanupOutdatedCaches: true,
        // The single app bundle is ~1.6 MB; Workbox's 2 MiB default leaves no headroom.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ].filter(Boolean),
```

```js
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    globals: true,
    alias: {
      'virtual:pwa-register': path.resolve(__dirname, 'test/stubs/pwa-register.js'),
    },
  },
```

  Create `frontend/test/stubs/pwa-register.js`:

```js
// Vitest stand-in for vite-plugin-pwa's `virtual:pwa-register` (the plugin is
// disabled under Vitest — see vite.config.js). Tests that exercise the update
// flow inject their own register function into startStaffPwa instead.
export function registerSW() {
  return () => Promise.resolve()
}
```

- [ ] **Step 11: Run the config test.**

  Run: `cd frontend && npx vitest run test/staffPwaConfig.test.js`

  Expected: PASS.

- [ ] **Step 12: Build and inspect the output.**

```bash
cd frontend && npm run build && ls dist/sw.js dist/staff.webmanifest dist/favicon.svg dist/icons && grep -c 'index.html' dist/sw.js && ! grep -q 'rel="manifest"' dist/index.html && echo OK
```

  Expected:
  - all four files listed
  - a non-zero `index.html` count (it is precached for the navigation fallback)
  - `OK`
  - no Workbox warning about files skipped for size

- [ ] **Step 13: Run the full suite** to catch alias or plugin fallout.

  Run: `cd frontend && npx vitest run`

  Expected: all PASS.

- [ ] **Step 14: Commit.**

```bash
# favicon.svg's move and manifest.json/sw.js's removal were already staged by git mv / git rm in Step 4.
git add frontend/package.json frontend/package-lock.json frontend/vite.config.js frontend/test/stubs/pwa-register.js frontend/test/staffPwaConfig.test.js frontend/public frontend/pwa-assets.config.js frontend/index.html
git commit -m "feat(pwa): build the staff app manifest, icons and service worker

The old root manifest.json/sw.js were never copied into dist (no public/
dir) and never registered; replace them with vite-plugin-pwa and a
/staff-scoped manifest.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017kwucfaVoi6X952jkJGouX"
```

---

### Task 6: `lib/staffPwa.js` — head tags, registration, install/update store

**Files:**
- Create: `frontend/lib/staffPwa.js`
- Modify: `frontend/main.jsx`
- Test: `frontend/lib/__tests__/staffPwa.test.js`

**Interfaces:**
- Consumes (Task 5): `virtual:pwa-register` `registerSW({ onNeedRefresh }) → updateSW(reload?: boolean)`.
- Produces:
  - `isStaffPathname(pathname: string): boolean`
  - `ensureStaffHead(enabled: boolean): void`. It adds or removes elements marked
    `data-staff-pwa`, including `<link rel="manifest" href="/staff.webmanifest">`.
  - `startStaffPwa({ register?, enableServiceWorker? = import.meta.env.PROD }): Promise<void>`,
    which is idempotent.
  - `promptInstall(): Promise<void>`
  - `applyUpdate(): void`
  - `useStaffPwa(): { needRefresh: boolean, installPrompt: Event|null, isStandalone: boolean, isIOS: boolean }`
  - `isStandaloneDisplay(): boolean`
  - `resetStaffPwaForTests(overrides?: object): void`

- [ ] **Step 1: Write the failing tests** `frontend/lib/__tests__/staffPwa.test.js`:

```js
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyUpdate, ensureStaffHead, isStaffPathname, promptInstall, resetStaffPwaForTests, startStaffPwa, useStaffPwa,
} from '../staffPwa.js'

afterEach(() => {
  resetStaffPwaForTests()
  ensureStaffHead(false)
})

describe('isStaffPathname', () => {
  it.each([
    ['/staff', true], ['/staff/', true], ['/staff/kyc', true], ['/staff/activate', true],
    ['/', false], ['/staffing', false], ['/business', false],
  ])('%s → %s', (path, expected) => expect(isStaffPathname(path)).toBe(expected))
})

describe('ensureStaffHead', () => {
  it('adds the staff manifest + apple tags once, and removes them', () => {
    ensureStaffHead(true)
    ensureStaffHead(true)
    expect(document.head.querySelectorAll('link[rel="manifest"]')).toHaveLength(1)
    expect(document.head.querySelector('link[rel="manifest"]')).toHaveAttribute('href', '/staff.webmanifest')
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon-180x180.png')
    expect(document.head.querySelector('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'AH Staff')
    ensureStaffHead(false)
    expect(document.head.querySelector('[data-staff-pwa]')).toBeNull()
  })
})

describe('install prompt', () => {
  it('captures beforeinstallprompt, exposes it, and consumes it on promptInstall', async () => {
    await startStaffPwa({ enableServiceWorker: false })
    const { result } = renderHook(() => useStaffPwa())
    const event = new Event('beforeinstallprompt', { cancelable: true })
    event.prompt = vi.fn().mockResolvedValue(undefined)
    event.userChoice = Promise.resolve({ outcome: 'accepted' })
    act(() => { window.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(result.current.installPrompt).toBe(event)
    await act(() => promptInstall())
    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(result.current.installPrompt).toBeNull()
  })

  it('marks the app standalone after appinstalled', async () => {
    await startStaffPwa({ enableServiceWorker: false })
    const { result } = renderHook(() => useStaffPwa())
    act(() => { window.dispatchEvent(new Event('appinstalled')) })
    expect(result.current.isStandalone).toBe(true)
  })
})

describe('service worker updates', () => {
  it('registers through the injected register fn and reloads into the waiting worker on applyUpdate', async () => {
    let needRefresh
    const updateSW = vi.fn()
    const register = vi.fn(({ onNeedRefresh }) => { needRefresh = onNeedRefresh; return updateSW })
    await startStaffPwa({ register, enableServiceWorker: true })
    expect(register).toHaveBeenCalledTimes(1)
    const { result } = renderHook(() => useStaffPwa())
    expect(result.current.needRefresh).toBe(false)
    act(() => needRefresh())
    expect(result.current.needRefresh).toBe(true)
    applyUpdate()
    expect(updateSW).toHaveBeenCalledWith(true)
  })

  it('is idempotent and never registers when disabled', async () => {
    const register = vi.fn(() => vi.fn())
    await startStaffPwa({ register, enableServiceWorker: false })
    await startStaffPwa({ register, enableServiceWorker: true })
    expect(register).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them to verify they fail.**

  Run: `cd frontend && npx vitest run lib/__tests__/staffPwa.test.js`

  Expected: FAIL, unresolved `../staffPwa.js`.

- [ ] **Step 3: Implement** `frontend/lib/staffPwa.js`:

```js
import { useSyncExternalStore } from "react";

// Staff PWA runtime (docs/superpowers/specs/2026-10-03-staff-pwa-responsive-
// design.md §2.2–2.4): the manifest/apple head tags exist only on /staff*
// pages (so the public marketplace is never installable), the service worker
// is registered only from there with scope "/staff", and a tiny external
// store exposes install/update state to the shell's InstallAppButton and
// UpdateToast.

const STAFF_HEAD_ATTR = "data-staff-pwa";
const STAFF_HEAD_TAGS = [
  ["link", { rel: "manifest", href: "/staff.webmanifest" }],
  ["link", { rel: "apple-touch-icon", href: "/icons/apple-touch-icon-180x180.png" }],
  ["meta", { name: "mobile-web-app-capable", content: "yes" }],
  ["meta", { name: "apple-mobile-web-app-capable", content: "yes" }],
  ["meta", { name: "apple-mobile-web-app-title", content: "AH Staff" }],
  ["meta", { name: "apple-mobile-web-app-status-bar-style", content: "default" }],
];

export function isStaffPathname(pathname) {
  return pathname === "/staff" || pathname.startsWith("/staff/");
}

export function ensureStaffHead(enabled) {
  if (typeof document === "undefined") return;
  const existing = document.head.querySelectorAll(`[${STAFF_HEAD_ATTR}]`);
  if (!enabled) {
    existing.forEach((el) => el.remove());
    return;
  }
  if (existing.length > 0) return;
  for (const [tag, attrs] of STAFF_HEAD_TAGS) {
    const el = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    el.setAttribute(STAFF_HEAD_ATTR, "");
    document.head.appendChild(el);
  }
}

function detectStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches === true || window.navigator.standalone === true;
}

function detectIOS() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

const initialState = () => ({ needRefresh: false, installPrompt: null, isStandalone: detectStandalone(), isIOS: detectIOS() });

let state = initialState();
let started = false;
let updateServiceWorker = null;
const listeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() {
  return state;
}

export function useStaffPwa() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isStandaloneDisplay() {
  return detectStandalone();
}

function onBeforeInstallPrompt(event) {
  event.preventDefault(); // keep the browser's mini-infobar quiet; the shell offers its own button
  setState({ installPrompt: event });
}
function onAppInstalled() {
  setState({ installPrompt: null, isStandalone: true });
}

export async function startStaffPwa({ register, enableServiceWorker = import.meta.env.PROD } = {}) {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
  if (!enableServiceWorker) return;
  if (!register && !("serviceWorker" in navigator)) return;
  try {
    const registerSW = register ?? (await import("virtual:pwa-register")).registerSW;
    updateServiceWorker = registerSW({ onNeedRefresh: () => setState({ needRefresh: true }) });
  } catch (error) {
    console.warn("AshantiHub Staff: service worker registration failed", error);
  }
}

export async function promptInstall() {
  const prompt = state.installPrompt;
  if (!prompt) return;
  setState({ installPrompt: null }); // a deferred prompt can only be shown once
  await prompt.prompt();
  try {
    await prompt.userChoice;
  } catch {
    // dismissed — nothing to do
  }
}

export function applyUpdate() {
  updateServiceWorker?.(true);
}

export function resetStaffPwaForTests(overrides = {}) {
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.removeEventListener("appinstalled", onAppInstalled);
  }
  started = false;
  updateServiceWorker = null;
  state = { ...initialState(), ...overrides };
  listeners.forEach((listener) => listener());
}
```

- [ ] **Step 4: Run the tests.**

  Run: `cd frontend && npx vitest run lib/__tests__/staffPwa.test.js`

  Expected: PASS.

- [ ] **Step 5: Boot-time hook-up** in `frontend/main.jsx`. Add the following after the CSS
  import and before `createRoot`:

```jsx
import { ensureStaffHead, isStaffPathname, startStaffPwa } from './lib/staffPwa.js'

// Staff app: link the /staff-scoped manifest and start listening for the
// install prompt as early as possible on a staff URL (beforeinstallprompt can
// fire before React has mounted). App.jsx keeps both in sync on in-app
// navigation afterwards.
if (isStaffPathname(window.location.pathname)) {
  ensureStaffHead(true)
  startStaffPwa()
}
```

- [ ] **Step 6: Build check.**

  Run: `cd frontend && npm run build`

  Expected: success, and `dist/assets/*.js` contains `registerSW`:
  `grep -l "serviceWorker" dist/assets/*.js` lists at least one file.

- [ ] **Step 7: Commit.**

```bash
git add frontend/lib/staffPwa.js frontend/lib/__tests__/staffPwa.test.js frontend/main.jsx
git commit -m "feat(pwa): staff-only head tags, SW registration and install/update store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017kwucfaVoi6X952jkJGouX"
```

---

### Task 7: Install button, update toast, offline banner in the shell

**Files:**
- Create: `frontend/components/admin/shell/InstallAppButton.jsx`
- Create: `frontend/components/admin/shell/UpdateToast.jsx`
- Create: `frontend/components/admin/shell/OfflineBanner.jsx`
- Modify: `frontend/components/admin/AdminCommandCenter.jsx`
- Test: `frontend/components/admin/shell/__tests__/StaffPwaUi.test.jsx`

**Interfaces:**
- Consumes (Task 6): `useStaffPwa`, `promptInstall`, `applyUpdate`, `resetStaffPwaForTests`,
  `startStaffPwa`.
- Produces:
  - `<InstallAppButton variant="header"|"drawer" />` renders a button named "⬇ Install app", or
    nothing.
  - `<UpdateToast bottomOffset />` uses `role="status"` and has a "Reload" and a "Later" button.
  - `<OfflineBanner />` uses `role="status"` with the text "You're offline — staff actions need a
    connection."

- [ ] **Step 1: Write the failing tests**
  `frontend/components/admin/shell/__tests__/StaffPwaUi.test.jsx`:

```jsx
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InstallAppButton from '../InstallAppButton.jsx'
import UpdateToast from '../UpdateToast.jsx'
import OfflineBanner from '../OfflineBanner.jsx'
import { resetStaffPwaForTests, startStaffPwa } from '../../../../lib/staffPwa.js'

afterEach(() => {
  resetStaffPwaForTests()
  try { localStorage.clear() } catch { /* ignore */ }
})

function fireInstallPrompt() {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome: 'accepted' })
  act(() => { window.dispatchEvent(event) })
  return event
}

describe('InstallAppButton', () => {
  it('renders nothing without a prompt on a non-iOS browser', () => {
    resetStaffPwaForTests({ isIOS: false })
    const { container } = render(<InstallAppButton />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers the deferred install prompt and hides after use', async () => {
    resetStaffPwaForTests({ isIOS: false })
    await startStaffPwa({ enableServiceWorker: false })
    render(<InstallAppButton />)
    const event = fireInstallPrompt()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '⬇ Install app' })) })
    expect(event.prompt).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '⬇ Install app' })).not.toBeInTheDocument()
  })

  it('is hidden when already running as an installed app', async () => {
    resetStaffPwaForTests({ isStandalone: true, isIOS: true })
    const { container } = render(<InstallAppButton />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the Add to Home Screen hint on iOS and remembers dismissal', () => {
    resetStaffPwaForTests({ isIOS: true, isStandalone: false })
    const { unmount } = render(<InstallAppButton variant="drawer" />)
    fireEvent.click(screen.getByRole('button', { name: '⬇ Install app' }))
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('button', { name: '⬇ Install app' })).not.toBeInTheDocument()
    unmount()
    const { container } = render(<InstallAppButton variant="drawer" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('UpdateToast', () => {
  it('appears when a new worker is waiting and reloads into it', async () => {
    let needRefresh
    const updateSW = vi.fn()
    await startStaffPwa({ enableServiceWorker: true, register: ({ onNeedRefresh }) => { needRefresh = onNeedRefresh; return updateSW } })
    render(<UpdateToast />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => needRefresh())
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(updateSW).toHaveBeenCalledWith(true)
  })

  it('Later hides it without reloading', async () => {
    let needRefresh
    const updateSW = vi.fn()
    await startStaffPwa({ enableServiceWorker: true, register: ({ onNeedRefresh }) => { needRefresh = onNeedRefresh; return updateSW } })
    render(<UpdateToast />)
    act(() => needRefresh())
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(updateSW).not.toHaveBeenCalled()
  })
})

describe('OfflineBanner', () => {
  afterEach(() => { delete navigator.onLine })

  it('shows only while the browser is offline', () => {
    let online = true
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
    render(<OfflineBanner />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => { online = false; window.dispatchEvent(new Event('offline')) })
    expect(screen.getByRole('status')).toHaveTextContent("You're offline — staff actions need a connection.")
    act(() => { online = true; window.dispatchEvent(new Event('online')) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run them to verify they fail.**

  Run: `cd frontend && npx vitest run components/admin/shell/__tests__/StaffPwaUi.test.jsx`

  Expected: FAIL with unresolved modules.

- [ ] **Step 3: Implement** `frontend/components/admin/shell/OfflineBanner.jsx`:

```jsx
import { useSyncExternalStore } from "react";
import { D } from "../theme.js";

function subscribe(callback) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
const getOnline = () => navigator.onLine;

// Shown under the sticky staff header while offline. Nothing is cached, so
// this is the whole offline story: an honest notice, not stale data.
// `bleed` matches the header's horizontal padding (12 phone / 20 otherwise)
// so the strip runs edge to edge.
export default function OfflineBanner({ bleed = 20 }) {
  const online = useSyncExternalStore(subscribe, getOnline, () => true);
  if (online) return null;
  return (
    <div role="status" style={{ margin: `0 -${bleed}px`, padding: `8px ${bleed}px`, background: `${D.amber}1F`, borderTop: `1px solid ${D.amber}55`, color: D.text, fontSize: "0.78rem", fontWeight: 700 }}>
      You're offline — staff actions need a connection.
    </div>
  );
}
```

- [ ] **Step 4: Implement** `frontend/components/admin/shell/UpdateToast.jsx`:

```jsx
import { useState } from "react";
import { D } from "../theme.js";
import { applyUpdate, useStaffPwa } from "../../../lib/staffPwa.js";

// A deploy's new service worker is waiting. Never auto-reload — a staffer may
// be mid-review — so offer Reload / Later.
export default function UpdateToast({ bottomOffset = 20 }) {
  const { needRefresh } = useStaffPwa();
  const [postponed, setPostponed] = useState(false);
  if (!needRefresh || postponed) return null;
  const buttonBase = { minHeight: 40, borderRadius: 20, padding: "0 16px", fontSize: "0.78rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" };
  return (
    <div role="status" style={{
      position: "fixed", left: 12, right: 12, bottom: bottomOffset, margin: "0 auto", maxWidth: 440, zIndex: 300,
      background: D.panelBg, border: `1px solid ${D.cardBorderStrong}`, borderRadius: 16, boxShadow: D.shadow,
      padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
    }}>
      <span style={{ flex: "1 1 180px", color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>A new version of AshantiHub Staff is available.</span>
      <button type="button" onClick={() => setPostponed(true)} style={{ ...buttonBase, background: "none", border: `1px solid ${D.divider}`, color: D.textDim }}>Later</button>
      <button type="button" onClick={applyUpdate} style={{ ...buttonBase, background: D.text, border: "none", color: D.pageBg }}>Reload</button>
    </div>
  );
}
```

- [ ] **Step 5: Implement** `frontend/components/admin/shell/InstallAppButton.jsx`:

```jsx
import { useState } from "react";
import { D } from "../theme.js";
import { promptInstall, useStaffPwa } from "../../../lib/staffPwa.js";

const IOS_HINT_DISMISSED_KEY = "ashantihub.staff.iosInstallHintDismissed";

function readDismissed() {
  try { return localStorage.getItem(IOS_HINT_DISMISSED_KEY) === "1"; } catch { return false; }
}

// "Install app": the browser's deferred install prompt where one exists
// (Chrome/Edge/Android), or — on iOS Safari, which has no prompt API — a
// one-time "Share → Add to Home Screen" hint. Hidden inside the installed app.
export default function InstallAppButton({ variant = "header" }) {
  const { installPrompt, isStandalone, isIOS } = useStaffPwa();
  const [hintOpen, setHintOpen] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);
  if (isStandalone) return null;

  const buttonStyle = {
    minHeight: variant === "drawer" ? 44 : 30, background: D.goldSoft, border: `1px solid ${D.cardBorderStrong}`, color: D.text,
    borderRadius: 20, padding: "0 13px", fontSize: variant === "drawer" ? "0.78rem" : "0.68rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  };

  if (installPrompt) {
    return <button type="button" onClick={promptInstall} style={buttonStyle}>⬇ Install app</button>;
  }
  if (!isIOS || dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(IOS_HINT_DISMISSED_KEY, "1"); } catch { /* storage blocked — dismiss for this session only */ }
    setDismissed(true);
  };
  return (
    <span style={{ position: "relative", display: "inline-flex", flexDirection: "column", gap: 8 }}>
      <button type="button" aria-expanded={hintOpen} onClick={() => setHintOpen((open) => !open)} style={buttonStyle}>⬇ Install app</button>
      {hintOpen && (
        <span style={{
          ...(variant === "header" ? { position: "absolute", top: "calc(100% + 8px)", right: 0, width: 240, zIndex: 120 } : {}),
          background: D.panelBg, border: `1px solid ${D.cardBorder}`, borderRadius: 12, boxShadow: D.shadow, padding: "10px 12px",
          color: D.text, fontSize: "0.78rem", lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 8,
        }}>
          <span>To install: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</span>
          <button type="button" onClick={dismiss} style={{ alignSelf: "flex-end", minHeight: 36, background: "none", border: `1px solid ${D.divider}`, borderRadius: 20, padding: "0 12px", color: D.textDim, fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Got it</button>
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 6: Wire them into the shell.**
  - In `AdminCommandCenter.jsx`, import `InstallAppButton`, `UpdateToast`, and `OfflineBanner`.
  - Change the `<StaffHeader …/>` element to pass `actions` and a child:

```jsx
        <StaffHeader title={activeLabel} role={role} roleColor={roleColor} fullName={auth.user?.full_name}
          onExit={onExit} exitLabel={exitLabel} breakpoint={breakpoint}
          onOpenMenu={() => setDrawerOpen(true)} menuButtonRef={menuButtonRef} drawerOpen={drawerOpen}
          actions={isPhone ? null : <InstallAppButton variant="header" />}>
          <OfflineBanner bleed={isPhone ? 12 : 20} />
        </StaffHeader>
```

  - In the drawer's button row, put `<InstallAppButton variant="drawer" />` before the exit
    button.
  - Just before the closing `</div>` of the shell root, add:

```jsx
      <UpdateToast bottomOffset={isPhone ? "calc(80px + env(safe-area-inset-bottom, 0px))" : 20} />
```

- [ ] **Step 7: Run the tests.**

  Run: `cd frontend && npx vitest run components/admin lib StaffDashboard.test.jsx`

  Expected: all PASS.

- [ ] **Step 8: Commit.**

```bash
git add frontend/components/admin/shell/InstallAppButton.jsx frontend/components/admin/shell/UpdateToast.jsx frontend/components/admin/shell/OfflineBanner.jsx frontend/components/admin/shell/__tests__/StaffPwaUi.test.jsx frontend/components/admin/AdminCommandCenter.jsx
git commit -m "feat(pwa): install button, update prompt and offline banner in the staff shell

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017kwucfaVoi6X952jkJGouX"
```

---

### Task 8: `/staff/:panel` routing, staff head sync, standalone sign-out (App.jsx)

**Files:**
- Modify: `frontend/App.jsx`. The touch points are the `useMatch` lines (~2496-2497), `show404`
  (~2518), the three `/staff` effects (~2786-2819), and the `isAdmin` early return (~2874).
- Test: `frontend/App.routing.test.jsx` (append)

**Interfaces:**
- Consumes:
  - Task 3: `StaffDashboard({auth,onExit,activeTab,onTabChange,exitLabel})`, and
    `onTabChange(id, {replace}?)`.
  - Task 6: `ensureStaffHead`, `isStaffPathname`, `startStaffPwa`, `isStandaloneDisplay`.
- Produces:
  - URL `/staff` means Overview.
  - `/staff/<id>` selects that panel.
  - Unpermitted or unknown ids are replaced with `/staff`.

- [ ] **Step 1: Write the failing tests.** Append to `frontend/App.routing.test.jsx`, and extend
  the imports with `waitFor`, `within`, `useLocation`, and `afterEach`:

```jsx
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderStaffAt(path) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AshantiHub />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function signInStaff(permissions) {
  setStoredAuth({ token: 'test-token', account_type: 'staff', id: 1, full_name: 'Akosua Support' })
  server.use(
    http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({
      account_type: 'staff', id: 1, full_name: 'Akosua Support', role: 'support', permissions,
    })),
  )
}

const staffNav = () => screen.findByRole('navigation', { name: 'Staff panels' }, { timeout: 3000 })

describe('AshantiHub routing — /staff/:panel', () => {
  afterEach(() => setStoredAuth(null))

  it('mounting at /staff/users opens the Users panel for a permitted staffer', async () => {
    signInStaff(['messaging.manage', 'users.view'])
    renderStaffAt('/staff/users')
    expect(within(await staffNav()).getByRole('button', { name: /Users/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('location')).toHaveTextContent('/staff/users')
  }, 8000)

  it('an unpermitted panel falls back to Overview and replaces the URL with /staff', async () => {
    signInStaff(['messaging.manage'])
    renderStaffAt('/staff/kyc')
    expect(await screen.findByText(/Akwaaba, Akosua/i, {}, { timeout: 3000 })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/staff'))
  }, 8000)

  it('an unknown panel id falls back the same way', async () => {
    signInStaff(['messaging.manage'])
    renderStaffAt('/staff/not-a-panel')
    expect(await screen.findByText(/Akwaaba, Akosua/i, {}, { timeout: 3000 })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/staff'))
  }, 8000)

  it('clicking a nav item pushes /staff/<panel>, and Overview goes back to /staff', async () => {
    signInStaff(['messaging.manage', 'users.view'])
    renderStaffAt('/staff')
    fireEvent.click(within(await staffNav()).getByRole('button', { name: /Users/ }))
    expect(screen.getByTestId('location').textContent).toBe('/staff/users')
    fireEvent.click(within(await staffNav()).getByRole('button', { name: /Overview/ }))
    expect(screen.getByTestId('location').textContent).toBe('/staff')
  }, 8000)

  it('a signed-out visit to /staff/users opens staff sign-in instead of a 404', async () => {
    renderStaffAt('/staff/users')
    expect(await screen.findByText('Staff Sign In', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe('/staff/users')
  }, 8000)

  it('/staff/activate still renders the activation page, not a panel', async () => {
    renderStaffAt('/staff/activate?token=abc')
    expect(await screen.findByText('Activate Your Staff Account', {}, { timeout: 3000 })).toBeInTheDocument()
  }, 8000)

  it('links the staff manifest on staff paths; Exit to / removes it', async () => {
    signInStaff(['messaging.manage', 'users.view'])
    renderStaffAt('/staff/users')
    await staffNav()
    expect(document.head.querySelector('link[rel="manifest"]')).toHaveAttribute('href', '/staff.webmanifest')
    fireEvent.click(screen.getByRole('button', { name: '← Exit' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
    await waitFor(() => expect(document.head.querySelector('link[rel="manifest"]')).toBeNull())
  }, 8000)
})
```

- [ ] **Step 2: Run them to verify they fail.**

  Run: `cd frontend && npx vitest run App.routing.test.jsx`

  Expected: the new tests FAIL. `/staff/users` is a 404, and nothing sets the manifest link.

- [ ] **Step 3: Implement the route mapping.** In `App.jsx`, import
  `{ ensureStaffHead, isStaffPathname, isStandaloneDisplay, startStaffPwa } from "./lib/staffPwa.js"`.
  Directly after `const eventDetailMatch = useMatch("/events/:id");`, add:

```jsx
  // Staff dashboard panels are URL-addressable (/staff/kyc, /staff/users, …)
  // so Android's back gesture steps through panels inside the installed app
  // and manifest shortcuts can deep-link. /staff/activate is its own page
  // (PATH_TO_PAGE) and is never read as a panel id. AdminCommandCenter
  // validates the id against the session's permissions and asks for a
  // replace back to /staff when it isn't one.
  const staffPanelMatch = useMatch("/staff/:panel");
  const staffPanel = staffPanelMatch && staffPanelMatch.params.panel !== "activate" ? staffPanelMatch.params.panel : null;
  const onStaffDashboardPath = location.pathname === "/staff" || location.pathname === "/staff/" || staffPanel !== null;
```

  Change `show404` to:

```jsx
  const show404 = !KNOWN_PATHS.has(location.pathname) && !businessDetailMatch && !eventDetailMatch && !onStaffDashboardPath;
```

- [ ] **Step 4: Update the three `/staff` effects.** Replace each literal `"/staff"` path check
  with `onStaffDashboardPath`, and guard the standalone case.
  - Effect 1: `if(!onStaffDashboardPath) return;` in place of
    `if(location.pathname!=="/staff") return;`.
  - Effect 2: `const shouldBeAdmin = onStaffDashboardPath && auth.user?.account_type==="staff";`
  - Effect 3:

```jsx
  useEffect(()=>{
    const wasAdmin=wasAdminRef.current;
    wasAdminRef.current=isAdmin;
    if(isAdmin){
      if(!onStaffDashboardPath) navigate("/staff");
    }else if(wasAdmin && onStaffDashboardPath && !isStandaloneDisplay()){
      // Inside the installed staff app there is no marketplace to go "home"
      // to — sign-out stays on /staff with the staff login open instead.
      navigate("/");
    }
  },[isAdmin]);
```

  Add the head-sync effect next to them:

```jsx
  // Staff PWA: the /staff-scoped manifest + apple tags exist only on staff
  // URLs (so the marketplace is never installable), and entering staff
  // in-session starts the install-prompt listener / SW registration.
  useEffect(()=>{
    const staffPath=isStaffPathname(location.pathname);
    ensureStaffHead(staffPath);
    if(staffPath) startStaffPwa();
  },[location.pathname]);
```

- [ ] **Step 5: Wire `StaffDashboard`.** Replace the `isAdmin` early return:

```jsx
  if(isAdmin){
    const staffStandalone=isStandaloneDisplay();
    return <StaffDashboard auth={auth}
      activeTab={staffPanel ?? "overview"}
      onTabChange={(id,{replace=false}={})=>{
        const path=id==="overview" ? "/staff" : `/staff/${id}`;
        if(location.pathname!==path) navigate(path,{replace});
      }}
      exitLabel={staffStandalone ? "Sign out" : "← Exit"}
      onExit={staffStandalone ? ()=>{auth.logout();setAuthModal("staff-login");} : ()=>setIsAdmin(false)}/>;
  }
```

- [ ] **Step 6: Run the tests.**

  Run: `cd frontend && npx vitest run App.routing.test.jsx StaffDashboard.test.jsx components/admin`

  Expected: all PASS. If MSW logs unhandled requests for panel endpoints (e.g. the Users list),
  check that `frontend/mocks/handlers.js` has a handler for that URL. Add a minimal empty-list
  handler there only if the request makes a test fail, not merely log.

- [ ] **Step 7: Commit.**

```bash
git add frontend/App.jsx frontend/App.routing.test.jsx
git commit -m "feat(staff): URL-addressable staff panels and staff-only PWA head tags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017kwucfaVoi6X952jkJGouX"
```

---

### Task 9: Phone baseline + layout audit + panel fixes

**Files:**
- Modify: `frontend/components/admin/shell/StaffShellStyles.jsx`
- Create: `frontend/scripts/staff-layout-audit.js`
- Modify (only those the audit flags): `frontend/components/admin/panels/*.jsx`,
  `frontend/components/admin/ModerationQueueTabs.jsx`, and in `frontend/App.jsx` `AuthModal`
  (~1116) and `StaffActivatePage` (~1256)
- Test: `frontend/components/admin/__tests__/AdminCommandCenter.test.jsx` (append one)

**Interfaces:**
- Consumes (Tasks 4 and 8): `.staff-shell[data-bp="phone"]`, `main.staff-content`, and
  `/staff/:panel` URLs.
- Produces: no new interfaces. Layout-only changes.

- [ ] **Step 1: Write the failing test.** Append to `AdminCommandCenter.test.jsx`:

```jsx
describe('AdminCommandCenter — phone baseline CSS', () => {
  it('ships the phone touch-target, input-zoom and wrapping rules', () => {
    renderShell()
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n')
    expect(css).toMatch(/\.staff-shell\[data-bp="phone"\] \.staff-content button \{ min-height: 44px; \}/)
    expect(css).toMatch(/font-size: 16px !important/)
    expect(css).toMatch(/overflow-wrap: anywhere/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails.**

  Run: `cd frontend && npx vitest run components/admin/__tests__/AdminCommandCenter.test.jsx -t "baseline"`

  Expected: FAIL.

- [ ] **Step 3: Append the phone baseline** inside the template string in
  `StaffShellStyles.jsx`:

```css
/* Phone baseline for every panel (spec §5 rules 3–4, Review Focus 5).
   !important appears only where panels set the same property inline. */
.staff-shell[data-bp="phone"] .staff-content { overflow-wrap: anywhere; }
.staff-shell[data-bp="phone"] .staff-content button { min-height: 44px; }
.staff-shell[data-bp="phone"] .staff-content input:not([type="checkbox"]):not([type="radio"]),
.staff-shell[data-bp="phone"] .staff-content select,
.staff-shell[data-bp="phone"] .staff-content textarea {
  font-size: 16px !important; min-height: 44px; max-width: 100%; box-sizing: border-box;
}
.staff-shell[data-bp="phone"] .staff-content img,
.staff-shell[data-bp="phone"] .staff-content video { max-width: 100%; height: auto; }
```

- [ ] **Step 4: Run the shell tests.**

  Run: `cd frontend && npx vitest run components/admin StaffDashboard.test.jsx`

  Expected: PASS.

- [ ] **Step 5: Bring up an isolated local stack.** Ports 8000, 5173 and 5432 are held by another
  project's containers on this machine, so use alternates. Write
  `<scratchpad>/compose.audit.yml`:

```yaml
services:
  db:
    ports: !reset []
  web:
    ports: !override
      - "8100:8000"
    environment:
      DJANGO_CORS_ALLOWED_ORIGINS: "http://localhost:4173"
      FRONTEND_BASE_URL: "http://localhost:4173"
```

  Then, from the repo root:

```bash
docker compose -p ashantihub-audit -f docker-compose.yml -f <scratchpad>/compose.audit.yml up -d --build db web
docker compose -p ashantihub-audit -f docker-compose.yml -f <scratchpad>/compose.audit.yml exec web python manage.py migrate
docker compose -p ashantihub-audit -f docker-compose.yml -f <scratchpad>/compose.audit.yml exec web python manage.py create_super_admin --full-name "Audit Admin" --email audit.admin@local.test --password 'AuditPass!2026'
docker compose -p ashantihub-audit -f docker-compose.yml -f <scratchpad>/compose.audit.yml exec web python manage.py seed_dev_data
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8100/api/accounts/staff/login/ -H 'Content-Type: application/json' -d '{"identifier":"audit.admin@local.test","password":"AuditPass!2026"}'
```

  - Expected: the final `curl` prints `200`.
  - If `create_super_admin` refuses because a super_admin exists, the audit project's DB volume
    has one from an earlier run; reuse its credentials or `down -v` and redo.
  - If `backend/.env` is missing, copy `backend/.env.example` (or `infra/env/backend.env.example`)
    to `backend/.env` first.
  - Ask the user before deleting any volume that isn't the `ashantihub-audit` project's.

- [ ] **Step 6: Build and serve the frontend against it.**

```bash
cd frontend && VITE_API_BASE_URL=http://localhost:8100 npm run build && npx vite preview --port 4173 --strictPort
```

  Run the preview with `run_in_background: true`.

- [ ] **Step 7: Create the audit script** `frontend/scripts/staff-layout-audit.js`:

```js
// Staff layout audit (docs/superpowers/plans/2026-10-03-staff-pwa-responsive.md
// Task 9). Paste this function into the Playwright MCP's
// browser_run_code_unsafe tool (it receives `page`). Needs the local audit
// stack: API on :8100 with a super_admin, `vite preview` on :4173 built with
// VITE_API_BASE_URL=http://localhost:8100. Returns every panel × viewport where
// the page scrolls sideways or an element pokes past the viewport (elements
// inside their own horizontal scroller are allowed — spec §5 rule 2).
async (page) => {
  const BASE = 'http://localhost:4173';
  const API = 'http://localhost:8100';
  const SHOTS = process.env.STAFF_AUDIT_SHOTS || '/tmp/staff-audit';
  const PANELS = ['overview', 'kyc', 'moderation', 'hero', 'events-moderation', 'reviews', 'event-pricing',
    'subscription-plans', 'subscription-plans-approval', 'escrow', 'disputes', 'transactions', 'credit',
    'users', 'staff', 'scout-assignments', 'field-verification', 'delivery-coordination', 'my-deliveries',
    'categories-zones', 'promotions', 'site-settings', 'delivery', 'contact-messages', 'messaging', 'analytics'];
  const VIEWPORTS = [[320, 640], [375, 812], [768, 1024], [1024, 768], [1440, 900]];

  const measure = (scope) => page.evaluate((scopeSelector) => {
    const vw = document.documentElement.clientWidth;
    const inOwnScroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
      }
      return false;
    };
    const offenders = [...document.querySelectorAll(`${scopeSelector} *`)]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && !inOwnScroller(el); })
      .slice(0, 8)
      .map((el) => ({ tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 60), right: Math.round(el.getBoundingClientRect().right) }));
    return { vw, scrollWidth: document.documentElement.scrollWidth, offenders };
  }, scope);

  const login = await page.request.post(`${API}/api/accounts/staff/login/`, { data: { identifier: 'audit.admin@local.test', password: 'AuditPass!2026' } });
  const auth = await login.json();
  await page.goto(`${BASE}/`);
  await page.evaluate((a) => localStorage.setItem('ashantihub.auth', JSON.stringify(a)), auth);

  const failures = [];
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    for (const id of PANELS) {
      await page.goto(`${BASE}/staff${id === 'overview' ? '' : `/${id}`}`);
      await page.waitForSelector('main.staff-content', { timeout: 20000 });
      await page.waitForTimeout(1000);
      const result = await measure('.staff-shell');
      if (result.scrollWidth > result.vw || result.offenders.length) failures.push({ viewport: `${width}x${height}`, panel: id, ...result });
      await page.screenshot({ path: `${SHOTS}/${width}-${id}.png`, fullPage: true });
    }
  }

  // Signed-out staff entry points at phone widths.
  await page.evaluate(() => localStorage.removeItem('ashantihub.auth'));
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ['/staff', '/staff/activate?token=audit']) {
      await page.goto(`${BASE}${path}`);
      await page.waitForTimeout(2600); // boot LoadingScreen + modal
      const result = await measure('body');
      if (result.scrollWidth > result.vw || result.offenders.length) failures.push({ viewport: `${width}`, panel: path, ...result });
      await page.screenshot({ path: `${SHOTS}/${width}-${path.replace(/[/?=]/g, '_')}.png`, fullPage: true });
    }
  }
  return { checked: VIEWPORTS.length * PANELS.length + 4, failures };
}
```

  Before pasting, replace `process.env.STAFF_AUDIT_SHOTS || '/tmp/staff-audit'` with the absolute
  path `<scratchpad>/staff-audit`, since the MCP sandbox has no `process.env`. Then `mkdir` that
  directory.

- [ ] **Step 8: Run the audit.** Load the Playwright MCP's `browser_run_code_unsafe` via
  ToolSearch, then call it with the script's function.

  Expected on the first run: a `failures` list. Record it, panel × viewport plus the offender
  text, in the task's working notes.

- [ ] **Step 9: Fix each failure with the matching pattern.** Edit only layout styles. Never
  change text, gating, data flow, or handlers.

  - **Fixed-width cell in a row** (`width: N` or `minWidth: N` with N > 260):

```jsx
// before
<select … style={{ ...fieldStyle, width: 120 }}>
// after
<select … style={{ ...fieldStyle, flex: "1 1 120px", minWidth: 0 }}>
```

  - **Row that doesn't wrap**: add `flexWrap: "wrap"` to the row's container, and `minWidth: 0`
    to flex children that hold text.
  - **Grid with too wide a minimum**:

```jsx
gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))"
```

  - **Genuinely tabular block** (columns must stay aligned): wrap it in

```jsx
<div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", maxWidth: "100%" }}>{table}</div>
```

  - **Column-header row that only labels columns**: hide it on phone, using
    `const isPhone = useBreakpoint() === "phone";`, then `{!isPhone && <HeaderRow/>}`. Make sure
    each value row shows its label inline on phone, e.g.
    `{isPhone && <span style={{ color: D.textDim }}>Amount: </span>}`.
  - **recharts axes clipping at 320px**: `<XAxis … interval="preserveStartEnd" tick={{ fontSize: isPhone ? 10 : 12 }} />`.
  - **Stacked action buttons on phone**: give the button-group container
    `flexDirection: isPhone ? "column" : "row"` and the buttons
    `width: isPhone ? "100%" : undefined`.
  - **AuthModal / StaffActivatePage overflow**:
    - give the modal card `width: "min(420px, calc(100vw - 24px))"` and `maxHeight: "90dvh"` with
      `overflowY: "auto"`
    - change any fixed `width` on inputs there to `width: "100%"` with `boxSizing: "border-box"`

  After each panel fix, run
  `cd frontend && npx vitest run StaffDashboard.test.jsx components/admin`. It must stay green
  with no test edits.

- [ ] **Step 10: Rebuild, re-serve, and re-run the audit until `failures` is `[]`.**
  - Stop the preview, then rerun Step 6 and Step 8.
  - Open the 320 and 375 screenshots for every panel with the Read tool. Look for clipped text,
    overlapping elements, unreadable sizes, and content hidden behind the bottom bar.
  - Fix anything found by the same patterns.
  - The audit passing is necessary but not sufficient; the screenshots must look right too.

- [ ] **Step 11: Run the full suite.**

  Run: `cd frontend && npx vitest run`

  Expected: all PASS.

- [ ] **Step 12: Commit.**

```bash
git add frontend/components/admin/shell/StaffShellStyles.jsx frontend/components/admin/__tests__/AdminCommandCenter.test.jsx frontend/scripts/staff-layout-audit.js frontend/components/admin/panels frontend/components/admin/ModerationQueueTabs.jsx frontend/App.jsx
git commit -m "feat(staff): phone baseline and layout fixes so every staff view fits 320px+

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017kwucfaVoi6X952jkJGouX"
```

  Keep the audit stack and preview running for Task 11.

---

### Task 10: Hosting headers — nginx templates + Vercel

**Files:**
- Modify: `infra/hestia/templates/ashantihub-spa.tpl`
- Modify: `infra/hestia/templates/ashantihub-spa.stpl`
- Modify: `frontend/vercel.json`
- Test: `frontend/test/staffPwaConfig.test.js` (append)

**Interfaces:**
- Produces: `/sw.js` and `/staff.webmanifest` are served `Cache-Control: no-cache, must-revalidate`;
  the manifest as `application/manifest+json`.

- [ ] **Step 1: Write the failing tests.** Append to `frontend/test/staffPwaConfig.test.js`:

```js
describe('hosting headers for the staff PWA', () => {
  const vercel = JSON.parse(read('vercel.json'))
  const headerFor = (source, key) =>
    vercel.headers.find((h) => h.source === source)?.headers.find((x) => x.key === key)?.value

  it('vercel: the service worker and manifest always revalidate', () => {
    expect(headerFor('/sw.js', 'Cache-Control')).toBe('no-cache, must-revalidate')
    expect(headerFor('/staff.webmanifest', 'Cache-Control')).toBe('no-cache, must-revalidate')
    expect(headerFor('/staff.webmanifest', 'Content-Type')).toBe('application/manifest+json')
  })

  it.each(['ashantihub-spa.tpl', 'ashantihub-spa.stpl'])('nginx %s: no-cache sw.js + typed manifest, never a ^~ .well-known location', (file) => {
    const conf = readFileSync(path.join(root, '..', 'infra', 'hestia', 'templates', file), 'utf8')
    expect(conf).toMatch(/location = \/sw\.js \{[^}]*no-cache, must-revalidate/s)
    expect(conf).toMatch(/location = \/staff\.webmanifest \{[^}]*application\/manifest\+json[^}]*no-cache, must-revalidate/s)
    expect(conf).not.toMatch(/\^~\s*\/\.well-known/)
  })
})
```

  The regex uses `[^}]*`, so the manifest location must stay a single flat block with no inner
  braces. That is why Step 3 uses `default_type` rather than a nested `types { … }` block.

- [ ] **Step 2: Run them to verify they fail.**

  Run: `cd frontend && npx vitest run test/staffPwaConfig.test.js`

  Expected: the new tests FAIL.

- [ ] **Step 3: nginx.** In **both** `ashantihub-spa.tpl` and `ashantihub-spa.stpl`, insert the
  following directly after the `location = /index.html { … }` block:

```nginx
	# Staff PWA (docs/superpowers/specs/2026-10-03-staff-pwa-responsive-design.md):
	# the service worker and its manifest must always revalidate, or a deploy's
	# new precache list waits on the browser's own 24h service-worker check.
	location = /sw.js {
		expires   -1;
		add_header Cache-Control "no-cache, must-revalidate";
	}

	location = /staff.webmanifest {
		default_type application/manifest+json;
		expires   -1;
		add_header Cache-Control "no-cache, must-revalidate";
	}
```

  `default_type` only applies when `mime.types` has no mapping for `.webmanifest`. On hosts whose
  `mime.types` already maps it, the type is the same, so either way the response is
  `application/manifest+json`.

- [ ] **Step 4: Vercel.** In `frontend/vercel.json`, append these objects to the `headers` array,
  after the existing `"/(.*)"` entry:

```json
    {
      "source": "/sw.js",
      "headers": [{ "key": "Cache-Control", "value": "no-cache, must-revalidate" }]
    },
    {
      "source": "/staff.webmanifest",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, must-revalidate" },
        { "key": "Content-Type", "value": "application/manifest+json" }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
```

- [ ] **Step 5: Run the tests and validate the nginx syntax.**

  Run: `cd frontend && npx vitest run test/staffPwaConfig.test.js`

  Expected: PASS.

  Then check that the substituted template parses:

```bash
sed -e 's/%ip%:%web_port%/127.0.0.1:8088/' -e 's/%[a-z_]*%/x/g' -e '/include /d' ../infra/hestia/templates/ashantihub-spa.tpl > <scratchpad>/spa-test.conf
docker run --rm -v <scratchpad>/spa-test.conf:/etc/nginx/conf.d/default.conf:ro nginx:stable nginx -t
```

  Expected: `syntax is ok`. If the `if ($anti_replay …)` lines in `.stpl` need Hestia's map,
  test only the `.tpl`; the added blocks are identical in both.

- [ ] **Step 6: Commit.**

```bash
git add infra/hestia/templates/ashantihub-spa.tpl infra/hestia/templates/ashantihub-spa.stpl frontend/vercel.json frontend/test/staffPwaConfig.test.js
git commit -m "infra: serve the staff service worker and manifest uncached

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017kwucfaVoi6X952jkJGouX"
```

  Note for the deploy step, which is out of this plan: production must re-run
  `infra/scripts/install-hestia-templates.sh` (see `infra/README.md`) for these headers to take
  effect.

---

### Task 11: End-to-end PWA verification + docs

**Files:**
- Modify: `docs/PWA_STAFF_DASHBOARD.md`
- Modify (do **not** stage; it is the user's untracked WIP): `frontend/CLAUDE.md`

- [ ] **Step 1: Run the full gates.**

```bash
cd frontend && npx vitest run && npm run typecheck && VITE_API_BASE_URL=http://localhost:8100 npm run build
```

  Expected: all tests PASS, typecheck clean, build succeeds. Paste the summary lines into the
  task report.

- [ ] **Step 2: Restart the preview** on :4173 from that build, in the background, with the
  Task 9 audit stack still up.

- [ ] **Step 3: Check the PWA behaviour with the Chrome DevTools MCP** (load the tools via
  ToolSearch). Record each result.
  1. `navigate_page` to `http://localhost:4173/`, then `evaluate_script`:
     `async () => ({ manifest: !!document.querySelector('link[rel=manifest]'), controlled: !!navigator.serviceWorker.controller, reg: !!(await navigator.serviceWorker.getRegistration('/')) })`.
     Expected: `manifest: false`, `controlled: false`.
  2. Sign in at `/staff` with the audit admin through the UI, then reload `/staff`. Evaluate:
     `async () => { const r = await navigator.serviceWorker.getRegistration('/staff'); return { scope: r?.scope, active: !!r?.active, manifest: document.querySelector('link[rel=manifest]')?.href } }`.
     Expected: scope `http://localhost:4173/staff`, active `true`, manifest `…/staff.webmanifest`.
  3. Evaluate `fetch('/staff.webmanifest').then(r => r.json())`. Expected: it parses, with
     `start_url` `/staff`.
  4. `navigate_page` to `/staff/messaging`, `emulate` network `Offline`, then reload. Expected:
     the shell renders with the "You're offline — staff actions need a connection." banner, the
     staffer is still signed in, and there is no browser error page. Take a screenshot.
  5. Restore the network. Make a trivial visible change (e.g. add a space to a comment in
     `OverviewPanel.jsx`), rebuild, restart the preview, and reload `/staff` once. Expected:
     "A new version of AshantiHub Staff is available." appears. Click Reload; the page reloads
     onto the new build. Revert the trivial change afterwards (`git checkout -- <file>`).
  6. `emulate` an iPhone-sized viewport (390×844, mobile, touch) on `/staff`. Open ☰, tab through
     the drawer (focus stays inside), and press Esc. Expected: focus returns to ☰.

- [ ] **Step 4: Update `docs/PWA_STAFF_DASHBOARD.md`.**
  - Change **Status** to: "Implemented — see `docs/superpowers/specs/2026-10-03-staff-pwa-responsive-design.md`."
  - In §2–§4, add a dated status line saying that `vite-plugin-pwa` registration, the icon set,
    and the `/staff`-scoped manifest have landed.
  - In §5, record that the "cache last-seen data" idea was **replaced** by the user's 2026-10-03
    decision: shell plus offline notice, no staff data stored on the device.

- [ ] **Step 5: Update `frontend/CLAUDE.md`.** It is untracked user WIP: edit it, don't stage it.
  Add under "Gotchas":

```markdown
- **Staff PWA is scoped, not global.** The service worker (`vite-plugin-pwa`, `vite.config.js`)
  registers from `lib/staffPwa.js` with `scope: "/staff"`, and the `staff.webmanifest` link is
  injected only on `/staff*` paths (`ensureStaffHead`). Never add a global `<link rel="manifest">`
  to `index.html` or `runtimeCaching` for API routes — staff data must not persist on devices.
  Static PWA files live in `frontend/public/`. Under Vitest the plugin is off and
  `virtual:pwa-register` is aliased to `test/stubs/pwa-register.js`.
- **Staff shell breakpoints** come from `hooks/useBreakpoint.js` (phone ≤760, tablet ≤1199,
  else desktop; jsdom → desktop). Phone-only CSS lives in `components/admin/shell/
  StaffShellStyles.jsx`; `scripts/staff-layout-audit.js` is the overflow audit for every panel.
```

- [ ] **Step 6: Tear down the audit stack.**
  - Stop the preview process.
  - Run `docker compose -p ashantihub-audit -f docker-compose.yml -f <scratchpad>/compose.audit.yml down`.
    Keep the volume; it's cheap and only this project uses it.

- [ ] **Step 7: Commit the tracked docs.**

```bash
git add docs/PWA_STAFF_DASHBOARD.md
git commit -m "docs: mark the staff PWA spec implemented

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017kwucfaVoi6X952jkJGouX"
```

- [ ] **Step 8: Hand off.** Report:
  - the test, typecheck and build output
  - the audit result (`failures: []`) and screenshots location
  - the DevTools check results
  - that real-device checks (Android Chrome install and back gesture, iPhone Add to Home Screen
    and safe areas) and the staging deploy are next, via the `deploy` skill, **only when the user
    asks**

  Do not deploy.
