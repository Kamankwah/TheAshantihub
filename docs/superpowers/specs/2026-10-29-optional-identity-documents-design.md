# Optional identity documents and the verified check mark — design

Date: 2026-10-29. Status: draft for the owner's approval.

## Why

Businesses push back on registration because the Ghana Card (number and both photos) and the
business registration certificate are mandatory. Registration should ask only for what is needed to
list: the business's details and its Ghana Post address. The documents become something a business
**chooses** to provide to earn a "verified" check mark on its products.

## What the owner decided

- The Ghana Card and the business certificate can be left out at registration.
- **KYC approval rests on the business address only.** Documents no longer gate it.
- A business that uploads its documents and has them approved gets the verified check mark on its
  products. Nothing else gives the check mark.
- **Customers are untouched.** They have no Ghana Card flow today and get none.

## Today (what the code does)

`BusinessOwner.kyc_status` (pending / verified / rejected) is one switch that means both "address
and documents checked". It is read in two kinds of places.

*It means "the business is approved to list"* (stays on `kyc_status`):
- `ModerationApproveView` (`listings/views.py`) refuses to publish a listing whose owner is not
  verified; `listings/moderation_checks.py` `_kyc_check`.
- The business dashboard gates its tabs on `kycStatus === "verified"`
  (`BusinessCommandCenter.jsx`); `ProfilePanel.jsx`.
- Staff reports and funnels that count KYC outcomes (`targets/`, `insights/`, `accounts/views.py`
  stats): they count approvals, not identity, and are left alone.

*It means "this business's identity is proven"* (must move to the new identity status):
- The public check mark and filter: `BusinessOwnerMiniSerializer.kyc_status`, the
  `?verified=true` listing filter (`listings/views.py`), `catalogue/offers.py` (`featured`,
  `offer_row.verified`), `marketplace/events.py`, `messaging/context.py`, and the frontend
  `FeaturedRow.jsx`, the "Verified businesses only" toggle in `Sidebar.jsx`.
- `credit/scoring.py` (`kyc_verified`, 30% of the score) and its labels (`dashboard/theme.js`,
  `CreditPanel.jsx`).
- `wallets/names.py`: a payout destination is accepted only if the provider's account name matches
  the owner's *verified* name, and for a business that is "KYC-verified".

Documents are required in: `BusinessOwnerProfileUpdateSerializer.validate` (card number; certificate
and TIN when `is_formal`), `BusinessOwner.compute_registration_step` (`business_info` step),
`BusinessRegistrationFlow.jsx` (inputs marked `required`, the card-number check in `submit`), and the
scout path (`ScoutRegistrationSerializer` / `portfolio/registration.py`, which requires
`ghana_card_front`, and `RegisterBusinessPanel.jsx`).

## Design

### 1. Two statuses

- `kyc_status` keeps its meaning: the business address (and details) are checked, the business may
  publish. It no longer depends on documents.
- A new **identity status** on `BusinessOwnerProfile`: `not_submitted` (default), `pending`,
  `verified`, `rejected`, with the rejection reason the owner sees and the reviewer and review time
  (the moderated-queue contract in `backend/CLAUDE.md`).
- The public listing seller shape keeps `kyc_status` (cached or older clients still read it) and
  adds an identity boolean; the frontend's check mark, filter and featured row read the new boolean.
- The verified check mark, the "verified only" filter, featured-offer eligibility, the credit
  `kyc_verified` factor and payout-name matching all read **identity verified**. Nothing else
  reads it.

### 2. Registration

- Ghana Card number, both card photos, certificate and TIN are optional everywhere: the owner form,
  the server serializer, `compute_registration_step`, and the scout registration (form and server).
  `is_formal` stays a choice; saying "formally registered" no longer forces a certificate or TIN at
  registration.
- `ghana_card_number` is `unique`. A blank value must be stored as `NULL`, never `""`, or the second
  document-less business collides with the first.
- Still required: business details, contact phone, and a Ghana Post address in the Ashanti Region.
- The duplicate check (`portfolio/checks.py`) must tolerate a missing card number.

### 3. Address decides KYC

