# Staff Dashboard Shell (RBAC-driven, light/dark theme) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `AdminDashboard` (built on fictional mock data) with a permission-gated `StaffDashboard` where every nav item and panel is driven by the logged-in staff member's actual `Permission` codenames, plus a light/dark theme toggle scoped to this new component.

**Architecture:** Backend exposes `role`/`permissions` on staff auth responses and adds three small `ListAPIView` endpoints (`users.view`-gated customer/business-owner lists, `staff.manage`-gated staff roster) following the exact pattern `PublicListingListView` already established. Frontend adds a `useTheme` hook, five thin `useQuery` data hooks matching `useCategories.js`'s shape, and a new `export function StaffDashboard` added to `App.jsx` (matching how `Card`/`MapView`/`AuthModal` are already exported from that file), built incrementally: the shell + all-placeholder panels land first, then each real panel replaces its placeholder in its own task.

**Tech Stack:** Django 5.0 / DRF 3.15 (no new dependencies). React 19 / `@tanstack/react-query` 5.59 / Vitest + MSW (no new dependencies).

## Global Constraints

- Actual permission matrix (confirmed against `accounts/migrations/0002_seed_roles_permissions.py` and `0006_seed_zones_manage_permission.py`): `super_admin` all 14; `admin` = `kyc.approve`, `listings.moderate`, `users.view`, `zones.manage`; `marketing` = `promotions.manage`, `analytics.view`, `categories.manage`, `zones.manage`; `accountant` = `escrow.view`, `escrow.release`, `disputes.resolve_financial`, `transactions.report`; `support` = `messaging.manage`, `disputes.flag`, `users.view`.
- `role`/`permissions` fields appear on staff login/`me()` responses **only** — customer/business-owner responses gain no new keys, not even `null`.
- The three new list endpoints (`customers/`, `business-owners/`, `staff/` under `/api/accounts/`) use `PageNumberPagination` with `page_size=20`, mirroring `listings.views.ListingPagination` — but this plan does not build Prev/Next pagination-clicking UI (that would require `apiFetch` to accept a full URL, which it doesn't today, and is out of scope): panels fetch page 1 and show a "showing first 20 of N" note when `count > 20`.
- `KYCPendingQueueView`/`ModerationPendingQueueView` (pre-existing, unmodified by this plan) are **not** paginated — they return a plain JSON array, not `{results: [...]}`. Do not confuse their shape with the three new endpoints' paginated shape.
- No React Context introduced for theming — `StaffDashboard` calls `useTheme()` once and passes `theme` down as a prop, per the design spec §3.2.
- Only neutral surface/text colors differ between light/dark; brand accent colors (`C.gold`, `C.kente1/2/3`, status colors) stay constant across both themes.
- Placeholder panels never show fake/mock data — a single shared `ComingSoonPanel` component, reused for every not-yet-built permission.
- New frontend hook files (`useTheme.js`, `useKYCQueue.js`, etc.) follow `frontend/hooks/`'s existing style: single quotes, no semicolons. New code added to `App.jsx` follows that file's existing style: double quotes, semicolons, dense inline `style={{}}`.
- Backend tests run via `docker compose run --rm web python manage.py test accounts`. Frontend tests run via `cd frontend && npm run test`.

---

## File Structure

```
backend/
  accounts/
    serializers.py                       # modified: 3 new list serializers, StaffListSerializer computed status
    views.py                             # modified: role/permissions on StaffLoginView + me(); 3 new list views; new AccountsPagination
    urls.py                              # modified: 3 new list paths
    tests/
      test_login.py                      # modified: role/permissions assertions
      test_authentication.py             # modified: me() staff role/permissions test
      test_users_list.py                 # new
      test_staff_list.py                 # new

frontend/
  hooks/
    useTheme.js                          # new
    useKYCQueue.js                       # new
    useModerationQueue.js                # new
    useCustomers.js                      # new
    useBusinessOwners.js                 # new
    useStaffRoster.js                    # new
    useAuth.js                           # modified: hasPermission helper
    __tests__/
      useTheme.test.jsx                  # new
      useKYCQueue.test.jsx               # new
      useModerationQueue.test.jsx        # new
      useCustomers.test.jsx              # new
      useBusinessOwners.test.jsx         # new
      useStaffRoster.test.jsx            # new
      useAuth.test.jsx                   # modified: hasPermission tests
  App.jsx                                # modified: new StaffDashboard + panel components; AdminDashboard + mock data deleted; AshantiHub wired to StaffDashboard
  StaffDashboard.test.jsx                # new (top-level, matches AuthModal.test.jsx placement)
```

---

### Task 1: Backend — role/permissions on staff auth responses

**Files:**
- Modify: `backend/accounts/views.py`
- Modify: `backend/accounts/tests/test_login.py`
- Modify: `backend/accounts/tests/test_authentication.py`

**Interfaces:**
- Consumes: `StaffUser.role` (existing FK), `Role.permissions` (existing M2M).
- Produces: `StaffLoginView` and `me()` responses gain `"role": str` and `"permissions": list[str]` for staff accounts only. Frontend Task 4 (`useAuth`) requires no code change to receive these (they pass through the existing generic response-forwarding), but this response shape is what later tasks' `hasPermission` and `StaffDashboard` depend on.

- [ ] **Step 1: Write the failing tests**

Add to `backend/accounts/tests/test_login.py`, inside `LoginTests`:

```python
    def test_staff_login_response_includes_role_and_permissions(self):
        response = self.client.post(
            "/api/accounts/staff/login/",
            {"identifier": "support@example.com", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["role"], "support")
        self.assertCountEqual(data["permissions"], ["messaging.manage", "disputes.flag", "users.view"])

    def test_customer_login_response_has_no_role_or_permissions_keys(self):
        response = self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "+233241234567", "password": "correct-horse-battery-staple"},
            format="json",
        )
        data = response.json()
        self.assertNotIn("role", data)
        self.assertNotIn("permissions", data)

    def test_business_owner_login_response_has_no_role_or_permissions_keys(self):
        response = self.client.post(
            "/api/accounts/business-owners/login/",
            {"identifier": "+233201112233", "password": "correct-horse-battery-staple"},
            format="json",
        )
        data = response.json()
        self.assertNotIn("role", data)
        self.assertNotIn("permissions", data)
```

Add to `backend/accounts/tests/test_authentication.py`, inside `MultiAccountAuthenticationTests`:

```python
    def test_me_endpoint_includes_role_and_permissions_for_staff(self):
        from accounts.models import Role, StaffUser

        staff = StaffUser.objects.create(
            full_name="Akosua Support",
            email="akosua-me-test@example.com",
            password_hash="unused-in-this-test",
            role=Role.objects.get(name=Role.SUPPORT),
        )
        token = issue_token(staff, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["role"], "support")
        self.assertCountEqual(data["permissions"], ["messaging.manage", "disputes.flag", "users.view"])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_login accounts.tests.test_authentication`
Expected: FAIL — `KeyError: 'role'` on the new staff assertions (the two "has no role/permissions keys" tests will already pass since those keys don't exist yet at all, but keep them for regression protection once Step 3 lands).

- [ ] **Step 3: Add role/permissions to `StaffLoginView`**

In `backend/accounts/views.py`, change:

```python
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

to:

```python
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
            "role": account.role.name,
            "permissions": list(account.role.permissions.values_list("codename", flat=True)),
        })
```

- [ ] **Step 4: Add role/permissions to `me()`**

In `backend/accounts/views.py`, change:

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

to:

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
    return Response(data)
```

