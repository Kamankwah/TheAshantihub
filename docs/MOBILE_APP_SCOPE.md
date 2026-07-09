# Mobile App Implementation Scope — React Native (iOS + Android)

**Status:** Spec only — no project scaffolded yet. Referenced from `docs/PROJECT_SCOPE.md` §4/§6 as the "Parallel/after Phase 1" track.

**Owner agent:** `.claude/agents/mobile-engineer.md`

## 1. Relationship to the web platform

This repo (`TheAshantihub`) stays **frontend-only web**, per its existing `CLAUDE.md` architecture description. The mobile app is a **separate repository**, not a folder added here — it consumes the same backend API that `docs/PROJECT_SCOPE.md`'s Django/DRF Phase 1 work stands up. Mobile Phase 1 (browsing) can start against mock data in parallel with backend work, mirroring how the current web prototype was built — but real payments (Mobile Phase 2) cannot start until `docs/HUBTEL_INTEGRATION.md` is live, since there's only one Hubtel integration, shared by both clients.

## 2. Stack

- **Framework:** Expo (managed workflow + dev client), not bare React Native.
  - Why: EAS Build/Submit handles iOS/Android signing and store submission without a local Xcode/Android Studio toolchain for every build; push notifications, over-the-air updates, and native module access (maps, camera for listing photos) are all first-class in Expo's dev-client model.
  - Bare RN tradeoff: more control, no Expo SDK version lock-in — not worth it for this project's needs (no exotic native modules required).
- **Navigation:** React Navigation — bottom tabs mirroring the web's `page` states (home/events/about/profile), stack navigators for detail screens (business detail, chat thread), a drawer reserved for staff-only screens (mirrors the web's `isAdmin`/`showBizDash` staff surfaces).
- **State/data:** TanStack Query for server state (listings, transactions, messages) + Zustand for local UI state — avoid Redux Toolkit's boilerplate for a project this size.
- **Design system:** a shared theme package exporting the `C` color palette (`App.jsx:4-10`, plus the new `pureBlack`/`white` additions from `docs/FRONTEND_MODERNIZATION.md`) so both web and mobile draw from one source of truth instead of two copies drifting apart.

## 3. Code/design sharing with the web repo

- Shared theme/tokens package (the `C` palette) — smallest, highest-value share.
- Shared API client + TypeScript types, once the Phase 1 backend's OpenAPI/schema exists — generate a typed client from the DRF schema and publish it as a private package both repos install, rather than hand-writing fetch calls twice.
- Monorepo tooling (pnpm workspaces or Turborepo) is worth adopting **only if** a true monorepo is created later; until then, a small private npm package for shared theme/types is sufficient and lower-friction than merging this frontend-only repo into a monorepo.

## 4. Feature-phased roadmap

Mirrors the web backend's phases so mobile never gets ahead of what the API actually supports.

### Mobile Phase 1 — Browse & Auth
- Phone OTP + email/password auth (same backend endpoints as web Phase 1)
- Category browsing, listing search/filter, business detail screens
- WhatsApp deep-link contact (`wa.me`, same pattern as `handleWA`/`WABtn` on web) — no in-app contact form, consistent with the WhatsApp-first product decision in `CLAUDE.md`
- Can begin against mock/stub data in parallel with backend Phase 1, same approach the web prototype used

### Mobile Phase 2 — Payments & Business Tools
- Hubtel payments: WebView-hosted Checkout (matching the web's Checkout-first approach from `docs/HUBTEL_INTEGRATION.md` §2) — evaluate a native Hubtel SDK only if one exists and materially improves UX, otherwise WebView is sufficient and avoids duplicating the webhook/security work
- Business dashboard (subset of web's `BusinessDashboard`) for business-owner users
- Push notifications: Expo push service (wraps FCM for Android, APNs for iOS) for payment confirmations, new messages, admin approval status

### Mobile Phase 3 — Messaging, Credit, Staff Tools
- Real-time messaging once the backend's Channels/Redis upgrade (web Phase 2) ships
- Credit dashboard (read-focused subset of `CreditDashboard`)
- Staff/admin moderation tools — a deliberately reduced subset of the web `AdminDashboard`, not full parity (admin work is expected to stay primarily a desktop/PWA activity — see `docs/PWA_STAFF_DASHBOARD.md`)
- Offline caching for listings/messages (TanStack Query's cache + persistence)

## 5. Platform-specific considerations

- **Apple App Store:** external payment flows are generally fine for a services marketplace (lead-gen/booking, not digital goods sold in-app) — Hubtel Checkout via WebView should be permissible under App Store Review Guideline 3.1.5, but this needs a legal/compliance sanity check before Mobile Phase 2 ships, not an assumption baked in silently.
- **Google Play:** standard target-API-level policy compliance (Play requires targeting a recent API level at submission time — verify current requirement at submission, not from this doc, since Google's minimum shifts periodically); external payment links are less restricted on Android than iOS.
- **Push notifications:** Expo push service for both platforms is the simplest path; if push volume/requirements grow beyond what Expo's service handles well, revisit direct FCM/APNs integration later — not a Phase 2 blocker.
- **Permissions:** location (for map view, mirroring the web's `showMap`), camera/photo library (business listing photo upload) — request at point of use, not at app launch.

## 6. Testing & CI/CD

- **Unit tests:** Jest (Expo's default).
- **E2E:** Maestro (simpler YAML-based flows, lower maintenance than Detox for a small team) — recommended over Detox unless deep native-module E2E coverage becomes necessary.
- **CI/CD:** EAS Build for iOS/Android binaries, EAS Submit for store delivery, triggered from GitHub Actions on release branches/tags — mirrors the web repo's existing GitHub Actions + Vercel pattern conceptually, different toolchain.

## 7. Explicit dependencies and sequencing

- Mobile Phase 1 (browse/auth) can start as soon as backend Phase 1 auth endpoints exist (or even against stubs before that, same as the web prototype's original approach).
- Mobile Phase 2 (payments) is **hard-blocked** on `docs/HUBTEL_INTEGRATION.md` being live in production — do not build a second, parallel Hubtel integration for mobile; both clients hit the same backend payment endpoints.
- Mobile Phase 3 (real-time messaging) is blocked on the web roadmap's Phase 2 (Channels/Redis upgrade, `docs/PROJECT_SCOPE.md` §6).
- This is a **separate project timeline** from the web Phase 2-4 roadmap, not additive to it — the two can run concurrently once Phase 1 (web backend + Hubtel) is done, with different people/sessions owning each if the team grows beyond solo.
