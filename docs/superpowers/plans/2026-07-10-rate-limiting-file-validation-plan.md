# DRF Rate Limiting + File-Content Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Throttle the three public registration/activation endpoints and add real file-content validation (via `python-magic`) to KYC and listing photo uploads, per `docs/superpowers/specs/2026-07-10-rate-limiting-file-validation-design.md`.

**Architecture:** DRF's built-in `ScopedRateThrottle` (no new dependency) gates `CustomerRegisterView`, `BusinessOwnerRegisterView`, `StaffActivateView`, each with its own distinct throttle scope. A new `accounts/validators.py` provides two `python-magic`-backed validator functions, wired as Django model-field `validators=[...]` on `BusinessOwnerProfile`'s three upload fields and (via cross-app import, matching the existing `listings`-imports-from-`accounts` precedent) `listings.Listing.main_photo`/`ListingPhoto.image`.

**Tech Stack:** DRF's `rest_framework.throttling.ScopedRateThrottle` (already available, zero new dependency). `python-magic==0.4.27` (new Python dependency) + the system `libmagic1` package (new Dockerfile step, since `python-magic` is a thin wrapper around the system `libmagic` library and won't work without it).

## Global Constraints

- Each of the three throttled views gets its OWN distinct `throttle_scope` (`customer_register`, `business_owner_register`, `staff_activate`) — not one shared scope, since `ScopedRateThrottle` pools request counts per scope, and a shared scope would let traffic to one endpoint eat into another's budget.
- Rate: `5/min` per IP for all three.
- No other view gets a `throttle_scope` — authenticated views and public GETs are out of scope.
- `validate_image_content_type` allows exactly `image/jpeg`, `image/png`. `validate_document_content_type` allows exactly `image/jpeg`, `image/png`, `application/pdf`.
- `python-magic` reads actual file bytes, not filename/extension — this is the entire point, don't accidentally validate on `.name`/extension anywhere.
- `libmagic1` must be installed in `backend/Dockerfile` before `pip install` runs, or `python-magic` will raise `ImportError`/`OSError` at import time inside the container.

---

## File Structure

```
backend/
  Dockerfile                                    # modified: apt-get install libmagic1
  requirements.txt                               # modified: add python-magic
  accounts/
    validators.py                                # new: validate_image_content_type, validate_document_content_type
    models.py                                    # modified: wire validators onto BusinessOwnerProfile's 3 upload fields
    migrations/
      0007_alter_businessownerprofile_validators.py  # generated
    views.py                                      # modified: throttle_scope on 3 views
    tests/
      test_file_validators.py                     # new
      test_rate_limiting.py                        # new
      test_business_owner_registration.py          # modified: +1 spoofed-upload test
  ashantihub/
    settings.py                                    # modified: DEFAULT_THROTTLE_CLASSES/RATES
  listings/
    models.py                                      # modified: wire validate_image_content_type onto main_photo/image
    migrations/
      0007_alter_listing_main_photo_and_more.py     # generated
    tests/
      test_listing_photos.py                        # modified: +1 spoofed-upload test
```

---

### Task 1: DRF rate limiting on the three public endpoints

**Files:**
- Modify: `backend/ashantihub/settings.py`
- Modify: `backend/accounts/views.py`
- Test: `backend/accounts/tests/test_rate_limiting.py`

**Interfaces:**
- Consumes: `CustomerRegisterView`, `BusinessOwnerRegisterView`, `StaffActivateView` (existing, from prior sub-projects).
- Produces: each view returns `429 Too Many Requests` on the 6th request within 60 seconds from the same IP; the first 5 are throttle-unaffected (may still 400/201 for unrelated reasons).

- [ ] **Step 1: Write the failing test — `backend/accounts/tests/test_rate_limiting.py`**

