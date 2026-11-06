# Self-serve onboarding: no subscriptions, pin-based location, automatic listing checks

Status: **design for approval** (2026-11-05). Not built. Written from the owner's brief of 2026-11-05 and a read of the code on
`righteoushack` (`3cfbf205`). Items marked **(my call)** are the author's decisions, not the owner's.

## 1. Why

Businesses are blocked on three things that need no human judgement:

1. **A subscription cap.** Subscriptions were retired as a business model (platform fee replaces them), but `SUBSCRIPTIONS_ENABLED`
   defaults to **on** (`backend/ashantihub/settings.py:327`). While on, a business with no active plan cannot create a listing
   (`listings/serializers.py:645`) and a plan's `max_active_listings` caps it. This is the "5 products" complaint.
2. **A Ghana Post code that is checked by format only, and too strictly.** `accounts/gps.py:19` accepts only `AK-039-5028`
   (dashes, upper case); the sign-up form repeats it (`BusinessRegistrationFlow.jsx:141`). `AK0395028` or `ak 039 5028` is
   told it is wrong. It never confirms the address is real (`GPS_REMOTE_VALIDATION` is off) and it cannot place the shop on a map.
3. **People in the loop for routine decisions.** A listing cannot be approved until the owner is KYC-verified
   (`listings/views.py:1073`); KYC rests on an address decision that needs the owner's 50 m phone fix, a signboard photo and a
   video call, or a scout visit (`accounts/address_verification.py`); then a staff member approves each listing. Nothing inspects
   the photo.

The owner's goal: a business registers, is live the same day, lists without limit, and a person looks only at what the system
cannot decide. Money stays safe because **withdrawal, not listing, is gated on identity**.

## 2. Goals, non-goals, anti-goals

**Goals**
- No subscription anywhere: no switch, plans, caps, renew banners, or registration step.
- One location truth: a **coordinate pin** captured on the phone at the shop. Dispatch, scouts and maps read the pin.
- A business is live after registering, confirming its email and sharing its shop location. Ghana Card is never needed to list.
- A listing that passes automatic checks is published at once; one that fails gets plain reasons to fix; only ambiguous cases reach a person.
- Ghana Card + staff approval is required before a first payout (kept as built), nothing else.

**Non-goals**
- Generating a Ghana Post digital address ourselves (see §4.4). Real Hubtel SMS and ML/NSFW image moderation: later.
- Changing fee rules, wallet/escrow, or the customer "no direct contact with businesses" rule.
- Deleting subscription tables or history (data is kept; only code and UI go).

**Anti-goals (a failure even if it works)**
- A fake or stolen business reaching a customer's money. Mitigation: escrow plus identity-gated withdrawal (§5).
- A check that rejects honest vendors with phone cameras for a reason they cannot fix. Every refusal states what to change.
- Showing "verified" for something nobody verified. Self-reported location is labelled as such (CLAUDE.md: no fabricated data).

## 3. Subscriptions: remove completely (Phase 1 then Phase 5)

Finish the four open backend gates recorded in `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` §13 (Plan 1F),
then delete the switch rather than leave it off:

- (a) `billing.clock.subscription_state` must not derive "overdue" with no plan (`billing/clock.py:383`); `marketing/featured.py`
  must stop adding a `subscription_overdue` blocker and owners must see no renew banner.
- (c) the moderation check `_subscription_check` ("No subscription.", `listings/moderation_checks.py`) is removed.
- (d) a business the clock once paused stays visible: `hidden_business_q` already ignores pause unless
  `SUBSCRIPTION_PAUSE_ENABLED`; that flag is removed too and a test pins "paused row is public".
- (e) drafts work before `business_kind` is set (`accounts/models.py:408` ordering of registration steps).
- Delete: the `plan_selection` step, the listing-creation subscription and cap rules, `lifecycle.restore` cap, `active_listing_cap_reached`,
  billing purchase/renew/trial endpoints and the owner plan UI (web and mobile). Keep `business_kind` selection as its own step.
- Plan perks (hero days/slots, boost credits) disappear with plans; promotions are bought individually (existing promotion purchase). **(my call)**
- Sequence: Phase 1 makes the code correct with the switch off and runs it that way on staging; Phase 5 removes the dead code after one
  clean release. Nothing is deployed to production without the owner's word.

