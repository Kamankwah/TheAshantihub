# Implementation Instructions — Master Index

**Status:** This is the literal "instruction set" tying together every planning doc produced in this pass. Nothing described here has been built in code yet, except the tooling/config listed in `docs/TOOLING_SETUP.md` §5 and the `docs/PROJECT_SCOPE.md` restructure.

## 1. Document map

| Doc | Covers | Owner agent |
| --- | --- | --- |
| `docs/PROJECT_SCOPE.md` | Full phased roadmap (Phase 1 backend+auth+Hubtel, Phase 2 real-time+AI, Phase 3 credit v2, Phase 4 DevOps hardening) | `backend-architect` (overall), `payments-integration-engineer` (§5b) |
| `docs/HUBTEL_INTEGRATION.md` | Hubtel technical integration spec — Checkout API, webhooks, security | `payments-integration-engineer` |
| `docs/MOBILE_APP_SCOPE.md` | React Native (iOS + Android) app, separate repo, phased against the backend roadmap | `mobile-engineer` |
| `docs/TOOLING_SETUP.md` | Agents/skills/plugins/MCP servers for this project | n/a (meta) |
| `docs/FRONTEND_MODERNIZATION.md` | Hero/Navbar redesign, componentization, palette extension, React 19 upgrade | `frontend-engineer` |
| `docs/PWA_STAFF_DASHBOARD.md` | Service worker fix, staff-scoped installable PWA | `frontend-engineer` |
| `CLAUDE.md` | Baseline architecture description (kept accurate as code changes land) | n/a (meta) |

## 2. Sequencing across all docs

```
Tooling setup (docs/TOOLING_SETUP.md)          — done this pass, keys pending
        │
        ▼
Phase 1 backend + Hubtel (docs/PROJECT_SCOPE.md §5a/§5b, docs/HUBTEL_INTEGRATION.md)
        │                                    │
        │ (frontend can proceed in parallel) │ (mobile Phase 2 blocked on this)
        ▼                                    ▼
Frontend modernization (docs/FRONTEND_MODERNIZATION.md)      Mobile app (docs/MOBILE_APP_SCOPE.md)
        │
        ▼
PWA staff dashboard (docs/PWA_STAFF_DASHBOARD.md)
        │
        ▼
Phase 2-4: real-time+AI, credit scoring v2, DevOps hardening (docs/PROJECT_SCOPE.md §6)
```

- Frontend modernization has **no hard dependency** on the backend — it can start immediately, in parallel with Phase 1 backend work, same as the original prototype was built mock-data-first.
- PWA staff-dashboard work should sequence after the React 19 bump (`docs/FRONTEND_MODERNIZATION.md` §6) to avoid verifying service-worker behavior twice against two React versions.
- Mobile Phase 1 (browse/auth) can start early against mock data; Mobile Phase 2 (payments) is hard-blocked on Hubtel being live in production.
- Credit scoring v2 (Phase 3) is unblocked immediately after Phase 1 now that Hubtel data exists from day one — it no longer needs a separate payments phase to complete first.

## 3. Cross-cutting items not owned by any single doc above

### Environment / secrets management
- Convention: `.env` files, never committed, consumed by Docker Compose in production (`docs/PROJECT_SCOPE.md` §7).
- `.claude/settings.local.json` already allow-lists a set of read-only/low-risk commands (`npm run *`, `npm install *`, `git add *`, DNS/HTTP checks for theashantihub.com, Vercel MCP tools) — extend this list as new safe, repeated commands emerge, don't broaden it speculatively.
- New secrets introduced by this pass (`HUBTEL_CLIENT_ID`/`SECRET`/etc., 21st.dev `API_KEY`, Postgres connection string) all follow the same placeholder-then-fill pattern documented in `docs/TOOLING_SETUP.md` and `docs/HUBTEL_INTEGRATION.md` §5 — never commit a real value for any of them.

### CI/CD
- Current state: Vercel handles the frontend build/deploy (`vercel.json`, SPA rewrite + security headers) — this stays as-is for the web frontend.
- Phase 1 backend adds a second CI/CD path: GitHub Actions building the Django backend and deploying over SSH to the VPS (`docs/PROJECT_SCOPE.md` §7) — this is new infrastructure, not an extension of the existing Vercel pipeline, because the backend isn't a static/edge deployment target.
- Mobile app CI/CD (EAS Build/Submit via GitHub Actions) is a third, independent pipeline — see `docs/MOBILE_APP_SCOPE.md` §6.

### Testing strategy
- Current state: **zero tests in the repo** — no test files, no ESLint/Prettier config, no test script in `package.json` (`CLAUDE.md` "Commands" section). This has been true since the prototype stage and hasn't been addressed by this planning pass.
- Recommended starting point, in priority order, once real code work begins:
  1. Backend: Django's built-in test framework for auth, listing CRUD, and — critically — the Hubtel webhook handler (`docs/HUBTEL_INTEGRATION.md` §4 is exactly the kind of logic that needs unit coverage for idempotency/signature-verification edge cases before it touches real money).
  2. Frontend: no framework recommendation made here — revisit once `components/` extraction (`docs/FRONTEND_MODERNIZATION.md` §2) gives the codebase actual unit boundaries to test; testing a 3,600-line single-file monolith is lower-value than testing extracted components.
  3. Mobile: Jest + Maestro per `docs/MOBILE_APP_SCOPE.md` §6, from the start of that project rather than retrofitted later.

### Monitoring / observability
- Deferred to Phase 4 (formerly Phase 5) per `docs/PROJECT_SCOPE.md` §6 — Sentry for error tracking, uptime checks. This planning pass does not pull that forward; flagged here only so it isn't forgotten, not because it's changing.

## 4. What is explicitly NOT done in this pass

- No `App.jsx` code changes (Hero, Navbar, palette, React 19 bump — all spec only).
- No Django/DRF backend scaffolded.
- No React Native project created.
- No real Hubtel API calls wired up — `MoMoPayment`/`MoMoModal` are still fully simulated.
- No service worker registration fix applied — `sw.js` is still dead code.
- MCP servers (`magic`, `postgres`) still have placeholder credentials — not functional until the user fills them in.
- `figma` plugin is enabled in config but the interactive OAuth authorization step has not been run (requires the user).
- No `ashantihub-conventions` project skill authored (recommended, not built).

## 5. What triggers each next step

| Next step | Trigger |
| --- | --- |
| Frontend modernization implementation | User approval to start editing `App.jsx` per `docs/FRONTEND_MODERNIZATION.md` |
| Phase 1 backend scaffold | User confirms Django/DRF as final choice and provides/approves VPS + DB provisioning |
| Hubtel integration | Phase 1 backend exists + Hubtel merchant account approved (sandbox credentials at minimum) |
| PWA staff dashboard | Frontend modernization's React 19 bump lands + Option A/B scoping decision (`docs/PWA_STAFF_DASHBOARD.md` §4) made with the user |
| Mobile app | Separate repo created; Mobile Phase 1 can start immediately, Phase 2 waits on live Hubtel |
| MCP servers going live | User supplies 21st.dev API key and (once provisioned) the Postgres connection string |