```python
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient


class RateLimitingTests(TestCase):
    def setUp(self):
        # DRF's ScopedRateThrottle tracks request counts via Django's cache framework,
        # keyed by (scope, client IP). Django's test runner does NOT clear the cache
        # between test methods (unlike the database, which rolls back per test) — without
        # this, whichever test method runs first would exhaust the shared-IP budget for a
        # scope, and every subsequent test method touching that same scope would see a
        # pre-throttled state instead of a fresh one.
        cache.clear()
        self.client = APIClient()

    def test_customer_register_throttles_after_five_requests_per_minute(self):
        for i in range(5):
            response = self.client.post(
                "/api/accounts/customers/register/",
                {"full_name": "Test User", "phone": f"+23320000{i:04d}", "password": "correct-horse-battery-staple"},
                format="json",
            )
            self.assertNotEqual(response.status_code, 429)
        response = self.client.post(
            "/api/accounts/customers/register/",
            {"full_name": "Test User", "phone": "+233200009999", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 429)

    def test_staff_activate_throttles_after_five_requests_per_minute(self):
        for _ in range(5):
            response = self.client.post(
                "/api/accounts/staff/activate/",
                {"token": "nonexistent-token", "password": "correct-horse-battery-staple"},
                format="json",
            )
            self.assertNotEqual(response.status_code, 429)
        response = self.client.post(
            "/api/accounts/staff/activate/",
            {"token": "nonexistent-token", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 429)

    def test_customer_and_staff_endpoints_have_independent_throttle_budgets(self):
        for i in range(5):
            self.client.post(
                "/api/accounts/customers/register/",
                {"full_name": "Test User", "phone": f"+23321000{i:04d}", "password": "correct-horse-battery-staple"},
                format="json",
            )
        # Customer endpoint is now throttled, but staff/activate should still have its own full budget.
        response = self.client.post(
            "/api/accounts/staff/activate/",
            {"token": "nonexistent-token", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertNotEqual(response.status_code, 429)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_rate_limiting`
Expected: FAIL — no throttling configured yet, all requests return their normal (non-429) status.

- [ ] **Step 3: Add throttle settings to `backend/ashantihub/settings.py`**

Find:
```python
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "accounts.authentication.MultiAccountJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [],
    # DRF's request.user falls back to this callable when no authenticator
    # succeeds. We use a custom AnonymousUser from our mixins that duck-types
    # Django's auth.models.AnonymousUser for DRF's IsAuthenticated checks.
    "UNAUTHENTICATED_USER": AnonymousUser,
    "EXCEPTION_HANDLER": "accounts.authentication.exception_handler",
}
```

Replace with:
```python
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "accounts.authentication.MultiAccountJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [],
    # DRF's request.user falls back to this callable when no authenticator
    # succeeds. We use a custom AnonymousUser from our mixins that duck-types
    # Django's auth.models.AnonymousUser for DRF's IsAuthenticated checks.
    "UNAUTHENTICATED_USER": AnonymousUser,
    "EXCEPTION_HANDLER": "accounts.authentication.exception_handler",
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "customer_register": "5/min",
        "business_owner_register": "5/min",
        "staff_activate": "5/min",
    },
}
```

- [ ] **Step 4: Add `throttle_scope` to the three views in `backend/accounts/views.py`**

Find:
```python
class CustomerRegisterView(generics.CreateAPIView):
    serializer_class = CustomerRegistrationSerializer
    permission_classes = [AllowAny]
```

Replace with:
```python
class CustomerRegisterView(generics.CreateAPIView):
    serializer_class = CustomerRegistrationSerializer
    permission_classes = [AllowAny]
    throttle_scope = "customer_register"
```

Find:
```python
class StaffActivateView(generics.GenericAPIView):
    serializer_class = StaffActivateSerializer
    permission_classes = [AllowAny]
```

Replace with:
```python
class StaffActivateView(generics.GenericAPIView):
    serializer_class = StaffActivateSerializer
    permission_classes = [AllowAny]
    throttle_scope = "staff_activate"
```

Find:
```python
class BusinessOwnerRegisterView(generics.CreateAPIView):
    serializer_class = BusinessOwnerRegistrationSerializer
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]
```

Replace with:
```python
class BusinessOwnerRegisterView(generics.CreateAPIView):
    serializer_class = BusinessOwnerRegistrationSerializer
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]
    throttle_scope = "business_owner_register"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_rate_limiting`
Expected: `Ran 3 tests in ...s OK`

- [ ] **Step 6: Clear the throttle cache in every existing test class that hits a now-throttled endpoint**

