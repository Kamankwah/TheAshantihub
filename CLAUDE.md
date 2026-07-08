# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install dependencies
- `npm run dev` — start the Vite dev server
- `npm run build` — production build (this is what Vercel runs via `vercel.json`, output to `dist/`)
- `npm run preview` — serve the built `dist/` output locally

There is no lint, typecheck, or test setup in this project (no test files, no ESLint/Prettier config, no test script in `package.json`). Verify changes by running `npm run build` and/or `npm run dev` and exercising the UI in a browser.

## Project structure

This is a flat-layout Vite + React app — there is no `src/` directory. Source files live at the repo root:

- `index.html` — Vite entry HTML, loads `/main.jsx` as a module script and mounts to `#root`.
- `main.jsx` — React root bootstrap (`ReactDOM.createRoot` + `<App />`).
- `App.jsx` — the entire application (~3,600 lines). Everything — components, mock data, business logic — lives in this single file.
- `sw.js` — a service worker (not currently registered anywhere in `main.jsx`/`App.jsx`, so it's inert dead code unless registration is added).
- `manifest.json` — PWA manifest, referenced from `index.html`.
- `vercel.json` — Vercel build/routing config: SPA rewrite (`/(.*) → /index.html`) plus security headers.

## Architecture

`App.jsx` is a monolith: dozens of components are defined as top-level `function` declarations before the single `export default function AshantiHub()` at the bottom of the file, which is the actual app root. There is no React Router or any routing library — navigation is done entirely with local `useState` in `AshantiHub`:

- `page` (`"home" | "events" | "about"`) switches sections within the main return via `page==="..."` conditionals.
- Several boolean flags (`isAdmin`, `showBizDash`, `showPayments`, `showCredit`) act like full-screen "routes": each one, if true, causes an **early return** of a different full-page component (`AdminDashboard`, `BusinessDashboard`, `PaymentDashboard`, `CreditDashboard`) instead of rendering the normal marketplace UI. `isAdmin` is toggled by a hidden gesture (`handleLogoClick` — 5 clicks on the logo).
- Other flags (`showMessaging`, `showNotifs`, `showReferral`, `showMap`, cookie banner) render as overlays/modals on top of the normal page rather than replacing it.

Data is all hardcoded in-file, no backend/API calls exist:

- `CATEGORIES` — the marketplace category list (hotels, food, tours, crafts, transport, etc.), each with an id/icon/label/color.
- `LISTINGS` — an object keyed by category id, each value an array of business listings (name, rating, price, location, phone, etc.).
- `TRANSLATIONS` — i18n string tables, selected via the `lang` state (`T = TRANSLATIONS[lang]`).
- `MOCK_CREDIT_BUSINESSES`, `LENDING_PARTNERS`, `SCORE_FACTORS` — data backing the credit-scoring/lending feature (`CreditDashboard`, `ScoreGauge`, `getScoreColor`/`getScoreGrade`).
- `Analytics` — an in-memory event tracker (`Analytics.track`/`Analytics.getReport`); it does not send anything to a real endpoint, events just accumulate in a JS array for the session.

Authentication is not actually implemented: `authModal`/`setAuthModal` and `user`/`setUser` state exist and are referenced throughout to gate features (WhatsApp contact, messaging, etc.), but there is no corresponding modal component that renders based on `authModal` — signup/login triggers currently no-op visually.

The "WhatsApp-first" contact pattern is central to the product: most business interactions (`handleWA`, `WABtn`) open a `wa.me` deep link with a prefilled message rather than an in-app contact form.

## Styling

No CSS framework or CSS files are used — all styling is inline `style={{...}}` objects on JSX elements, using a shared color constant object `C` (Ghanaian/Ashanti-themed palette: gold, kente colors, Ghana flag colors) defined at the top of `App.jsx`. Reuse `C` rather than hardcoding new colors.