(`StaffUser` is already imported at the top of `views.py`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_login accounts.tests.test_authentication`
Expected: PASS, all tests including the pre-existing `test_me_endpoint_resolves_customer_from_token` (unaffected — customer responses still have exactly the same 3 keys as before, since the new fields are only added inside the `isinstance(request.user, StaffUser)` branch).

- [ ] **Step 6: Run full accounts regression suite**

Run: `docker compose run --rm web python manage.py test accounts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/accounts/views.py backend/accounts/tests/test_login.py backend/accounts/tests/test_authentication.py
git commit -m "feat: expose role and permissions on staff login and /me/ responses"
```

---

### Task 2: Backend — customer and business-owner list endpoints (`users.view`)

**Files:**
- Create: `backend/accounts/tests/test_users_list.py`
- Modify: `backend/accounts/serializers.py`
- Modify: `backend/accounts/views.py`
- Modify: `backend/accounts/urls.py`

**Interfaces:**
- Consumes: `HasRolePermission` (existing, `backend/accounts/permissions.py`).
- Produces: `GET /api/accounts/customers/` and `GET /api/accounts/business-owners/`, both gated by `users.view`, both paginated (`{"count", "next", "previous", "results": [...]}`, page size 20). `AccountsPagination` (new, in `views.py`) is reused by Task 3's `StaffListView`.

- [ ] **Step 1: Write the failing tests**

Create `backend/accounts/tests/test_users_list.py`:

```python
from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser


class UsersListTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        Customer.objects.create(
            full_name="Ama Owusu", phone="+233241234567", email="ama@example.com",
            password_hash=make_password("x"),
        )
        BusinessOwner.objects.create(
            full_name="Kwame Business", login_phone="+233201112233", email="kwame@example.com",
            password_hash=make_password("x"),
        )

    def _staff(self, role_name, suffix):
        staff = StaffUser.objects.create(
            full_name=f"{role_name} Person", email=f"{role_name}-{suffix}@example.com",
            password_hash="x", role=Role.objects.get(name=role_name),
        )
        return issue_token(staff, "staff")

    def test_admin_can_list_customers(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('admin', 1)}")
        response = self.client.get("/api/accounts/customers/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(data["results"][0]["full_name"], "Ama Owusu")
        self.assertNotIn("password_hash", data["results"][0])

    def test_support_can_list_customers(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('support', 1)}")
        response = self.client.get("/api/accounts/customers/")
        self.assertEqual(response.status_code, 200)

    def test_marketing_cannot_list_customers(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('marketing', 1)}")
        response = self.client.get("/api/accounts/customers/")
        self.assertEqual(response.status_code, 403)

    def test_admin_can_list_business_owners(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('admin', 2)}")
        response = self.client.get("/api/accounts/business-owners/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(data["results"][0]["full_name"], "Kwame Business")
        self.assertEqual(data["results"][0]["kyc_status"], "pending")
        self.assertNotIn("password_hash", data["results"][0])

    def test_marketing_cannot_list_business_owners(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('marketing', 2)}")
        response = self.client.get("/api/accounts/business-owners/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_request_is_rejected(self):
        response = self.client.get("/api/accounts/customers/")
        self.assertEqual(response.status_code, 401)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_users_list`
Expected: FAIL — `404` on both new URLs (they don't exist yet).

- [ ] **Step 3: Add the list serializers**

In `backend/accounts/serializers.py`, add at the end of the file:

```python
class CustomerListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["id", "full_name", "phone", "email", "created_at"]


class BusinessOwnerListSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessOwner
        fields = ["id", "full_name", "login_phone", "email", "kyc_status", "created_at"]
```

- [ ] **Step 4: Add `AccountsPagination` and the two list views**

In `backend/accounts/views.py`, change the imports from:

```python
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

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

to:

```python
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import issue_token
from .models import BusinessOwner, Customer, StaffUser
from .permissions import HasRolePermission
from .serializers import (
    INVITE_TOKEN_LIFETIME,
    BusinessOwnerKYCDetailSerializer,
    BusinessOwnerKYCSerializer,
    BusinessOwnerListSerializer,
    BusinessOwnerLoginSerializer,
    BusinessOwnerRegistrationSerializer,
    BusinessOwnerProfileUpdateSerializer,
    CustomerListSerializer,
    CustomerLoginSerializer,
    CustomerRegistrationSerializer,
    PayoutDetailSerializer,
    StaffActivateSerializer,
    StaffInviteSerializer,
    StaffLoginSerializer,
)


class AccountsPagination(PageNumberPagination):
    page_size = 20
```

Then add these two views (placed after `KYCRejectView`, before `IsBusinessOwner`):

```python
class CustomerListView(generics.ListAPIView):
    serializer_class = CustomerListSerializer
    queryset = Customer.objects.all().order_by("-created_at")
    pagination_class = AccountsPagination

    def get_permissions(self):
        return [HasRolePermission("users.view")]


class BusinessOwnerListView(generics.ListAPIView):
    serializer_class = BusinessOwnerListSerializer
    queryset = BusinessOwner.objects.all().order_by("-created_at")
    pagination_class = AccountsPagination

    def get_permissions(self):
        return [HasRolePermission("users.view")]
```

- [ ] **Step 5: Wire the URLs**

In `backend/accounts/urls.py`, add two paths after `kyc/<int:pk>/reject/` and before the closing `]`:

```python
    path("customers/", views.CustomerListView.as_view(), name="customer-list"),
    path("business-owners/", views.BusinessOwnerListView.as_view(), name="business-owner-list"),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_users_list`
Expected: PASS, all 7 tests.

- [ ] **Step 7: Run full accounts regression suite**

Run: `docker compose run --rm web python manage.py test accounts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/accounts/tests/test_users_list.py backend/accounts/serializers.py backend/accounts/views.py backend/accounts/urls.py
git commit -m "feat: add users.view-gated customer and business-owner list endpoints"
```

---

### Task 3: Backend — staff roster list endpoint (`staff.manage`)

**Files:**
- Create: `backend/accounts/tests/test_staff_list.py`
- Modify: `backend/accounts/serializers.py`
- Modify: `backend/accounts/views.py`
- Modify: `backend/accounts/urls.py`

**Interfaces:**
- Consumes: `AccountsPagination` (Task 2).
- Produces: `GET /api/accounts/staff/`, gated by `staff.manage`, paginated, each item including a computed `status` field (`"active" | "invited" | "invite_expired"`).

- [ ] **Step 1: Write the failing tests**

Create `backend/accounts/tests/test_staff_list.py`:

```python
import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser


class StaffListTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.super_admin = StaffUser.objects.create(
            full_name="Kwame Super", email="kwame-list@example.com", password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )
        self.token = issue_token(self.super_admin, "staff")

        StaffUser.objects.create(
            full_name="Active Person", email="active@example.com", password_hash="realhash",
            role=Role.objects.get(name="admin"), invite_token=None, invite_expires_at=None,
        )
        StaffUser.objects.create(
            full_name="Invited Person", email="invited@example.com", password_hash="unusable",
            role=Role.objects.get(name="support"), invite_token="tok-1",
            invite_expires_at=timezone.now() + datetime.timedelta(days=7),
        )
        StaffUser.objects.create(
            full_name="Expired Person", email="expired@example.com", password_hash="unusable",
            role=Role.objects.get(name="marketing"), invite_token="tok-2",
            invite_expires_at=timezone.now() - datetime.timedelta(days=1),
        )

    def test_super_admin_can_list_staff(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.get("/api/accounts/staff/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["count"], 4)

    def test_admin_cannot_list_staff(self):
        admin = StaffUser.objects.create(
            full_name="Regular Admin", email="regular-admin@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        token = issue_token(admin, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/staff/")
        self.assertEqual(response.status_code, 403)

    def test_status_field_reflects_activation_state(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.get("/api/accounts/staff/")
        by_name = {item["full_name"]: item["status"] for item in response.json()["results"]}
        self.assertEqual(by_name["Active Person"], "active")
        self.assertEqual(by_name["Invited Person"], "invited")
        self.assertEqual(by_name["Expired Person"], "invite_expired")

    def test_role_field_is_the_role_name(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.get("/api/accounts/staff/")
        by_name = {item["full_name"]: item["role"] for item in response.json()["results"]}
        self.assertEqual(by_name["Active Person"], "admin")

    def test_password_hash_never_leaked(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.get("/api/accounts/staff/")
        for item in response.json()["results"]:
            self.assertNotIn("password_hash", item)
            self.assertNotIn("invite_token", item)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_staff_list`
Expected: FAIL — `404` (URL doesn't exist yet).

- [ ] **Step 3: Add `StaffListSerializer`**

In `backend/accounts/serializers.py`, add at the end of the file:

```python
class StaffListSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source="role.name", read_only=True)
    status = serializers.SerializerMethodField()

    class Meta:
        model = StaffUser
        fields = ["id", "full_name", "email", "phone", "role", "status", "created_at"]

    def get_status(self, obj):
        if obj.invite_token is None:
            return "active"
        if obj.invite_expires_at and obj.invite_expires_at < timezone.now():
            return "invite_expired"
        return "invited"
```

(`timezone` is already imported at the top of `serializers.py`.)

- [ ] **Step 4: Add `StaffListView`**

In `backend/accounts/views.py`, add `StaffListSerializer` to the import block from `.serializers` (alphabetically, after `StaffInviteSerializer`), then add this view after `BusinessOwnerListView`:

```python
class StaffListView(generics.ListAPIView):
    serializer_class = StaffListSerializer
    queryset = StaffUser.objects.all().order_by("-created_at")
    pagination_class = AccountsPagination

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]
```

- [ ] **Step 5: Wire the URL**

In `backend/accounts/urls.py`, add one path after `business-owners/` (from Task 2) and before the closing `]`:

```python
    path("staff/", views.StaffListView.as_view(), name="staff-list"),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_staff_list`
Expected: PASS, all 5 tests.

- [ ] **Step 7: Run full accounts regression suite**

Run: `docker compose run --rm web python manage.py test accounts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/accounts/tests/test_staff_list.py backend/accounts/serializers.py backend/accounts/views.py backend/accounts/urls.py
git commit -m "feat: add staff.manage-gated staff roster endpoint with computed status"
```

---

### Task 4: Frontend — `useAuth` gains `hasPermission`

**Files:**
- Modify: `frontend/hooks/useAuth.js`
- Modify: `frontend/hooks/__tests__/useAuth.test.jsx`

**Interfaces:**
- Consumes: `user.permissions` (already passes through transparently from the backend once Task 1 lands — no other `useAuth.js` code changes needed, since `login()`/the mount-hydration effect already forward whatever fields the backend returns verbatim).
- Produces: `hasPermission(codename)` added to `useAuth()`'s return value. `StaffDashboard` (Task 7 onward) depends on this.

- [ ] **Step 1: Write the failing test**

Add to `frontend/hooks/__tests__/useAuth.test.jsx`:

```jsx
describe('hasPermission', () => {
  it('returns true when the logged-in user holds the permission', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/staff/login/', () => {
        return HttpResponse.json({
          token: 't', account_type: 'staff', id: 1, full_name: 'Akosua Support',
          role: 'support', permissions: ['messaging.manage', 'disputes.flag', 'users.view'],
        })
      }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.login('staff', 'akosua@example.com', 'secret')
    })
    expect(result.current.hasPermission('messaging.manage')).toBe(true)
    expect(result.current.hasPermission('kyc.approve')).toBe(false)
  })

  it('returns false when there is no logged-in user', async () => {
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.hasPermission('messaging.manage')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- useAuth.test.jsx`
Expected: FAIL — `result.current.hasPermission is not a function`.

- [ ] **Step 3: Add `hasPermission`**

In `frontend/hooks/useAuth.js`, change the final lines from:

```js
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

to:

```js
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

  const hasPermission = useCallback(
    (codename) => user?.permissions?.includes(codename) ?? false,
    [user],
  )

  return { user, isLoading, login, logout, registerCustomer, registerBusinessOwner, hasPermission }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- useAuth.test.jsx`
Expected: PASS, all tests.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/hooks/useAuth.js frontend/hooks/__tests__/useAuth.test.jsx
git commit -m "feat: add hasPermission helper to useAuth"
```

---

### Task 5: Frontend — `useTheme` hook

**Files:**
- Create: `frontend/hooks/useTheme.js`
- Create: `frontend/hooks/__tests__/useTheme.test.jsx`

**Interfaces:**
- Consumes: `localStorage`, `window.matchMedia`.
- Produces: `useTheme()` returning `{ theme: "light"|"dark", toggleTheme() }`. `StaffDashboard` (Task 7) depends on this.

- [ ] **Step 1: Write the failing tests**

Create `frontend/hooks/__tests__/useTheme.test.jsx`:

```jsx
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTheme } from '../useTheme.js'

function mockMatchMedia(matches) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('defaults to dark when the OS prefers dark and nothing is stored', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
  })

  it('defaults to light when the OS prefers light and nothing is stored', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
  })

  it('reads a previously stored theme over the OS preference', () => {
    mockMatchMedia(true)
    localStorage.setItem('ashantihub.theme', 'light')
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
  })

  it('toggleTheme flips the theme and persists it', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme())
    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('dark')
    expect(localStorage.getItem('ashantihub.theme')).toBe('dark')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- useTheme.test.jsx`
Expected: FAIL — `frontend/hooks/useTheme.js` doesn't exist yet.

- [ ] **Step 3: Implement the hook**

Create `frontend/hooks/useTheme.js`:

```js
import { useCallback, useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'ashantihub.theme'

function getInitialTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'))
  }, [])

  return { theme, toggleTheme }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- useTheme.test.jsx`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/hooks/useTheme.js frontend/hooks/__tests__/useTheme.test.jsx
git commit -m "feat: add useTheme hook (light/dark, localStorage-persisted)"
```

---

### Task 6: Frontend — data-fetching hooks for the 5 real panels

**Files:**
- Create: `frontend/hooks/useKYCQueue.js`, `frontend/hooks/useModerationQueue.js`, `frontend/hooks/useCustomers.js`, `frontend/hooks/useBusinessOwners.js`, `frontend/hooks/useStaffRoster.js`
- Create: matching test files under `frontend/hooks/__tests__/`

**Interfaces:**
- Consumes: `apiFetch` (existing).
- Produces: five `useQuery`-wrapping hooks, each following `useCategories.js`'s exact shape. `useKYCQueue`/`useModerationQueue` resolve to a **plain array** (their backend endpoints are unpaginated). `useCustomers`/`useBusinessOwners`/`useStaffRoster` resolve to a **paginated object** (`{count, next, previous, results}`) per Tasks 2–3. Panel tasks (8–11) depend on this distinction.

- [ ] **Step 1: Write the failing tests**

Create `frontend/hooks/__tests__/useKYCQueue.test.jsx`:

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useKYCQueue } from '../useKYCQueue.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useKYCQueue', () => {
  it('returns the pending KYC queue as a plain array', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/kyc/pending/', () => {
        return HttpResponse.json([{ id: 1, full_name: 'Kwame Business', kyc_status: 'pending' }])
      }),
    )
    const { result } = renderWithClient(() => useKYCQueue())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(1)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/kyc/pending/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useKYCQueue())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
```

Create `frontend/hooks/__tests__/useModerationQueue.test.jsx` (identical shape, targeting `/api/listings/moderation/pending/`):

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useModerationQueue } from '../useModerationQueue.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useModerationQueue', () => {
  it('returns the pending listings queue as a plain array', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/moderation/pending/', () => {
        return HttpResponse.json([{ id: 1, name: 'Royal Ashanti Lodge', status: 'pending_review' }])
      }),
    )
    const { result } = renderWithClient(() => useModerationQueue())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toHaveLength(1)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/moderation/pending/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useModerationQueue())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
```

Create `frontend/hooks/__tests__/useCustomers.test.jsx`:

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useCustomers } from '../useCustomers.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useCustomers', () => {
  it('returns the paginated customers response', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 1, full_name: 'Ama Owusu' }] })
      }),
    )
    const { result } = renderWithClient(() => useCustomers())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.count).toBe(1)
    expect(result.current.data.results).toHaveLength(1)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useCustomers())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
```

Create `frontend/hooks/__tests__/useBusinessOwners.test.jsx` (identical shape, targeting `/api/accounts/business-owners/`):

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useBusinessOwners } from '../useBusinessOwners.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useBusinessOwners', () => {
  it('returns the paginated business owners response', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/business-owners/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 1, full_name: 'Kwame Business' }] })
      }),
    )
    const { result } = renderWithClient(() => useBusinessOwners())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.count).toBe(1)
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/business-owners/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useBusinessOwners())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
```

Create `frontend/hooks/__tests__/useStaffRoster.test.jsx` (identical shape, targeting `/api/accounts/staff/`):

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../mocks/server.js'
import { useStaffRoster } from '../useStaffRoster.js'

function renderWithClient(hook) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  })
}

describe('useStaffRoster', () => {
  it('returns the paginated staff roster response', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 1, full_name: 'Akosua Support', role: 'support', status: 'active' }] })
      }),
    )
    const { result } = renderWithClient(() => useStaffRoster())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data.results[0].status).toBe('active')
  })

  it('exposes isError on failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/', () => new HttpResponse(null, { status: 403 })),
    )
    const { result } = renderWithClient(() => useStaffRoster())
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- useKYCQueue useModerationQueue useCustomers useBusinessOwners useStaffRoster`
Expected: FAIL — none of the five hook files exist yet.

