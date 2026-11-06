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
