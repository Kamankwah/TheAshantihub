# Design: Staff/Customer/Business Account Model, Registration & KYC

**Date:** 2026-07-09
**Status:** Approved, implemented
**Sub-project:** 1 of 5 in the dashboards/RBAC/escrow initiative (see `docs/IMPLEMENTATION_INSTRUCTIONS.md` for the full sequence)

## 1. Background & scope

`docs/PROJECT_SCOPE.md` Phase 1 currently plans a single `User` model (phone + email auth) with a self-serve business signup and an admin approval queue (Days 1-4). This spec expands that into three distinct account types — customers, business owners, and internal staff — each with different registration flows, and adds a KYC/verification pipeline for business owners (Ghana Card, GPS address, business registration documents, payout information).

This is the foundational sub-project of five: it must land before the escrow payment model (needs the payout fields defined here) and before the three role-specific dashboards (need the account/permission model defined here). Those are separate specs.

**Out of scope for this spec** (covered by later specs in the sequence):
- Escrow hold/release/dispute logic (only the payout *fields* are defined here)
- Staff/Customer/Business dashboard UI content and layout
- Real Hubtel payout wiring (this spec only stores payout destination data)

## 2. Data model

Three separate account tables (no shared base `User` table), each with independent auth (phone/OTP or email/password per `PROJECT_SCOPE.md` §3), plus a Role/Permission RBAC layer for staff.

```
Customer
  id
  full_name
  phone                     # OTP auth
  email                     # fallback auth
  password_hash
  created_at

BusinessOwner
  id
  full_name
  login_phone               # private, OTP auth / account recovery
  email
  password_hash
  kyc_status                # pending | verified | rejected
  kyc_rejection_reason      # nullable, set when kyc_status = rejected
  created_at

BusinessOwnerProfile        # OneToOne -> BusinessOwner
  ghana_card_number
  ghana_card_front_image
  ghana_card_back_image
  gps_address                        # Ghana Post digital address format
  business_contact_phone             # public: shown on listing, used for wa.me links
  is_formal                          # bool, self-declared at registration
  business_reg_certificate           # nullable; required iff is_formal = true
  tin                                # nullable; required iff is_formal = true
  payout_bank_name                   # nullable
  payout_bank_account_number         # nullable
  payout_bank_account_name           # nullable
  payout_momo_network                # nullable: MTN | Vodafone | AirtelTigo
  payout_momo_number                 # nullable
  payout_momo_name                   # nullable
  default_payout_method              # bank | momo
  payout_verification_status         # pending | verified

StaffUser
  id
  full_name
  email
  phone
  password_hash
  role                      # FK -> Role
  invited_by                # FK -> StaffUser, nullable (null only for the first bootstrap super_admin)
  created_at

Role
  id
  name                      # super_admin | admin | accountant | marketing | support

Permission
  id
  codename                  # e.g. "kyc.approve", "escrow.release", "listings.moderate"
  description

Role <-M2M-> Permission     # seeded per §4 below
```

