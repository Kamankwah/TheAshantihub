# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

This file deliberately holds only what a session **cannot** derive by reading the code:
conventions that differ from the defaults, failure contracts, and safety rules. Structure,
file inventories, and endpoint maps are omitted on purpose — read the source for those.
Area-specific guidance lives in `frontend/CLAUDE.md` and `backend/CLAUDE.md` (each loads only
when working under that directory), and the release procedure lives in the `deploy` skill.

## Commands

Frontend, from `frontend/`: `npm install`, `npm run dev`, `npm run build` (what Vercel runs, per
`frontend/vercel.json`), `npm run preview`, `npm run test`.

Backend, from the repo root via `docker-compose.yml`. **The compose service is named `web`, not
`backend`:** `docker compose run --rm web python manage.py <cmd>`.

**Run Vitest from `frontend/`.** From the repo root it globs stale `.worktrees/**` and
`.claude/worktrees/**` copies that lack `node_modules` and reports a spurious mass failure
(hundreds of failed files, thousand-second import times). That is an environment artifact, not a
regression. A second mass-failure shape — hundreds of `[MSW] intercepted a request without a
matching request handler` lines — means a local `frontend/.env` points `VITE_API_BASE_URL`
somewhere other than the `http://localhost:8000` that `frontend/mocks/handlers.js` hardcodes;
move `.env` aside to confirm.

## Deployment & workflow

**GOLDEN RULE — never deploy to production without an explicit instruction from the user.**
All development is verified locally, then shipped to **test/staging**. Promotion to
**production** happens *only* when the user explicitly says so (e.g. "promote to production").
Do not promote proactively, "to finish the job", or because staging looks good — stop and wait
for the user's go-ahead. Approval to deploy to test is **not** approval to deploy to production.

The full procedure — the verify-before-merge gate, the PR flow into `righteoushack` then `main`,
the staging deploy, the production promotion, the server/environment table, and the deployment
gotchas — is in the **`deploy` skill** (`.claude/skills/deploy/SKILL.md`). `infra/README.md` is
the full operational reference; read it before touching the server.

Two infra prohibitions are repeated here because they bite during ordinary edits, outside a
deploy:

- **Never add an `^~ /.well-known/` location to a Hestia nginx template.** Hestia answers the
  Let's Encrypt challenge from a regex location; a `^~` prefix location outranks it and breaks
  issuance and every renewal. nginx vhosts are HestiaCP templates in `infra/hestia/templates/` —
  editing a generated config under `/etc/nginx/conf.d/domains/` is pointless, Hestia rewrites
  those.
- **Do not "simplify" `deploy.sh`'s `/tmp` re-exec away.** It git-resets the checkout it is stored
  in, and bash reads scripts by byte offset — without the re-exec, bash resumes at the wrong
  offset and silently skips steps. This already caused two failed deploys.

## Product rules

**Businesses cannot be contacted directly** (fraud prevention). There is no business-to-customer
WhatsApp link and no direct in-app chat anywhere in the app. The single "🎧 Contact Support"
action opens `MessagingCenter`, always framed as a conversation with **AshantiHub Support about**
a business or listing — never with the business itself. A `Conversation.subject` is kept as a
"Re:" context line, and every `Message.sender_type` is `customer`, `business_owner`, or `staff`.

WhatsApp is kept, unchanged, only where it points at AshantiHub itself rather than a third-party
business: the floating support bubble, the Contact page's `WABtn`, `NotFoundPage`'s support link,
the grocery-concierge order button (AshantiHub's own concierge), the referral share link, and the
business dashboard's "WhatsApp Update" button (a business notifying AshantiHub's support number).

**No fabricated data in the UI.** Where a backend field or endpoint doesn't exist, the UI says so
or renders nothing — it does not invent a value. Examples already settled: a rating row is hidden
entirely when `review_count` is 0 rather than showing 0.0; the business Analytics spend chart is
labelled "Your AshantiHub spend", not revenue, because an owner has no transaction row for sales;
there is no "payment type" or card-digits field for a customer because no payment-method model
exists; cancelling a promotion is explicitly not a refund, and the UI says so before confirming.
Keep this bar — prefer an honest empty state or a stated limitation over a plausible-looking mock.

## Area guidance

- `frontend/CLAUDE.md` — the no-`useMutation` mutation convention, the
  `components/**` must-never-import-`App.jsx` rule and the prop-threading that enforces it, the
  inline-`C`-palette styling rule and its `shadcn-scope` Tailwind exception, the paginated-vs-
  unpaginated hook split, the jsdom/Leaflet stubs, and the test files treated as contracts.
- `backend/CLAUDE.md` — the moderated-queue contract, the correctness cores (booking
  availability, effective staff permissions, payout masking, checkout stock reservation,
  owner-scoped order isolation, promotion expiry), and the pre-moderated-`Review` test-fixture
  gotcha.

## Planning & specs

`docs/` holds forward-looking architecture/implementation specs beyond what is built. Check the
relevant one before starting work in its area — they carry decisions already made, not just
background. These are **specs, not implemented state**; update them when code from them lands.

- `docs/PROJECT_SCOPE.md` — full phased roadmap (backend, auth, Hubtel payments, AI messaging,
  credit scoring, DevOps hardening)
- `docs/HUBTEL_INTEGRATION.md` — Hubtel payment integration spec. Payments in the app today are
  **simulated** (`MoMoPayment`); real Hubtel processing is future work.
- `docs/MOBILE_APP_SCOPE.md` — React Native (iOS + Android) scope. There is no mobile app yet, so
  the App Store / Play Store buttons in `components/ui/` are inert brand buttons.
- `docs/TOOLING_SETUP.md` — project agents/skills/plugins/MCP setup
- `docs/FRONTEND_MODERNIZATION.md` — Hero/Navbar redesign, componentization plan, React 19 path
- `docs/UI_MODERNIZATION_ROADMAP.md` — TypeScript + Tailwind v4 + shadcn/ui adoption, the
  `SiteSettings` backend, routing/theme/WhatsApp-removal/Business-tab work. Phases A–H are
  implemented.
- `docs/PWA_STAFF_DASHBOARD.md` — PWA spec for staff dashboards
- `docs/IMPLEMENTATION_INSTRUCTIONS.md` — master index, sequencing, and what is not done yet

## Design System

Always read `DESIGN.md` (repo root) before making any visual or UI decision. It is the source of
truth for palette, typography, spacing, layout, motion, and the trust-surface/anti-slop rules.
All font, color, and aesthetic direction is defined there — do not deviate without explicit user
approval. In QA/review, flag any code that doesn't match it.

`DESIGN.md` largely **documents** the system already in code (`frontend/theme.js` `C`,
`frontend/components/dashboard/theme.js` `D`, `frontend/index.css` shadcn tokens — the palette is
unchanged). The one active evolution it prescribes is **typography**: adopt **Fraunces**
(headings) + **Plus Jakarta Sans** (body/UI/data, tabular figures) + **JetBrains Mono** (codes),
retiring today's browser-default-serif / stray-Georgia / Geist split. The **verified-tier kente
band** is documented as a Phase-2 principle, not yet built.
