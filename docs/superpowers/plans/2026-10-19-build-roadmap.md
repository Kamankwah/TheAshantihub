# Build Roadmap — Marketplace Rebrand and Pending Wallet Work

Date: 2026-10-19. Hard date: marketplace opens **6 Nov 2026 06:00 Africa/Accra** (Plan M1 must be on staging, owner-approved, before then; production only on the owner's explicit say).

## Streams

| Id | Plan | File | State |
|---|---|---|---|
| W7A | Wallet rulings: settings, suggested defaults, Money rules page | plans/2026-10-18-wallet-rulings-7a-… | Built, branch `feature/wallet-rulings-7a` (4 commits, unpushed) |
| W7E | Milestone release and cancellation policies | …-7e-… | Written |
| W7C | Release, withdrawals, staff edits, OTP caps | …-7c-… | Written |
| W7D | Rider pay on refund, vendor texts, digest | …-7d-… | Written |
| W7B | Opening hours | …-7b-… | Written |
| M1 | Opening-day storefront | 2026-10-19-marketplace-1-… | Written |
| M2 | Business listing tools and Ashanti Direct | …-marketplace-2-… | Written |
| M3 | Staff listing pipeline (+ new General Manager role) | …-marketplace-3-… | Written |
| M4 | Product, cart, checkout and account pages, shopper wallet | …-marketplace-4-… | Written |
| F1–F6 | Wallet frontends 1F–6F (screens for the already-built wallet backends) | last table of each `2026-10-16-*` plan and `2026-10-15-ledger-fees-foundation.md` | Not started; no separate plan files yet |

No 7F or 8F exists in any plan: Plan 7 is live Hubtel (needs credentials and Bank of Ghana clearance), nothing is numbered 8. Confirm with the owner if something else was meant.

## Order and why

1. **W7A** — done; finish with whole-branch review and (when authorised) push.
2. **F2 (OTP screens) and F3 (wallet screens)** — M1 and M4 reuse the sign-in code entry, step-up prompt and wallet API screens; M4 stops if 2F is not merged. Write these two frontend plans first (they are defined in the 2F/3F table rows).
3. **M1** — the only date-bound work. Needs W7A's governed settings pattern; independent of the other wallet plans.
4. **M3 Task 0 (GM role) then M3** — needs M1's approvals only lightly; M2 reuses M3's maker-checker helper (`cannot_decide`), so do M3 Tasks 0–7 before M2 Task 2.
5. **M2** — needs M1 (opening gate, hero ads, price stub) and M3 helper.
6. **M4** — needs M1–M3 and F2/F3. Product, cart, checkout, account, shopper wallet.
7. **W7E, W7C, W7D, W7B** in that order (W7C Task 2 calls W7E's `sales.release_at`) — can interleave after M1 if capacity allows; none gate the 6 Nov opening because the ledger switches stay off until the owner turns them on.
8. **F1, F4, F5, F6** — remaining wallet frontends; each must ship before its switch is turned on (see each plan's closing table).

## Gates that stay closed

`LEDGER_ENABLED`, the OTP switches, `SOLD_OUT_HIDDEN_ENABLED`, `STOCK_ALERTS_ENABLED`, `SUBSCRIPTIONS_ENABLED` (1F registration step must ship before it is turned off) — each stays as it is until its frontend plan ships and the owner says so. Live Hubtel stays out of scope.

## Owner rulings recorded 2026-10-19

GM is a new role (Super Admin-like dashboard, reports to Super Admin, approves listings, never money items). Staff-listed events still need the organiser's visibility payment. Storefront: marketplace opens automatically; shoppers browse-only before opening; countdown takeover layout "A"; categories shown to shoppers only when they hold listings.
