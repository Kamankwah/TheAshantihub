# Follow-up A (backend) report

Status: DONE (one concern, below).

## 1. Hold reasons stored
- `Listing.hold_reasons` JSONField(default=list, blank=True); migration `listings/0042_listing_hold_reasons` (additive, reversible).
- `autopublish.Verdict.details` = list of `{code, message}` (`reasons` is now a property of the messages). Codes: hold = `prohibited_term`, `daily_limit`, `photo_check_unavailable`; fix = `photo_missing`, `photo_unreadable`, `photo_too_small`, `name_too_short`, `description_too_short`, `price_missing`, `category_kind_mismatch`, `contact_details_in_text`.
- Set at submit (fix: saved on the still-draft listing before the 400; hold: with the pending status). Cleared on publish (submit and staff approve), staff reject, re-review, resubmit (also with the switch off) and a scout undo (`portfolio/undo.py`).
- Staff queue (`ModerationListingSerializer`, list and detail): `hold_reasons: [{code, message}]`, only while status is pending_review, else `[]`. Message keeps the matched word and the limit.
- Owner (`OwnerListingSerializer`): `hold_notice` = "We need to check this listing." when pending_review with a hold code, else null; `fix_reasons` = list of plain sentences for draft/rejected listings sent back, else `[]`. No hold specifics, no `hold_reasons` key.
- `test_listing_revisions` read-only set updated for the two new read-only owner fields (the full run caught this).

## 2. Photo check
Open vs decode separated. Storage reads are wrapped (`_StorageStream`) so a ConnectionError/TimeoutError (OSErrors) raised by storage while Pillow reads is a hold, not a fix. FileNotFoundError/ValueError on open and Pillow decode failures (UnidentifiedImageError, DecompressionBombError, OSError, SyntaxError, ValueError, EOFError, truncated) = fix. Anything else (open or decode) = hold plus a logged warning.

## 3. `POST /api/accounts/business-owners/me/email/`
Business owner only (customer/staff token 401/403), scope `owner_email_change` 5/hour, `activity_exempt`. Logic: `email_confirmation.set_email` (owner row lock, revoke live links) then `send`.

## 4. Docs
backend/CLAUDE.md and spec section 11 (gaps removed, closure noted).

## Tests
Full run `accounts listings otp storefront marketplace cart orders core portfolio`: 3117 tests, 1 failure (the revisable-fields contract, fixed and re-run green together with golive, autopublish, owner_email_change). `makemigrations --check --dry-run`: no changes.

## Fix round 1 (security review)

Critical: `POST business-owners/me/email/` could let a borrowed session point the account's password reset and sign-in codes at its own address. Now:
- Body `{email, password}`. The current password is checked FIRST (before the confirmed check, validation and any availability check): wrong, missing or empty all answer 400 `{"detail": "That password isn't right.", "password": ["That password isn't right."], "code": "wrong_password"}`, identical whatever address was typed. Every attempt counts toward the 5/hour throttle.
- `step_up.require(CONTACT_CHANGE, force=escrow.enabled())` runs in the same `transaction.atomic()` as the save (before validation, as the customer view does), so a refused address leaves the code usable. Failure: 403 `{"detail": "Confirm it's you with a code first.", "code": "step_up_required", "action": "contact_change"}`; the client retries with the `X-Step-Up-Token` header. Also asked when `OTP_STEP_UP_ENFORCED` is on.
- An actual change (not the same address again) restarts payout cooling, ends trusted devices, ends ALL phone sessions (`MobileSession.revoke_all`; the access token carries no session id, so the current phone cannot be kept - the app signs in again at its next refresh; web JWTs are stateless and unaffected, as with the staff route), tells the old email (else the sign-in phone, with its own "an email was added" text) after commit, and records `business.email_changed` last with masked old/new.
- A same-address resend does none of that; it only revokes old links and sends a new one.

Tests: full run 3138 OK (1 skipped), makemigrations --check clean.

Minors: (1) throttle test now proves the DRF throttle (no `too_many_links`, email unchanged), plus wrong passwords count; (2) `address_taken` refuses another business, a staff email and a customer's verified recovery email with the one wording; (3) `email_missing` message no longer says "below"; (4) owner `fix_reasons` uses the `FIX_CODES` allow-list; (5) an owner PATCH of a draft/rejected listing clears `hold_reasons` (4-line change in `OwnerListingSerializer.update`); (6) ValueError on open now holds, decode-time ValueError stays a fix, and the storage guard passes `AttributeError`/`io.UnsupportedOperation` through (Pillow's non-seekable fallback works) and guards readline/readinto/close.

## Fix round 2
- Important 1: `otp/views_step_up._codes_off` now lets a business owner receive and verify `contact_change` codes while the ledger is on (the new email endpoint forces one; owners would otherwise be stuck at 409 `otp_off`). No other owner action opened up. `wallets/tests/test_guards.py` pin flipped on purpose (it asserted the old refusal; the reason is in the test) and a ledger-off counter-test added. New end-to-end test through the real endpoints: POST email -> 403 `step_up_required` -> step-up send -> verify -> POST with `X-Step-Up-Token` -> 200.
- Minor 2: the sign-in phone is always texted (own wording, "email was added" for a first email), and the old email is notified too if one exists; both swallow send errors (test).
- Minor 3: the password is trimmed before checking (test with a trailing and leading space; whitespace-only is wrong_password).
- Minor 5: when payout cooling actually restarted (a destination was pushed back; same condition as the staff route) the owner gets an in-app notice "Your payout accounts wait the cooling period again before they can receive money."; none for owners without payout destinations. 200 body is now `{"email", "sent": true, "side_effects": {"signed_out_phone": bool, "payout_cooling": bool}}` (`signed_out_phone` true only if a phone session was actually ended; both false for a same-address resend).
- Tests: full run (accounts listings otp storefront marketplace cart orders core portfolio wallets) 3626 OK (1 skipped); makemigrations --check clean.