- [ ] **Step 3: Implement the five hooks**

Create `frontend/hooks/useKYCQueue.js`:

```js
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useKYCQueue() {
  return useQuery({
    queryKey: ['kyc-queue'],
    queryFn: () => apiFetch('/api/accounts/kyc/pending/'),
  })
}
```

Create `frontend/hooks/useModerationQueue.js`:

```js
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useModerationQueue() {
  return useQuery({
    queryKey: ['moderation-queue'],
    queryFn: () => apiFetch('/api/listings/moderation/pending/'),
  })
}
```

Create `frontend/hooks/useCustomers.js`:

```js
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useCustomers() {
  return useQuery({
    queryKey: ['staff-customers'],
    queryFn: () => apiFetch('/api/accounts/customers/'),
  })
}
```

Create `frontend/hooks/useBusinessOwners.js`:

```js
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useBusinessOwners() {
  return useQuery({
    queryKey: ['staff-business-owners'],
    queryFn: () => apiFetch('/api/accounts/business-owners/'),
  })
}
```

Create `frontend/hooks/useStaffRoster.js`:

```js
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

export function useStaffRoster() {
  return useQuery({
    queryKey: ['staff-roster'],
    queryFn: () => apiFetch('/api/accounts/staff/'),
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- useKYCQueue useModerationQueue useCustomers useBusinessOwners useStaffRoster`
Expected: PASS, 10 tests total.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/hooks/useKYCQueue.js frontend/hooks/useModerationQueue.js frontend/hooks/useCustomers.js frontend/hooks/useBusinessOwners.js frontend/hooks/useStaffRoster.js frontend/hooks/__tests__/useKYCQueue.test.jsx frontend/hooks/__tests__/useModerationQueue.test.jsx frontend/hooks/__tests__/useCustomers.test.jsx frontend/hooks/__tests__/useBusinessOwners.test.jsx frontend/hooks/__tests__/useStaffRoster.test.jsx
git commit -m "feat: add data-fetching hooks for staff dashboard panels"
```

---

### Task 7: Frontend — `StaffDashboard` shell (sidebar, header, Overview, all-placeholder panels)

**Files:**
- Modify: `frontend/App.jsx` (imports; new `StaffDashboard` + `ComingSoonPanel` + `StaffOverviewPanel` + `DASHBOARD_THEME` const, placed after `AdminDashboard`'s closing `}` at `App.jsx:2508` — `AdminDashboard` and the mock data above it are **not deleted yet**, that happens in Task 12, so this task's diff is purely additive)
- Create: `frontend/StaffDashboard.test.jsx`

**Interfaces:**
- Consumes: `useTheme` (Task 5), `auth` prop shaped like `useAuth()`'s return value (`user.role`, `user.permissions`, `user.full_name`).
- Produces: `export function StaffDashboard({ auth, onExit })`. Every nav item other than Overview renders `ComingSoonPanel` at this point — Tasks 8–11 replace specific tabs' placeholder with a real panel, one at a time.

- [ ] **Step 1: Write the failing tests**

Create `frontend/StaffDashboard.test.jsx`:

```jsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StaffDashboard } from './App.jsx'

