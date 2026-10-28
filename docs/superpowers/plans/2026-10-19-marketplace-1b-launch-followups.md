# Marketplace Plan 1B: Launch Follow-ups (owner answers 2026-10-19) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the owner's answers to the open questions of Plan M1: notify-me text with the site link, self-hosted fonts, no public business contact phone, dark mode on every page. (Category mapping stays as built; hero video cap stays 25 MB for launch.)

**Architecture:** Extends the M1 storefront branch (`feature/marketplace-1-storefront`, PR #170). Notify-me texts live in the storefront notify app (find via `grep -rn "notify" backend/storefront`); fonts in `frontend/index.html`/`index.css`/`theme.js`; public listing serializers in `backend/listings/serializers.py` (`PublicListingSerializer`); theme in `frontend/theme.js` (`C`), `frontend/components/dashboard/theme.js` (`D`), the header toggle built in M1.

**Tech Stack:** Django/DRF, React (inline palette, `@fontsource` packages).

**Spec:** docs/superpowers/specs/2026-10-19-marketplace-rebrand-design.md; DESIGN.md (typography: Fraunces, Plus Jakarta Sans, JetBrains Mono; palette unchanged); CLAUDE.md product rules (businesses cannot be contacted directly).

## Global Constraints

- Notify-me text: one SMS (<= 160 chars GSM-7, no emoji), exactly "AshantiHub is open! Shop now: {FRONTEND_BASE_URL host}" built from `FRONTEND_BASE_URL`, never a hardcoded domain; the email keeps its own longer body with the same link.
- Fonts are bundled with the app (no request to fonts.googleapis.com or fonts.gstatic.com at any time), per DESIGN.md pairing, with Georgia / system fallbacks.
- `contact_phone` is removed from every PUBLIC response (listing list/detail, sponsored, deals, search, events, seller page, related/offers); owners and staff endpoints keep it. No other field is renamed.
- Dark mode: every customer, business and public page respects the theme toggle (light/dark, default follows the device) with readable contrast; prices on dark surfaces use `C.lightGold`; trust/verified marks stay green; no hardcoded white/cream backgrounds left outside the theme tokens.
- No fabricated data; frontend conventions in `frontend/CLAUDE.md`; run Vitest from `frontend/`.

## Review Focus

- The notify-me text for a recipient with an unreachable `FRONTEND_BASE_URL` (unset) falls back to a safe default and never sends a broken link.
- No external font request remains anywhere (index.html, index.css `@import`, theme.js, components with their own `<link>`/`@import`).
- A public API consumer cannot recover a phone from `contact_phone`, `phone`, `whatsapp` or nested business objects; owner/staff views unaffected; frontend never renders a business phone on public pages.
- Dark mode: modals, drawers, tables, forms, toasts and map/QR surfaces (not only page backgrounds) are readable; images with white backgrounds are not inverted.

---

### Task 1: Notify-me text with the site link

**Files:** Modify the notify-me sender (storefront app, message builder), Test beside its existing tests.

- [ ] **Step 1: Failing tests:** `test_text_is_the_agreed_wording_with_the_site_host`, `test_text_is_one_segment_gsm7`, `test_unset_frontend_base_url_uses_safe_default_and_never_a_broken_link`, `test_email_body_contains_the_same_link`.
- [ ] **Step 2: Run** `... test storefront` — Expected: FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** — PASS. **Step 5: Commit** `feat(storefront): notify-me text carries the site link`.

### Task 2: Self-host the fonts

**Files:** Modify `frontend/package.json` (`@fontsource-variable/fraunces`, `@fontsource-variable/plus-jakarta-sans`, `@fontsource/jetbrains-mono` at exact versions at least two weeks old), `frontend/index.css`/`main.jsx` imports, remove the Google Fonts `<link>`/`@import` added in M1 (ruling R27/R36) and any other; Test: `frontend/__tests__/no-external-fonts.test.js` (reads index.html, index.css and every source file for `fonts.googleapis.com|fonts.gstatic.com`).

- [ ] **Step 1: Failing test** `no source references an external font host`. **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** with the DESIGN.md stacks and `font-variant-numeric: tabular-nums` on numerals; `npm run build` must succeed and the CSP in `infra/` / `frontend/vercel.json` must not need the Google hosts (check and remove them).
- [ ] **Step 4: Run** test + `npm run build` — PASS. **Step 5: Commit** `feat(frontend): self-host fonts`.

### Task 3: Remove the public contact phone

**Files:** Modify `backend/listings/serializers.py` (`PublicListingSerializer` and any public/related/sponsored/deals/search serializers), `backend/events/serializers.py` public shapes, the seller page serializer from M2-style endpoints if present; frontend components that read it (`grep -rn "contact_phone" frontend/`); Test: `backend/listings/tests/test_public_no_phone.py`, frontend `__tests__`.

- [ ] **Step 1: Failing tests:** `test_public_listing_list_and_detail_have_no_phone_keys`, `test_sponsored_deals_search_and_related_have_no_phone`, `test_event_public_has_no_phone`, `test_owner_and_staff_endpoints_still_return_contact_phone`; frontend `listing page shows no business phone or tel link`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (separate owner/staff serializer where needed; do not break the owner dashboard or staff panels). **Step 4: Run** `... test listings events accounts` and the frontend tests — PASS. **Step 5: Commit** `fix(listings): never expose a business phone on public responses`.

### Task 4: Dark mode on every page

**Files:** Modify `frontend/theme.js` (`C`), `frontend/components/dashboard/theme.js` (`D`), the M1 theme toggle/hook, and every page/component that hardcodes light colours (find with grep for hex colours and `#fff`/`#FDF6E3`/`background:` literals outside the palettes; fix by token, not per-file one-offs); Test: `frontend/__tests__/theme.test.jsx` plus per-area smoke tests rendering key pages in dark mode (home, product/listing detail, cart drawer, account, business dashboard, staff shell) asserting no light-only hardcoded surface (a lint-style test scanning for banned literals outside the theme files with an allowlist).

- [ ] **Step 1: Failing tests:** `C and D resolve to dark values when the theme is dark and light otherwise`, `no component hardcodes a page background colour outside theme files (allowlist for brand marks and kente stripes)`, smoke tests per area.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** palette resolution at one place (CSS variables on `:root[data-theme]` consumed through the existing `C`/`D` objects so inline styles keep working), then sweep components in batches; keep screenshots/QR/map surfaces readable (dark card behind QR codes is not allowed: QR stays on white).
- [ ] **Step 4: Run** the full frontend suite and `npm run build` — PASS. **Step 5: Commit** per area: `feat(frontend): dark mode for <area>`.

### Task 5: Record the decisions

- [ ] Update the M1 plan's/spec's open questions (category mapping confirmed, 25 MB video for launch, notify wording, fonts self-hosted, contact phone removed, dark mode everywhere) in `docs/superpowers/specs/2026-10-19-marketplace-rebrand-design.md` under "Decisions from the builder check"; commit `docs: marketplace launch decisions`.
