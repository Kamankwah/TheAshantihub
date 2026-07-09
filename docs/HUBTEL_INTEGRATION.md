# Hubtel Payment Integration — Technical Spec

**Status:** Spec only — no code written yet. Scheduled as Phase 1, Days 8-13 in `docs/PROJECT_SCOPE.md` §5b.

**Owner agent:** `.claude/agents/payments-integration-engineer.md`

## 1. Why this doc exists

Payments in the current prototype (`App.jsx`) are **100% simulated**:

- `MoMoPayment` (`App.jsx:638-923`) — fake `setTimeout`-based "processing" → "success" flow, used from `PaymentDashboard` (line 950) and the business plan upgrade flow (line 2489).
- `MoMoModal` (`App.jsx:1816-1900`) — a second, near-identical simulated modal used on listing detail pay buttons.
- "Hubtel" appears only as descriptive copy (`App.jsx:1179`, `1877`) — no `fetch`/`axios` call, no API keys, no webhook, anywhere in the codebase.
- `MOMO_NETWORKS` (`App.jsx:610-621`) already models MTN MoMo / Vodafone Cash / AirtelTigo Money with fee (1.5%) and USSD codes — reuse this as the network picker source of truth, don't redefine it.
- `PaymentDashboard`'s transaction table currently reads `MOCK_TRANSACTIONS`-shaped data (ref, business, amount, plan, network, date, status, type) — the real implementation should produce records in this same shape so the existing UI needs minimal changes.

This doc is the integration spec for replacing the simulation with real Hubtel calls.

## 2. Product choice: Checkout API vs. Direct Receive Money API

| | Hubtel Checkout (hosted page) | Direct Receive Money API |
| --- | --- | --- |
| Integration effort | Low — redirect + webhook | Higher — in-app PIN prompt flow, more edge cases |
| UX | Leaves the app briefly (or opens in a WebView) | Stays fully in-app, closer to current `MoMoModal` UX |
| PCI/compliance surface | Minimal (Hubtel hosts card entry) | Still minimal for MoMo, higher if adding card support directly |
| **Recommendation** | **Use for Phase 1 (Days 8-13)** — fastest path to a real, working ledger | Fast-follow once Phase 1 is stable, to restore full in-app UX parity with today's `MoMoModal` |

Phase 1 ships Checkout. The Direct API fast-follow is out of scope for Days 8-13 but should be tracked as a Phase 2/3 nice-to-have, not silently dropped.

## 3. Backend surface needed

This assumes the Phase 1 Django/DRF backend (per `docs/PROJECT_SCOPE.md` §3) exists — Hubtel integration cannot be done client-side only; secrets and status verification must live server-side.

- `POST /api/payments/checkout/` — creates a Hubtel Checkout session for a given `{business_id, plan_or_listing_fee, amount}`, returns the Hubtel-hosted checkout URL for the frontend to redirect/open.
- `POST /api/payments/webhook/hubtel/` — receives Hubtel's payment status callback. This is the source of truth for whether a payment succeeded, **never** the frontend's redirect-return state.
- `GET /api/payments/transactions/` — backs `PaymentDashboard`'s table, returns records in the existing `MOCK_TRANSACTIONS` shape (ref, business, amount, plan, network, date, status, type) so the frontend swap is close to a drop-in data-source change.

## 4. Webhook design (the part most likely to be gotten wrong)

