# Staged Business Registration Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-modal business owner signup with a 4-stage flow (Personal Info → Business Info → Payment Info → Terms), where a business owner can sign out and resume exactly where they left off, and lands on a `BusinessDashboard` whose tabs are gated behind KYC approval.

**Architecture:** Backend: relax `BusinessOwnerProfile`'s nullability so a `BusinessOwner` can exist with an empty profile, shrink the registration endpoint to personal info only, reuse two already-existing PATCH endpoints for stages 2-3, add a small new endpoint for stage 4, and compute the current stage on the fly (no stored step field). Frontend: one new `BusinessRegistrationFlow` component (internal step state) mounted via a single always-on gate in `AshantiHub`, replacing `AuthModal`'s business-owner signup branch entirely, plus approval-status gating added to `BusinessDashboard`.

**Tech Stack:** Django/DRF (backend), React 19 + Vite + `@tanstack/react-query` (frontend), Vitest + React Testing Library + MSW (frontend tests), Django `TestCase` + DRF `APIClient` (backend tests).

Full design context: `docs/superpowers/specs/2026-07-13-business-registration-flow-design.md` (approved, committed as `b1dabdb`).

## Global Constraints

- Registration step values are exactly the strings: `"business_info"`, `"payment_info"`, `"terms"`, `"complete"` — used identically in the backend's `compute_registration_step()`, the `/api/accounts/me/` response's `registration_step` field, and the frontend's `BusinessRegistrationFlow` internal `step` state (`"personal_info"` is a 4th frontend-only value with no backend equivalent, since a `BusinessOwner` row not existing yet has no `/me/` response at all).
- `"complete"` means "don't force the registration wizard" — it does **not** mean "approved". It covers both a freshly-finished registration (`kyc_status` still `"pending"`) and any already-reviewed owner (`"verified"` or `"rejected"`). `BusinessDashboard` separately branches on `kyc_status`.
- Endpoint paths are fixed by the spec and must not change: `POST /api/accounts/business-owners/register/` (Stage 1, shrunk), `GET`+`PATCH /api/accounts/business-owners/me/profile/` (Stage 2, GET added, reused as-is otherwise), `PATCH /api/accounts/business-owners/me/payout/` (Stage 3, unchanged), `POST /api/accounts/business-owners/me/terms/` (Stage 4, new).
- Business `Listing` creation (name/category/description) is explicitly **not** part of this flow — stays in `BusinessDashboard`'s existing "Listings & Prices" tab, untouched.
- Customer signup is unchanged — this entire plan only touches the business-owner path.

---

### Task 1: Relax `BusinessOwnerProfile` nullability + add `terms_accepted_at`

**Files:**
- Modify: `backend/accounts/models.py:87-127` (`BusinessOwnerProfile`)
- Create: `backend/accounts/migrations/0008_business_registration_stages.py`
- Test: `backend/accounts/tests/test_business_owner_models.py`

**Interfaces:**
- Produces: `BusinessOwnerProfile` can now be created with only `business_owner` set — every other field (`ghana_card_number`, `ghana_card_front_image`, `ghana_card_back_image`, `gps_address`, `business_contact_phone`, `default_payout_method`) is optional. New field `terms_accepted_at` (nullable `DateTimeField`).

- [ ] **Step 1: Update the model fields**

In `backend/accounts/models.py`, replace the `BusinessOwnerProfile` class body (currently lines 87-127) with:

```python
class BusinessOwnerProfile(models.Model):
    BANK = "bank"
    MOMO = "momo"
    PAYOUT_METHOD_CHOICES = [(BANK, "Bank"), (MOMO, "Mobile Money")]

    business_owner = models.OneToOneField(
        BusinessOwner, on_delete=models.CASCADE, related_name="profile"
    )
    ghana_card_number = models.CharField(max_length=30, unique=True, null=True, blank=True)
    ghana_card_front_image = models.ImageField(
        upload_to="ghana_cards/", validators=[validate_image_content_type], null=True, blank=True
    )
    ghana_card_back_image = models.ImageField(
        upload_to="ghana_cards/", validators=[validate_image_content_type], null=True, blank=True
    )
    gps_address = models.CharField(max_length=20, null=True, blank=True)
    business_contact_phone = models.CharField(max_length=20, null=True, blank=True)

    is_formal = models.BooleanField(default=False)
    business_reg_certificate = models.FileField(
        upload_to="business_reg_certificates/", null=True, blank=True,
        validators=[validate_document_content_type],
    )
    tin = models.CharField(max_length=30, null=True, blank=True)

    payout_bank_name = models.CharField(max_length=100, null=True, blank=True)
    payout_bank_account_number = models.CharField(max_length=50, null=True, blank=True)
    payout_bank_account_name = models.CharField(max_length=150, null=True, blank=True)
    payout_momo_network = models.CharField(max_length=20, null=True, blank=True)
    payout_momo_number = models.CharField(max_length=20, null=True, blank=True)
    payout_momo_name = models.CharField(max_length=150, null=True, blank=True)
    default_payout_method = models.CharField(
        max_length=10, choices=PAYOUT_METHOD_CHOICES, null=True, blank=True
    )
    payout_verification_status = models.CharField(
        max_length=10,
        choices=[("pending", "Pending"), ("verified", "Verified")],
        default="pending",
    )
    terms_accepted_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Profile for {self.business_owner.full_name}"
```

(Only `ghana_card_number`/`ghana_card_front_image`/`ghana_card_back_image`/`gps_address`/`business_contact_phone`/`default_payout_method` gain `null=True, blank=True`, and `terms_accepted_at` is new — everything else is unchanged from the current file.)

- [ ] **Step 2: Generate and write the migration**

Run: `cd backend && python manage.py makemigrations accounts --name business_registration_stages`

This should produce `backend/accounts/migrations/0008_business_registration_stages.py`. Verify its `operations` list contains six `AlterField` operations (for the six fields above) plus one `AddField` for `terms_accepted_at`. If the generated file differs in naming from the six fields listed, fix the field names to match — do not proceed with a mismatched migration.

- [ ] **Step 3: Write a failing test proving the new nullability**

Add to `backend/accounts/tests/test_business_owner_models.py` (append to the existing `BusinessOwnerModelTests` class, after `test_ghana_card_number_is_unique_across_profiles`):

```python
    def test_profile_can_be_created_with_no_kyc_or_payout_data(self):
        owner = self._make_owner(login_phone="+233209998879", email="kojo3@example.com")
        profile = BusinessOwnerProfile.objects.create(business_owner=owner)
        self.assertIsNone(profile.ghana_card_number)
        self.assertIsNone(profile.default_payout_method)
        self.assertIsNone(profile.terms_accepted_at)
```

- [ ] **Step 4: Run the migration and the test**

Run: `cd backend && python manage.py migrate accounts && python manage.py test accounts.tests.test_business_owner_models -v 2`

Expected: migration applies cleanly, all tests in the file pass (including the new one).

- [ ] **Step 5: Commit**

```bash
git add backend/accounts/models.py backend/accounts/migrations/0008_business_registration_stages.py backend/accounts/tests/test_business_owner_models.py
git commit -m "feat: relax BusinessOwnerProfile nullability, add terms_accepted_at"
```

---

### Task 2: `compute_registration_step()` model method

**Files:**
- Modify: `backend/accounts/models.py` (`BusinessOwner` class)
- Test: `backend/accounts/tests/test_business_owner_models.py`

**Interfaces:**
- Consumes: the nullable `BusinessOwnerProfile` fields from Task 1.
- Produces: `BusinessOwner.compute_registration_step()` → one of `"business_info"`, `"payment_info"`, `"terms"`, `"complete"`. Used by Task 4 (`/me/` view) and Task 5 (`TermsAcceptView`).

- [ ] **Step 1: Add the method**

In `backend/accounts/models.py`, add this method inside the `BusinessOwner` class (after its `__str__` method, i.e. right before the blank lines that precede `class BusinessOwnerProfile`):

```python
    def compute_registration_step(self):
        if self.kyc_status in (self.VERIFIED, self.REJECTED):
            return "complete"
        profile = self.profile
        if not (profile.ghana_card_number and profile.gps_address
                and profile.business_contact_phone
                and profile.ghana_card_front_image
                and profile.ghana_card_back_image):
            return "business_info"
        if profile.is_formal and not (profile.business_reg_certificate and profile.tin):
            return "business_info"
        if not profile.default_payout_method:
            return "payment_info"
        if (profile.default_payout_method == BusinessOwnerProfile.MOMO
                and not profile.payout_momo_number):
            return "payment_info"
        if (profile.default_payout_method == BusinessOwnerProfile.BANK
                and not profile.payout_bank_account_number):
            return "payment_info"
        if not profile.terms_accepted_at:
            return "terms"
        return "complete"
```

This references `BusinessOwnerProfile.MOMO`/`BusinessOwnerProfile.BANK`, which are defined later in the same module — safe, because the method body only executes after the whole module has finished loading.

- [ ] **Step 2: Write the failing tests**

Add a new test class to `backend/accounts/tests/test_business_owner_models.py` (append to the end of the file):