**Constraints:**
- `BusinessOwnerProfile.business_reg_certificate` and `.tin` are required at the database/serializer validation level when `is_formal = true`, and must be null/omitted when `is_formal = false`.
- At least one of the bank fields or the momo fields must be populated; `default_payout_method` must match a populated set (can't default to `bank` with no bank fields filled).
- `BusinessOwner.kyc_status` starts at `pending` on registration and is staff-controlled thereafter (no self-service transition to `verified`).

## 3. Registration flows

### 3.1 Customer
Minimal-friction, no KYC:
1. Full name
2. Phone (OTP) or email + password
3. Account is active immediately — no approval step.

### 3.2 Business owner
1. Account basics: full name, login phone/email, password.
2. Business details form:
   - "Is your business formally registered with the Registrar General's Department?" toggle
     - If **yes**: business registration certificate upload (required) + TIN (required)
     - If **no**: those fields are hidden entirely, nothing required
   - Ghana Card number + front/back image upload
   - GPS address
   - Business contact phone (public-facing, distinct from login phone)
3. Payout details: owner may add a bank account, a mobile money number, or both; if both, must mark one as `default_payout_method`.
4. Submission sets `kyc_status = pending`. Owner can log in immediately and edit their profile/listing draft, but see §5 for what's gated.

### 3.3 Staff
No public registration form. A `super_admin` creates the account from the (future) Staff Dashboard's "Manage Staff" screen:
1. `super_admin` enters email/phone + selects a `Role`.
2. System sends an invite link.
3. Invitee sets their own password via the link to activate the account.

## 4. RBAC — default permission matrix

Proper `Role` ↔ `Permission` many-to-many, seeded with this default matrix (adjustable later by a `super_admin` without a code deploy, since it's data, not hardcoded logic):

| Role | Permissions |
| --- | --- |
| `super_admin` | All permissions, including staff account management (create/invite/deactivate/reassign roles) |
| `admin` | Approve/reject business KYC, moderate listings, view all users — no escrow release, no staff management |
| `accountant` | Escrow ledger (read), payout hold/release actions, dispute financial resolution, transaction reports — no KYC approval |
| `marketing` | Promotions/featured listings, analytics/reports, category management — no financial or KYC access |
| `support` | Messaging/ticket queue, dispute intake and flagging (escalates financial disputes to `accountant`/`admin`) — read-only on user profiles |

Every staff-facing API endpoint checks the caller's `Role`'s permission set server-side (not just hidden in the UI).

## 5. KYC verification workflow

- On registration, `BusinessOwner.kyc_status = pending`. Owner can log in, see a "Verification pending" banner on their dashboard, and edit their profile/listing draft — but:
  - The listing is **not published** (not visible/searchable on the marketplace) while `pending` or `rejected`.
  - Escrow payouts are **blocked** while not `verified` (enforced again in the escrow spec, but the flag originates here).
- An `admin` or `super_admin` reviews submissions in the existing Day-4 approval queue (`docs/PROJECT_SCOPE.md` §5a Day 4), now KYC-aware: they see Ghana Card images, GPS address, registration docs (if `is_formal`), and approve or reject with a reason.
- **Approve** → `kyc_status = verified` → listing goes live, payouts unblocked.
- **Reject** → `kyc_status = rejected`, `kyc_rejection_reason` set → owner sees the reason on their dashboard and can edit + resubmit (resets to `pending`).
- **Payout detail changes after verification:** changing bank/momo details resets only `payout_verification_status` to `pending` — this does not revoke `kyc_status = verified` or unpublish the listing, since identity verification and payout-destination verification are separate concerns. An `accountant` (per the matrix) re-verifies the new payout destination before the next release can go to it.

## 6. Impact on `docs/PROJECT_SCOPE.md` Phase 1 schedule

- **Day 1** (`User` model, JWT auth skeleton) → becomes three models (`Customer`, `BusinessOwner`, `StaffUser`) + `Role`/`Permission`, with shared OTP-sending/password-hashing utilities (not shared tables) to avoid tripling that logic across three models.
- **Day 3** (self-serve business signup API) → becomes the full KYC-aware flow in §3.2.
- **Day 4** (admin approval queue) → becomes the KYC-aware approval queue in §5.
- **Day 6** (dashboards wired to live data) → `BusinessDashboard` reads `kyc_status`/`payout_verification_status` to render the pending/verified/rejected states.

No change to Day 2 (OTP/email auth flows) or Day 5 (messaging/reviews) beyond now operating across three account tables instead of one.

## 7. Edge cases & error handling

- Registering as `is_formal = true` without uploading cert/TIN → validation error at submission, not silently accepted as informal.
- Toggling `is_formal` after initial submission but before KYC review → allowed; re-validates required fields for the new state.
- Duplicate Ghana Card number across two `BusinessOwnerProfile` rows → rejected at submission (unique constraint) to prevent one person registering multiple business accounts under one identity without staff awareness.
- Staff invite link expiry → invite tokens expire after 7 days; `super_admin` can re-send.
- A `StaffUser`'s `Role` is reassigned while they're logged in → permission checks are server-side per-request, so the change takes effect on their next action, not just next login.

## 8. Testing considerations

Per `docs/IMPLEMENTATION_INSTRUCTIONS.md` §3 (testing strategy — currently zero tests in the repo), when backend work begins this area should get Django test coverage for:
- `is_formal` conditional validation (cert/TIN required iff true)
- KYC status transitions (pending → verified/rejected → resubmission → pending)
- Payout detail change resetting only `payout_verification_status`, not `kyc_status`
- Permission checks per role (each of the 5 roles hitting an endpoint outside its matrix should 403)

## 9. Open questions

None — all decisions in this spec were confirmed during brainstorming (2026-07-09).