- **Signature verification:** every inbound webhook call must be verified against Hubtel's signature/HMAC scheme before the payload is trusted — reject unsigned or mismatched requests with 401, do not process them.
- **Idempotency:** Hubtel may retry a webhook delivery. Key processing off the Hubtel transaction reference (`ref` field, matching the existing `MOCK_TRANSACTIONS` shape's `ref: "MTN240601001"`-style identifier) — an already-processed ref is a no-op 200, not a duplicate ledger entry.
- **Retry/replay safety:** log every raw webhook payload (for reconciliation and dispute handling) before acting on it; make status transitions monotonic (e.g. `pending → success` is valid, a late `pending` after `success` is ignored, not reverted).
- **Amount verification:** always re-verify the webhook's reported amount against the amount the checkout session was created for server-side. Never trust a client-supplied amount at any point in the flow.
- **Rate limiting:** the webhook endpoint is public (Hubtel calls it from the internet) — put it behind rate limiting / IP allow-listing if Hubtel publishes stable source IPs, and make sure it's excluded from any auth-required middleware since Hubtel isn't an authenticated app user.

## 5. Environment variables / credentials

| Variable | Purpose |
| --- | --- |
| `HUBTEL_CLIENT_ID` | Hubtel API client identifier |
| `HUBTEL_CLIENT_SECRET` | Hubtel API secret — server-side only, never shipped to the frontend |
| `HUBTEL_MERCHANT_ACCOUNT` | Merchant/POS account number for checkout session creation |
| `HUBTEL_WEBHOOK_SECRET` | Used to verify inbound webhook signatures |
| `HUBTEL_CALLBACK_URL` | Public HTTPS URL Hubtel calls on payment completion — must be live on the VPS before Day 9 (checkout integration) starts |

Sandbox and production credential sets are separate — Day 8 (per `docs/PROJECT_SCOPE.md` §5b) sets up sandbox only; Day 13 is the production cutover. Do not hardcode either into source — both are `.env`-only per the existing DevOps convention in `docs/PROJECT_SCOPE.md` §7.

## 6. Mapping to existing UI surfaces

| Existing mock code | Real replacement |
| --- | --- |
| `MoMoPayment`'s `setTimeout` "processing"→"success" (`App.jsx:642-644`) | Redirect to Hubtel Checkout URL from `POST /api/payments/checkout/`; poll or wait for webhook-driven status update |
| `MoMoModal`'s equivalent simulated flow (`App.jsx:1821-1822`) | Same real checkout flow, second entry point |
| `PaymentDashboard` overview stats (`App.jsx:994-1015`) | Computed server-side from real transaction records, not mock counts |
| Automated WhatsApp payment reminders (`App.jsx:1188-1226`) | Unchanged — these stay `wa.me` deep links per the WhatsApp-first product pattern (`CLAUDE.md`); only the underlying transaction data they reference becomes real |
| `MOMO_NETWORKS` (`App.jsx:610-621`) | Reused as-is as the network picker source of truth |

## 7. Forward dependency: credit scoring

`CreditDashboard`'s `SCORE_FACTORS` (`App.jsx:31-38`) already weights **"Listing Fee Payment History" at 20%** — this factor is currently unscored (Phase 1 credit scoring v1 is explicitly payment-blind per `docs/PROJECT_SCOPE.md` §5a). Once this integration ships, real payment history exists and should feed that factor — that wiring is Phase 3 (credit scoring v2) work, not built as part of this spec, but noted here so Phase 3 doesn't have to rediscover the connection.

## 8. Security checklist

- [ ] Never trust client-reported payment status — only the verified webhook updates ledger state.
- [ ] Verify all amounts server-side against the original checkout session, not the webhook payload alone.
- [ ] Verify webhook signatures on every request; reject unsigned/invalid ones.
- [ ] Log all raw webhook payloads for reconciliation and dispute handling.
- [ ] Rate-limit and/or IP-scope the public webhook endpoint.
- [ ] Keep `HUBTEL_CLIENT_SECRET`/`HUBTEL_WEBHOOK_SECRET` server-side only — audit that no debug logging or error response ever echoes them.
- [ ] Sandbox-test all three MoMo networks (MTN, Vodafone Cash, AirtelTigo) before the Day 13 production cutover — network-specific failure modes are common with Hubtel aggregation.
- [ ] Run this endpoint set through the Semgrep MCP (see `docs/TOOLING_SETUP.md`) before go-live.