```python
class ComputeRegistrationStepTests(TestCase):
    def _make_owner_with_profile(self, kyc_status=BusinessOwner.PENDING, **profile_overrides):
        owner = BusinessOwner.objects.create(
            full_name="Step Trader", login_phone="+233209990001", password_hash="x",
            kyc_status=kyc_status,
        )
        BusinessOwnerProfile.objects.create(business_owner=owner, **profile_overrides)
        return owner

    def test_fresh_profile_needs_business_info(self):
        owner = self._make_owner_with_profile()
        self.assertEqual(owner.compute_registration_step(), "business_info")

    def test_formal_business_without_documents_still_needs_business_info(self):
        owner = self._make_owner_with_profile(
            ghana_card_number="GHA-1", gps_address="AK-1", business_contact_phone="+233201111111",
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg", is_formal=True,
        )
        self.assertEqual(owner.compute_registration_step(), "business_info")

    def test_business_info_complete_needs_payment_info(self):
        owner = self._make_owner_with_profile(
            ghana_card_number="GHA-2", gps_address="AK-2", business_contact_phone="+233201111112",
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg", is_formal=False,
        )
        self.assertEqual(owner.compute_registration_step(), "payment_info")

    def test_momo_selected_without_number_still_needs_payment_info(self):
        owner = self._make_owner_with_profile(
            ghana_card_number="GHA-3", gps_address="AK-3", business_contact_phone="+233201111113",
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg", is_formal=False,
            default_payout_method="momo",
        )
        self.assertEqual(owner.compute_registration_step(), "payment_info")

    def test_payment_info_complete_needs_terms(self):
        owner = self._make_owner_with_profile(
            ghana_card_number="GHA-4", gps_address="AK-4", business_contact_phone="+233201111114",
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg", is_formal=False,
            default_payout_method="momo", payout_momo_number="+233201111114",
        )
        self.assertEqual(owner.compute_registration_step(), "terms")

    def test_terms_accepted_is_complete(self):
        owner = self._make_owner_with_profile(
            ghana_card_number="GHA-5", gps_address="AK-5", business_contact_phone="+233201111115",
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg", is_formal=False,
            default_payout_method="momo", payout_momo_number="+233201111115",
            terms_accepted_at=timezone.now(),
        )
        self.assertEqual(owner.compute_registration_step(), "complete")

    def test_verified_owner_is_complete_regardless_of_profile_state(self):
        owner = self._make_owner_with_profile(kyc_status=BusinessOwner.VERIFIED)
        self.assertEqual(owner.compute_registration_step(), "complete")

    def test_rejected_owner_is_complete_regardless_of_profile_state(self):
        owner = self._make_owner_with_profile(kyc_status=BusinessOwner.REJECTED)
        self.assertEqual(owner.compute_registration_step(), "complete")
```

Add `from django.utils import timezone` to the top of the file's imports (alongside the existing `from django.db import IntegrityError` and `from django.test import TestCase`).

- [ ] **Step 3: Run the tests**

Run: `cd backend && python manage.py test accounts.tests.test_business_owner_models -v 2`

Expected: all tests pass, including the 8 new ones in `ComputeRegistrationStepTests`.

- [ ] **Step 4: Commit**

```bash
git add backend/accounts/models.py backend/accounts/tests/test_business_owner_models.py
git commit -m "feat: add BusinessOwner.compute_registration_step()"
```

---

### Task 3: Shrink Stage 1 registration to personal info only

**Files:**
- Modify: `backend/accounts/serializers.py:86-171` (`BusinessOwnerRegistrationSerializer`)
- Modify: `backend/accounts/views.py:79-89` (`BusinessOwnerRegisterView`)
- Modify: `backend/accounts/tests/test_business_owner_registration.py` (full rewrite)
- Modify: `backend/accounts/tests/test_business_owner_profile_update.py` (add the moved security test)

