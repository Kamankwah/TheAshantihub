# Design: DRF Rate Limiting + Real File-Content Validation

**Date:** 2026-07-10
**Status:** Approved, not yet implemented

## 1. Background & scope

Two backend hardening gaps identified while reviewing the project's full dependency list against what's actually built: (1) the three public, unauthenticated POST endpoints (`customers/register/`, `business-owners/register/`, `staff/activate/`) have no rate limiting, leaving them open to brute-force/spam; (2) KYC and listing file uploads (Ghana Card images, business registration certificates, listing photos) are only validated by extension/framework-level `ImageField`/`FileField` checks, not actual file content — a renamed `.exe` would currently pass.

**Out of scope:** `django-ratelimit` was the originally-named tool, but since this is an all-DRF API, DRF's own built-in `ScopedRateThrottle` is used instead (idiomatic fit, zero new dependency) — this decision was made during brainstorming. `pyotp`/`qrcode` (2FA), Redis/Celery, and nginx remain deferred per `docs/PROJECT_SCOPE.md`'s existing phased roadmap — not part of this spec.

## 2. Rate limiting

Add to `backend/ashantihub/settings.py`'s `REST_FRAMEWORK` dict:
```python
"DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
"DEFAULT_THROTTLE_RATES": {
    "customer_register": "5/min",
    "business_owner_register": "5/min",
    "staff_activate": "5/min",
},
```

Each of the three public views gets its own distinct `throttle_scope` (not one shared scope) — otherwise `ScopedRateThrottle` pools request counts across all views sharing a scope name, so a client hitting two different registration endpoints from the same IP would eat into one shared 5/min budget instead of getting 5/min independently per endpoint:
- `accounts.views.CustomerRegisterView` → `throttle_scope = "customer_register"`
- `accounts.views.BusinessOwnerRegisterView` → `throttle_scope = "business_owner_register"`
- `accounts.views.StaffActivateView` → `throttle_scope = "staff_activate"`

No other view gets a `throttle_scope` — everything else either requires authentication already (JWT-gated) or is a public read (`AllowAny` GET), which is a different risk profile not in scope here.

A request exceeding 5/min from the same IP gets DRF's native `429 Too Many Requests` with a `Retry-After` header — no custom exception handling needed, this is DRF's built-in behavior.

## 3. File-content validation

New file `backend/accounts/validators.py`:
```python
validate_image_content_type(file)   # allows image/jpeg, image/png
validate_document_content_type(file) # allows image/jpeg, image/png, application/pdf
```
Both use `python-magic` to read actual file bytes (not filename/extension) and raise `django.core.exceptions.ValidationError` on a mismatch.

Wired as Django model-field `validators=[...]`:
- `BusinessOwnerProfile.ghana_card_front_image`, `.ghana_card_back_image` → `validate_image_content_type`
- `BusinessOwnerProfile.business_reg_certificate` → `validate_document_content_type`
- `listings.Listing.main_photo`, `listings.ListingPhoto.image` → `validate_image_content_type` (imported from `accounts.validators` — a cross-app import, matching the existing precedent of `listings` importing from `accounts`, e.g. `IsBusinessOwner`)

`python-magic` requires the system `libmagic` library — added to `backend/Dockerfile` (`apt-get install libmagic1`) alongside the Python package in `requirements.txt`, since the dev environment runs inside Docker.

## 4. Testing

- `backend/accounts/tests/test_file_validators.py` — unit tests for both validator functions: real JPEG/PNG/PDF bytes pass; a text file / renamed executable's bytes fail with `ValidationError`.
- One integration test each on business-owner registration (`test_business_owner_registration.py`) and listing photo upload (`test_listing_photos.py`) confirming a spoofed upload is rejected end-to-end (400).
- `backend/accounts/tests/test_rate_limiting.py` — confirms the 6th request within a minute to each of the three throttled endpoints returns 429; the first 5 succeed (or fail for unrelated reasons like a duplicate-phone 400, which still counts against the throttle and is fine to assert around).

## 5. Open questions

None — confirmed during brainstorming (2026-07-10): DRF's built-in throttling over `django-ratelimit`; all three flagged upload categories (Ghana Card, business cert, listing photos) get content validation.