function makeAuth(overrides = {}) {
  return {
    user: {
      token: 't', account_type: 'staff', id: 1, full_name: 'Akosua Support',
      role: 'support', permissions: ['messaging.manage', 'disputes.flag', 'users.view'],
    },
    hasPermission: (codename) => ['messaging.manage', 'disputes.flag', 'users.view'].includes(codename),
    ...overrides,
  }
}

describe('StaffDashboard', () => {
  it('shows Overview by default with a greeting and the session permissions', () => {
    render(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    expect(screen.getByText(/Akosua/)).toBeInTheDocument()
    expect(screen.getByText('messaging.manage')).toBeInTheDocument()
  })

  it('only shows nav items the session has permission for', () => {
    render(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    expect(screen.getByText('Messaging / Tickets')).toBeInTheDocument()
    expect(screen.getByText('Users')).toBeInTheDocument()
    expect(screen.queryByText('KYC Queue')).not.toBeInTheDocument()
    expect(screen.queryByText('Staff Management')).not.toBeInTheDocument()
  })

  it('a super_admin-shaped session sees every nav item', () => {
    const auth = makeAuth({
      user: { token: 't', account_type: 'staff', id: 2, full_name: 'Kwame Super', role: 'super_admin', permissions: [
        'kyc.approve', 'listings.moderate', 'users.view', 'escrow.view', 'escrow.release',
        'disputes.resolve_financial', 'transactions.report', 'promotions.manage', 'analytics.view',
        'categories.manage', 'messaging.manage', 'disputes.flag', 'staff.manage', 'zones.manage',
      ] },
      hasPermission: () => true,
    })
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    ;['KYC Queue', 'Listings Moderation', 'Users', 'Categories & Zones', 'Staff Management',
      'Escrow Ledger', 'Disputes', 'Transactions Report', 'Promotions', 'Analytics', 'Messaging / Tickets']
      .forEach((label) => expect(screen.getByText(label)).toBeInTheDocument())
  })

  it('switches panels on nav click and shows a coming-soon message for unbuilt permissions', () => {
    render(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Messaging / Tickets'))
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
  })

  it('calls onExit when the exit button is clicked', () => {
    const onExit = vi.fn()
    render(<StaffDashboard auth={makeAuth()} onExit={onExit} />)
    fireEvent.click(screen.getByText('← Exit'))
    expect(onExit).toHaveBeenCalled()
  })

  it('toggles theme when the theme button is clicked', () => {
    render(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    const toggle = screen.getByTitle('Toggle theme')
    expect(toggle.textContent).toBe('🌙')
    fireEvent.click(toggle)
    expect(toggle.textContent).toBe('☀️')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- StaffDashboard.test.jsx`
Expected: FAIL — `StaffDashboard` is not exported from `App.jsx` yet.

- [ ] **Step 3: Add the imports**

In `frontend/App.jsx`, change:

```jsx
import { useState, useEffect, useRef } from "react";
import { useCategories } from "./hooks/useCategories.js";
import { useZones } from "./hooks/useZones.js";
import { useListings } from "./hooks/useListings.js";
import { useListing } from "./hooks/useListing.js";
import { useAuth } from "./hooks/useAuth.js";
```

to:

```jsx
import { useState, useEffect, useRef } from "react";
import { useCategories } from "./hooks/useCategories.js";
import { useZones } from "./hooks/useZones.js";
import { useListings } from "./hooks/useListings.js";
import { useListing } from "./hooks/useListing.js";
import { useAuth } from "./hooks/useAuth.js";
import { useTheme } from "./hooks/useTheme.js";
import { useKYCQueue } from "./hooks/useKYCQueue.js";
import { useModerationQueue } from "./hooks/useModerationQueue.js";
import { useCustomers } from "./hooks/useCustomers.js";
import { useBusinessOwners } from "./hooks/useBusinessOwners.js";
import { useStaffRoster } from "./hooks/useStaffRoster.js";
import { apiPost } from "./apiClient.js";
```

- [ ] **Step 4: Add `StaffDashboard` and its shell dependencies**

In `frontend/App.jsx`, add this block immediately after `AdminDashboard`'s closing `}` (`App.jsx:2508`), before `function BusinessDashboard({ onExit }) {`:

```jsx
const DASHBOARD_THEME = {
  light: { pageBg:"#f0f2f5", sidebarBg:C.cream, sidebarText:C.darkBrown, cardBg:"#ffffff", text:C.darkBrown, textMuted:"#666", border:"#e0e0e0" },
  dark:  { pageBg:"#14161c", sidebarBg:"#0d0e12", sidebarText:C.cream, cardBg:"#1c1f26", text:C.cream, textMuted:"#9aa0aa", border:"#2a2d35" },
};

const ROLE_COLORS = { super_admin:C.gold, admin:C.kente3, accountant:C.kente1, marketing:C.kente2, support:C.ghGreen };

function ComingSoonPanel({theme,feature}) {
  return <div style={{background:theme.cardBg,borderRadius:16,padding:"40px 24px",textAlign:"center",border:`1px solid ${theme.border}`}}>
    <div style={{fontSize:"2rem",marginBottom:10}}>🚧</div>
    <div style={{color:theme.text,fontWeight:800,fontSize:"0.9rem",marginBottom:4}}>Coming soon</div>
    <div style={{color:theme.textMuted,fontSize:"0.78rem"}}>{feature} isn't built yet.</div>
  </div>;
}

function StaffOverviewPanel({auth,theme,roleColor}) {
  const permissions = auth.user?.permissions||[];
  return <div>
    <h2 style={{color:theme.text,fontWeight:900,margin:"0 0 6px",fontSize:"1.1rem"}}>Akwaaba, {auth.user?.full_name?.split(" ")[0]}!</h2>
    <div style={{color:theme.textMuted,fontSize:"0.8rem",marginBottom:20}}>
      You're signed in as <span style={{color:roleColor,fontWeight:800,textTransform:"capitalize"}}>{auth.user?.role?.replace("_"," ")}</span>.
    </div>
    <div style={{background:theme.cardBg,borderRadius:16,padding:"18px",border:`1px solid ${theme.border}`}}>
      <div style={{color:theme.text,fontWeight:800,fontSize:"0.82rem",marginBottom:10}}>Your permissions</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {permissions.map(p=>(
          <span key={p} style={{background:`${roleColor}18`,color:roleColor,borderRadius:20,padding:"3px 10px",fontSize:"0.68rem",fontWeight:700}}>{p}</span>
        ))}
      </div>
    </div>
  </div>;
}

export function StaffDashboard({auth,onExit}) {
  const {theme,toggleTheme} = useTheme();
  const t = DASHBOARD_THEME[theme];
  const [activeTab,setActiveTab] = useState("overview");
  const [sidebarCollapsed,setSidebarCollapsed] = useState(false);
  const role = auth.user?.role;
  const roleColor = ROLE_COLORS[role]||C.gold;

  const NAV_ITEMS = [
    {id:"overview",icon:"📊",label:"Overview",show:true},
    {id:"kyc",icon:"🪪",label:"KYC Queue",show:auth.hasPermission("kyc.approve")},
    {id:"moderation",icon:"📋",label:"Listings Moderation",show:auth.hasPermission("listings.moderate")},
    {id:"users",icon:"👥",label:"Users",show:auth.hasPermission("users.view")},
    {id:"categories-zones",icon:"🗂️",label:"Categories & Zones",show:auth.hasPermission("categories.manage")||auth.hasPermission("zones.manage")},
    {id:"staff",icon:"🛡️",label:"Staff Management",show:auth.hasPermission("staff.manage")},
    {id:"escrow",icon:"💰",label:"Escrow Ledger",show:auth.hasPermission("escrow.view")||auth.hasPermission("escrow.release")},
    {id:"disputes",icon:"⚖️",label:"Disputes",show:auth.hasPermission("disputes.resolve_financial")||auth.hasPermission("disputes.flag")},
    {id:"transactions",icon:"📈",label:"Transactions Report",show:auth.hasPermission("transactions.report")},
    {id:"promotions",icon:"🎯",label:"Promotions",show:auth.hasPermission("promotions.manage")},
    {id:"analytics",icon:"📊",label:"Analytics",show:auth.hasPermission("analytics.view")},
    {id:"messaging",icon:"💬",label:"Messaging / Tickets",show:auth.hasPermission("messaging.manage")},
  ].filter(item=>item.show);

  return <div style={{fontFamily:"'Georgia',serif",background:t.pageBg,minHeight:"100vh",display:"flex"}}>
    <div style={{width:sidebarCollapsed?60:220,background:t.sidebarBg,borderLeft:`4px solid ${roleColor}`,transition:"width 0.2s",flexShrink:0,position:"sticky",top:0,height:"100vh",overflowY:"auto"}}>
      <div style={{padding:"16px 12px",display:"flex",alignItems:"center",gap:8}}>
        <Flag w={28} h={19}/>
        {!sidebarCollapsed&&<div style={{color:t.sidebarText,fontWeight:900,fontSize:"0.85rem"}}>AshantiHub Staff</div>}
      </div>
      <button onClick={()=>setSidebarCollapsed(s=>!s)} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",padding:"4px 12px",fontSize:"0.7rem",fontFamily:"inherit"}}>{sidebarCollapsed?"→":"← Collapse"}</button>
      <nav>
        {NAV_ITEMS.map(item=>(
          <button key={item.id} onClick={()=>setActiveTab(item.id)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:activeTab===item.id?`${roleColor}22`:"none",border:"none",borderLeft:activeTab===item.id?`3px solid ${roleColor}`:"3px solid transparent",color:t.sidebarText,padding:"10px 12px",fontSize:"0.78rem",fontWeight:activeTab===item.id?800:600,cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
            <span>{item.icon}</span>{!sidebarCollapsed&&<span>{item.label}</span>}
          </button>
        ))}
      </nav>
    </div>

    <div style={{flex:1,minWidth:0}}>
      <div style={{background:t.cardBg,borderBottom:`1px solid ${t.border}`,padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:56,position:"sticky",top:0,zIndex:10}}>
        <div style={{color:t.text,fontWeight:800,fontSize:"0.9rem"}}>{NAV_ITEMS.find(i=>i.id===activeTab)?.label}</div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={toggleTheme} title="Toggle theme" style={{background:"none",border:`1px solid ${t.border}`,borderRadius:20,padding:"4px 10px",cursor:"pointer",fontSize:"0.8rem"}}>{theme==="dark"?"☀️":"🌙"}</button>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{background:roleColor,color:"white",borderRadius:20,padding:"2px 8px",fontSize:"0.62rem",fontWeight:800,textTransform:"capitalize"}}>{role?.replace("_"," ")}</span>
            <span style={{color:t.text,fontSize:"0.78rem",fontWeight:700}}>{auth.user?.full_name}</span>
          </div>
          <button onClick={onExit} style={{background:"none",border:`1px solid ${t.border}`,color:t.textMuted,borderRadius:20,padding:"4px 12px",fontSize:"0.7rem",cursor:"pointer",fontFamily:"inherit"}}>← Exit</button>
        </div>
      </div>

      <div style={{padding:"22px 20px 60px"}}>
        {activeTab==="overview"&&<StaffOverviewPanel auth={auth} theme={t} roleColor={roleColor}/>}
        {activeTab==="kyc"&&<ComingSoonPanel theme={t} feature="KYC Queue"/>}
        {activeTab==="moderation"&&<ComingSoonPanel theme={t} feature="Listings Moderation"/>}
        {activeTab==="users"&&<ComingSoonPanel theme={t} feature="Users"/>}
        {activeTab==="categories-zones"&&<ComingSoonPanel theme={t} feature="Categories & Zones"/>}
        {activeTab==="staff"&&<ComingSoonPanel theme={t} feature="Staff Management"/>}
        {activeTab==="escrow"&&<ComingSoonPanel theme={t} feature="Escrow Ledger"/>}
        {activeTab==="disputes"&&<ComingSoonPanel theme={t} feature="Disputes"/>}
        {activeTab==="transactions"&&<ComingSoonPanel theme={t} feature="Transactions Report"/>}
        {activeTab==="promotions"&&<ComingSoonPanel theme={t} feature="Promotions"/>}
        {activeTab==="analytics"&&<ComingSoonPanel theme={t} feature="Analytics"/>}
        {activeTab==="messaging"&&<ComingSoonPanel theme={t} feature="Messaging / Tickets"/>}
      </div>
    </div>
  </div>;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm run test -- StaffDashboard.test.jsx`
Expected: PASS, all 6 tests.

- [ ] **Step 6: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/App.jsx frontend/StaffDashboard.test.jsx
git commit -m "feat: add StaffDashboard shell with permission-gated nav and theme toggle"
```

---

### Task 8: Frontend — KYC Queue and Listings Moderation panels

**Files:**
- Modify: `frontend/App.jsx` (add `KYCQueuePanel`, `ListingsModerationPanel`; replace their two `ComingSoonPanel` lines in `StaffDashboard`)
- Modify: `frontend/StaffDashboard.test.jsx`

**Interfaces:**
- Consumes: `useKYCQueue`, `useModerationQueue` (Task 6, both resolve to a **plain array**), `apiPost` (existing, for approve/reject actions).
- Produces: two real panel components rendered when `activeTab==="kyc"` / `activeTab==="moderation"`.

- [ ] **Step 1: Write the failing tests**

In `frontend/StaffDashboard.test.jsx`, change the top import line from:

```jsx
import { fireEvent, render, screen } from '@testing-library/react'
```

to:

```jsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './mocks/server.js'
```

Add these test cases inside the existing `describe('StaffDashboard', ...)` block:

```jsx
  it('renders the KYC queue and approves an entry', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/kyc/pending/', () => {
        return HttpResponse.json([{ id: 7, full_name: 'Kwame Business', login_phone: '+233201112233', created_at: '2026-07-01T00:00:00Z' }])
      }),
    )
    let approveCalled = false
    server.use(
      http.post('http://localhost:8000/api/accounts/kyc/7/approve/', () => {
        approveCalled = true
        return HttpResponse.json({ id: 7, kyc_status: 'verified' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'kyc.approve' })
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('KYC Queue'))
    await screen.findByText('Kwame Business')
    fireEvent.click(screen.getByText('✓ Approve'))
    await waitFor(() => expect(approveCalled).toBe(true))
  })

  it('renders the listings moderation queue', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/moderation/pending/', () => {
        return HttpResponse.json([{ id: 3, name: 'Royal Ashanti Lodge', category: { label: 'Hotels' }, zone: { name: 'Manhyia' }, price_amount: '450.00', contact_phone: '+233244000001' }])
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'listings.moderate' })
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Listings Moderation'))
    await screen.findByText('Royal Ashanti Lodge')
  })
```

(This file already imports `waitFor` — if not, add it to the existing `@testing-library/react` import line.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- StaffDashboard.test.jsx`
Expected: FAIL — both new tests time out/fail since the panels still render `ComingSoonPanel` ("Coming soon" text, not the real queue data).

- [ ] **Step 3: Add the two panel components**

In `frontend/App.jsx`, add these two components immediately before `export function StaffDashboard`:

```jsx
function KYCQueuePanel({theme}) {
  const {data,isLoading,isError,refetch} = useKYCQueue();
  const [rejectingId,setRejectingId] = useState(null);
  const [rejectReason,setRejectReason] = useState("");

  const approve = async (id) => { await apiPost(`/api/accounts/kyc/${id}/approve/`,{}); refetch(); };
  const reject = async (id) => { await apiPost(`/api/accounts/kyc/${id}/reject/`,{reason:rejectReason}); setRejectingId(null); setRejectReason(""); refetch(); };

  if(isLoading) return <div style={{color:theme.textMuted,fontSize:"0.8rem"}}>Loading…</div>;
  if(isError) return <div style={{color:"#dc2626",fontSize:"0.8rem"}}>Could not load the KYC queue.</div>;
  const items = data||[];

  return <div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`}}>
    <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:14}}>Pending KYC submissions ({items.length})</div>
    {items.length===0&&<div style={{color:theme.textMuted,fontSize:"0.8rem"}}>No pending submissions.</div>}
    {items.map(o=>(
      <div key={o.id} style={{padding:"12px 0",borderBottom:`1px solid ${theme.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div>
            <div style={{color:theme.text,fontWeight:700,fontSize:"0.82rem"}}>{o.full_name}</div>
            <div style={{color:theme.textMuted,fontSize:"0.68rem"}}>{o.login_phone} • submitted {o.created_at?.slice(0,10)}</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>approve(o.id)} style={{background:"#22c55e",color:"white",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✓ Approve</button>
            <button onClick={()=>setRejectingId(o.id)} style={{background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✕ Reject</button>
          </div>
        </div>
        {rejectingId===o.id&&<div style={{marginTop:8,display:"flex",gap:6}}>
          <input value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder="Rejection reason" style={{flex:1,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
          <button onClick={()=>reject(o.id)} disabled={!rejectReason} style={{background:"#dc2626",color:"white",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:rejectReason?"pointer":"default"}}>Confirm reject</button>
        </div>}
      </div>
    ))}
  </div>;
}

function ListingsModerationPanel({theme}) {
  const {data,isLoading,isError,refetch} = useModerationQueue();
  const [rejectingId,setRejectingId] = useState(null);
  const [rejectReason,setRejectReason] = useState("");

  const approve = async (id) => { await apiPost(`/api/listings/moderation/${id}/approve/`,{}); refetch(); };
  const reject = async (id) => { await apiPost(`/api/listings/moderation/${id}/reject/`,{reason:rejectReason}); setRejectingId(null); setRejectReason(""); refetch(); };

  if(isLoading) return <div style={{color:theme.textMuted,fontSize:"0.8rem"}}>Loading…</div>;
  if(isError) return <div style={{color:"#dc2626",fontSize:"0.8rem"}}>Could not load the moderation queue.</div>;
  const items = data||[];

  return <div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`}}>
    <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:14}}>Pending listings ({items.length})</div>
    {items.length===0&&<div style={{color:theme.textMuted,fontSize:"0.8rem"}}>No pending listings.</div>}
    {items.map(l=>(
      <div key={l.id} style={{padding:"12px 0",borderBottom:`1px solid ${theme.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div>
            <div style={{color:theme.text,fontWeight:700,fontSize:"0.82rem"}}>{l.name}</div>
            <div style={{color:theme.textMuted,fontSize:"0.68rem"}}>{l.category?.label} • {l.zone?.name} • GHS {l.price_amount} • {l.contact_phone}</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>approve(l.id)} style={{background:"#22c55e",color:"white",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✓ Approve</button>
            <button onClick={()=>setRejectingId(l.id)} style={{background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✕ Reject</button>
          </div>
        </div>
        {rejectingId===l.id&&<div style={{marginTop:8,display:"flex",gap:6}}>
          <input value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder="Rejection reason" style={{flex:1,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
          <button onClick={()=>reject(l.id)} disabled={!rejectReason} style={{background:"#dc2626",color:"white",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:rejectReason?"pointer":"default"}}>Confirm reject</button>
        </div>}
      </div>
    ))}
  </div>;
}
```

Then, inside `StaffDashboard`'s render, change:

```jsx
        {activeTab==="kyc"&&<ComingSoonPanel theme={t} feature="KYC Queue"/>}
        {activeTab==="moderation"&&<ComingSoonPanel theme={t} feature="Listings Moderation"/>}
```

to:

```jsx
        {activeTab==="kyc"&&<KYCQueuePanel theme={t}/>}
        {activeTab==="moderation"&&<ListingsModerationPanel theme={t}/>}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- StaffDashboard.test.jsx`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/App.jsx frontend/StaffDashboard.test.jsx
git commit -m "feat: wire real KYC Queue and Listings Moderation panels into StaffDashboard"
```

---

### Task 9: Frontend — Users panel (Customers / Business Owners tabs)

**Files:**
- Modify: `frontend/App.jsx` (add `UsersPanel`; replace its `ComingSoonPanel` line)
- Modify: `frontend/StaffDashboard.test.jsx`

**Interfaces:**
- Consumes: `useCustomers`, `useBusinessOwners` (Task 6, both resolve to `{count, results}`).
- Produces: real panel rendered when `activeTab==="users"`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/StaffDashboard.test.jsx`:

```jsx
  it('renders the Users panel with a Customers/Business Owners tab switch', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 1, full_name: 'Ama Owusu', phone: '+233241234567', email: 'ama@example.com' }] })
      }),
      http.get('http://localhost:8000/api/accounts/business-owners/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 2, full_name: 'Kwame Business', login_phone: '+233201112233', kyc_status: 'pending' }] })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'users.view' })
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Users'))
    await screen.findByText('Ama Owusu')
    fireEvent.click(screen.getByText('Business Owners'))
    await screen.findByText('Kwame Business')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- StaffDashboard.test.jsx`
Expected: FAIL — the Users tab still renders `ComingSoonPanel`.

- [ ] **Step 3: Add `UsersPanel`**

In `frontend/App.jsx`, add this component immediately before `export function StaffDashboard`:

```jsx
function UsersPanel({theme}) {
  const [subTab,setSubTab] = useState("customers");
  const customers = useCustomers();
  const owners = useBusinessOwners();
  const active = subTab==="customers"?customers:owners;

  return <div>
    <div style={{display:"flex",gap:8,marginBottom:14}}>
      <button onClick={()=>setSubTab("customers")} style={{padding:"6px 14px",borderRadius:20,border:"none",cursor:"pointer",fontWeight:700,fontSize:"0.75rem",background:subTab==="customers"?C.gold:theme.border,color:subTab==="customers"?C.darkBrown:theme.textMuted,fontFamily:"inherit"}}>Customers</button>
      <button onClick={()=>setSubTab("owners")} style={{padding:"6px 14px",borderRadius:20,border:"none",cursor:"pointer",fontWeight:700,fontSize:"0.75rem",background:subTab==="owners"?C.gold:theme.border,color:subTab==="owners"?C.darkBrown:theme.textMuted,fontFamily:"inherit"}}>Business Owners</button>
    </div>
    {active.isLoading&&<div style={{color:theme.textMuted,fontSize:"0.8rem"}}>Loading…</div>}
    {active.isError&&<div style={{color:"#dc2626",fontSize:"0.8rem"}}>Could not load this list.</div>}
    {active.data&&<div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`}}>
      <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:4}}>{active.data.count} total</div>
      {active.data.count>20&&<div style={{color:theme.textMuted,fontSize:"0.68rem",marginBottom:10}}>Showing first 20 of {active.data.count}.</div>}
      {active.data.results.map(u=>(
        <div key={u.id} style={{padding:"10px 0",borderBottom:`1px solid ${theme.border}`}}>
          <div style={{color:theme.text,fontWeight:700,fontSize:"0.8rem"}}>{u.full_name}</div>
          <div style={{color:theme.textMuted,fontSize:"0.68rem"}}>
            {subTab==="customers"?`${u.phone||"—"} • ${u.email||"—"}`:`${u.login_phone} • KYC: ${u.kyc_status}`}
          </div>
        </div>
      ))}
    </div>}
  </div>;
}
```

Then, inside `StaffDashboard`'s render, change:

```jsx
        {activeTab==="users"&&<ComingSoonPanel theme={t} feature="Users"/>}
```

to:

```jsx
        {activeTab==="users"&&<UsersPanel theme={t}/>}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- StaffDashboard.test.jsx`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/App.jsx frontend/StaffDashboard.test.jsx
git commit -m "feat: wire real Users panel (Customers/Business Owners) into StaffDashboard"
```

---

### Task 10: Frontend — Categories & Zones panel

**Files:**
- Modify: `frontend/App.jsx` (add `CategoriesZonesPanel`; replace its `ComingSoonPanel` line)
- Modify: `frontend/StaffDashboard.test.jsx`

**Interfaces:**
- Consumes: `useCategories`, `useZones` (existing, already used by the public marketplace), `apiPost` (existing, for the create-category/create-zone POSTs).
- Produces: real panel rendered when `activeTab==="categories-zones"`, gating the category-creation form on `hasPermission("categories.manage")` and the zone-creation form on `hasPermission("zones.manage")` independently (per the design spec — `admin` has `zones.manage` only).

- [ ] **Step 1: Write the failing tests**

Add to `frontend/StaffDashboard.test.jsx`:

```jsx
  it('shows only zone creation for a session with zones.manage but not categories.manage', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/categories/', () => HttpResponse.json([{ id: 1, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' }])),
      http.get('http://localhost:8000/api/listings/zones/', () => HttpResponse.json([{ id: 1, name: 'Manhyia' }])),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'zones.manage' })
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Categories & Zones'))
    await screen.findByText('Manhyia')
    expect(screen.getByPlaceholderText('New zone name')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('New category label')).not.toBeInTheDocument()
  })

  it('creates a new zone', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/categories/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/listings/zones/', () => HttpResponse.json([])),
    )
    let created = false
    server.use(
      http.post('http://localhost:8000/api/listings/zones/', () => { created = true; return HttpResponse.json({ id: 2, name: 'Adum' }, { status: 201 }) }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'zones.manage' })
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Categories & Zones'))
    fireEvent.change(await screen.findByPlaceholderText('New zone name'), { target: { value: 'Adum' } })
    fireEvent.click(screen.getByText('Add zone'))
    await waitFor(() => expect(created).toBe(true))
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- StaffDashboard.test.jsx`
Expected: FAIL — the Categories & Zones tab still renders `ComingSoonPanel`.

- [ ] **Step 3: Add `CategoriesZonesPanel`**

In `frontend/App.jsx`, add this component immediately before `export function StaffDashboard`:

```jsx
function CategoriesZonesPanel({theme,auth}) {
  const categories = useCategories();
  const zones = useZones();
  const [newCategoryLabel,setNewCategoryLabel] = useState("");
  const [newZoneName,setNewZoneName] = useState("");

  const addCategory = async () => {
    if(!newCategoryLabel) return;
    const slug = newCategoryLabel.toLowerCase().replace(/\s+/g,"-");
    await apiPost("/api/listings/categories/",{slug,icon:"🆕",label:newCategoryLabel,color:"#888888"});
    setNewCategoryLabel("");
    categories.refetch();
  };
  const addZone = async () => {
    if(!newZoneName) return;
    await apiPost("/api/listings/zones/",{name:newZoneName});
    setNewZoneName("");
    zones.refetch();
  };

  return <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
    <div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`}}>
      <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:12}}>Categories</div>
      {(categories.data||[]).map(c=>(
        <div key={c.id} style={{padding:"6px 0",color:theme.text,fontSize:"0.8rem"}}>{c.icon} {c.label}</div>
      ))}
      {auth.hasPermission("categories.manage")&&<div style={{marginTop:12,display:"flex",gap:6}}>
        <input value={newCategoryLabel} onChange={e=>setNewCategoryLabel(e.target.value)} placeholder="New category label" style={{flex:1,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
        <button onClick={addCategory} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"6px 14px",fontSize:"0.72rem",fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Add category</button>
      </div>}
    </div>
    <div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`}}>
      <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:12}}>Zones</div>
      {(zones.data||[]).map(z=>(
        <div key={z.id} style={{padding:"6px 0",color:theme.text,fontSize:"0.8rem"}}>{z.name}</div>
      ))}
      {auth.hasPermission("zones.manage")&&<div style={{marginTop:12,display:"flex",gap:6}}>
        <input value={newZoneName} onChange={e=>setNewZoneName(e.target.value)} placeholder="New zone name" style={{flex:1,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
        <button onClick={addZone} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"6px 14px",fontSize:"0.72rem",fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Add zone</button>
      </div>}
    </div>
  </div>;
}
```

Then, inside `StaffDashboard`'s render, change:

```jsx
        {activeTab==="categories-zones"&&<ComingSoonPanel theme={t} feature="Categories & Zones"/>}
```

to:

```jsx
        {activeTab==="categories-zones"&&<CategoriesZonesPanel theme={t} auth={auth}/>}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- StaffDashboard.test.jsx`
Expected: PASS, all 11 tests.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/App.jsx frontend/StaffDashboard.test.jsx
git commit -m "feat: wire real Categories & Zones panel into StaffDashboard"
```

---

### Task 11: Frontend — Staff Management panel

**Files:**
- Modify: `frontend/App.jsx` (add `StaffManagementPanel`; replace its `ComingSoonPanel` line)
- Modify: `frontend/StaffDashboard.test.jsx`

**Interfaces:**
- Consumes: `useStaffRoster` (Task 6), `apiPost` (existing, for the invite action against the pre-existing `staff/invite/` endpoint).
- Produces: real panel rendered when `activeTab==="staff"`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/StaffDashboard.test.jsx`:

```jsx
  it('renders the staff roster and invites a new staff member', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 1, full_name: 'Akosua Support', email: 'akosua@example.com', role: 'support', status: 'active' }] })
      }),
    )
    let invited = false
    server.use(
      http.post('http://localhost:8000/api/accounts/staff/invite/', () => { invited = true; return HttpResponse.json({ id: 2 }, { status: 201 }) }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'staff.manage' })
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Staff Management'))
    await screen.findByText('Akosua Support')
    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'New Hire' } })
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'newhire@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Role'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByText('Send invite'))
    await waitFor(() => expect(invited).toBe(true))
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- StaffDashboard.test.jsx`
Expected: FAIL — the Staff Management tab still renders `ComingSoonPanel`.

- [ ] **Step 3: Add `StaffManagementPanel`**

In `frontend/App.jsx`, add this component immediately before `export function StaffDashboard`:

```jsx
const STATUS_COLORS = {active:"#22c55e",invited:"#f59e0b",invite_expired:"#dc2626"};