DRF's `ScopedRateThrottle` tracks request counts via Django's cache framework, keyed by `(scope, client IP)`. That cache is process-wide for the whole test run — it is NOT reset between test methods or test classes the way the database is (no per-test transaction rollback applies to the cache). Since `test_customer_registration.py`, `test_business_owner_registration.py`, and `test_staff_invite.py` all make requests to the now-throttled endpoints across multiple test methods, the CUMULATIVE request count across the whole test run can exceed 5 well before any single test method does, causing unrelated, unpredictable 429s partway through the suite.

Add `cache.clear()` to the `setUp()` of every existing test class that posts to `/api/accounts/customers/register/`, `/api/accounts/business-owners/register/`, or `/api/accounts/staff/activate/`:
- `backend/accounts/tests/test_customer_registration.py` — `CustomerRegistrationTests.setUp`
- `backend/accounts/tests/test_business_owner_registration.py` — `BusinessOwnerRegistrationTests.setUp`
- `backend/accounts/tests/test_staff_invite.py` — `StaffInviteTests.setUp` (this one also hits `staff/activate/`)

For each, add the import `from django.core.cache import cache` at the top of the file (if not already present) and add `cache.clear()` as the first line of `setUp()`, before any other setup logic — matching the same pattern used in `test_rate_limiting.py`'s `RateLimitingTests.setUp` above. This does not change what any of these tests assert; it only ensures each test class starts with a clean throttle counter.

- [ ] **Step 7: Run the full backend suite to confirm no regressions**

Run: `docker compose run --rm web python manage.py test accounts core listings`
Expected: `Ran 95 tests in ...s OK` (92 existing + 3 new), with pristine output — no unexpected 429s anywhere in the suite. If any test still fails with a 429 after Step 6's cache-clearing, that specific test method itself makes more than 5 requests to one throttled endpoint within its own body — fix that test to use a fresh `APIClient()` per 5-request burst or otherwise stay under the limit; do not weaken the throttle rate to make it pass.

- [ ] **Step 8: Commit**

```bash
git add backend/ashantihub/settings.py backend/accounts/views.py backend/accounts/tests/
git commit -m "feat: throttle public registration/activation endpoints (5/min per IP)"
```

---

### Task 2: `python-magic` file-content validators, wired onto `BusinessOwnerProfile`

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `backend/requirements.txt`
- Create: `backend/accounts/validators.py`
- Modify: `backend/accounts/models.py`
- Test: `backend/accounts/tests/test_file_validators.py`
- Modify: `backend/accounts/tests/test_business_owner_registration.py`

