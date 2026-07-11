# Login/Session (Backend + Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add login endpoints for `Customer`/`BusinessOwner`/`StaffUser`, make registration/activation issue a usable token, and build the frontend auth UI (`AuthModal`, `useAuth`) that replaces the currently dead `authModal`/`user` state in `App.jsx`.

**Architecture:** Backend adds three new login endpoints mirroring the existing per-account-type registration endpoint pattern (`accounts/serializers.py`, `accounts/views.py`, `accounts/urls.py`), reusing the already-built `issue_token`/`MultiAccountJWTAuthentication` machinery that today is only exercised in tests. Frontend adds a thin auth layer to `apiClient.js`, a `useAuth` hook following the existing `frontend/hooks/` convention, and an `AuthModal` component added to `App.jsx` as a new top-level `export function` (matching how `Card`/`MapView` are already exported from that file for testing) rather than a new file, since this codebase has not yet done its `components/` extraction (`docs/FRONTEND_MODERNIZATION.md`).

**Tech Stack:** Django 5.0 / DRF 3.15 / `rest_framework_simplejwt` (already installed, no new dependencies). React 19 / `@tanstack/react-query` 5.59 / Vitest + MSW (already installed, no new dependencies).

## Global Constraints

- Per `docs/superpowers/specs/2026-07-11-login-session-design.md`: three separate login endpoints (customer, business_owner, staff), not one unified endpoint — phone/email uniqueness is only enforced within each account table.
- `StaffUser` login uses email only (`StaffUser.phone` has no `unique=True`).
- Any login failure (unknown identifier or wrong password) returns the identical `400 {"non_field_errors": ["Invalid credentials"]}` — never reveal which part was wrong.
- New `"login"` throttle scope, `5/min`, added to `DEFAULT_THROTTLE_RATES` in `backend/ashantihub/settings.py:76-80`, shared by all three login views (same class of risk regardless of account type).
- `ACCESS_TOKEN_LIFETIME` stays at the existing 12h (`settings.py:84`) — no refresh token, no blacklist, no change to `SIMPLE_JWT` in this plan.
- Business owner login succeeds regardless of `kyc_status` (pending/verified/rejected all log in) — only listing publication and payouts are KYC-gated, not login itself.
- No staff sign-up UI — staff accounts remain invite-only.
- Frontend token storage: `localStorage` key `"ashantihub.auth"`, JSON `{token, account_type, id, full_name}`. Not `sessionStorage`, not cookies — `MultiAccountJWTAuthentication` expects a `Bearer` header, not a cookie.
- New frontend code in `apiClient.js`/`hooks/` follows those files' existing style: single quotes, no semicolons (see `frontend/apiClient.js`, `frontend/hooks/useCategories.js`). New code added to `App.jsx` follows that file's existing style: double quotes, semicolons, dense/no extra whitespace (see `ReferralModal` at `App.jsx:1915-1962`).
- Backend tests run via `docker compose run --rm web python manage.py test accounts`. Frontend tests run via `cd frontend && npm run test`.

---

## File Structure

```
backend/
  ashantihub/
    settings.py                          # modified: add "login" to DEFAULT_THROTTLE_RATES
  accounts/
    serializers.py                       # modified: add CustomerLoginSerializer, BusinessOwnerLoginSerializer, StaffLoginSerializer
    views.py                             # modified: add 3 login views; CustomerRegisterView/BusinessOwnerRegisterView/StaffActivateView now issue tokens; me() now returns full_name
    urls.py                              # modified: mount 3 login paths
    tests/
      test_login.py                      # new
      test_authentication.py             # modified: me() response now includes full_name
      test_customer_registration.py      # modified: registration response includes a working token
      test_business_owner_registration.py # modified: registration response includes a working token
      test_staff_invite.py               # modified: activation response includes a working token

frontend/
  apiClient.js                           # modified: add apiPost, apiPostForm, getStoredAuth, setStoredAuth, auth header injection, 401 handling
  apiClient.test.js                      # modified: cover the above
  hooks/
    useAuth.js                           # new
    __tests__/
      useAuth.test.jsx                   # new
  App.jsx                                # modified: new `export function AuthModal(...)`; AshantiHub wired to useAuth() instead of dead authModal/user state
  AuthModal.test.jsx                     # new (top-level, matches Card.test.jsx/MapView.test.jsx placement)
```

---

### Task 1: Login endpoints — customer, business owner, staff

**Files:**
- Create: `backend/accounts/tests/test_login.py`
- Modify: `backend/ashantihub/settings.py:76-80`
- Modify: `backend/accounts/serializers.py`
- Modify: `backend/accounts/views.py`
- Modify: `backend/accounts/urls.py`

**Interfaces:**
- Consumes: `accounts.authentication.issue_token(account, account_type)` (existing, `backend/accounts/authentication.py:15-21`, currently called only from tests). `django.contrib.auth.hashers.check_password`.
- Produces: `POST /api/accounts/customers/login/`, `POST /api/accounts/business-owners/login/`, `POST /api/accounts/staff/login/` — each accepts `{"identifier": str, "password": str}`, returns `200 {"token": str, "account_type": str, "id": int, "full_name": str}` on success or `400 {"non_field_errors": ["Invalid credentials"]}` on failure. Task 2 and the frontend tasks depend on this exact response shape.

- [ ] **Step 1: Write the failing tests**

Create `backend/accounts/tests/test_login.py`:

```python
from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer, Role, StaffUser


class LoginTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Owusu",
            phone="+233241234567",
            email="ama@example.com",
            password_hash=make_password("correct-horse-battery-staple"),
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Business",
            login_phone="+233201112233",
            email="kwame@example.com",
            password_hash=make_password("correct-horse-battery-staple"),
        )
        self.staff = StaffUser.objects.create(
            full_name="Support Staffer",
            email="support@example.com",
            password_hash=make_password("correct-horse-battery-staple"),
            role=Role.objects.get(name=Role.SUPPORT),
        )

    def test_customer_login_with_phone_succeeds(self):
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "+233241234567", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["account_type"], "customer")
        self.assertEqual(data["id"], self.customer.id)
        self.assertEqual(data["full_name"], "Ama Owusu")
        self.assertTrue(data["token"])

    def test_customer_login_with_email_succeeds(self):
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "ama@example.com", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_customer_login_wrong_password_rejected(self):
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "+233241234567", "password": "wrong-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"non_field_errors": ["Invalid credentials"]})

    def test_customer_login_unknown_identifier_returns_same_error_as_wrong_password(self):
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "+233200000000", "password": "wrong-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"non_field_errors": ["Invalid credentials"]})

    def test_business_owner_login_with_phone_succeeds(self):
        response = self.client.post(
            "/api/accounts/business-owners/login/",
            {"identifier": "+233201112233", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["account_type"], "business_owner")
        self.assertEqual(data["id"], self.owner.id)

    def test_business_owner_login_succeeds_while_kyc_pending(self):
        self.assertEqual(self.owner.kyc_status, BusinessOwner.PENDING)
        response = self.client.post(
            "/api/accounts/business-owners/login/",
            {"identifier": "kwame@example.com", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_staff_login_with_email_succeeds(self):
        response = self.client.post(
            "/api/accounts/staff/login/",
            {"identifier": "support@example.com", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["account_type"], "staff")
        self.assertEqual(data["id"], self.staff.id)

    def test_login_token_authenticates_against_me_endpoint(self):
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "+233241234567", "password": "correct-horse-battery-staple"},
            format="json",
        )
        token = response.json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        me_response = self.client.get("/api/accounts/me/")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["id"], self.customer.id)

    def test_login_throttles_after_five_requests_per_minute(self):
        for _ in range(5):
            response = self.client.post(
                "/api/accounts/customers/login/",
                {"identifier": "+233241234567", "password": "wrong-password"},
                format="json",
            )
            self.assertNotEqual(response.status_code, 429)
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "+233241234567", "password": "wrong-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 429)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_login`
Expected: FAIL — `404` on all three login URLs (they don't exist yet).

- [ ] **Step 3: Add the `"login"` throttle scope**

Modify `backend/ashantihub/settings.py:76-80` from:

```python
    "DEFAULT_THROTTLE_RATES": {
        "customer_register": "5/min",
        "business_owner_register": "5/min",
        "staff_activate": "5/min",
    },
```

to:

```python
    "DEFAULT_THROTTLE_RATES": {
        "customer_register": "5/min",
        "business_owner_register": "5/min",
        "staff_activate": "5/min",
        "login": "5/min",
    },
```

- [ ] **Step 4: Add the login serializers**

In `backend/accounts/serializers.py`, change the import line at the top from:

```python
from django.contrib.auth.hashers import make_password
```

to:

```python
from django.contrib.auth.hashers import check_password, make_password
from django.db.models import Q
```

Then add these three serializers at the end of the file:

```python
class CustomerLoginSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    password = serializers.CharField()

    def validate(self, attrs):
        account = Customer.objects.filter(
            Q(phone=attrs["identifier"]) | Q(email=attrs["identifier"])
        ).first()
        if account is None or not check_password(attrs["password"], account.password_hash):
            raise serializers.ValidationError("Invalid credentials")
        self.account = account
        return attrs


class BusinessOwnerLoginSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    password = serializers.CharField()

    def validate(self, attrs):
        account = BusinessOwner.objects.filter(
            Q(login_phone=attrs["identifier"]) | Q(email=attrs["identifier"])
        ).first()
        if account is None or not check_password(attrs["password"], account.password_hash):
            raise serializers.ValidationError("Invalid credentials")
        self.account = account
        return attrs


class StaffLoginSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    password = serializers.CharField()

    def validate(self, attrs):
        account = StaffUser.objects.filter(email=attrs["identifier"]).first()
        if account is None or not check_password(attrs["password"], account.password_hash):
            raise serializers.ValidationError("Invalid credentials")
        self.account = account
        return attrs
```

- [ ] **Step 5: Add the login views**

In `backend/accounts/views.py`, change the imports at the top from:

```python
from .models import BusinessOwner, StaffUser
from .permissions import HasRolePermission
from .serializers import (
    INVITE_TOKEN_LIFETIME,
    BusinessOwnerKYCDetailSerializer,
    BusinessOwnerKYCSerializer,
    BusinessOwnerRegistrationSerializer,
    BusinessOwnerProfileUpdateSerializer,
    CustomerRegistrationSerializer,
    PayoutDetailSerializer,
    StaffActivateSerializer,
    StaffInviteSerializer,
)
```

to:

```python
from .authentication import issue_token
from .models import BusinessOwner, Customer, StaffUser
from .permissions import HasRolePermission
from .serializers import (
    INVITE_TOKEN_LIFETIME,
    BusinessOwnerKYCDetailSerializer,
    BusinessOwnerKYCSerializer,
    BusinessOwnerLoginSerializer,
    BusinessOwnerRegistrationSerializer,
    BusinessOwnerProfileUpdateSerializer,
    CustomerLoginSerializer,
    CustomerRegistrationSerializer,
    PayoutDetailSerializer,
    StaffActivateSerializer,
    StaffInviteSerializer,
    StaffLoginSerializer,
)
```

Then add these three views (placed after `StaffResendInviteView`, before `KYCPendingQueueView`):

```python
class CustomerLoginView(generics.GenericAPIView):
    serializer_class = CustomerLoginSerializer
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = serializer.account
        return Response({
            "token": issue_token(account, "customer"),
            "account_type": "customer",
            "id": account.id,
            "full_name": account.full_name,
        })


class BusinessOwnerLoginView(generics.GenericAPIView):
    serializer_class = BusinessOwnerLoginSerializer
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = serializer.account
        return Response({
            "token": issue_token(account, "business_owner"),
            "account_type": "business_owner",
            "id": account.id,
            "full_name": account.full_name,
        })


class StaffLoginView(generics.GenericAPIView):
    serializer_class = StaffLoginSerializer
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = serializer.account
        return Response({
            "token": issue_token(account, "staff"),
            "account_type": "staff",
            "id": account.id,
            "full_name": account.full_name,
        })
```

- [ ] **Step 6: Wire the URLs**

In `backend/accounts/urls.py`, add three paths after `staff/<int:pk>/resend-invite/` and before `business-owners/register/`:

```python
    path("customers/login/", views.CustomerLoginView.as_view(), name="customer-login"),
    path("business-owners/login/", views.BusinessOwnerLoginView.as_view(), name="business-owner-login"),
    path("staff/login/", views.StaffLoginView.as_view(), name="staff-login"),
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_login`
Expected: PASS, all 9 tests.

- [ ] **Step 8: Run full accounts regression suite**

Run: `docker compose run --rm web python manage.py test accounts`
Expected: PASS — confirms the new imports/serializers didn't break the existing registration/KYC/staff-invite suites.

- [ ] **Step 9: Commit**

```bash
git add backend/accounts/tests/test_login.py backend/accounts/serializers.py backend/accounts/views.py backend/accounts/urls.py backend/ashantihub/settings.py
git commit -m "feat: add login endpoints for customer, business owner, and staff accounts"
```

---

### Task 2: Registration and staff activation issue a token; `/me/` returns `full_name`

**Files:**
- Modify: `backend/accounts/views.py`
- Modify: `backend/accounts/tests/test_authentication.py`
- Modify: `backend/accounts/tests/test_customer_registration.py`
- Modify: `backend/accounts/tests/test_business_owner_registration.py`
- Modify: `backend/accounts/tests/test_staff_invite.py`

**Interfaces:**
- Consumes: `issue_token` (already imported into `views.py` by Task 1).
- Produces: `CustomerRegisterView`/`BusinessOwnerRegisterView` responses now include `"token"`. `StaffActivateView` response becomes `{"status": "activated", "token": str}`. `GET /api/accounts/me/` response becomes `{"account_type": str, "id": int, "full_name": str}`. The frontend tasks (3-6) depend on all of these shapes, and on existing UI in `App.jsx` (`ReviewsModal` at `App.jsx:1643`, `ReferralModal` at `App.jsx:1916`, header greeting at `App.jsx:3058-3059,3116`) that already reads `user.fullName` and would otherwise silently break once real login replaces the dead mock `user` state.

- [ ] **Step 1: Write the failing tests**

In `backend/accounts/tests/test_authentication.py`, change:

```python
    def test_me_endpoint_resolves_customer_from_token(self):
        token = issue_token(self.customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(), {"account_type": "customer", "id": self.customer.id}
        )
```

to:

```python
    def test_me_endpoint_resolves_customer_from_token(self):
        token = issue_token(self.customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"account_type": "customer", "id": self.customer.id, "full_name": "Ama Owusu"},
        )
```

In `backend/accounts/tests/test_customer_registration.py`, add this test method to `CustomerRegistrationTests`:

```python
    def test_registration_response_includes_a_working_token(self):
        response = self.client.post(
            "/api/accounts/customers/register/", self.valid_payload, format="json"
        )
        self.assertEqual(response.status_code, 201)
        token = response.json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        me_response = self.client.get("/api/accounts/me/")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["account_type"], "customer")
```

In `backend/accounts/tests/test_business_owner_registration.py`, add this test method to `BusinessOwnerRegistrationTests` (reusing that file's existing `self.base_payload`, `self.client`, and `APIClient` setup):

```python
    def test_registration_response_includes_a_working_token(self):
        response = self.client.post(
            "/api/accounts/business-owners/register/", self.base_payload, format="multipart"
        )
        self.assertEqual(response.status_code, 201, response.content)
        token = response.json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        me_response = self.client.get("/api/accounts/me/")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["account_type"], "business_owner")
```

In `backend/accounts/tests/test_staff_invite.py`, add this test method to `StaffInviteTests`:

```python
    def test_activation_response_includes_a_working_token(self):
        StaffUser.objects.create(
            full_name="Token Hire",
            email="tokenhire@example.com",
            password_hash="unusable",
            role=Role.objects.get(name="support"),
            invited_by=self.super_admin,
            invite_token="token-hire-abc",
            invite_expires_at=timezone.now() + datetime.timedelta(days=7),
        )
        response = self.client.post(
            "/api/accounts/staff/activate/",
            {"token": "token-hire-abc", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        token = response.json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        me_response = self.client.get("/api/accounts/me/")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["account_type"], "staff")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_authentication accounts.tests.test_customer_registration accounts.tests.test_business_owner_registration accounts.tests.test_staff_invite`
Expected: FAIL — `me()` response is missing `full_name`; registration/activation responses have no `"token"` key (`KeyError`).

- [ ] **Step 3: Update `me()` to include `full_name`**

In `backend/accounts/views.py`, change:

```python
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    token = request.auth
    return Response({"account_type": token["account_type"], "id": request.user.id})
```

to:

```python
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    token = request.auth
    return Response({
        "account_type": token["account_type"],
        "id": request.user.id,
        "full_name": request.user.full_name,
    })
```

(`request.user` is already the actual `Customer`/`BusinessOwner`/`StaffUser` instance — `MultiAccountJWTAuthentication.authenticate` in `backend/accounts/authentication.py:43-48` returns the model instance itself, not a wrapper, so `.full_name` is directly available on all three account models.)

- [ ] **Step 4: Make `CustomerRegisterView` issue a token**

In `backend/accounts/views.py`, change:

```python
class CustomerRegisterView(generics.CreateAPIView):
    serializer_class = CustomerRegistrationSerializer
    permission_classes = [AllowAny]
    throttle_scope = "customer_register"
```

to:

```python
class CustomerRegisterView(generics.CreateAPIView):
    serializer_class = CustomerRegistrationSerializer
    permission_classes = [AllowAny]
    throttle_scope = "customer_register"

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        customer = Customer.objects.get(pk=response.data["id"])
        response.data["token"] = issue_token(customer, "customer")
        return response
```

- [ ] **Step 5: Make `BusinessOwnerRegisterView` issue a token**

In `backend/accounts/views.py`, change:

```python
class BusinessOwnerRegisterView(generics.CreateAPIView):
    serializer_class = BusinessOwnerRegistrationSerializer
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]
    throttle_scope = "business_owner_register"
```

to:

```python
class BusinessOwnerRegisterView(generics.CreateAPIView):
    serializer_class = BusinessOwnerRegistrationSerializer
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]
    throttle_scope = "business_owner_register"

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        owner = BusinessOwner.objects.get(pk=response.data["id"])
        response.data["token"] = issue_token(owner, "business_owner")
        return response
```

- [ ] **Step 6: Make `StaffActivateView` issue a token**

In `backend/accounts/views.py`, change:

```python
class StaffActivateView(generics.GenericAPIView):
    serializer_class = StaffActivateSerializer
    permission_classes = [AllowAny]
    throttle_scope = "staff_activate"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"status": "activated"})
```

to:

```python
class StaffActivateView(generics.GenericAPIView):
    serializer_class = StaffActivateSerializer
    permission_classes = [AllowAny]
    throttle_scope = "staff_activate"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        staff = serializer.save()
        return Response({"status": "activated", "token": issue_token(staff, "staff")})
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_authentication accounts.tests.test_customer_registration accounts.tests.test_business_owner_registration accounts.tests.test_staff_invite`
Expected: PASS.

- [ ] **Step 8: Run full backend regression suite**

Run: `docker compose run --rm web python manage.py test accounts listings core`
Expected: PASS — confirms the `me()` response shape change and the three `create()`/`post()` overrides didn't break KYC, listings, or any other consumer of these views.

- [ ] **Step 9: Commit**

```bash
git add backend/accounts/views.py backend/accounts/tests/test_authentication.py backend/accounts/tests/test_customer_registration.py backend/accounts/tests/test_business_owner_registration.py backend/accounts/tests/test_staff_invite.py
git commit -m "feat: registration and staff activation now issue a login token; /me/ returns full_name"
```

---

### Task 3: `apiClient.js` auth layer

**Files:**
- Modify: `frontend/apiClient.js`
- Modify: `frontend/apiClient.test.js`

**Interfaces:**
- Consumes: nothing new (browser `fetch`, `localStorage`).
- Produces: `apiFetch(path)` (existing, now auth-aware), `apiPost(path, body)`, `apiPostForm(path, formData)`, `getStoredAuth()`, `setStoredAuth(auth | null)`. Task 4's `useAuth` hook is built directly on these.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/apiClient.test.js` (keep the existing two `describe('apiFetch', ...)` tests as-is, add a new `describe` block below them):

```js
import { getStoredAuth, setStoredAuth, apiPost, apiPostForm } from './apiClient.js'

describe('auth storage', () => {
  it('returns null when nothing is stored', () => {
    expect(getStoredAuth()).toBeNull()
  })

  it('round-trips a stored auth object', () => {
    setStoredAuth({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
    expect(getStoredAuth()).toEqual({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
  })

  it('clears storage when set to null', () => {
    setStoredAuth({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
    setStoredAuth(null)
    expect(getStoredAuth()).toBeNull()
  })
})

describe('apiFetch with a stored token', () => {
  it('attaches an Authorization header when a token is present', async () => {
    setStoredAuth({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
    let receivedAuth
    server.use(
      http.get('http://localhost:8000/api/accounts/me/', ({ request }) => {
        receivedAuth = request.headers.get('authorization')
        return HttpResponse.json({ account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
    )
    await apiFetch('/api/accounts/me/')
    expect(receivedAuth).toBe('Bearer abc123')
    setStoredAuth(null)
  })

  it('clears stored auth on a 401 response', async () => {
    setStoredAuth({ token: 'expired', account_type: 'customer', id: 1, full_name: 'Ama' })
    server.use(
      http.get('http://localhost:8000/api/accounts/me/', () => {
        return new HttpResponse(null, { status: 401 })
      }),
    )
    await expect(apiFetch('/api/accounts/me/')).rejects.toThrow()
    expect(getStoredAuth()).toBeNull()
  })
})

describe('apiPost', () => {
  it('sends a JSON body and returns the parsed response', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/customers/login/', async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ identifier: '+233241234567', password: 'secret' })
        return HttpResponse.json({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
    )
    const data = await apiPost('/api/accounts/customers/login/', { identifier: '+233241234567', password: 'secret' })
    expect(data).toEqual({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
  })

  it('throws on a non-2xx response', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/customers/login/', () => {
        return HttpResponse.json({ non_field_errors: ['Invalid credentials'] }, { status: 400 })
      }),
    )
    await expect(apiPost('/api/accounts/customers/login/', { identifier: 'x', password: 'y' })).rejects.toThrow()
  })
})

describe('apiPostForm', () => {
  it('sends a FormData body without setting Content-Type manually', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/business-owners/register/', async ({ request }) => {
        const formData = await request.formData()
        expect(formData.get('full_name')).toBe('Abena Boateng')
        return HttpResponse.json({ id: 1, token: 'abc123' }, { status: 201 })
      }),
    )
    const formData = new FormData()
    formData.append('full_name', 'Abena Boateng')
    const data = await apiPostForm('/api/accounts/business-owners/register/', formData)
    expect(data).toEqual({ id: 1, token: 'abc123' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- apiClient.test.js`
Expected: FAIL — `getStoredAuth`, `setStoredAuth`, `apiPost`, `apiPostForm` are not exported yet.

- [ ] **Step 3: Implement the auth layer**

Replace the full contents of `frontend/apiClient.js` with:

```js
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const AUTH_STORAGE_KEY = 'ashantihub.auth'

export function getStoredAuth() {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function setStoredAuth(auth) {
  if (auth) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  }
}

function authHeaders() {
  const auth = getStoredAuth()
  return auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}
}

async function handleResponse(response, path) {
  if (response.status === 401) {
    setStoredAuth(null)
  }
  if (!response.ok) {
    throw new Error(`API request to ${path} failed with status ${response.status}`)
  }
  return response.json()
}

export async function apiFetch(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() })
  return handleResponse(response, path)
}

export async function apiPost(path, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  return handleResponse(response, path)
}

export async function apiPostForm(path, formData) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  })
  return handleResponse(response, path)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- apiClient.test.js`
Expected: PASS, all tests including the original two `apiFetch` tests.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS — confirms `useCategories`/`useZones`/`useListings`/`useListing`, which call `apiFetch`, still work now that it sends an (empty, since no token is stored in those tests) `Authorization` header lookup on every call.

- [ ] **Step 6: Commit**

```bash
git add frontend/apiClient.js frontend/apiClient.test.js
git commit -m "feat: add auth-aware POST/form-POST helpers and token storage to apiClient"
```

---

### Task 4: `useAuth` hook

**Files:**
- Create: `frontend/hooks/useAuth.js`
- Create: `frontend/hooks/__tests__/useAuth.test.jsx`

**Interfaces:**
- Consumes: `apiFetch`, `apiPost`, `apiPostForm`, `getStoredAuth`, `setStoredAuth` from `frontend/apiClient.js` (Task 3).
- Produces: `useAuth()` returning `{ user, isLoading, login(accountType, identifier, password), logout(), registerCustomer(fields), registerBusinessOwner(fields) }`, where `accountType` is one of `"customer" | "business_owner" | "staff"` and `user` is either `null` or `{ token, account_type, id, full_name }`. Task 5 (`AuthModal`) and Task 6 (`AshantiHub`) consume this hook.

- [ ] **Step 1: Write the failing tests**

Create `frontend/hooks/__tests__/useAuth.test.jsx`:

```jsx
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { setStoredAuth } from '../../apiClient.js'
import { useAuth } from '../useAuth.js'

afterEach(() => setStoredAuth(null))

describe('useAuth', () => {
  it('starts with no user and isLoading false when nothing is stored', async () => {
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('hydrates the user from a stored token, validated against /me/', async () => {
    setStoredAuth({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
    server.use(
      http.get('http://localhost:8000/api/accounts/me/', () => {
        return HttpResponse.json({ account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toEqual({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
  })

  it('clears a stored token that /me/ rejects', async () => {
    setStoredAuth({ token: 'expired', account_type: 'customer', id: 1, full_name: 'Ama' })
    server.use(
      http.get('http://localhost:8000/api/accounts/me/', () => new HttpResponse(null, { status: 401 })),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('login stores and returns the authenticated user', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/customers/login/', () => {
        return HttpResponse.json({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.login('customer', '+233241234567', 'secret')
    })
    expect(result.current.user).toEqual({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
  })

  it('logout clears the user', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/customers/login/', () => {
        return HttpResponse.json({ token: 'abc123', account_type: 'customer', id: 1, full_name: 'Ama' })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.login('customer', '+233241234567', 'secret')
    })
    act(() => result.current.logout())
    expect(result.current.user).toBeNull()
  })

  it('registerCustomer stores the returned token under account_type customer', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/customers/register/', () => {
        return HttpResponse.json({ id: 5, full_name: 'Kofi Mensah', phone: '+233201112233', token: 'newtoken' }, { status: 201 })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.registerCustomer({ full_name: 'Kofi Mensah', phone: '+233201112233', password: 'secretpass' })
    })
    expect(result.current.user).toEqual({ token: 'newtoken', account_type: 'customer', id: 5, full_name: 'Kofi Mensah' })
  })

  it('registerBusinessOwner posts as multipart/form-data and stores the returned token', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/business-owners/register/', async ({ request }) => {
        const formData = await request.formData()
        expect(formData.get('full_name')).toBe('Abena Boateng')
        return HttpResponse.json({ id: 9, full_name: 'Abena Boateng', login_phone: '+233245551122', kyc_status: 'pending', token: 'biztoken' }, { status: 201 })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.registerBusinessOwner({ full_name: 'Abena Boateng', login_phone: '+233245551122', password: 'secretpass' })
    })
    expect(result.current.user).toEqual({ token: 'biztoken', account_type: 'business_owner', id: 9, full_name: 'Abena Boateng' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- useAuth.test.jsx`
Expected: FAIL — `frontend/hooks/useAuth.js` doesn't exist yet.

- [ ] **Step 3: Implement the hook**

Create `frontend/hooks/useAuth.js`:

```js
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, apiPost, apiPostForm, getStoredAuth, setStoredAuth } from '../apiClient.js'

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
    const formData = new FormData()
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') formData.append(key, value)
    })
    const data = await apiPostForm('/api/accounts/business-owners/register/', formData)
    const auth = { token: data.token, account_type: 'business_owner', id: data.id, full_name: data.full_name }
    setStoredAuth(auth)
    setUser(auth)
    return auth
  }, [])

  return { user, isLoading, login, logout, registerCustomer, registerBusinessOwner }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- useAuth.test.jsx`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/hooks/useAuth.js frontend/hooks/__tests__/useAuth.test.jsx
git commit -m "feat: add useAuth hook for login/logout/registration and session persistence"
```

---

### Task 5: `AuthModal` component

**Files:**
- Modify: `frontend/App.jsx` (add a new `export function AuthModal(...)`, placed after `ReferralModal` at `App.jsx:1962` and before `NotificationsPanel`)
- Create: `frontend/AuthModal.test.jsx`

**Interfaces:**
- Consumes: `useAuth()`'s return shape (Task 4) passed in as a prop named `auth`; the shared `C` palette object (`App.jsx:4-10`, already in scope for every function defined in `App.jsx`).
- Produces: `export function AuthModal({ authState, auth, onClose, onSuccess })` where `authState` is `"login" | "signup" | "staff-login"`, `onSuccess(user)` is called after a successful login/registration, and `onClose()` closes the modal. Task 6 renders this from `AshantiHub`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/AuthModal.test.jsx`:

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
    registerBusinessOwner: vi.fn().mockResolvedValue({ token: 't', account_type: 'business_owner', id: 2, full_name: 'Abena' }),
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
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('customer', '+233241234567', 'secret'))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })

  it('defaults to the customer signup form and submits to auth.registerCustomer', async () => {
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

  it('switches to the business owner signup form and shows KYC fields', () => {
    render(<AuthModal authState="signup" auth={makeAuth()} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: "I'm a Business Owner" }))
    expect(screen.getByPlaceholderText('Ghana Card number')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('GPS address (e.g. AK-123-4567)')).toBeInTheDocument()
  })

  it('reveals business registration certificate and TIN fields only when is_formal is checked', () => {
    render(<AuthModal authState="signup" auth={makeAuth()} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: "I'm a Business Owner" }))
    expect(screen.queryByPlaceholderText('TIN')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/formally registered/i))
    expect(screen.getByPlaceholderText('TIN')).toBeInTheDocument()
  })

  it('shows an error message and does not call onSuccess when login fails', async () => {
    const auth = makeAuth({ login: vi.fn().mockRejectedValue(new Error('API request failed with status 400')) })
    const onSuccess = vi.fn()
    render(<AuthModal authState="login" auth={auth} onClose={vi.fn()} onSuccess={onSuccess} />)

    fireEvent.change(screen.getByPlaceholderText('Phone or email'), { target: { value: '+233241234567' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument())
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('locks to staff login and hides the signup/account-type tabs when authState is staff-login', () => {
    render(<AuthModal authState="staff-login" auth={makeAuth()} onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Sign Up' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: "I'm a Business Owner" })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Phone or email')).toBeInTheDocument()
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<AuthModal authState="login" auth={makeAuth()} onClose={onClose} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByTestId('auth-modal-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- AuthModal.test.jsx`
Expected: FAIL — `AuthModal` is not exported from `App.jsx` yet.

- [ ] **Step 3: Implement `AuthModal`**

In `frontend/App.jsx`, add this new function immediately after the closing `}` of `ReferralModal` (`App.jsx:1962`), before the `// ─── Notifications Panel ───` comment. It follows this file's existing style (double quotes, semicolons, dense inline `style={{}}`) rather than the newer hooks-file style:

```jsx
const authInputStyle={width:"100%",boxSizing:"border-box",padding:"10px 12px",borderRadius:10,border:"1.5px solid #ddd",marginBottom:10,fontSize:"0.82rem",fontFamily:"inherit"};
const authLabelStyle={display:"block",fontSize:"0.72rem",fontWeight:700,color:C.darkBrown,marginBottom:10};
const authSubmitStyle={width:"100%",background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"12px",fontWeight:900,fontSize:"0.85rem",cursor:"pointer",fontFamily:"inherit",marginTop:4};

export function AuthModal({authState,auth,onClose,onSuccess}) {
  const lockedAccountType = authState==="staff-login" ? "staff" : null;
  const [mode,setMode]=useState(authState==="staff-login" ? "login" : authState);
  const [accountType,setAccountType]=useState(lockedAccountType || "customer");
  const [identifier,setIdentifier]=useState("");
  const [password,setPassword]=useState("");
  const [fullName,setFullName]=useState("");
  const [phone,setPhone]=useState("");
  const [email,setEmail]=useState("");
  const [bizFields,setBizFields]=useState({
    ghana_card_number:"",ghana_card_front_image:null,ghana_card_back_image:null,
    gps_address:"",business_contact_phone:"",is_formal:false,
    business_reg_certificate:null,tin:"",
    payout_bank_name:"",payout_bank_account_number:"",payout_bank_account_name:"",
    payout_momo_network:"",payout_momo_number:"",payout_momo_name:"",
    default_payout_method:"momo",
  });
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

  const handleBusinessSignup=async(e)=>{
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result=await auth.registerBusinessOwner({full_name:fullName,login_phone:phone,email:email||undefined,password,...bizFields});
      onSuccess(result);
    } catch (err) {
      setError("Could not create your business account. Please check your details.");
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

        {mode==="signup" && !lockedAccountType && <div style={{display:"flex",gap:8,marginBottom:16}}>
          <button type="button" onClick={()=>setAccountType("customer")} style={{flex:1,padding:"6px",borderRadius:20,border:`1.5px solid ${C.gold}`,cursor:"pointer",fontWeight:700,fontSize:"0.72rem",background:accountType==="customer"?C.gold:"white",color:C.darkBrown}}>I'm a Customer</button>
          <button type="button" onClick={()=>setAccountType("business_owner")} style={{flex:1,padding:"6px",borderRadius:20,border:`1.5px solid ${C.gold}`,cursor:"pointer",fontWeight:700,fontSize:"0.72rem",background:accountType==="business_owner"?C.gold:"white",color:C.darkBrown}}>I'm a Business Owner</button>
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

        {mode==="signup" && accountType==="customer" && <form onSubmit={handleCustomerSignup}>
          <input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Full name" required style={authInputStyle}/>
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Phone (+233...)" style={authInputStyle}/>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="Email" style={authInputStyle}/>
          <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password (min 8 characters)" required minLength={8} style={authInputStyle}/>
          <button type="submit" disabled={submitting} style={authSubmitStyle}>{submitting?"Creating account…":"Create Free Account"}</button>
        </form>}

        {mode==="signup" && accountType==="business_owner" && <form onSubmit={handleBusinessSignup}>
          <input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Full name" required style={authInputStyle}/>
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Login phone (+233...)" required style={authInputStyle}/>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="Email" style={authInputStyle}/>
          <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password (min 8 characters)" required minLength={8} style={authInputStyle}/>
          <input value={bizFields.ghana_card_number} onChange={e=>setBizFields(f=>({...f,ghana_card_number:e.target.value}))} placeholder="Ghana Card number" required style={authInputStyle}/>
          <label style={authLabelStyle}>Ghana Card — front
            <input type="file" accept="image/*" required onChange={e=>setBizFields(f=>({...f,ghana_card_front_image:e.target.files[0]}))} style={authInputStyle}/>
          </label>
          <label style={authLabelStyle}>Ghana Card — back
            <input type="file" accept="image/*" required onChange={e=>setBizFields(f=>({...f,ghana_card_back_image:e.target.files[0]}))} style={authInputStyle}/>
          </label>
          <input value={bizFields.gps_address} onChange={e=>setBizFields(f=>({...f,gps_address:e.target.value}))} placeholder="GPS address (e.g. AK-123-4567)" required style={authInputStyle}/>
          <input value={bizFields.business_contact_phone} onChange={e=>setBizFields(f=>({...f,business_contact_phone:e.target.value}))} placeholder="Business contact phone (public)" required style={authInputStyle}/>
          <label style={{...authLabelStyle,display:"flex",alignItems:"center",gap:8}}>
            <input type="checkbox" checked={bizFields.is_formal} onChange={e=>setBizFields(f=>({...f,is_formal:e.target.checked}))}/>
            My business is formally registered with the Registrar General's Department
          </label>
          {bizFields.is_formal && <>
            <label style={authLabelStyle}>Business registration certificate
              <input type="file" accept="application/pdf,image/*" required onChange={e=>setBizFields(f=>({...f,business_reg_certificate:e.target.files[0]}))} style={authInputStyle}/>
            </label>
            <input value={bizFields.tin} onChange={e=>setBizFields(f=>({...f,tin:e.target.value}))} placeholder="TIN" required style={authInputStyle}/>
          </>}
          <div style={{fontSize:"0.72rem",fontWeight:800,color:C.darkBrown,margin:"10px 0 4px"}}>Payout details (bank and/or mobile money)</div>
          <input value={bizFields.payout_momo_number} onChange={e=>setBizFields(f=>({...f,payout_momo_number:e.target.value}))} placeholder="Mobile money number" style={authInputStyle}/>
          <input value={bizFields.payout_momo_name} onChange={e=>setBizFields(f=>({...f,payout_momo_name:e.target.value}))} placeholder="Mobile money account name" style={authInputStyle}/>
          <select value={bizFields.payout_momo_network} onChange={e=>setBizFields(f=>({...f,payout_momo_network:e.target.value}))} style={authInputStyle}>
            <option value="">Mobile money network</option>
            <option value="MTN">MTN</option>
            <option value="Vodafone">Vodafone</option>
            <option value="AirtelTigo">AirtelTigo</option>
          </select>
          <input value={bizFields.payout_bank_account_number} onChange={e=>setBizFields(f=>({...f,payout_bank_account_number:e.target.value}))} placeholder="Bank account number" style={authInputStyle}/>
          <input value={bizFields.payout_bank_account_name} onChange={e=>setBizFields(f=>({...f,payout_bank_account_name:e.target.value}))} placeholder="Bank account name" style={authInputStyle}/>
          <input value={bizFields.payout_bank_name} onChange={e=>setBizFields(f=>({...f,payout_bank_name:e.target.value}))} placeholder="Bank name" style={authInputStyle}/>
          <select value={bizFields.default_payout_method} onChange={e=>setBizFields(f=>({...f,default_payout_method:e.target.value}))} style={authInputStyle}>
            <option value="momo">Default payout: Mobile Money</option>
            <option value="bank">Default payout: Bank</option>
          </select>
          <button type="submit" disabled={submitting} style={authSubmitStyle}>{submitting?"Submitting…":"Submit for Verification"}</button>
        </form>}
      </div>
    </div>
  </div>;
}
```

Note on the `label`/checkbox in the last form: `screen.getByLabelText(/formally registered/i)` in the test works because the `<input type="checkbox">` is nested inside its `<label>`, which Testing Library resolves without needing an explicit `htmlFor`/`id` pair.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- AuthModal.test.jsx`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/App.jsx frontend/AuthModal.test.jsx
git commit -m "feat: add AuthModal component with login and customer/business-owner signup forms"
```

---

### Task 6: Wire `useAuth`/`AuthModal` into `AshantiHub`

**Files:**
- Modify: `frontend/App.jsx`

**Interfaces:**
- Consumes: `useAuth` (Task 4), `AuthModal` (Task 5).
- Produces: `AshantiHub`'s `authModal`/`user` dead state replaced by live `useAuth()`; every existing reference to `user`/`setAuthModal` in `App.jsx` (`ReviewsModal`, `ReferralModal`, `MessagingCenter`, `NotificationsPanel`, `Card`, the header greeting, `handleWA`, `handleLogoClick`) now receives real data instead of always-null mock state. No new consumers outside this task's scope — role-gated dashboards (`isAdmin`/`showBizDash`) stay exactly as they are today except for how staff now reach the login gesture.

- [ ] **Step 1: Replace the dead state with `useAuth()`**

In `frontend/App.jsx`, add the import at the very top of the file (before the `C` palette constant):

```jsx
import { useAuth } from './hooks/useAuth.js';
```

Then in `AshantiHub` (`App.jsx:2895` onward), change:

```jsx
  const [authModal,setAuthModal]=useState(null);
  const [user,setUser]=useState(null);
```

to:

```jsx
  const [authModal,setAuthModal]=useState(null);
  const auth=useAuth();
  const user=auth.user ? {fullName:auth.user.full_name,accountType:auth.user.account_type,id:auth.user.id} : null;
```

(`user.fullName` is what every existing consumer in this file already reads — see `App.jsx:1643,1916,3058-3059,3116` — so this shape is chosen to match those call sites exactly rather than changing them.)

- [ ] **Step 2: Update `handleLogoClick` for the staff login bridge**

Change:

```jsx
  const handleLogoClick=()=>{const n=adminClicks+1;setAdminClicks(n);if(n>=5){setIsAdmin(true);setAdminClicks(0);}};
```

to:

```jsx
  const handleLogoClick=()=>{
    const n=adminClicks+1;
    setAdminClicks(n);
    if(n>=5){
      setAdminClicks(0);
      if(auth.user?.account_type==="staff"){setIsAdmin(true);}
      else{setAuthModal("staff-login");}
    }
  };
```

- [ ] **Step 3: Render `AuthModal` and handle its success callback**

Find the existing modal-rendering block:

```jsx
      {showMessaging&&<MessagingCenter user={user} onClose={()=>{setShowMessaging(false);setMessagingBusiness(null);}} initialBusiness={messagingBusiness}/>}
      {showNotifs&&<NotificationsPanel user={user} onClose={()=>setShowNotifs(false)}/>}
```

and change it to:

```jsx
      {authModal&&<AuthModal authState={authModal} auth={auth} onClose={()=>setAuthModal(null)} onSuccess={(result)=>{setAuthModal(null);if(result.account_type==="staff"){setIsAdmin(true);}}}/>}
      {showMessaging&&<MessagingCenter user={user} onClose={()=>{setShowMessaging(false);setMessagingBusiness(null);}} initialBusiness={messagingBusiness}/>}
      {showNotifs&&<NotificationsPanel user={user} onClose={()=>setShowNotifs(false)}/>}
```

- [ ] **Step 4: Wire logout**

`AdminDashboard`'s `onExit` prop (`App.jsx:3001`, `if(isAdmin) return <AdminDashboard onExit={()=>setIsAdmin(false)}/>;`) currently only clears the local `isAdmin` flag, leaving the staff session itself active — that's correct and unchanged by this task, since "exit the dashboard view" and "log out of the account" are different actions and only the former is in scope for the existing `AdminDashboard` component. Add a real logout call at the one place a logged-in user already has a visible affordance for it: the header user-menu button at `App.jsx:3058-3059` (`<span>...</span>{user.fullName?.split(" ")[0]}`). Change:

```jsx
              <span style={{background:C.darkBrown,color:C.gold,borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"0.6rem",fontWeight:900}}>{user.fullName?.[0]?.toUpperCase()||"U"}</span>
              {user.fullName?.split(" ")[0]}
```

to:

```jsx
              <span style={{background:C.darkBrown,color:C.gold,borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"0.6rem",fontWeight:900}}>{user.fullName?.[0]?.toUpperCase()||"U"}</span>
              {user.fullName?.split(" ")[0]}
              <span onClick={(e)=>{e.stopPropagation();auth.logout();}} style={{marginLeft:6,opacity:0.7,cursor:"pointer",fontSize:"0.68rem"}} title="Sign out">⏻</span>
```

- [ ] **Step 5: Verify the build**

Run: `cd frontend && npm run build`
Expected: build succeeds with no errors (this catches import typos/syntax errors — `App.jsx` has no automated test coverage of `AshantiHub` itself, per `CLAUDE.md`'s testing-strategy note that whole-file testing is deferred until the `components/` extraction lands).

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS — confirms `Card`/`MapView`/`AuthModal`/hook tests are unaffected by the `AshantiHub` wiring change.

- [ ] **Step 7: Manual smoke test**

Run: `cd frontend && npm run dev`, then in a browser:
1. Click "Sign Up", fill the customer form, submit — confirm the modal closes and the header shows "Akwaaba, `<first name>`!" instead of the Sign In/Sign Up buttons.
2. Reload the page — confirm the greeting persists (session hydrated from `localStorage` via `/me/`).
3. Click the sign-out (⏻) icon — confirm the header reverts to Sign In/Sign Up.
4. Click "Sign In", switch to the "Business Owner" tab, and log in with a business-owner account created via the API directly (this plan doesn't seed one) — confirm login succeeds.
5. Click the AshantiHub logo 5 times rapidly while logged out — confirm the staff login modal opens (no signup tab, no account-type tabs).
6. Requires a backend running with `docker compose up` and `VITE_API_BASE_URL` pointed at it (see `CLAUDE.md` "Commands").

This step has no automated substitute — flag explicitly if the manual pass is skipped, per this project's verification norms.

- [ ] **Step 8: Commit**

```bash
git add frontend/App.jsx
git commit -m "feat: wire useAuth and AuthModal into AshantiHub, replacing dead auth state"
```

---

## Post-plan note

This plan intentionally does not touch `isAdmin`/`showBizDash`/`showPayments`/`showCredit` gating logic beyond the one staff-login bridge in Task 6 Step 2 — redesigning those into real RBAC-driven dashboards is the next sub-project (staff dashboard shell), which depends on this plan being merged first.