Every business needs a recorded Ghana Post address decision before KYC approval, through both doors
(`kyc.address_decision_missing`). Today only scout-registered or field-corrected businesses do; the
address is now the only thing KYC checks, so it applies to all. *(Owner's guess to confirm.)* The
submitter-never-decides rules (`kyc.is_kyc_submitter`) are unchanged. No new screen: the KYC review
sheet already has the address buttons (`POST kyc/{id}/address-verify/`, `kyc.approve`), so for a
self-registered business it is one extra click before Approve. Businesses already pending with no
decision simply wait for that click; no backfill.

### 4. Getting the check mark

- The business dashboard gets a "Get verified" section where the owner submits the card number and
  both photos, and the certificate and TIN when the business is formal. It works whether KYC is
  pending or verified, so it is **its own endpoint**; the existing profile PATCH stays locked once
  KYC is verified.
- Submitting sets identity `pending`. A resubmission after rejection is allowed and sets `pending`
  again.
- The existing KYC queue and review sheet keep showing the card and certificate when present (and
  their absence plainly, never a placeholder); approve/reject there decides the address-based KYC
  only. Identity is reviewed in the KYC queue too (same permission as KYC, a separate tab or filter). Approve sets
  `verified` and notifies the owner; reject needs a reason, shown to the owner. The same
  "submitter never decides" refusal applies. Both write activity events.
- Once `verified`, the owner cannot swap the documents; changing them goes through Support as the
  profile already says.

### 5. Existing businesses

A data migration keeps everyone's mark: **every** owner with `kyc_status = verified` becomes identity
`verified` (staff approved them when documents were mandatory, including scout-registered, corrected
and seeded ones, so no one who shows a mark today loses it, nor the credit factor). Owners with KYC
pending that already uploaded the card (number and both photos) become identity `pending`. Everyone
else, rejected-KYC included, is `not_submitted`. The same migration turns any stored `""` card number
into `NULL` (the unique column can hold at most one `""`, so there are no duplicates to resolve).

### 6. Honest copy

Replace claims that are no longer true: "Every listing checked against Ghana Card" (`Hero.jsx`), the
credit tip and factor description, the profile note. A business without a check mark just shows no
mark; no "unverified" warning label (the UI says nothing invented). The vendor wallet explains, when
it applies, that a withdrawal account needs a verified identity.

## Goals

- Registration finishes without any document.
- Only staff-approved documents produce the check mark.
- No existing check mark disappears.

## Non-goals

- Customer verification or any customer Ghana Card flow.
- Automatic Ghana Card checks against a government service.
- Changing the rule that a listing is published only after KYC.
- Document expiry or re-verification.

## Anti-goals (a failure even if it "works")

- A business shows the check mark without staff approving documents.
- A blank card number crashes a second registration (unique constraint).
- The Ghana Card number or any photo reaches a public response.
- The vendor payout rule is loosened: an unverified identity must not be able to add a withdrawal
  account. (Behind `LEDGER_ENABLED`, off today, so nothing changes for users yet.)

## Constraints

- Follow `backend/CLAUDE.md` and `frontend/CLAUDE.md` (no `useMutation`, inline `C`/`D` palettes,
  `components/**` never imports `App.jsx`, moderated-queue contract, `DESIGN.md`).
- Tests first; run Vitest from `frontend/`.
- Ship to staging only. Production promotion waits for the owner's explicit word.
- Update `backend/CLAUDE.md`'s KYC note in the same change.

## Calls made without the owner (confirm or change)

1. Address decision required for every business (section 3).
2. Payout-name matching for businesses requires identity verified (section 1); it blocks adding new
   withdrawal accounts only, existing ones stay. With the ledger off there is no visible effect yet.
3. Scout registration follows the same optional rule.
4. TIN is optional with the certificate: both are asked for only when submitting for the mark, and
   only if the business is formal.
5. Rejected-KYC businesses start at identity `not_submitted` (they can submit from the dashboard).
6. A business with KYC verified and no identity can publish; its listings simply carry no mark and
   are excluded from "verified only" and featured offers.
7. Every KYC-verified business keeps its mark at migration (section 5).

## Left to the builder

Field and endpoint names, the staff review layout, how the public listing response exposes the
check mark (a boolean beside or replacing `kyc_status`), the shape of the migration, and test
structure.