**Interfaces:**
- Consumes: nothing from prior tasks in this plan.
- Produces: `validate_image_content_type(file)` and `validate_document_content_type(file)` in `accounts.validators` — importable by `listings` in Task 3. Both raise `django.core.exceptions.ValidationError` on a content-type mismatch (checked via `python-magic`'s byte-sniffing, not filename/extension). Wired onto `BusinessOwnerProfile.ghana_card_front_image`, `.ghana_card_back_image` (image-only) and `.business_reg_certificate` (image or PDF).

- [ ] **Step 1: Add `libmagic1` to `backend/Dockerfile`**

Find:
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
```

Replace with:
```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
```

- [ ] **Step 2: Add `python-magic` to `backend/requirements.txt`**

Find:
```
Django==5.0.9
djangorestframework==3.15.2
djangorestframework-simplejwt==5.3.1
psycopg2-binary==2.9.9
django-environ==0.11.2
Pillow==10.4.0
django-cors-headers==4.4.0
```

Replace with:
```
Django==5.0.9
djangorestframework==3.15.2
djangorestframework-simplejwt==5.3.1
psycopg2-binary==2.9.9
django-environ==0.11.2
Pillow==10.4.0
django-cors-headers==4.4.0
python-magic==0.4.27
```

- [ ] **Step 3: Rebuild the `web` image so `libmagic1`/`python-magic` are actually installed**

Run: `docker compose build web`
Expected: image rebuilds successfully, no apt/pip errors.

- [ ] **Step 4: Write the failing test — `backend/accounts/tests/test_file_validators.py`**

```python
import io

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image

from accounts.validators import validate_document_content_type, validate_image_content_type


def _real_jpeg():
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile("photo.jpg", buf.read(), content_type="image/jpeg")


def _real_pdf():
    # Minimal valid PDF header bytes, enough for libmagic to identify as application/pdf.
    pdf_bytes = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"
    return SimpleUploadedFile("cert.pdf", pdf_bytes, content_type="application/pdf")


def _spoofed_executable():
    # Renamed "image" that is actually not image bytes at all.
    return SimpleUploadedFile("fake.jpg", b"MZ\x90\x00\x03\x00\x00\x00fake-executable-bytes", content_type="image/jpeg")


class FileValidatorTests(TestCase):
    def test_validate_image_content_type_accepts_real_jpeg(self):
        validate_image_content_type(_real_jpeg())  # should not raise

    def test_validate_image_content_type_rejects_spoofed_file(self):
        with self.assertRaises(ValidationError):
            validate_image_content_type(_spoofed_executable())

    def test_validate_document_content_type_accepts_real_pdf(self):
        validate_document_content_type(_real_pdf())  # should not raise

    def test_validate_document_content_type_accepts_real_jpeg(self):
        validate_document_content_type(_real_jpeg())  # should not raise

    def test_validate_document_content_type_rejects_spoofed_file(self):
        with self.assertRaises(ValidationError):
            validate_document_content_type(_spoofed_executable())
```

- [ ] **Step 5: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_file_validators`
Expected: FAIL — `ModuleNotFoundError: No module named 'accounts.validators'`

- [ ] **Step 6: Write `backend/accounts/validators.py`**

```python
import magic
from django.core.exceptions import ValidationError

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png"}
ALLOWED_DOCUMENT_TYPES = {"image/jpeg", "image/png", "application/pdf"}


def _detect_content_type(file):
    file.seek(0)
    header = file.read(2048)
    file.seek(0)
    return magic.from_buffer(header, mime=True)


def validate_image_content_type(file):
    content_type = _detect_content_type(file)
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise ValidationError(f"Unsupported file type: expected an image, got {content_type}.")


def validate_document_content_type(file):
    content_type = _detect_content_type(file)
    if content_type not in ALLOWED_DOCUMENT_TYPES:
        raise ValidationError(f"Unsupported file type: expected an image or PDF, got {content_type}.")
```

- [ ] **Step 7: Run test to verify it passes**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_file_validators`
Expected: `Ran 5 tests in ...s OK`

- [ ] **Step 8: Wire the validators onto `BusinessOwnerProfile` in `backend/accounts/models.py`**

Find:
```python
    ghana_card_front_image = models.ImageField(upload_to="ghana_cards/")
    ghana_card_back_image = models.ImageField(upload_to="ghana_cards/")
```

Replace with:
```python
    ghana_card_front_image = models.ImageField(
        upload_to="ghana_cards/", validators=[validate_image_content_type]
    )
    ghana_card_back_image = models.ImageField(
        upload_to="ghana_cards/", validators=[validate_image_content_type]
    )
```

Find:
```python
    business_reg_certificate = models.FileField(
        upload_to="business_reg_certificates/", null=True, blank=True
    )
```

Replace with:
```python
    business_reg_certificate = models.FileField(
        upload_to="business_reg_certificates/", null=True, blank=True,
        validators=[validate_document_content_type],
    )
```

Add the import near the top of `backend/accounts/models.py`, alongside the existing `from .mixins import AuthenticatableAccountMixin` line:
```python
from .validators import validate_document_content_type, validate_image_content_type
```

- [ ] **Step 9: Add the failing integration test — append to `backend/accounts/tests/test_business_owner_registration.py`**

```python
    def test_spoofed_ghana_card_image_is_rejected(self):
        payload = {
            **self.base_payload,
            "is_formal": "false",
            "ghana_card_front_image": SimpleUploadedFile(
                "fake.jpg", b"MZ\x90\x00\x03\x00\x00\x00fake-executable-bytes", content_type="image/jpeg"
            ),
        }
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("ghana_card_front_image", response.json())
```

(Add this method inside the existing `BusinessOwnerRegistrationTests` class, alongside its sibling test methods. `SimpleUploadedFile` is already imported at the top of this file.)

- [ ] **Step 10: Generate the migration and run tests**

Run: `docker compose run --rm web python manage.py makemigrations accounts`
Expected: creates `backend/accounts/migrations/0007_alter_businessownerprofile_validators.py` (or similar auto-generated name — Django names field-validator-only migrations descriptively; accept whatever name it generates, don't force a specific filename).

Run: `docker compose run --rm web python manage.py migrate && docker compose run --rm web python manage.py test accounts.tests.test_file_validators accounts.tests.test_business_owner_registration`
Expected: `Ran 11 tests in ...s OK` (5 validator tests + 6 registration tests, 1 new)

- [ ] **Step 11: Run the full backend suite to confirm no regressions**

Run: `docker compose run --rm web python manage.py test accounts core listings`
Expected: all tests pass (95 from Task 1 + 5 validator tests + 1 new registration test = 101). If any EXISTING test that uploads a Ghana Card image/business cert now fails because its test fixture bytes aren't real image/PDF bytes, this means an existing test's fixture needs the same real-bytes treatment already applied elsewhere in this codebase (e.g. `backend/accounts/tests/test_business_owner_registration.py`'s existing `_image()` helper, if it already generates real JPEG bytes via PIL, should already be fine; if any fixture still uses raw fake bytes like `b"fake-image-bytes"`, fix that fixture to generate real bytes the same way, don't weaken the validator).

- [ ] **Step 12: Commit**

```bash
git add backend/Dockerfile backend/requirements.txt backend/accounts/
git commit -m "feat: validate KYC upload file content with python-magic (Ghana Card, business cert)"
```

---

### Task 3: Wire file-content validation onto listing photo uploads

**Files:**
- Modify: `backend/listings/models.py`
- Test: append to `backend/listings/tests/test_listing_photos.py`

**Interfaces:**
- Consumes: `validate_image_content_type` from `accounts.validators` (Task 2).
- Produces: `Listing.main_photo` and `ListingPhoto.image` reject non-image content the same way `BusinessOwnerProfile`'s image fields do.

- [ ] **Step 1: Write the failing test — append to `backend/listings/tests/test_listing_photos.py`**

```python
    def test_spoofed_photo_upload_is_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.post(
            f"/api/listings/mine/{self.listing.id}/photos/",
            {
                "image": SimpleUploadedFile(
                    "fake.jpg", b"MZ\x90\x00\x03\x00\x00\x00fake-executable-bytes", content_type="image/jpeg"
                ),
                "order": 1,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("image", response.json())
```

(Add this method inside the existing `ListingPhotoTests` class. `SimpleUploadedFile` is already imported at the top of this file, per the existing `_image()` helper's usage.)

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test listings.tests.test_listing_photos`
Expected: FAIL — the spoofed upload currently succeeds (201), since no content-type validation exists yet on this field.

- [ ] **Step 3: Wire `validate_image_content_type` onto `backend/listings/models.py`**

Find:
```python
    main_photo = models.ImageField(upload_to="listing_photos/main/", null=True, blank=True)
```

Replace with:
```python
    main_photo = models.ImageField(
        upload_to="listing_photos/main/", null=True, blank=True,
        validators=[validate_image_content_type],
    )
```

Find:
```python
class ListingPhoto(models.Model):
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="photos")
    image = models.ImageField(upload_to="listing_photos/gallery/")
```

Replace with:
```python
class ListingPhoto(models.Model):
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="photos")
    image = models.ImageField(
        upload_to="listing_photos/gallery/", validators=[validate_image_content_type]
    )
```

Add the import near the top of `backend/listings/models.py`, alongside the existing `from accounts.models import BusinessOwner` line:
```python
from accounts.validators import validate_image_content_type
```

- [ ] **Step 4: Generate the migration and run tests**

Run: `docker compose run --rm web python manage.py makemigrations listings`
Expected: creates a new migration touching `Listing.main_photo` and `ListingPhoto.image` (accept whatever name Django generates).

Run: `docker compose run --rm web python manage.py migrate && docker compose run --rm web python manage.py test listings.tests.test_listing_photos`
Expected: `Ran 6 tests in ...s OK` (5 existing + 1 new)

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `docker compose run --rm web python manage.py test accounts core listings`
Expected: all tests pass (101 from Task 2 + 1 new = 102). As in Task 2's Step 11, if any existing listing-photo test fixture uses fake non-image bytes, fix the fixture to use real bytes rather than weakening the validator.

- [ ] **Step 6: Commit**

```bash
git add backend/listings/
git commit -m "feat: validate listing photo upload content with python-magic"
```