## 4. Location: the pin is the address

### 4.1 Standard being followed
Coordinates (WGS 84 latitude/longitude, with accuracy in metres) are the source of truth for delivery and mapping; a street or
postal-style address is only a label (the model Uber, Bolt, Glovo, Jumia and Google Maps use). Where a country has no street grid, a
short code derived from coordinates (Plus Code / Open Location Code, an open standard) is the human-readable fallback.

### 4.2 Business location capture
- At registration the owner shares the shop location from their phone at the shop. This reuses `LocationCapture` / `location_capture.py`
  (inside the Ashanti box, `ASHANTI_LAT/LNG`; accuracy 50 m or better counts as "device fix"). The owner can drag the pin on the map to the door;
  a dragged pin is marked `manual`.
- The app shows the pin on a map, reverse-geocodes a suggested label (Mapbox, already integrated), and stores: lat, lng, accuracy,
  who/when, `location_is_manual`, the Plus Code (computed locally, no network), and a free-text landmark.
- Ghana Post code becomes **optional**. Real codes can carry letters in the number groups (owner's screenshot of the GhanaPostGPS app: `AO-T010-3560`), so the format is 2 letters, then 3-4 letters-or-digits, then 4 letters-or-digits. Input is normalised leniently (strip spaces/dashes, upper-case, reformat to `AK-039-5028`; no character is ever converted);
  the "begins with A" Ashanti rule stays. A well-formed code never blocks go-live. If a lookup service is configured it only
  cross-checks: pin more than 500 m from the code's coordinates raises a flag for scouts, never a refusal. **(my call)**

### 4.3 Verification becomes tiered, not a gate
| Level | How reached | Shown as | Effect |
|---|---|---|---|
| Located | device or dragged pin inside Ashanti, not a duplicate within 25 m of another business (flag, not block) | "Location shared by the owner" | Business is live (§5) |
| Verified | scout visit confirms (or video call, as built) | "Verified location" tick | Higher new-seller limits, promo eligibility |
| Wrong | scout or staff mark it wrong with a reason | owner is told, listings stay up for 7 days then hide until re-shared **(my call)** | |

Scout visits stay but are **scheduled work, not a gate**: every new business enters a scout queue (zone-routed) and is visited within
a target window set in settings. `address.verify` and the maker-checker rule remain for the decision itself.

### 4.4 Can we generate the Ghana Post code?
Not reliably. A search on 2026-11-05 found no published Ghana Post algorithm or official developer API; only third-party wrappers
(for example [Dojah](https://docs.dojah.io/docs/ghana/validate-digital-addresses.md)) whose data source is unconfirmed. Guessing a
code would put a made-up address in front of riders. So: the pin is generated by the app, the Plus Code is generated by the app, and
the Ghana Post code is something the owner may type or paste. Owner action (not engineering): ask Ghana Post for partner API access;
if granted, the lookup in §4.2 is switched on.

### 4.5 Dispatch and customers
- A pickup stop is the business pin; a drop-off stop is the customer's pin. `routing/` and `delivery/` already read lat/lng; the work is to
  make the pin mandatory and trusted, and to give the rider a one-tap "Navigate" link built from coordinates (`geo:` / Google Maps / Waze).
- Customer delivery address = pin (device fix or dragged) **or** a valid Ghana Post code, plus landmark/directions and phone. Today a
  GhanaPost code plus landmark is required (`CustomerAddress`, CLAUDE.md shopper limits); this relaxes the code, keeps the landmark.
  Store pickup needs neither, unchanged. **(my call: relaxes a settled rule, listed in §9)**
- The delivery fee is still computed from the pin-to-pin road distance (OSRM), not from the code.

## 5. Go-live and money

Registration order: account (phone + email) → business type (`business_kind`) → shop location pin → terms → **live**.
- **Email confirmation** is required to publish (a link; mail transport is live on Stackmail). Phone OTP is added to the same gate
  when Hubtel SMS is live; until then it is not required. **(my call)**
- The Ghana Card, certificate, TIN and payout details are collected later from Profile & Settings. They are **never** required to list.
- **Withdrawal gate (kept as built):** `wallets/destinations.py` already refuses a payout account until identity is approved
  (`kyc_required`). Sales accrue to the business wallet and wait; the dashboard says "Verify your Ghana Card to withdraw".
  The registration `payment_info` step stops being a go-live blocker.
- `BusinessOwner.kyc_status` stops meaning "may list". Listing publication and `ModerationApproveView`'s KYC check no longer read it;
  it keeps meaning identity/address approval for payouts and the verified badge. Needs a clean field/semantics split in the plan.

Why this is safe: customers pay AshantiHub (escrow), the vendor is paid only after delivery is verified, and cash-out needs a
verified Ghana Card, so an impostor can list but cannot take money out. This is the Stripe Connect / Bank of Ghana tiered-KYC
pattern: onboard instantly, collect identity before payout, risk-based checks over blanket manual review.

## 6. Listing checks and instant publish

Runs when the owner presses Publish (synchronous for cheap checks, a Celery task for image analysis; the UI shows "checking" for seconds).
Outcomes: **Pass** → published immediately. **Fix** → stays draft with itemised, plain reasons and one-line tips. **Flag** → published or held
by rule below and put in a small "Needs a look" queue owned by Operations (not Super Admin) with a target time.

| Check | Applies to | Rule (thresholds in site settings, **my call**) | Result |
|---|---|---|---|
| Photo size | all | main photo at least 800×800 px; at least 3 photos for goods | Fix |
| Sharpness / exposure | all | Laplacian variance and mean brightness within bounds | Fix |
| White background | goods only (not food, services, stays, events) | after the automatic clean-up of §6a: at least 90% of a border strip near-white and low colour; subject fills 40–95% of the frame | Fix |
| Description | all | name 3+ chars, description 40+ chars, price > 0, category valid, product answers (warranty/expiry/returns) | Fix |
| No contact details | name, description | reuse `moderation_checks.contact_details_in` (no-direct-contact rule) | Fix |
| Duplicate image | goods | perceptual hash within a small distance of another business's photo | Flag (held) |
| Prohibited terms | all | maintained word list | Flag (held) |
| Price outlier | goods | beyond a multiple of the category median | Flag (published, queued) |

Edits to a published listing re-run the same checks and apply at once if they pass (replaces the revision approval for routine edits).
After publish: customer reports; N distinct reports hide the listing pending a look; the first listing of every new business is
queued for an after-the-fact spot check (does not block). A seller can ask for a human look at any Fix (appeal), which goes to the queue.
Existing hero/promotion checks and their approvals are unchanged.

Image analysis is deterministic (Pillow/numpy, no third party), so every refusal is explainable and testable. Known risk: strict white-background
and 3-photo rules will fail some honest vendors; pass/fail rates are logged per rule so thresholds can be tuned from data after opening.

## 6a. Automatic background clean-up (goods photos)
The owner no longer has to retake a photo with a non-white background: on upload the system removes the background and places the
product on pure white, centred and consistently sized, then runs the §6 checks on the result. The original is always kept.
- **Engine (my call):** a self-hosted open-source segmentation model (rembg with IS-Net, ONNX, CPU) in the Celery worker. No per-photo cost and
  photos stay in-house. A paid service (remove.bg, Photoroom) is the fallback if quality or server load disappoints. Licences and the
  server's memory/CPU headroom are confirmed in the plan.
- **Spike result (2026-11-05, six public kente photos, IS-Net on CPU, about 2-3 s each):** good on a cloth worn or draped on a mannequin
  against a backdrop (clean edges, fabric intact). **Destructive on flat cloth that fills the frame, or a pile of cloth:** with no background
  to remove, the model erased most of the cloth (2% to 9% of pixels kept on three of six photos).
- **Guard (required):** if the cleaned result keeps less than about 30% of the original's pixels, or the subject touches most of the frame
  edges, the clean-up is discarded and the original is used. A flat-lay with no background is then judged on size, sharpness and detail only
  (no white-background rule), because there is nothing to clean. Thresholds are settings.
- **Owner sees before and after** and picks the cleaned or original image; a cleaned image that fails a check is never published silently.
- Applies to option photos (§6b) too. Original and cleaned files are both stored; the public site serves the chosen one.

## 6b. Same product, several designs: option photos
Variants already exist (`ListingVariant`: label, price, sale price, stock; up to 40; picker on the product page). Change: each option may carry
one optional photo. Picking an option swaps the main image on the product page, and the cart and order lines show that photo. When a
business publishes a listing whose name is very close to another of its own listings, the form suggests adding it as an option instead
(a suggestion, never a block). Existing duplicate listings are **not** merged (owner's decision 2026-11-05).

## 7. What people still decide (management by exception)
Super Admin: fee settings, staff, overrides, maker-checker on money. Operations: the "Needs a look" queue and scout scheduling.
General Manager: reports and rulings. Scouts: location visits. Support: customer cases. No one approves a routine business or a routine listing.

## 8. Phasing (each phase gets its own plan; each ships to staging first)
1. **Subscriptions off + lenient code parsing.** Gates (a)(c)(d)(e); switch off on staging; normalise Ghana Post input on web and mobile.
2. **Pin at registration + go-live rules.** Pin capture/dragging, Plus Code, tiers, email confirmation, decouple listing from `kyc_status`, payout step moved after go-live, scout queue.
3. **Automatic listing checks.** Check engine, background clean-up with guard, option photos and duplicate-name suggestion, settings, instant publish, "Needs a look" queue, reports, spot check, backlog run over the current pending queue.
4. **Pins in dispatch and customer addresses.** Mandatory pins, navigate links, customer pin-or-code, rider app.
5. **Cleanup.** Delete subscription code, UI and the two env flags; retain data.

Marketplace opens browse-only on 6 Nov 06:00 Accra with wallet/ledger switches off; none of this is required for opening. Phase 1 is small
enough to ship before it if the owner asks; the rest follows after.

## 9. Rulings this design changes
- "GhanaPost code plus landmark required for door-to-door delivery" (CLAUDE.md) → pin or code, plus landmark.
- "KYC gates listing" (Director/PR #193 behaviour) → KYC gates payout and the verified badge only.
- Plan perks (hero days/slots, boost credits) end with plans.
- CLAUDE.md and `docs/IMPLEMENTATION_INSTRUCTIONS.md` must be updated when each phase lands.

## 9a. Calls made after the builder check (all **my call**, open to override)
- **Existing data.** At the Phase 2 rollout, existing businesses that already have a pin go live; those without one are asked to share it and
  stay hidden until they do. At the Phase 3 rollout the current `pending_review` queue is run through the new checks: Pass publishes,
  Fix returns the listing to draft with reasons and a notice, Flag goes to the "Needs a look" queue. That bulk run is its own explicit
  step that waits for the owner's go-ahead on each environment.
- **Abuse limits.** Throttle registration per IP and per phone/email; one phone and one email per business already hold (unique). Until a
  business is **Verified**: at most 20 new listings a day (a fraud velocity limit, not a product cap; none exists today and it is built in
  Phase 3), and first-listing spot check as in §6. Lifted by the scout visit.
- **"Wrong" location.** Owner is told with the reason and may re-share any time. Listings hide after 7 days if still wrong. Open orders
  finish as normal; escrow and wallet are untouched. Staff who may mark it wrong are those holding `address.verify`.
- **Pin changes.** Versioned: every capture is kept (`LocationCapture` history). The pin wins over the Ghana Post code. Moving the pin
  more than 50 m resets Verified to Located. An order snapshots the pickup and drop-off pins at checkout; a later change never
  re-routes a live delivery.
- **Targets.** Scout visit within 7 days of going live; "Needs a look" decided within 4 working hours. Both are settings. If scouts cannot
  keep up, "Located" is a legitimate long-term state: the badge, limits and promo eligibility degrade gracefully, nothing blocks.
- **Edits.** Every edit to a published listing (name, price, category, photos) re-runs all checks; a price drop of more than 50% is a Flag.
  Hero media and paid promotions keep their existing approvals.
- **Photos.** Checks run server-side on the stored original, never on a client-resized copy; the mobile app uploads originals at
  1200 px or more on the long edge. Image analysis runs in a Celery task (production and staging have the worker; local runs in-process).
- **Customer pin.** Must fall inside the Ashanti box and carry accuracy; the delivery fee is computed on the server at checkout from
  the stored pin, so moving the pin afterwards changes nothing. A rider can report "pin wrong", which opens a Support case.

## 10. Left to the builder
Exact thresholds and defaults; Plus Code library choice; map and reverse-geocode provider calls and caching; queue UI layout; the data
migration that retires `plan_selection`; wording of every refusal and tip; test fixtures; mobile parity for each web change.

## 11. Phase 2 as built (branch feat/self-serve-phase2)

What shipped, in the order it was built:
- **Email confirmation.** Mailed bearer link (hashed token, single use, 48 h, 5 a day, in the URL fragment); `otp.VerifiedContact` marks the
  confirmed address. Web page `/confirm-email`; a banner with Resend on the web dashboard and mobile home.
- **Go-live rule** (`backend/accounts/golive.py`): confirmed email, shop pin, business type, accepted terms. KYC-verified businesses and the
  company owner are grandfathered live. `me` carries `go_live`; listing submit answers 403 `not_live` and staff approve 400 `not_live`.
  `kyc_status` readers other than those two doors (promo waivers, flash sales, offers, staff-made drafts, insights, hero/promotion
  check lists) were left alone; `identity_status` still gates payouts.
- **Shop pin step** at registration on web (`ShopLocationStep`) and mobile, with device location or a hand-placed pin (`manual`), an optional
  landmark, a computed Plus Code (not stored) and a tier label. The self-registered chain is now business info, shop location, plan/type,
  terms; `payment_info` left it.
- **Co-location notice**: another business within 25 m raises a staff notice, never a refusal.
- **Scout/address queue** already kept live, KYC-pending businesses; Task 5 only added tests.
- **Minimal auto-publish** (`listings/autopublish.py`) behind `LISTING_AUTO_PUBLISH_ENABLED` (off), with `LISTING_PROHIBITED_TERMS` and
  `UNVERIFIED_DAILY_LISTING_LIMIT` (20): pass publishes, fix returns 400 `needs_fixes`, hold goes to the queue; the first listing raises a
  spot-check case. This is the small subset of section 6 only (size, description, category, contact details, prohibited terms, daily limit);
  sharpness, white-background, duplicate-image and price-outlier checks, and the clean-up of 6a, are still Phase 3.
- **Wrong location hides a business after 7 days** behind `WRONG_LOCATION_HIDE_ENABLED` (off), plus the read-only
  `list_wrong_location_businesses` dry run, which must be read before the switch is turned on.

Differences from the spec:
- The 25 m co-location flag uses `FraudFlag.OTHER` (not reversing, not suspendable), not `SIMILAR_NEARBY`, so a shared market pin can never
  reverse a scout's commission. Each pair is raised once ever, at most 3 per capture, and not when the pin did not move.
- "Submitted today" for the daily limit counts listings by `updated_at` (there is no submitted-at column). It can hold a listing early for a
  business that edits many published listings in one day; it never lets one through.
- The mobile screen is `mobile/src/app/(auth)/register/shop-location.tsx`, beside the other `/register/*` steps.
- Email is now required on web and mobile business sign-up (the spec had it optional at registration), because nothing in the app lets an
  owner add one later.
- The registration `payment_info` step is dropped from the self-registered chain only; the scout-registered chain keeps it.
- Auto-publish is a subset of section 6 (above), not the Phase 3 engine.

Known gaps:
- A phone-only business owner (created through the web `AuthModal`, `frontend/App.jsx`, which still allows a business owner without an email)
  sees `email_missing` and has no in-app way to add an email; they need staff help or a later "add email" endpoint. Owners registered
  phone-only before this change are in the same position.
- Staff screens show a wrong-location-hidden listing as hidden without saying why.
- Nothing tells the owner when the 7 days elapse, and owners already marked wrong before the switch is turned on get no warning (the dry run is
  the mitigation).
- Device checks owed: marker drag inside the mobile `ScrollView`, the Android Google Maps key, and a real inbox for the confirmation email.
- Backend, web and mobile must ship together: a pinless self-registered owner on a client without the `shop_location` step would be stuck.
- Delivery is unchanged: "pin or code" for customers is Phase 4.