**Interfaces:**
- Consumes: `BusinessOwner.compute_registration_step()` from Task 2 (used in a new test's assertion).
- Produces: `POST /api/accounts/business-owners/register/` now accepts and requires only `full_name`, `login_phone`, `email` (optional), `password` — response shape unchanged (`{id, full_name, login_phone, kyc_status}` + `token`).

- [ ] **Step 1: Shrink the serializer**

In `backend/accounts/serializers.py`, replace the `BusinessOwnerRegistrationSerializer` class (currently lines 86-171) with:

```python
class BusinessOwnerRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    kyc_status = serializers.CharField(read_only=True)

    class Meta:
        model = BusinessOwner
        fields = ["id", "full_name", "login_phone", "email", "password", "kyc_status"]

    def create(self, validated_data):
        password = validated_data.pop("password")
        validated_data["password_hash"] = make_password(password)
        owner = BusinessOwner.objects.create(**validated_data)
        BusinessOwnerProfile.objects.create(business_owner=owner)
        return owner

    def to_representation(self, instance):
        return {
            "id": instance.id,
            "full_name": instance.full_name,
            "login_phone": instance.login_phone,
            "kyc_status": instance.kyc_status,
        }
```

- [ ] **Step 2: Simplify the view**

In `backend/accounts/views.py`, replace the `BusinessOwnerRegisterView` class (currently lines 79-89) with:

```python
class BusinessOwnerRegisterView(generics.CreateAPIView):
    serializer_class = BusinessOwnerRegistrationSerializer
    permission_classes = [AllowAny]
    throttle_scope = "business_owner_register"

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        owner = BusinessOwner.objects.get(pk=response.data["id"])
        response.data["token"] = issue_token(owner, "business_owner")
        return response
```

(Only the `parser_classes = [MultiPartParser, FormParser]` line is removed — the endpoint now takes plain JSON, and DRF's project-wide default parsers already include `JSONParser`.)

- [ ] **Step 3: Rewrite the registration test file**

Replace the entire contents of `backend/accounts/tests/test_business_owner_registration.py` with:

```python
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import BusinessOwner


class BusinessOwnerRegistrationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.payload = {
            "full_name": "Abena Boateng",
            "login_phone": "+233245551122",
            "email": "abena@example.com",
            "password": "correct-horse-battery-staple",
        }

    def test_registration_creates_an_owner_with_an_empty_profile(self):
        response = self.client.post(
            "/api/accounts/business-owners/register/", self.payload, format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["kyc_status"], "pending")
        owner = BusinessOwner.objects.get(login_phone="+233245551122")
        self.assertIsNotNone(owner.profile)
        self.assertFalse(owner.profile.ghana_card_number)
        self.assertEqual(owner.compute_registration_step(), "business_info")

    def test_registration_does_not_require_or_accept_kyc_fields(self):
        payload = {**self.payload, "ghana_card_number": "GHA-000000000-0"}
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)
        owner = BusinessOwner.objects.get(login_phone="+233245551122")
        self.assertFalse(owner.profile.ghana_card_number)

    def test_registration_response_includes_a_working_token(self):
        response = self.client.post(
            "/api/accounts/business-owners/register/", self.payload, format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)
        token = response.json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        me_response = self.client.get("/api/accounts/me/")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["account_type"], "business_owner")

    def test_password_too_short_is_rejected(self):
        payload = {**self.payload, "password": "short"}
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.json())
```

This drops the `@override_settings(MEDIA_ROOT=...)`/PIL/`_image`/`_pdf` helpers and every KYC-field/image/payout test — none of that applies to this endpoint anymore. The security-relevant "spoofed image content" coverage moves to Step 4 below, since that's the endpoint that now owns image uploads.

- [ ] **Step 4: Move the spoofed-image security test to the profile-update tests**

Add this test to `backend/accounts/tests/test_business_owner_profile_update.py`, inside the existing `BusinessOwnerProfileUpdateTests` class (after `test_disallowed_ghana_card_image_format_is_rejected`):

```python
    def test_spoofed_ghana_card_image_is_rejected(self):
        owner = self._make_owner(BusinessOwner.REJECTED)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"ghana_card_front_image": SimpleUploadedFile(
                "fake.jpg", b"MZ\x90\x00\x03\x00\x00\x00fake-executable-bytes", content_type="image/jpeg"
            )},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("ghana_card_front_image", response.json())
```

(`SimpleUploadedFile` is already imported at the top of this file — no new import needed.)

- [ ] **Step 5: Run both test files**

Run: `cd backend && python manage.py test accounts.tests.test_business_owner_registration accounts.tests.test_business_owner_profile_update -v 2`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/accounts/serializers.py backend/accounts/views.py backend/accounts/tests/test_business_owner_registration.py backend/accounts/tests/test_business_owner_profile_update.py
git commit -m "feat: shrink business owner registration to personal info only"
```

---

### Task 4: Extend `/api/accounts/me/` with business-owner registration state

**Files:**
- Modify: `backend/accounts/views.py:33-45` (`me`)
- Create: `backend/accounts/tests/test_me_endpoint.py`

**Interfaces:**
- Consumes: `BusinessOwner.compute_registration_step()` from Task 2.
- Produces: for `account_type == "business_owner"`, `/api/accounts/me/` additionally returns `kyc_status`, `kyc_rejection_reason`, `registration_step`.

- [ ] **Step 1: Extend the view**

In `backend/accounts/views.py`, replace the `me` function (currently lines 33-45) with:

```python
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    token = request.auth
    data = {
        "account_type": token["account_type"],
        "id": request.user.id,
        "full_name": request.user.full_name,
    }
    if isinstance(request.user, StaffUser):
        data["role"] = request.user.role.name
        data["permissions"] = list(request.user.role.permissions.values_list("codename", flat=True))
    if isinstance(request.user, BusinessOwner):
        data["kyc_status"] = request.user.kyc_status
        data["kyc_rejection_reason"] = request.user.kyc_rejection_reason
        data["registration_step"] = request.user.compute_registration_step()
    return Response(data)
```

(`BusinessOwner` is already imported at the top of `views.py` — no new import needed.)

- [ ] **Step 2: Write the tests**

Create `backend/accounts/tests/test_me_endpoint.py`:

```python
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer


class MeEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_customer_me_has_no_business_fields(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200002222", password_hash="x")
        token = issue_token(customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["account_type"], "customer")
        self.assertNotIn("kyc_status", body)
        self.assertNotIn("registration_step", body)

    def test_fresh_business_owner_me_reports_business_info_step(self):
        owner = BusinessOwner.objects.create(
            full_name="Kojo Trader", login_phone="+233209990002", password_hash="x",
        )
        BusinessOwnerProfile.objects.create(business_owner=owner)
        token = issue_token(owner, "business_owner")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["kyc_status"], "pending")
        self.assertIsNone(body["kyc_rejection_reason"])
        self.assertEqual(body["registration_step"], "business_info")

    def test_rejected_business_owner_me_reports_reason_and_complete_step(self):
        owner = BusinessOwner.objects.create(
            full_name="Yaa Trader", login_phone="+233209990003", password_hash="x",
            kyc_status=BusinessOwner.REJECTED, kyc_rejection_reason="Blurry Ghana Card",
        )
        BusinessOwnerProfile.objects.create(business_owner=owner)
        token = issue_token(owner, "business_owner")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        body = response.json()
        self.assertEqual(body["kyc_status"], "rejected")
        self.assertEqual(body["kyc_rejection_reason"], "Blurry Ghana Card")
        self.assertEqual(body["registration_step"], "complete")
```

- [ ] **Step 3: Run the tests**

Run: `cd backend && python manage.py test accounts.tests.test_me_endpoint -v 2`

Expected: all 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/accounts/views.py backend/accounts/tests/test_me_endpoint.py
git commit -m "feat: expose kyc_status/registration_step on /api/accounts/me/ for business owners"
```

---

### Task 5: `POST /api/accounts/business-owners/me/terms/`

**Files:**
- Modify: `backend/accounts/views.py` (add `TermsAcceptView`, after `BusinessOwnerProfileUpdateView`)
- Modify: `backend/accounts/urls.py`
- Create: `backend/accounts/tests/test_business_terms_acceptance.py`

**Interfaces:**
- Consumes: `BusinessOwner.compute_registration_step()` from Task 2, `IsBusinessOwner` permission (already defined in `views.py`).
- Produces: `POST /api/accounts/business-owners/me/terms/` → 400 if business/payment info incomplete, else sets `terms_accepted_at` and returns `{registration_step: "complete"}`.

- [ ] **Step 1: Add the view**

In `backend/accounts/views.py`, add this class immediately after `BusinessOwnerProfileUpdateView` (which currently ends around line 268):

```python
class TermsAcceptView(APIView):
    permission_classes = [IsBusinessOwner]

    def post(self, request):
        owner = request.user
        if owner.compute_registration_step() != "terms":
            return Response(
                {"registration_step": "Business and payment information must be complete before accepting terms."},
                status=400,
            )
        profile = owner.profile
        profile.terms_accepted_at = timezone.now()
        profile.save(update_fields=["terms_accepted_at"])
        return Response({"registration_step": owner.compute_registration_step()})
```

(`timezone` is already imported at the top of `views.py`; `IsBusinessOwner` is defined earlier in the same file.)

- [ ] **Step 2: Add the URL**

In `backend/accounts/urls.py`, add this line immediately after the `"business-owners/me/profile/"` path:

```python
    path("business-owners/me/terms/", views.TermsAcceptView.as_view(), name="business-owner-terms"),
```

- [ ] **Step 3: Write the tests**

Create `backend/accounts/tests/test_business_terms_acceptance.py`:

```python
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer


class TermsAcceptanceTests(TestCase):
    def _make_owner(self, **profile_overrides):
        owner = BusinessOwner.objects.create(
            full_name="Efua Seller", login_phone="+233206665599", password_hash="x",
        )
        defaults = dict(business_owner=owner)
        defaults.update(profile_overrides)
        BusinessOwnerProfile.objects.create(**defaults)
        return owner

    def _client_for(self, owner):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
        return client

    def test_cannot_accept_terms_before_business_and_payment_info_are_complete(self):
        owner = self._make_owner()
        client = self._client_for(owner)
        response = client.post("/api/accounts/business-owners/me/terms/")
        self.assertEqual(response.status_code, 400)
        owner.profile.refresh_from_db()
        self.assertIsNone(owner.profile.terms_accepted_at)

    def test_accepts_terms_once_business_and_payment_info_are_complete(self):
        owner = self._make_owner(
            ghana_card_number="GHA-222333444-5", gps_address="AK-039-6000",
            business_contact_phone="+233206665599", is_formal=False,
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg",
            default_payout_method="momo", payout_momo_number="+233206665599",
        )
        client = self._client_for(owner)
        response = client.post("/api/accounts/business-owners/me/terms/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["registration_step"], "complete")
        owner.profile.refresh_from_db()
        self.assertIsNotNone(owner.profile.terms_accepted_at)

    def test_customer_cannot_access_terms_endpoint(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200003333", password_hash="x")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        response = client.post("/api/accounts/business-owners/me/terms/")
        self.assertEqual(response.status_code, 403)
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && python manage.py test accounts.tests.test_business_terms_acceptance -v 2`

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/accounts/views.py backend/accounts/urls.py backend/accounts/tests/test_business_terms_acceptance.py
git commit -m "feat: add business owner terms-acceptance endpoint"
```

---

### Task 6: `apiClient`/`useAuth` frontend plumbing

**Files:**
- Modify: `frontend/apiClient.js`
- Modify: `frontend/hooks/useAuth.js`
- Modify: `frontend/apiClient.test.js`
- Modify: `frontend/hooks/__tests__/useAuth.test.jsx`

**Interfaces:**
- Consumes: the 4 backend endpoints from Tasks 3-5.
- Produces: `apiClient.js` exports `apiPatchForm(path, formData)`. `useAuth()` returns (in addition to its existing fields): `submitBusinessInfo(fields)`, `submitPayoutInfo(fields)`, `acceptBusinessTerms()`, `refreshUser()`. `registerBusinessOwner(fields)` changes from multipart to JSON, and its resolved/stored user object gains `kyc_status` and a hardcoded `registration_step: 'business_info'` (a fresh registration always starts there — no need to round-trip to `/me/` to know that).

- [ ] **Step 1: Add `apiPatchForm` to `apiClient.js`**

In `frontend/apiClient.js`, add this function at the end of the file (after `apiPostForm`):

```js
export async function apiPatchForm(path, formData) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: formData,
  })
  return handleResponse(response, path)
}
```

- [ ] **Step 2: Write the failing `apiPatchForm` test**

In `frontend/apiClient.test.js`, add `apiPatchForm` to the existing import line (`import { apiFetch, getStoredAuth, setStoredAuth, apiPost, apiPostForm, apiPatch, apiPatchForm } from './apiClient.js'`), and add this test inside the `describe('apiFetch', ...)` block's sibling scope (add a new top-level `describe` after the existing ones):

```js
describe('apiPatchForm', () => {
  it('sends a PATCH request with the given FormData', async () => {
    server.use(
      http.patch('http://localhost:8000/api/accounts/business-owners/me/profile/', async ({ request }) => {
        const formData = await request.formData()
        expect(formData.get('gps_address')).toBe('AK-039-5028')
        return HttpResponse.json({ gps_address: 'AK-039-5028' })
      }),
    )
    const formData = new FormData()
    formData.append('gps_address', 'AK-039-5028')
    const data = await apiPatchForm('/api/accounts/business-owners/me/profile/', formData)
    expect(data).toEqual({ gps_address: 'AK-039-5028' })
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npx vitest run apiClient.test.js`
Expected: FAIL — `apiPatchForm is not a function` (or similar import error).

- [ ] **Step 4: Confirm it passes**

Run: `cd frontend && npx vitest run apiClient.test.js`
Expected: PASS (the Step 1 implementation already exists — this step just confirms Steps 1-2 are wired together correctly).

- [ ] **Step 5: Update `useAuth.js`**

Replace the full contents of `frontend/hooks/useAuth.js` with:

```js
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, apiPatch, apiPatchForm, apiPost, apiPostForm, getStoredAuth, setStoredAuth } from '../apiClient.js'

const LOGIN_PATHS = {
  customer: '/api/accounts/customers/login/',
  business_owner: '/api/accounts/business-owners/login/',
  staff: '/api/accounts/staff/login/',
}

export function useAuth() {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const stored = getStoredAuth()
    if (!stored) {
      setIsLoading(false)
      return
    }
    apiFetch('/api/accounts/me/')
      .then((me) => setUser({ ...stored, ...me }))
      .catch(() => {
        setStoredAuth(null)
        setUser(null)
      })
      .finally(() => setIsLoading(false))
  }, [])

  const login = useCallback(async (accountType, identifier, password) => {
    const data = await apiPost(LOGIN_PATHS[accountType], { identifier, password })
    setStoredAuth(data)
    setUser(data)
    return data
  }, [])

  const logout = useCallback(() => {
    setStoredAuth(null)
    setUser(null)
  }, [])

  const registerCustomer = useCallback(async (fields) => {
    const data = await apiPost('/api/accounts/customers/register/', fields)
    const auth = { token: data.token, account_type: 'customer', id: data.id, full_name: data.full_name }
    setStoredAuth(auth)
    setUser(auth)
    return auth
  }, [])

  const registerBusinessOwner = useCallback(async (fields) => {
    const data = await apiPost('/api/accounts/business-owners/register/', fields)
    const auth = {
      token: data.token, account_type: 'business_owner', id: data.id, full_name: data.full_name,
      kyc_status: data.kyc_status, registration_step: 'business_info',
    }
    setStoredAuth(auth)
    setUser(auth)
    return auth
  }, [])

  const submitBusinessInfo = useCallback(async (fields) => {
    const formData = new FormData()
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') formData.append(key, value)
    })
    return apiPatchForm('/api/accounts/business-owners/me/profile/', formData)
  }, [])

  const submitPayoutInfo = useCallback(async (fields) => {
    return apiPatch('/api/accounts/business-owners/me/payout/', fields)
  }, [])

  const acceptBusinessTerms = useCallback(async () => {
    return apiPost('/api/accounts/business-owners/me/terms/', {})
  }, [])

  const refreshUser = useCallback(async () => {
    const me = await apiFetch('/api/accounts/me/')
    setUser((current) => (current ? { ...current, ...me } : current))
    return me
  }, [])

  const hasPermission = useCallback(
    (codename) => user?.permissions?.includes(codename) ?? false,
    [user],
  )

  return {
    user, isLoading, login, logout, registerCustomer, registerBusinessOwner,
    submitBusinessInfo, submitPayoutInfo, acceptBusinessTerms, refreshUser,
    hasPermission,
  }
}
```

- [ ] **Step 6: Update the `registerBusinessOwner` test and add tests for the new functions**

In `frontend/hooks/__tests__/useAuth.test.jsx`, replace the existing `it('registerBusinessOwner posts as multipart/form-data and stores the returned token', ...)` test with:

```js
  it('registerBusinessOwner posts as JSON and stores a business_info registration step', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/business-owners/register/', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ full_name: 'Abena Boateng', login_phone: '+233245551122', password: 'secretpass' })
        return HttpResponse.json({ id: 9, full_name: 'Abena Boateng', login_phone: '+233245551122', kyc_status: 'pending', token: 'biztoken' }, { status: 201 })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.registerBusinessOwner({ full_name: 'Abena Boateng', login_phone: '+233245551122', password: 'secretpass' })
    })
    expect(result.current.user).toEqual({
      token: 'biztoken', account_type: 'business_owner', id: 9, full_name: 'Abena Boateng',
      kyc_status: 'pending', registration_step: 'business_info',
    })
  })

  it('submitBusinessInfo patches business-owners/me/profile/ as multipart/form-data', async () => {
    server.use(
      http.patch('http://localhost:8000/api/accounts/business-owners/me/profile/', async ({ request }) => {
        const formData = await request.formData()
        expect(formData.get('gps_address')).toBe('AK-039-5028')
        return HttpResponse.json({ gps_address: 'AK-039-5028' })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.submitBusinessInfo({ gps_address: 'AK-039-5028' })
    })
  })

  it('submitPayoutInfo patches business-owners/me/payout/ as JSON', async () => {
    server.use(
      http.patch('http://localhost:8000/api/accounts/business-owners/me/payout/', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ default_payout_method: 'momo', payout_momo_number: '+233201112233' })
        return HttpResponse.json({ default_payout_method: 'momo' })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.submitPayoutInfo({ default_payout_method: 'momo', payout_momo_number: '+233201112233' })
    })
  })

  it('acceptBusinessTerms posts to business-owners/me/terms/ and returns the registration step', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/business-owners/me/terms/', () => {
        return HttpResponse.json({ registration_step: 'complete' })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let response
    await act(async () => {
      response = await result.current.acceptBusinessTerms()
    })
    expect(response).toEqual({ registration_step: 'complete' })
  })

  it('refreshUser re-fetches /me/ and merges the result into the current user', async () => {
    setStoredAuth({ token: 'biztoken', account_type: 'business_owner', id: 9, full_name: 'Abena Boateng' })
    server.use(
      http.get('http://localhost:8000/api/accounts/me/', () => {
        return HttpResponse.json({
          account_type: 'business_owner', id: 9, full_name: 'Abena Boateng',
          kyc_status: 'pending', kyc_rejection_reason: null, registration_step: 'complete',
        })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.refreshUser()
    })
    expect(result.current.user.registration_step).toBe('complete')
  })
```

- [ ] **Step 7: Run the tests**

Run: `cd frontend && npx vitest run hooks/__tests__/useAuth.test.jsx apiClient.test.js`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/apiClient.js frontend/apiClient.test.js frontend/hooks/useAuth.js frontend/hooks/__tests__/useAuth.test.jsx
git commit -m "feat: add staged business-registration auth methods to useAuth"
```

---

### Task 7: Remove business-owner signup from `AuthModal`

**Files:**
- Modify: `frontend/App.jsx:1812-1960` (`AuthModal`)
- Modify: `frontend/AuthModal.test.jsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AuthModal`'s signup mode is customer-only. Login mode (Customer/Business Owner/Staff toggle) is unchanged.

- [ ] **Step 1: Replace the `AuthModal` function**

In `frontend/App.jsx`, replace the entire `AuthModal` function (currently lines 1812-1960, from `export function AuthModal({authState,auth,onClose,onSuccess}) {` through its closing `}`) with:

```jsx
export function AuthModal({authState,auth,onClose,onSuccess}) {
  const lockedAccountType = authState==="staff-login" ? "staff" : null;
  const [mode,setMode]=useState(authState==="staff-login" ? "login" : authState);
  const [accountType,setAccountType]=useState(lockedAccountType || "customer");
  const [identifier,setIdentifier]=useState("");
  const [password,setPassword]=useState("");
  const [fullName,setFullName]=useState("");
  const [phone,setPhone]=useState("");
  const [email,setEmail]=useState("");
  const [error,setError]=useState(null);
  const [submitting,setSubmitting]=useState(false);

  const handleLogin=async(e)=>{
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result=await auth.login(lockedAccountType||accountType,identifier,password);
      onSuccess(result);
    } catch (err) {
      setError("Invalid credentials. Please check your details and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCustomerSignup=async(e)=>{
    e.preventDefault();
    setError(null);
    if(!phone && !email){
      setError("Please provide a phone number or email address.");
      return;
    }
    setSubmitting(true);
    try {
      const result=await auth.registerCustomer({full_name:fullName,phone:phone||undefined,email:email||undefined,password});
      onSuccess(result);
    } catch (err) {
      setError("Could not create your account. Please check your details.");
    } finally {
      setSubmitting(false);
    }
  };

  return <div data-testid="auth-modal-backdrop" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:"white",borderRadius:22,width:"100%",maxWidth:440,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
      <div style={{background:`linear-gradient(135deg,${C.kente1},${C.kente3})`,borderRadius:"22px 22px 0 0",padding:"20px 24px",position:"relative"}}>
        <button onClick={onClose} style={{position:"absolute",top:14,right:16,background:"none",border:"none",color:"white",fontSize:"1.4rem",cursor:"pointer",opacity:0.7}}>✕</button>
        <div style={{color:C.gold,fontWeight:900,fontSize:"1.1rem"}}>{lockedAccountType==="staff"?"Staff Sign In":mode==="login"?"Welcome back":"Create your account"}</div>
      </div>
      <div style={{padding:"20px 24px"}}>
        {!lockedAccountType && <div style={{display:"flex",gap:8,marginBottom:16}}>
          <button type="button" onClick={()=>setMode("login")} style={{flex:1,padding:"8px",borderRadius:20,border:"none",cursor:"pointer",fontWeight:800,fontSize:"0.78rem",background:mode==="login"?C.gold:"#eee",color:mode==="login"?C.darkBrown:"#666"}}>Sign In</button>
          <button type="button" onClick={()=>setMode("signup")} style={{flex:1,padding:"8px",borderRadius:20,border:"none",cursor:"pointer",fontWeight:800,fontSize:"0.78rem",background:mode==="signup"?C.gold:"#eee",color:mode==="signup"?C.darkBrown:"#666"}}>Sign Up</button>
        </div>}

        {error && <div style={{background:"#fdecea",color:"#b00020",borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:"0.78rem"}}>{error}</div>}

        {mode==="login" && <form onSubmit={handleLogin}>
          {!lockedAccountType && <div style={{display:"flex",gap:8,marginBottom:12}}>
            <button type="button" onClick={()=>setAccountType("customer")} style={{flex:1,padding:"6px",borderRadius:20,border:`1.5px solid ${C.gold}`,cursor:"pointer",fontWeight:700,fontSize:"0.72rem",background:accountType==="customer"?C.gold:"white"}}>Customer</button>
            <button type="button" onClick={()=>setAccountType("business_owner")} style={{flex:1,padding:"6px",borderRadius:20,border:`1.5px solid ${C.gold}`,cursor:"pointer",fontWeight:700,fontSize:"0.72rem",background:accountType==="business_owner"?C.gold:"white"}}>Business Owner</button>
          </div>}
          <input value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="Phone or email" required style={authInputStyle}/>
          <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password" required style={authInputStyle}/>
          <button type="submit" disabled={submitting} style={authSubmitStyle}>{submitting?"Signing in…":"Sign In"}</button>
        </form>}

        {mode==="signup" && <form onSubmit={handleCustomerSignup}>
          <input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Full name" required style={authInputStyle}/>
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Phone (+233...)" style={authInputStyle}/>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="Email" style={authInputStyle}/>
          <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password (min 8 characters)" required minLength={8} style={authInputStyle}/>
          <button type="submit" disabled={submitting} style={authSubmitStyle}>{submitting?"Creating account…":"Create Free Account"}</button>
        </form>}
      </div>
    </div>
  </div>;
}
```

This removes the `bizFields` state, `handleBusinessSignup`, the signup-mode Customer/Business-Owner toggle, and the entire business-owner signup form. Login mode's Customer/Business Owner/Staff toggle is untouched.

- [ ] **Step 2: Update `AuthModal.test.jsx`**

Replace the full contents of `frontend/AuthModal.test.jsx` with:

```jsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthModal } from './App.jsx'

function makeAuth(overrides = {}) {
  return {
    user: null,
    isLoading: false,
    login: vi.fn().mockResolvedValue({ token: 't', account_type: 'customer', id: 1, full_name: 'Ama' }),
    logout: vi.fn(),
    registerCustomer: vi.fn().mockResolvedValue({ token: 't', account_type: 'customer', id: 1, full_name: 'Kofi' }),
    ...overrides,
  }
}

describe('AuthModal', () => {
  it('submits identifier and password to auth.login on the Sign In form', async () => {
    const auth = makeAuth()
    const onSuccess = vi.fn()
    render(<AuthModal authState="login" auth={auth} onClose={vi.fn()} onSuccess={onSuccess} />)

    fireEvent.change(screen.getByPlaceholderText('Phone or email'), { target: { value: '+233241234567' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret' } })
    const signInButtons = screen.getAllByRole('button', { name: 'Sign In' })
    fireEvent.click(signInButtons[signInButtons.length - 1])

    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('customer', '+233241234567', 'secret'))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })

  it('shows the customer signup form and submits to auth.registerCustomer', async () => {
    const auth = makeAuth()
    const onSuccess = vi.fn()
    render(<AuthModal authState="signup" auth={auth} onClose={vi.fn()} onSuccess={onSuccess} />)

    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Kofi Mensah' } })
    fireEvent.change(screen.getByPlaceholderText('Phone (+233...)'), { target: { value: '+233201112233' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Free Account' }))

    await waitFor(() => expect(auth.registerCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'Kofi Mensah', phone: '+233201112233', password: 'secretpass' })
    ))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })

  it('shows an error message and does not call onSuccess when login fails', async () => {
    const auth = makeAuth({ login: vi.fn().mockRejectedValue(new Error('API request failed with status 400')) })
    const onSuccess = vi.fn()
    render(<AuthModal authState="login" auth={auth} onClose={vi.fn()} onSuccess={onSuccess} />)

    fireEvent.change(screen.getByPlaceholderText('Phone or email'), { target: { value: '+233241234567' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } })
    const signInButtons = screen.getAllByRole('button', { name: 'Sign In' })
    fireEvent.click(signInButtons[signInButtons.length - 1])

    await waitFor(() => expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument())
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('locks to staff login and hides the signup tab when authState is staff-login', () => {
    render(<AuthModal authState="staff-login" auth={makeAuth()} onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Sign Up' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Phone or email')).toBeInTheDocument()
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<AuthModal authState="login" auth={makeAuth()} onClose={onClose} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByTestId('auth-modal-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an error and does not call auth.registerCustomer when both phone and email are left blank', async () => {
    const auth = makeAuth()
    render(<AuthModal authState="signup" auth={auth} onClose={vi.fn()} onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Kofi Mensah' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Free Account' }))

    await waitFor(() => expect(screen.getByText('Please provide a phone number or email address.')).toBeInTheDocument())
    expect(auth.registerCustomer).not.toHaveBeenCalled()
  })

  it('login mode still offers the Customer/Business Owner account-type toggle', async () => {
    const auth = makeAuth()
    render(<AuthModal authState="login" auth={auth} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Business Owner' }))
    fireEvent.change(screen.getByPlaceholderText('Phone or email'), { target: { value: '+233241234567' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('business_owner', '+233241234567', 'secret'))
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `cd frontend && npx vitest run AuthModal.test.jsx`

Expected: all 7 tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/App.jsx frontend/AuthModal.test.jsx
git commit -m "feat: make AuthModal signup customer-only, business signup moves to BusinessRegistrationFlow"
```

---

### Task 8: `BusinessRegistrationFlow` component

**Files:**
- Create: `frontend/components/BusinessRegistrationFlow.jsx`
- Create: `frontend/BusinessRegistrationFlow.test.jsx`

**Interfaces:**
- Consumes: `auth.registerBusinessOwner`, `auth.submitBusinessInfo`, `auth.submitPayoutInfo`, `auth.acceptBusinessTerms`, `auth.refreshUser`, `auth.logout` (all from Task 6's `useAuth`).
- Produces: `export default function BusinessRegistrationFlow({ user, auth, initialStep, prefill, setPage, setShowBizDash })`. Internal `step` state: `"personal_info" | "business_info" | "payment_info" | "terms"`.

- [ ] **Step 1: Write the component**

Create `frontend/components/BusinessRegistrationFlow.jsx`:

```jsx
import { useState } from "react";
import { C } from "../theme.js";

// ─── BusinessRegistrationFlow ─────────────────────────────────────────────
// The 4-stage business-owner registration wizard: Personal Information (only
// when no account exists yet) -> Business Information (KYC) -> Payment
// Account Information (payout) -> Terms & Conditions. One component with
// internal step state, not four separate AshantiHub pages — these steps are
// a single sequential flow, matching how BusinessDashboard is one component
// with internal tabs rather than four pages.
//
// business_info/payment_info steps call auth.refreshUser() after their own
// submit and route to whatever registration_step the server reports next,
// rather than always advancing to a hardcoded next step — this is what
// makes the "Fix and Resubmit after rejection" entry point (from
// BusinessDashboard, starting at business_info) correctly skip straight
// back to the dashboard when that was the only thing missing, instead of
// forcing payment_info/terms to be redone.

const STEP_LABELS = {
  personal_info: "1 of 4: Personal Information",
  business_info: "2 of 4: Business Information",
  payment_info: "3 of 4: Payment Account Information",
  terms: "4 of 4: Terms & Conditions",
};

const inputStyle={width:"100%",boxSizing:"border-box",padding:"10px 12px",borderRadius:10,border:"1.5px solid #ddd",marginBottom:10,fontSize:"0.82rem",fontFamily:"inherit"};
const labelStyle={display:"block",fontSize:"0.72rem",fontWeight:700,color:C.darkBrown,marginBottom:10};
const submitStyle={width:"100%",background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"12px",fontWeight:900,fontSize:"0.85rem",cursor:"pointer",fontFamily:"inherit",marginTop:4};

const TERMS_COPY = `AshantiHub Business Agreement (summary)

1. Listing Accuracy — Every listing you publish must accurately represent a real, operating business you own or are authorized to represent. Misleading names, prices, or photos may result in listing removal.

2. WhatsApp Conduct — Customers will contact you directly via WhatsApp. Respond in good faith and do not use contact details obtained through AshantiHub for unrelated marketing.

3. Payout Terms — Payouts are made to the bank or mobile money account you provide. You are responsible for keeping these details accurate and up to date; AshantiHub is not liable for payouts sent to details you failed to update. A service fee may apply to processed payouts.

4. KYC Accuracy — The Ghana Card and business details you provide must be accurate and current. Misrepresentation is grounds for account suspension.

5. Suspension & Termination — AshantiHub may suspend or terminate a business account for fraudulent listings, repeated customer complaints, or violation of these terms.`;

export default function BusinessRegistrationFlow({ user, auth, initialStep, prefill, setPage, setShowBizDash }) {
  const [step, setStep] = useState(initialStep || "personal_info");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Step 1 — Personal Information
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Step 2 — Business Information
  const [ghanaCardNumber, setGhanaCardNumber] = useState(prefill?.ghana_card_number || "");
  const [ghanaCardFront, setGhanaCardFront] = useState(null);
  const [ghanaCardBack, setGhanaCardBack] = useState(null);
  const [gpsAddress, setGpsAddress] = useState(prefill?.gps_address || "");
  const [businessContactPhone, setBusinessContactPhone] = useState(prefill?.business_contact_phone || "");
  const [isFormal, setIsFormal] = useState(prefill?.is_formal || false);
  const [businessRegCertificate, setBusinessRegCertificate] = useState(null);
  const [tin, setTin] = useState(prefill?.tin || "");

  // Step 3 — Payment Account Information
  const [payoutMomoNumber, setPayoutMomoNumber] = useState("");
  const [payoutMomoName, setPayoutMomoName] = useState("");
  const [payoutMomoNetwork, setPayoutMomoNetwork] = useState("");
  const [payoutBankAccountNumber, setPayoutBankAccountNumber] = useState("");
  const [payoutBankAccountName, setPayoutBankAccountName] = useState("");
  const [payoutBankName, setPayoutBankName] = useState("");
  const [defaultPayoutMethod, setDefaultPayoutMethod] = useState("momo");

  // Step 4 — Terms
  const [agreed, setAgreed] = useState(false);

  const handlePersonalInfoSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await auth.registerBusinessOwner({ full_name: fullName, login_phone: phone, email: email || undefined, password });
      setStep("business_info");
    } catch (err) {
      setError("Could not create your account. Please check your details.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBusinessInfoSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await auth.submitBusinessInfo({
        ghana_card_number: ghanaCardNumber,
        ghana_card_front_image: ghanaCardFront,
        ghana_card_back_image: ghanaCardBack,
        gps_address: gpsAddress,
        business_contact_phone: businessContactPhone,
        is_formal: isFormal,
        business_reg_certificate: isFormal ? businessRegCertificate : undefined,
        tin: isFormal ? tin : undefined,
      });
      const fresh = await auth.refreshUser();
      if (fresh.registration_step === "complete") {
        setShowBizDash(true);
      } else {
        setStep(fresh.registration_step);
      }
    } catch (err) {
      setError("Could not save your business information. Please check your details.");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentInfoSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await auth.submitPayoutInfo({
        default_payout_method: defaultPayoutMethod,
        payout_momo_number: payoutMomoNumber || undefined,
        payout_momo_name: payoutMomoName || undefined,
        payout_momo_network: payoutMomoNetwork || undefined,
        payout_bank_account_number: payoutBankAccountNumber || undefined,
        payout_bank_account_name: payoutBankAccountName || undefined,
        payout_bank_name: payoutBankName || undefined,
      });
      const fresh = await auth.refreshUser();
      if (fresh.registration_step === "complete") {
        setShowBizDash(true);
      } else {
        setStep(fresh.registration_step);
      }
    } catch (err) {
      setError("Could not save your payment details. Please check your details.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTermsSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await auth.acceptBusinessTerms();
      await auth.refreshUser();
      setShowBizDash(true);
    } catch (err) {
      setError("Could not record your acceptance. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{fontFamily:"'Georgia',serif",background:"#f4f5f7",minHeight:"100vh"}}>
      <div style={{background:`linear-gradient(135deg,${C.darkBrown},${C.black})`,padding:"0 16px",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 20px rgba(0,0,0,0.4)"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
        <div style={{maxWidth:520,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:58}}>
          <div style={{color:C.gold,fontWeight:900,fontSize:"0.92rem"}}>👑 AshantiHub — Business Registration</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={()=>setPage("home")} style={{background:"none",border:"1px solid #444",color:"#aaa",borderRadius:20,padding:"4px 12px",fontSize:"0.68rem",cursor:"pointer",fontFamily:"inherit"}}>← Home</button>
            {user && <button onClick={()=>auth.logout()} style={{background:"none",border:"1px solid #444",color:"#aaa",borderRadius:20,padding:"4px 12px",fontSize:"0.68rem",cursor:"pointer",fontFamily:"inherit"}}>Sign Out</button>}
          </div>
        </div>
      </div>

      <div style={{maxWidth:440,margin:"0 auto",padding:"24px 20px 60px"}}>
        <div style={{fontSize:"0.68rem",fontWeight:800,color:C.kente2,marginBottom:16,letterSpacing:1}}>STEP {STEP_LABELS[step]}</div>

        {error && <div style={{background:"#fdecea",color:"#b00020",borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:"0.78rem"}}>{error}</div>}

        {step==="personal_info" && (
          <form onSubmit={handlePersonalInfoSubmit}>
            <h2 style={{color:C.darkBrown,fontSize:"1.05rem",margin:"0 0 14px"}}>Create your business account</h2>
            <input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Full name" required style={inputStyle}/>
            <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Phone (+233...)" required style={inputStyle}/>
            <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="Email" style={inputStyle}/>
            <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password (min 8 characters)" required minLength={8} style={inputStyle}/>
            <button type="submit" disabled={submitting} style={submitStyle}>{submitting?"Creating account…":"Continue"}</button>
          </form>
        )}

        {step==="business_info" && (
          <form onSubmit={handleBusinessInfoSubmit}>
            <h2 style={{color:C.darkBrown,fontSize:"1.05rem",margin:"0 0 14px"}}>Tell us about your business</h2>
            <input value={ghanaCardNumber} onChange={e=>setGhanaCardNumber(e.target.value)} placeholder="Ghana Card number" required style={inputStyle}/>
            <label style={labelStyle}>Ghana Card — front
              <input type="file" accept="image/*" required onChange={e=>setGhanaCardFront(e.target.files[0])} style={inputStyle}/>
            </label>
            <label style={labelStyle}>Ghana Card — back
              <input type="file" accept="image/*" required onChange={e=>setGhanaCardBack(e.target.files[0])} style={inputStyle}/>
            </label>
            <input value={gpsAddress} onChange={e=>setGpsAddress(e.target.value)} placeholder="GPS address (e.g. AK-123-4567)" required style={inputStyle}/>
            <input value={businessContactPhone} onChange={e=>setBusinessContactPhone(e.target.value)} placeholder="Business contact phone (public)" required style={inputStyle}/>
            <label style={{...labelStyle,display:"flex",alignItems:"center",gap:8}}>
              <input type="checkbox" checked={isFormal} onChange={e=>setIsFormal(e.target.checked)}/>
              My business is formally registered with the Registrar General's Department
            </label>
            {isFormal && <>
              <label style={labelStyle}>Business registration certificate
                <input type="file" accept="application/pdf,image/*" required onChange={e=>setBusinessRegCertificate(e.target.files[0])} style={inputStyle}/>
              </label>
              <input value={tin} onChange={e=>setTin(e.target.value)} placeholder="TIN" required style={inputStyle}/>
            </>}
            <button type="submit" disabled={submitting} style={submitStyle}>{submitting?"Saving…":"Continue"}</button>
          </form>
        )}

        {step==="payment_info" && (
          <form onSubmit={handlePaymentInfoSubmit}>
            <h2 style={{color:C.darkBrown,fontSize:"1.05rem",margin:"0 0 14px"}}>How should we pay you?</h2>
            <input value={payoutMomoNumber} onChange={e=>setPayoutMomoNumber(e.target.value)} placeholder="Mobile money number" required={defaultPayoutMethod==="momo"} style={inputStyle}/>
            <input value={payoutMomoName} onChange={e=>setPayoutMomoName(e.target.value)} placeholder="Mobile money account name" style={inputStyle}/>
            <select value={payoutMomoNetwork} onChange={e=>setPayoutMomoNetwork(e.target.value)} style={inputStyle}>
              <option value="">Mobile money network</option>
              <option value="MTN">MTN</option>
              <option value="Vodafone">Vodafone</option>
              <option value="AirtelTigo">AirtelTigo</option>
            </select>
            <input value={payoutBankAccountNumber} onChange={e=>setPayoutBankAccountNumber(e.target.value)} placeholder="Bank account number" required={defaultPayoutMethod==="bank"} style={inputStyle}/>
            <input value={payoutBankAccountName} onChange={e=>setPayoutBankAccountName(e.target.value)} placeholder="Bank account name" style={inputStyle}/>
            <input value={payoutBankName} onChange={e=>setPayoutBankName(e.target.value)} placeholder="Bank name" style={inputStyle}/>
            <select value={defaultPayoutMethod} onChange={e=>setDefaultPayoutMethod(e.target.value)} style={inputStyle}>
              <option value="momo">Default payout: Mobile Money</option>
              <option value="bank">Default payout: Bank</option>
            </select>
            <button type="submit" disabled={submitting} style={submitStyle}>{submitting?"Saving…":"Continue"}</button>
          </form>
        )}

        {step==="terms" && (
          <form onSubmit={handleTermsSubmit}>
            <h2 style={{color:C.darkBrown,fontSize:"1.05rem",margin:"0 0 14px"}}>Business Agreement</h2>
            <div style={{background:"#f9f9f9",borderRadius:10,padding:"14px",fontSize:"0.74rem",color:"#444",lineHeight:1.6,whiteSpace:"pre-line",marginBottom:14,maxHeight:260,overflowY:"auto"}}>
              {TERMS_COPY}
            </div>
            <label style={{...labelStyle,display:"flex",alignItems:"center",gap:8}}>
              <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>
              I have read and agree to the AshantiHub Business Agreement
            </label>
            <button type="submit" disabled={submitting || !agreed} style={submitStyle}>{submitting?"Submitting…":"Submit for Verification"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the tests**

Create `frontend/BusinessRegistrationFlow.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BusinessRegistrationFlow from './components/BusinessRegistrationFlow.jsx'

function makeAuth(overrides = {}) {
  return {
    registerBusinessOwner: vi.fn().mockResolvedValue({}),
    submitBusinessInfo: vi.fn().mockResolvedValue({}),
    submitPayoutInfo: vi.fn().mockResolvedValue({}),
    acceptBusinessTerms: vi.fn().mockResolvedValue({}),
    refreshUser: vi.fn().mockResolvedValue({ registration_step: 'payment_info' }),
    logout: vi.fn(),
    ...overrides,
  }
}

function uploadFile(labelText) {
  const file = new File(['(binary)'], 'card.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText(labelText), { target: { files: [file] } })
}

describe('BusinessRegistrationFlow', () => {
  it('starts at personal_info when there is no user, and advances on submit', async () => {
    const auth = makeAuth()
    render(<BusinessRegistrationFlow user={null} auth={auth} setPage={vi.fn()} setShowBizDash={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Abena Owusu' } })
    fireEvent.change(screen.getByPlaceholderText('Phone (+233...)'), { target: { value: '+233201112233' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(auth.registerBusinessOwner).toHaveBeenCalledWith(
      expect.objectContaining({ full_name: 'Abena Owusu', login_phone: '+233201112233', password: 'secretpass' })
    ))
    await waitFor(() => expect(screen.getByText(/Tell us about your business/)).toBeInTheDocument())
  })

  it('starts directly at a resumed step when initialStep is provided', () => {
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="payment_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)
    expect(screen.getByText(/How should we pay you/)).toBeInTheDocument()
  })

  it('business_info step submits KYC fields and advances to the next incomplete step', async () => {
    const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'payment_info' }) })
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="business_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Ghana Card number'), { target: { value: 'GHA-000000000-0' } })
    uploadFile(/Ghana Card — front/i)
    uploadFile(/Ghana Card — back/i)
    fireEvent.change(screen.getByPlaceholderText('GPS address (e.g. AK-123-4567)'), { target: { value: 'AK-123-4567' } })
    fireEvent.change(screen.getByPlaceholderText('Business contact phone (public)'), { target: { value: '+233201112233' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(auth.submitBusinessInfo).toHaveBeenCalledWith(
      expect.objectContaining({ ghana_card_number: 'GHA-000000000-0', gps_address: 'AK-123-4567' })
    ))
    await waitFor(() => expect(screen.getByText(/How should we pay you/)).toBeInTheDocument())
  })

  it('business_info step goes straight to the dashboard when resubmitting fixes the only missing piece', async () => {
    const setShowBizDash = vi.fn()
    const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'complete' }) })
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="business_info" setPage={vi.fn()} setShowBizDash={setShowBizDash} />)

    fireEvent.change(screen.getByPlaceholderText('Ghana Card number'), { target: { value: 'GHA-000000000-0' } })
    uploadFile(/Ghana Card — front/i)
    uploadFile(/Ghana Card — back/i)
    fireEvent.change(screen.getByPlaceholderText('GPS address (e.g. AK-123-4567)'), { target: { value: 'AK-123-4567' } })
    fireEvent.change(screen.getByPlaceholderText('Business contact phone (public)'), { target: { value: '+233201112233' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(setShowBizDash).toHaveBeenCalledWith(true))
  })

  it('reveals certificate and TIN fields only when formally registered is checked', () => {
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="business_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)
    expect(screen.queryByPlaceholderText('TIN')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/formally registered/i))
    expect(screen.getByPlaceholderText('TIN')).toBeInTheDocument()
  })

  it('payment_info step submits payout fields and advances to terms', async () => {
    const auth = makeAuth({ refreshUser: vi.fn().mockResolvedValue({ registration_step: 'terms' }) })
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="payment_info" setPage={vi.fn()} setShowBizDash={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Mobile money number'), { target: { value: '+233201112233' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(auth.submitPayoutInfo).toHaveBeenCalledWith(
      expect.objectContaining({ default_payout_method: 'momo', payout_momo_number: '+233201112233' })
    ))
    await waitFor(() => expect(screen.getByText(/Business Agreement/)).toBeInTheDocument())
  })

  it('terms step requires the checkbox before Submit for Verification is enabled', () => {
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="terms" setPage={vi.fn()} setShowBizDash={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Submit for Verification' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/I have read and agree/i))
    expect(screen.getByRole('button', { name: 'Submit for Verification' })).not.toBeDisabled()
  })

  it('accepting terms calls acceptBusinessTerms, refreshUser, and opens the dashboard', async () => {
    const auth = makeAuth()
    const setShowBizDash = vi.fn()
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={auth} initialStep="terms" setPage={vi.fn()} setShowBizDash={setShowBizDash} />)

    fireEvent.click(screen.getByLabelText(/I have read and agree/i))
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Verification' }))

    await waitFor(() => expect(auth.acceptBusinessTerms).toHaveBeenCalled())
    await waitFor(() => expect(auth.refreshUser).toHaveBeenCalled())
    await waitFor(() => expect(setShowBizDash).toHaveBeenCalledWith(true))
  })

  it('shows an error and stays on the same step when a submission fails', async () => {
    const auth = makeAuth({ registerBusinessOwner: vi.fn().mockRejectedValue(new Error('failed')) })
    render(<BusinessRegistrationFlow user={null} auth={auth} setPage={vi.fn()} setShowBizDash={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Abena Owusu' } })
    fireEvent.change(screen.getByPlaceholderText('Phone (+233...)'), { target: { value: '+233201112233' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 characters)'), { target: { value: 'secretpass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(screen.getByText(/Could not create your account/)).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Full name')).toBeInTheDocument()
  })

  it('prefills business_info text fields from the prefill prop', () => {
    render(<BusinessRegistrationFlow user={{fullName:'Abena'}} auth={makeAuth()} initialStep="business_info"
      prefill={{ ghana_card_number: 'GHA-111', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false, tin: '' }}
      setPage={vi.fn()} setShowBizDash={vi.fn()} />)
    expect(screen.getByPlaceholderText('Ghana Card number')).toHaveValue('GHA-111')
    expect(screen.getByPlaceholderText('GPS address (e.g. AK-123-4567)')).toHaveValue('AK-1')
  })

  it('clicking Home navigates back via setPage', () => {
    const setPage = vi.fn()
    render(<BusinessRegistrationFlow user={null} auth={makeAuth()} setPage={setPage} setShowBizDash={vi.fn()} />)
    fireEvent.click(screen.getByText('← Home'))
    expect(setPage).toHaveBeenCalledWith('home')
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `cd frontend && npx vitest run BusinessRegistrationFlow.test.jsx`

Expected: all 11 tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/BusinessRegistrationFlow.jsx frontend/BusinessRegistrationFlow.test.jsx
git commit -m "feat: add BusinessRegistrationFlow component"
```

---

### Task 9: Wire the flow into `AshantiHub`

**Files:**
- Modify: `frontend/App.jsx` (imports, `user` mapping, early-return gate)

**Interfaces:**
- Consumes: `BusinessRegistrationFlow` from Task 8.
- Produces: business owners with an incomplete registration always land on `BusinessRegistrationFlow`, regardless of `page` or any other UI state. A logged-out visitor who clicks "Register Your Business" (About page / Business page CTA — both already call `setPage("register")`) also lands there, starting at `personal_info`.

- [ ] **Step 1: Add the import**

In `frontend/App.jsx`, add this line after the existing `import AccountPanel from "./components/AccountPanel.jsx";`:

```js
import BusinessRegistrationFlow from "./components/BusinessRegistrationFlow.jsx";
```

- [ ] **Step 2: Extend the `user` mapping**

In `frontend/App.jsx`, replace the line (currently around line 2998):

```js
  const user=auth.user ? {fullName:auth.user.full_name,accountType:auth.user.account_type,id:auth.user.id} : null;
```

with:

```js
  const user=auth.user ? {fullName:auth.user.full_name,accountType:auth.user.account_type,id:auth.user.id,registrationStep:auth.user.registration_step,kycStatus:auth.user.kyc_status,kycRejectionReason:auth.user.kyc_rejection_reason} : null;
```

- [ ] **Step 3: Add the gate**

In `frontend/App.jsx`, immediately before the line `if(isAdmin) return <StaffDashboard auth={auth} onExit={()=>setIsAdmin(false)}/>;` (currently around line 3148), insert:

```js
  const showRegistrationFlow = (page==="register" && !user) ||
    (user?.accountType==="business_owner" && user.registrationStep && user.registrationStep!=="complete");
  if(showRegistrationFlow) return <BusinessRegistrationFlow user={user} auth={auth} initialStep={user?.registrationStep} setPage={setPage} setShowBizDash={setShowBizDash}/>;
```

This single condition covers both entry points (fresh visitor navigating to `page==="register"`, and a business owner whose registration isn't finished yet, from anywhere in the app) without ever needing to unmount/remount the component between them — once a fresh visitor completes Stage 1, `user.accountType` becomes `"business_owner"` on the very next render, so the second clause takes over from the first with no gap, preserving `BusinessRegistrationFlow`'s local step state.

Known limitation (not in scope for this plan): a logged-in **customer** clicking "Register Your Business" won't see anything, since `!user` is false for them and they aren't a business owner either — same as today's behavior for everyone, just now narrowed to this one case instead of affecting all visitors.

- [ ] **Step 4: Verify manually**

There's no existing full-`AshantiHub`-level test file in this codebase (the app is tested by extracting and testing individual exported components, per `Card.test.jsx`/`AuthModal.test.jsx`/`StaffDashboard.test.jsx`), so this wiring step is covered by Task 6's `useAuth` tests and Task 8's `BusinessRegistrationFlow` tests for its logic, plus this manual check:

Run: `cd frontend && npm run build`
Expected: builds with no errors.

Run: `cd frontend && npm run dev`, then in a browser: click "Register Your Business" (About page) with no account, fill out personal info, and confirm you land on "Tell us about your business" (Business Information) without any page reload or flash.

- [ ] **Step 5: Run the full test suite**

Run: `cd frontend && npx vitest run`

Expected: all test files pass (no regressions from the `user` object shape change).

- [ ] **Step 6: Commit**

```bash
git add frontend/App.jsx
git commit -m "feat: wire BusinessRegistrationFlow into AshantiHub with a forced-resume gate"
```

---

### Task 10: Allow reading the business profile + `BusinessDashboard` approval gating

**Files:**
- Modify: `backend/accounts/views.py` (`BusinessOwnerProfileUpdateView`)
- Modify: `backend/accounts/tests/test_business_owner_profile_update.py`
- Modify: `frontend/App.jsx` (`BusinessDashboard`, and its call site)
- Create: `frontend/BusinessDashboard.test.jsx`

**Interfaces:**
- Consumes: `BusinessRegistrationFlow` from Task 8, `user.kycStatus`/`user.kycRejectionReason` from Task 9's `user` mapping.
- Produces: `GET /api/accounts/business-owners/me/profile/` now works (was PATCH-only, and `useBusinessProfile` — already written, already calling this GET — was silently always failing until now). `BusinessDashboard` gains a `auth` prop and gates all tabs behind `kyc_status === "verified"`.

- [ ] **Step 1: Allow GET on the profile endpoint**

In `backend/accounts/views.py`, replace the `BusinessOwnerProfileUpdateView` class definition line and `http_method_names` line:

```python
class BusinessOwnerProfileUpdateView(generics.UpdateAPIView):
    serializer_class = BusinessOwnerProfileUpdateSerializer
    permission_classes = [IsBusinessOwner]
    http_method_names = ["patch"]

    def get_object(self):
        return self.request.user.profile
```

with:

```python
class BusinessOwnerProfileUpdateView(generics.RetrieveUpdateAPIView):
    serializer_class = BusinessOwnerProfileUpdateSerializer
    permission_classes = [IsBusinessOwner]
    http_method_names = ["get", "patch"]

    def get_object(self):
        return self.request.user.profile
```

- [ ] **Step 2: Write the test**

Add to `backend/accounts/tests/test_business_owner_profile_update.py`, inside `BusinessOwnerProfileUpdateTests` (after `test_spoofed_ghana_card_image_is_rejected` from Task 3):

```python
    def test_owner_can_fetch_their_own_profile(self):
        owner = self._make_owner(BusinessOwner.PENDING)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.get("/api/accounts/business-owners/me/profile/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ghana_card_number"], "GHA-777888999-0")
```

- [ ] **Step 3: Run the backend test**

Run: `cd backend && python manage.py test accounts.tests.test_business_owner_profile_update -v 2`

Expected: all tests pass, including the new one.

- [ ] **Step 4: Commit the backend fix**

```bash
git add backend/accounts/views.py backend/accounts/tests/test_business_owner_profile_update.py
git commit -m "fix: allow GET on business-owners/me/profile/"
```

- [ ] **Step 5: Add gating to `BusinessDashboard`**

In `frontend/App.jsx`, change the `BusinessDashboard` function signature (currently `function BusinessDashboard({ onExit, user }) {`) to:

```jsx
export function BusinessDashboard({ onExit, user, auth }) {
```

(Adding `export` makes it importable in the new test file, matching `AuthModal`/`Card`/`StaffDashboard`'s existing convention.)

Immediately after the existing `const [showPayModal, setShowPayModal] = useState(false);` / `const [selectedPlan, setSelectedPlan] = useState(null);` state declarations, add:

```js
  const [resubmitting, setResubmitting] = useState(false);
  const isVerified = user?.kycStatus === "verified";
  const isRejected = user?.kycStatus === "rejected";
```

Immediately after those, before the `const { data: listings, ... } = useMyListings();` line, add the resubmit early-return:

```js
  if (resubmitting) {
    return <BusinessRegistrationFlow
      user={user} auth={auth} initialStep="business_info" prefill={profile}
      setPage={()=>setResubmitting(false)} setShowBizDash={()=>setResubmitting(false)}
    />;
  }
```

Wait — `profile` isn't defined yet at that point (it comes from the `useBusinessProfile()` call below). Move this early-return to **after** the `useMyListings`/`useBusinessProfile`/`useSubscriptionPlans`/`useMySubscription` hook calls instead — i.e. insert it right after the existing block:

```js
  const { data: listings, isLoading: listingsLoading, isError: listingsError, refetch: refetchListings } = useMyListings();
  const { data: profile, isLoading: profileLoading, isError: profileError } = useBusinessProfile();
  const { data: subPlans, isLoading: plansLoading, isError: plansError } = useSubscriptionPlans();
  const { data: subscription, isLoading: subLoading, isError: subError, refetch: refetchSubscription } = useMySubscription();

  if (resubmitting) {
    return <BusinessRegistrationFlow
      user={user} auth={auth} initialStep="business_info" prefill={profile}
      setPage={()=>setResubmitting(false)} setShowBizDash={()=>setResubmitting(false)}
    />;
  }
```

(Hooks must all run unconditionally before this early return, same rule that already governs every other hook call in this component — this placement respects it.)

- [ ] **Step 6: Disable tabs and gate the content area**

In `frontend/App.jsx`, inside `BusinessDashboard`'s render, find this line (the tab bar's `.map`):

```jsx
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setBizTab(t.id)} style={{background:"none",border:"none",borderBottom:bizTab===t.id?`3px solid ${C.gold}`:"3px solid transparent",color:bizTab===t.id?C.darkBrown:"#888",padding:"12px 16px",fontSize:"0.75rem",fontWeight:bizTab===t.id?800:600,cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit"}}>
              {t.icon} {t.label}
            </button>
          ))}
```

Replace it with:

```jsx
          {tabs.map(t=>(
            <button key={t.id} disabled={!isVerified} onClick={()=>isVerified&&setBizTab(t.id)} style={{background:"none",border:"none",borderBottom:bizTab===t.id?`3px solid ${C.gold}`:"3px solid transparent",color:!isVerified?"#ccc":bizTab===t.id?C.darkBrown:"#888",padding:"12px 16px",fontSize:"0.75rem",fontWeight:bizTab===t.id?800:600,cursor:isVerified?"pointer":"not-allowed",whiteSpace:"nowrap",fontFamily:"inherit"}}>
              {t.icon} {t.label}
            </button>
          ))}
```

Then find the line `{actionError&&<div style={{background:"#fee2e2",color:"#dc2626",borderRadius:12,padding:"10px 14px",fontSize:"0.78rem",marginBottom:16}}>{actionError}</div>}` (immediately followed by `{bizTab==="overview"&&(`). Insert this conditional wrapper immediately after the `actionError` line and before `{bizTab==="overview"&&(`:

```jsx
        {!isVerified ? (
          <div style={{background:"white",borderRadius:16,padding:"28px 24px",textAlign:"center",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
            {isRejected ? (
              <>
                <div style={{fontSize:"2rem",marginBottom:10}}>⚠️</div>
                <div style={{fontWeight:900,color:"#dc2626",fontSize:"1.05rem",marginBottom:8}}>Your application needs changes</div>
                <div style={{color:"#555",fontSize:"0.85rem",lineHeight:1.6,marginBottom:18,maxWidth:420,marginLeft:"auto",marginRight:"auto"}}>{user?.kycRejectionReason || "Our team found an issue with your submission."}</div>
                <button onClick={()=>setResubmitting(true)} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:30,padding:"11px 24px",fontWeight:900,fontSize:"0.85rem",cursor:"pointer",fontFamily:"inherit"}}>Fix and Resubmit</button>
              </>
            ) : (
              <>
                <div style={{fontSize:"2rem",marginBottom:10}}>⏳</div>
                <div style={{fontWeight:900,color:C.darkBrown,fontSize:"1.05rem",marginBottom:8}}>Your application is under review</div>
                <div style={{color:"#555",fontSize:"0.85rem",lineHeight:1.6}}>Our team is verifying your Ghana Card and business details. This usually takes 1-2 business days — you'll be able to manage listings, enquiries and your subscription here as soon as you're approved.</div>
              </>
            )}
          </div>
        ) : (
          <>
```

Then, at the **end** of the tab-content switch — immediately after the line `)}` that closes the `{bizTab==="subscription"&&(` block (the line right before the closing `</div>` of the `maxWidth:960` content wrapper) — insert the matching close:

```jsx
          </>
        )}
```

- [ ] **Step 7: Update the `BusinessDashboard` call site**

In `frontend/App.jsx`, change the line:

```js
  if(showBizDash) return <BusinessDashboard onExit={()=>setShowBizDash(false)} user={user}/>;
```

to:

```js
  if(showBizDash) return <BusinessDashboard onExit={()=>setShowBizDash(false)} user={user} auth={auth}/>;
```

- [ ] **Step 8: Write the tests**

Create `frontend/BusinessDashboard.test.jsx`:

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { BusinessDashboard } from './App.jsx'
import { server } from './mocks/server.js'

function renderWithQueryClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function mockDashboardData({ profile } = {}) {
  server.use(
    http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([])),
    http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json(profile || {
      ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false,
    })),
    http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
    http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
  )
}

function makeAuth(overrides = {}) {
  return {
    submitBusinessInfo: vi.fn().mockResolvedValue({}),
    submitPayoutInfo: vi.fn().mockResolvedValue({}),
    acceptBusinessTerms: vi.fn().mockResolvedValue({}),
    refreshUser: vi.fn().mockResolvedValue({ registration_step: 'complete' }),
    logout: vi.fn(),
    ...overrides,
  }
}

describe('BusinessDashboard approval gating', () => {
  it('shows the normal tabs when verified', async () => {
    mockDashboardData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', kycStatus: 'verified' }} />)
    await waitFor(() => expect(screen.getByText(/Akwaaba, Abena/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Listings & Prices/ })).not.toBeDisabled()
  })

  it('shows a pending-review status card with disabled tabs when pending', async () => {
    mockDashboardData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', kycStatus: 'pending' }} />)
    expect(screen.getByText(/under review/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Listings & Prices/ })).toBeDisabled()
    expect(screen.queryByText(/Akwaaba, Abena/)).not.toBeInTheDocument()
  })

  it('shows the rejection reason and a resubmit button when rejected', async () => {
    mockDashboardData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', kycStatus: 'rejected', kycRejectionReason: 'Blurry Ghana Card' }} />)
    expect(screen.getByText('Blurry Ghana Card')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fix and Resubmit' })).toBeInTheDocument()
  })

  it('clicking Fix and Resubmit opens the registration flow pre-filled with the existing profile', async () => {
    mockDashboardData({ profile: { ghana_card_number: 'GHA-999', gps_address: 'AK-9', business_contact_phone: '+233209999999', is_formal: false } })
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', kycStatus: 'rejected', kycRejectionReason: 'Blurry Ghana Card' }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fix and Resubmit' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Fix and Resubmit' }))
    await waitFor(() => expect(screen.getByPlaceholderText('Ghana Card number')).toHaveValue('GHA-999'))
  })
})
```

- [ ] **Step 9: Run the tests**

Run: `cd frontend && npx vitest run BusinessDashboard.test.jsx`

Expected: all 4 tests pass.

- [ ] **Step 10: Run the full frontend and backend suites**

Run: `cd frontend && npx vitest run`
Run: `cd backend && python manage.py test`

Expected: everything passes, no regressions.

- [ ] **Step 11: Commit**

```bash
git add frontend/App.jsx frontend/BusinessDashboard.test.jsx
git commit -m "feat: gate BusinessDashboard behind KYC approval, add rejection resubmit flow"
```
