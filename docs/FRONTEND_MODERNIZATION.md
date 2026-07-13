# Frontend Modernization Spec — Hero, Navbar, Componentization

**Status:** §2–5 implemented (React 19 bump in §6 was already the installed version by the time this landed, so no separate action was needed there) — see `docs/superpowers/specs/2026-07-12-frontend-modernization-design.md` / `.../plans/2026-07-12-frontend-modernization-plan.md` for what actually shipped.

**Owner agent:** `.claude/agents/frontend-engineer.md`

## 1. Current state (baseline, for reference)

- **Hero:** inline JSX at `App.jsx:3213-3347`, one static background photo (`KUMASI_PHOTOS.manhyiaPalace`), a kente-colored gradient overlay, a faint diagonal texture, a Ghana-flag-stripe bottom bar, welcome text, CTA buttons, the search bar, and quick-action buttons. No carousel, no video, no JS/CSS-driven animation.
- **Navbar:** the `Header` component at `App.jsx:3121-3180`, sticky, no hamburger/mobile menu — everything wraps via `flexWrap`. Search lives in the hero, not the header.
- **Palette:** `C` object at `App.jsx:4-10` — 14 keys (gold, deepGold, darkBrown, lightGold, cream, black `#1A1A1A`, kente1-3, ghRed/ghGold/ghGreen, whatsapp, orange). No pure black/white.
- **Stack:** React `18.3.1`, Vite 5.1.4, no animation library, no router, no CSS framework — raw inline `style={{}}` throughout.
- **Only existing animations:** `@keyframes spin/loadBar/fadeIn/pulse` declared inline via `<style>` tags local to a few components (`LoadingScreen` etc.) — no shared animation system.

## 2. Componentization plan

Per the approved decision: extract into a `components/` directory rather than continuing to grow the single `App.jsx` file.

```
TheAshantihub/
  components/
    Hero.jsx          # new, replaces inline hero JSX at App.jsx:3213-3347
    Navbar.jsx         # extracted from Header (App.jsx:3121-3180), renamed for clarity
    ...                # future extractions land here, not required to migrate everything at once
  App.jsx              # keeps state/page-routing (page, isAdmin, showBizDash, etc.), imports the above
  main.jsx
```

- **Scope discipline:** only extract what this modernization pass actually touches (Hero, Navbar). Do not do a big-bang extraction of all 3,600 lines in the same pass — that's a much larger, separate refactor with its own risk profile.
- `App.jsx` continues to own all state (`page`, `isAdmin`, `showBizDash`, `showPayments`, `showCredit`, etc.) and passes props/callbacks down — no new state management library needed for this.
- When this lands, update `CLAUDE.md`'s "Project structure" and "Architecture" sections to describe the `components/` directory — that file currently documents the single-file layout as fact, and would become stale the moment this ships.

## 3. Hero redesign

- **Replace** the single static `KUMASI_PHOTOS.manhyiaPalace` background with a **multi-slide carousel** — image and optionally video backgrounds, auto-advancing with manual prev/next controls.
- **Animation approach:** start library-free, using CSS `@keyframes` crossfade/Ken-Burns (slow background-position or scale drift) — this matches the app's existing zero-dependency styling convention (`CLAUDE.md` "Styling" section) and avoids a new dependency for the first pass.
  - **Optional upgrade path:** flag `framer-motion` as a follow-up if richer gesture-driven motion (swipe-to-advance, spring transitions) is wanted later — this requires adding a real dependency and re-verifying compatibility after the React 19 bump (§5 below), so treat it as a distinct, separately-approved step, not bundled into the first Hero ship.
- **Content sourcing:** reuse the existing `KUMASI_PHOTOS` object as the starting slide set (add more entries as needed); video slides are a genuinely new asset requirement — flag to the user that video assets need to be sourced/licensed before that part can ship, this doc doesn't invent asset content.
- **Preserve:** the Ghana-flag-stripe bottom bar, the kente-gradient overlay treatment, the search bar and quick-action buttons currently living in the hero — these are product decisions independent of the carousel mechanism, not being removed.
- **Accessibility:** respect `prefers-reduced-motion` — pause auto-advance and skip Ken-Burns drift for users who've set that OS/browser preference.

## 4. Navbar redesign

- Extract `Header` → `Navbar.jsx`, keep all existing actions (language switcher, currency selector, page nav, notifications, messages, favourites, auth/user, Biz Dashboard, Payments buttons) — this is a structural extraction + visual refresh, not a feature cut.
- **Add the missing responsive behavior:** a hamburger/mobile menu for narrow viewports — today it only wraps via `flexWrap`, which degrades poorly on small phone widths given how many action buttons the header carries.
- Keep the sticky positioning and the Ghana-flag-stripe top accent (existing brand signature, `App.jsx:3123`).

## 5. Palette extension

Add two new keys to `C` (`App.jsx:4-10`), additive only — no existing key renamed or removed:

```js
const C = {
  // ...existing 14 keys unchanged...
  pureBlack:"#000000",
  white:"#ffffff",
};
```

Use these for new detail accents (high-contrast borders, icon strokes, text-on-photo overlays in the new Hero) — not as replacements for `C.black` (`#1A1A1A`) or `C.cream` (`#FDF6E3`), which remain the primary dark/light surface colors. `manifest.json`'s `background_color`/`theme_color` already match `C.cream`/`C.darkBrown` — no change needed there.

## 6. React 19 upgrade path

- Bump `react`/`react-dom` from `^18.2.0` (installed `18.3.1`) → `^19.x` in `package.json`.
- Verify `@vitejs/plugin-react` (`^4.2.1`) compatibility with React 19 — check its changelog/peer-dependency range at upgrade time rather than assuming compatibility.
- **Risk assessment:** low. `main.jsx` already uses `ReactDOM.createRoot` (the React 18+ API, not the legacy `ReactDOM.render`), and a repo-wide scan found no legacy lifecycle methods, no `propTypes`/`defaultProps` patterns that changed in 19, no string refs. The main verification step is simply `npm install` + `npm run build` + a manual smoke pass through every `page`/dashboard state after the bump, since there's no automated test suite (`CLAUDE.md` "Commands" section) to catch regressions.
- Do this bump **before** starting the Hero/Navbar work, so new components are written against React 19 from the start rather than upgraded later.

## 7. Suggested execution order (for the session that implements this)

1. React 19 bump + smoke test (isolated, low-risk, unblocks everything else).
2. Palette extension (`pureBlack`/`white`) — trivial, no risk, do it early so new components can use it.
3. Create `components/` directory, extract `Navbar.jsx` from `Header` (lower-risk extraction — no new visual design, just a move + the hamburger menu addition).
4. Build the new `Hero.jsx` (carousel, animations) — highest-effort, most visually significant piece, do last so it benefits from the other groundwork being in place.
5. Manual smoke test: every `page` state (home/events/about), every staff-dashboard early-return route, mobile viewport widths, `prefers-reduced-motion` on/off.