function StaffManagementPanel({theme}) {
  const {data,isLoading,isError,refetch} = useStaffRoster();
  const [inviteName,setInviteName] = useState("");
  const [inviteEmail,setInviteEmail] = useState("");
  const [inviteRole,setInviteRole] = useState("");

  const sendInvite = async () => {
    if(!inviteName||!inviteEmail||!inviteRole) return;
    await apiPost("/api/accounts/staff/invite/",{full_name:inviteName,email:inviteEmail,role:inviteRole});
    setInviteName(""); setInviteEmail(""); setInviteRole("");
    refetch();
  };

  return <div>
    <div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`,marginBottom:16}}>
      <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:12}}>Invite a staff member</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        <input value={inviteName} onChange={e=>setInviteName(e.target.value)} placeholder="Full name" style={{flex:1,minWidth:120,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
        <input value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="Email" style={{flex:1,minWidth:120,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
        <input value={inviteRole} onChange={e=>setInviteRole(e.target.value)} placeholder="Role" style={{width:120,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
        <button onClick={sendInvite} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"6px 14px",fontSize:"0.72rem",fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Send invite</button>
      </div>
    </div>

    {isLoading&&<div style={{color:theme.textMuted,fontSize:"0.8rem"}}>Loading…</div>}
    {isError&&<div style={{color:"#dc2626",fontSize:"0.8rem"}}>Could not load the staff roster.</div>}
    {data&&<div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`}}>
      <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:10}}>{data.count} staff members</div>
      {data.results.map(s=>(
        <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${theme.border}`}}>
          <div>
            <div style={{color:theme.text,fontWeight:700,fontSize:"0.8rem"}}>{s.full_name}</div>
            <div style={{color:theme.textMuted,fontSize:"0.68rem"}}>{s.email} • {s.role}</div>
          </div>
          <span style={{background:`${STATUS_COLORS[s.status]}22`,color:STATUS_COLORS[s.status],borderRadius:20,padding:"2px 8px",fontSize:"0.62rem",fontWeight:700}}>{s.status}</span>
        </div>
      ))}
    </div>}
  </div>;
}
```

Then, inside `StaffDashboard`'s render, change:

```jsx
        {activeTab==="staff"&&<ComingSoonPanel theme={t} feature="Staff Management"/>}
```

to:

```jsx
        {activeTab==="staff"&&<StaffManagementPanel theme={t}/>}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- StaffDashboard.test.jsx`
Expected: PASS, all 12 tests.

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/App.jsx frontend/StaffDashboard.test.jsx
git commit -m "feat: wire real Staff Management panel into StaffDashboard"
```

---

### Task 12: Frontend — retire `AdminDashboard`, wire `StaffDashboard` into `AshantiHub`

**Files:**
- Modify: `frontend/App.jsx` (delete `AdminDashboard` + its mock data arrays; change the `isAdmin` render gate)

**Interfaces:**
- Consumes: `StaffDashboard` (Tasks 7–11), `auth` (already in scope in `AshantiHub` since the login-session sub-project).
- Produces: `AshantiHub` renders the real `StaffDashboard` instead of the mock `AdminDashboard`. No other change to `isAdmin`'s own state/gating logic or the hidden-gesture bridge.

- [ ] **Step 1: Delete the mock data block and `AdminDashboard`**

In `frontend/App.jsx`, delete the entire block from the `// ─── Mock Data for Admin ───` comment (`App.jsx:2157`) through `AdminDashboard`'s closing `}` (`App.jsx:2508`) — this removes `mockCustomers`, `mockBusinesses`, `mockOrders`, `mockRiders`, `mockPartners`, `mockDeliveryOrders`, and the `AdminDashboard` function itself. The `DASHBOARD_THEME`/`ROLE_COLORS`/`ComingSoonPanel`/panel components/`StaffDashboard` block added in Tasks 7–11 (which sits immediately after this deleted block) is untouched — after deletion it becomes the first thing following `AuthModal`'s closing `}`.

- [ ] **Step 2: Update the render gate**

In `frontend/App.jsx`, change:

```jsx
  if(isAdmin) return <AdminDashboard onExit={()=>setIsAdmin(false)}/>;
```

to:

```jsx
  if(isAdmin) return <StaffDashboard auth={auth} onExit={()=>setIsAdmin(false)}/>;
```

- [ ] **Step 3: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS — confirms no other part of `App.jsx` referenced `AdminDashboard`, `mockCustomers`, etc. (a lingering reference would surface as a `ReferenceError` during the module's test collection).

- [ ] **Step 4: Verify the build**

Run: `cd frontend && npm run build`
Expected: succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/App.jsx
git commit -m "feat: retire AdminDashboard mock UI, wire StaffDashboard into AshantiHub"
```

---

### Task 13: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full backend regression**

Run: `docker compose run --rm web python manage.py test accounts listings core`
Expected: PASS, all tests (should be 119 pre-existing + this plan's new tests: 3 from Task 1 + 7 from Task 2 + 5 from Task 3 = 15 new, 134 total).

- [ ] **Step 2: Full frontend regression**

Run: `cd frontend && npm run test`
Expected: PASS, all tests.

- [ ] **Step 3: Build verification**

Run: `cd frontend && npm run build`
Expected: succeeds with no errors.

- [ ] **Step 4: Manual smoke test (code-trace, or live if a backend is available)**

Trace or run through:
1. Log in as a `super_admin` (or 5-click the logo while logged in as one) — confirm every nav item appears, Overview lists all 14 permissions, KYC/Moderation/Users/Categories & Zones/Staff Management show real data, the remaining 6 show "Coming soon."
2. Log in as `support` — confirm only Overview, Users, Messaging/Tickets, Disputes appear; Messaging/Tickets and Disputes show "Coming soon"; Users shows real customer/business-owner lists.
3. Toggle the theme — confirm the sidebar/cards/text genuinely switch between the light and dark token sets, and the preference survives a page reload (persisted to `localStorage`).
4. As `admin`, open Categories & Zones — confirm only "Add zone" is available, not "Add category" (since `admin` lacks `categories.manage`).
5. As `super_admin`, invite a new staff member from Staff Management — confirm the roster refreshes and the new entry shows `status: "invited"`.

If no live backend is available in the execution environment, perform this as a code-trace against the actual diff (as Task 6 of the login-session plan did) and note explicitly that a live pass is still outstanding.

- [ ] **Step 5: Report**

No commit for this task — report the verification results (pass/fail per step, and whether the smoke test was live or code-traced) back to the controller.
