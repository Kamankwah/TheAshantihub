# Roles, Registration & KYC Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Django/DRF/Postgres backend (currently nonexistent — this repo is frontend-only) and build the Customer/BusinessOwner/StaffUser account model, RBAC permission system, registration flows, and KYC approval workflow described in `docs/superpowers/specs/2026-07-09-roles-registration-kyc-design.md`.

**Architecture:** A `backend/` directory holds a Django project (`ashantihub`) with two apps: `core` (health check, project-wide concerns) and `accounts` (all three account models, Role/Permission RBAC, registration, auth, KYC). Because the three account types are deliberately separate tables (not a shared Django `AUTH_USER_MODEL`), authentication uses a custom JWT scheme: tokens carry an `account_type` claim, and a custom DRF authentication class resolves the right model per request. This is new infrastructure the spec's Day-2 OTP login work will reuse.

**Tech Stack:** Django 5.0, Django REST Framework 3.15, djangorestframework-simplejwt 5.3 (token encode/verify only, not its user-resolution layer), PostgreSQL 16, psycopg2-binary, django-environ, Pillow (image uploads), django-cors-headers, Docker Compose for local dev.

## Global Constraints

- Three account tables (`Customer`, `BusinessOwner`, `StaffUser`) — no shared base table, per the approved spec.
- `BusinessOwnerProfile.business_reg_certificate` and `.tin` are required if and only if `is_formal = true`.
- `BusinessOwner.kyc_status` starts at `pending`; only staff actions transition it to `verified`/`rejected`.
- A business owner may register a bank account, mobile money, or both; `default_payout_method` must reference a populated method.
- Changing payout details after verification resets only `payout_verification_status`, never `kyc_status`.
- `Ghana Card` numbers are unique across `BusinessOwnerProfile` rows.
- Staff accounts are never self-registered — only created via an authenticated `super_admin` invite action.
- RBAC permission checks happen server-side on every staff-facing endpoint, per the default matrix in the spec (`super_admin`=all, `admin`=KYC+listings+users, `accountant`=escrow/payouts/tx reports, `marketing`=promotions/analytics, `support`=messaging/disputes read-mostly).
- All backend code lives under `backend/` at the repo root; the existing frontend files at the repo root are untouched by this plan.
- Tests run against the Postgres dev container (`docker compose up -d db`), not SQLite — matches the target production database.

---

## File Structure

```
docker-compose.yml                          # new, repo root
backend/
  Dockerfile
  requirements.txt
  .env.example
  manage.py
  ashantihub/
    __init__.py
    settings.py
    urls.py
    wsgi.py
    asgi.py
  core/
    __init__.py
    apps.py
    views.py                                # health check
    urls.py
    tests.py
  accounts/
    __init__.py
    apps.py
    models.py                               # Role, Permission, Customer, StaffUser, BusinessOwner, BusinessOwnerProfile
    mixins.py                                # AuthenticatableAccountMixin
    authentication.py                        # MultiAccountJWTAuthentication, issue_token()
    permissions.py                           # HasRolePermission
    serializers.py
    views.py
    urls.py
    management/
      __init__.py
      commands/
        __init__.py
        create_super_admin.py               # bootstrap command
    migrations/
      0001_initial.py                       # generated (Task 2: Role, Permission)
      0002_seed_roles_permissions.py        # hand-written data migration (Task 2)
      0003_customer.py                      # generated (Task 3)
      0004_staffuser.py                     # generated (Task 5)
      0005_businessowner_businessownerprofile.py  # generated (Task 6)
    tests/
      __init__.py
      test_roles_seed.py
      test_authentication.py
      test_customer_registration.py
      test_staff_invite.py
      test_permissions.py
      test_business_owner_models.py
      test_business_owner_registration.py
      test_kyc_workflow.py
      test_payout_details.py
```

---

### Task 1: Django + DRF + Postgres scaffold, Docker Compose, health check

**Files:**
- Create: `docker-compose.yml`
- Create: `backend/Dockerfile`
- Create: `backend/requirements.txt`
- Create: `backend/.env.example`
- Create: `backend/manage.py`
- Create: `backend/ashantihub/__init__.py`
- Create: `backend/ashantihub/settings.py`
- Create: `backend/ashantihub/urls.py`
- Create: `backend/ashantihub/wsgi.py`
- Create: `backend/ashantihub/asgi.py`
- Create: `backend/core/__init__.py`
- Create: `backend/core/apps.py`
- Create: `backend/core/views.py`
- Create: `backend/core/urls.py`
- Test: `backend/core/tests.py`

**Interfaces:**
- Produces: `GET /api/health/` → `{"status": "ok"}`, HTTP 200. Later tasks' apps are mounted under `/api/accounts/` in `ashantihub/urls.py`.

- [ ] **Step 1: Write `backend/requirements.txt`**

```
Django==5.0.9
djangorestframework==3.15.2
djangorestframework-simplejwt==5.3.1
psycopg2-binary==2.9.9
django-environ==0.11.2
Pillow==10.4.0
django-cors-headers==4.4.0
```

- [ ] **Step 2: Write `backend/Dockerfile`**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
```

- [ ] **Step 3: Write `backend/.env.example`**

```
DJANGO_SECRET_KEY=change-me-in-real-env
DJANGO_DEBUG=True
POSTGRES_DB=ashantihub
POSTGRES_USER=ashantihub
POSTGRES_PASSWORD=ashantihub_dev
POSTGRES_HOST=db
POSTGRES_PORT=5432
```

Copy it to a real `.env` for local dev: `cp backend/.env.example backend/.env` (this file is gitignored, never committed).

- [ ] **Step 4: Write `docker-compose.yml`** (repo root)

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: ashantihub
      POSTGRES_USER: ashantihub
      POSTGRES_PASSWORD: ashantihub_dev
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
  web:
    build: ./backend
    command: python manage.py runserver 0.0.0.0:8000
    volumes:
      - ./backend:/app
    ports:
      - "8000:8000"
    env_file:
      - ./backend/.env
    depends_on:
      - db
volumes:
  pgdata:
```

- [ ] **Step 5: Write `backend/manage.py`**

```python
#!/usr/bin/env python
import os
import sys


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ashantihub.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Write `backend/ashantihub/__init__.py`** (empty file)

```python
```

- [ ] **Step 7: Write `backend/ashantihub/settings.py`**

```python
from pathlib import Path
import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(DJANGO_DEBUG=(bool, False))
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-only-insecure-key")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "core",
    "accounts",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "ashantihub.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    },
]

WSGI_APPLICATION = "ashantihub.wsgi.application"
ASGI_APPLICATION = "ashantihub.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", default="ashantihub"),
        "USER": env("POSTGRES_USER", default="ashantihub"),
        "PASSWORD": env("POSTGRES_PASSWORD", default="ashantihub_dev"),
        "HOST": env("POSTGRES_HOST", default="localhost"),
        "PORT": env("POSTGRES_PORT", default="5432"),
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

STATIC_URL = "static/"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

CORS_ALLOW_ALL_ORIGINS = True

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "accounts.authentication.MultiAccountJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [],
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": __import__("datetime").timedelta(hours=12),
}
```

- [ ] **Step 8: Write `backend/ashantihub/urls.py`**

```python
from django.urls import include, path

urlpatterns = [
    path("api/", include("core.urls")),
    path("api/accounts/", include("accounts.urls")),
]
```

- [ ] **Step 9: Write `backend/ashantihub/wsgi.py`**

```python
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ashantihub.settings")
application = get_wsgi_application()
```

- [ ] **Step 10: Write `backend/ashantihub/asgi.py`**

```python
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ashantihub.settings")
application = get_asgi_application()
```

- [ ] **Step 11: Write `backend/core/__init__.py`** (empty file)

```python
```

- [ ] **Step 12: Write `backend/core/apps.py`**

```python
from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core"
```

- [ ] **Step 13: Write the failing test — `backend/core/tests.py`**

```python
from rest_framework.test import APITestCase


class HealthCheckTests(APITestCase):
    def test_health_check_returns_ok(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
```

- [ ] **Step 14: Create an empty `accounts` app so `INSTALLED_APPS` resolves**

```bash
mkdir -p backend/accounts
touch backend/accounts/__init__.py
```

```python
# backend/accounts/apps.py
from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"
```

```python
# backend/accounts/urls.py
from django.urls import path

urlpatterns = []
```

- [ ] **Step 15: Run test to verify it fails**

Run: `docker compose up -d db && docker compose run --rm web python manage.py test core`
Expected: FAIL — `ModuleNotFoundError` or 404, since `core/views.py` and `core/urls.py` don't exist yet.

- [ ] **Step 16: Write `backend/core/views.py`**

```python
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    return Response({"status": "ok"})
```

- [ ] **Step 17: Write `backend/core/urls.py`**

```python
from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health_check, name="health-check"),
]
```

- [ ] **Step 18: Run migrations and the test to verify it passes**

Run: `docker compose run --rm web python manage.py migrate`
Expected: `Operations to perform: ... Apply all migrations: (none yet)` — succeeds, connects to Postgres.

Run: `docker compose run --rm web python manage.py test core`
Expected: `Ran 1 test in ...s OK`

- [ ] **Step 19: Commit**

```bash
git add docker-compose.yml backend/
git commit -m "feat: scaffold Django/DRF/Postgres backend with health check"
```

---

### Task 2: Role & Permission models + seed data migration

**Files:**
- Modify: `backend/accounts/models.py` (create)
- Test: `backend/accounts/tests/test_roles_seed.py`
- Create: `backend/accounts/tests/__init__.py`

**Interfaces:**
- Consumes: nothing from Task 1 beyond the app skeleton.
- Produces: `Role` model with `.name` in `{"super_admin", "admin", "accountant", "marketing", "support"}`; `Permission` model with `.codename`; `Role.permissions` M2M field. Later tasks (`StaffUser`, `HasRolePermission`) rely on `Role.objects.get(name=...)` and `role.permissions.filter(codename=...).exists()`.

- [ ] **Step 1: Delete the placeholder `accounts/tests.py` created by Django's default app layout (none was generated since we hand-wrote the app) and create the tests package**

```bash
mkdir -p backend/accounts/tests
touch backend/accounts/tests/__init__.py
```

- [ ] **Step 2: Write the failing test — `backend/accounts/tests/test_roles_seed.py`**

```python
from django.test import TestCase

from accounts.models import Permission, Role

DEFAULT_MATRIX = {
    "super_admin": None,  # None = all permissions
    "admin": {"kyc.approve", "listings.moderate", "users.view"},
    "accountant": {"escrow.view", "escrow.release", "disputes.resolve_financial", "transactions.report"},
    "marketing": {"promotions.manage", "analytics.view", "categories.manage"},
    "support": {"messaging.manage", "disputes.flag", "users.view"},
}


class RoleSeedTests(TestCase):
    def test_all_five_roles_exist(self):
        names = set(Role.objects.values_list("name", flat=True))
        self.assertEqual(names, set(DEFAULT_MATRIX.keys()))

    def test_super_admin_has_every_permission(self):
        super_admin = Role.objects.get(name="super_admin")
        self.assertEqual(
            set(super_admin.permissions.values_list("codename", flat=True)),
            set(Permission.objects.values_list("codename", flat=True)),
        )

    def test_accountant_cannot_approve_kyc(self):
        accountant = Role.objects.get(name="accountant")
        self.assertFalse(accountant.permissions.filter(codename="kyc.approve").exists())

    def test_marketing_has_no_financial_permissions(self):
        marketing = Role.objects.get(name="marketing")
        financial_codenames = {"escrow.view", "escrow.release", "transactions.report"}
        self.assertFalse(
            marketing.permissions.filter(codename__in=financial_codenames).exists()
        )
```

- [ ] **Step 3: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_roles_seed`
Expected: FAIL — `ImportError: cannot import name 'Role' from 'accounts.models'` (module doesn't exist yet).

- [ ] **Step 4: Write `backend/accounts/models.py`**

```python
from django.db import models


class Permission(models.Model):
    codename = models.CharField(max_length=100, unique=True)
    description = models.CharField(max_length=255)

    def __str__(self):
        return self.codename


class Role(models.Model):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    ACCOUNTANT = "accountant"
    MARKETING = "marketing"
    SUPPORT = "support"

    NAME_CHOICES = [
        (SUPER_ADMIN, "Super Admin"),
        (ADMIN, "Admin"),
        (ACCOUNTANT, "Accountant"),
        (MARKETING, "Marketing"),
        (SUPPORT, "Support"),
    ]

    name = models.CharField(max_length=20, choices=NAME_CHOICES, unique=True)
    permissions = models.ManyToManyField(Permission, related_name="roles", blank=True)

    def __str__(self):
        return self.name
```

- [ ] **Step 5: Generate the schema migration**

Run: `docker compose run --rm web python manage.py makemigrations accounts`
Expected: creates `backend/accounts/migrations/0001_initial.py` with `Permission` and `Role` models plus the M2M through table. Verify the migration file lists both models before continuing.

- [ ] **Step 6: Write the data migration — `backend/accounts/migrations/0002_seed_roles_permissions.py`**

```python
from django.db import migrations

PERMISSIONS = [
    ("kyc.approve", "Approve or reject business owner KYC submissions"),
    ("listings.moderate", "Approve, edit, or remove marketplace listings"),
    ("users.view", "View customer and business owner profiles"),
    ("escrow.view", "View the escrow ledger"),
    ("escrow.release", "Release or hold escrow payouts"),
    ("disputes.resolve_financial", "Resolve the financial side of a dispute"),
    ("transactions.report", "Generate transaction/financial reports"),
    ("promotions.manage", "Manage promotions and featured listings"),
    ("analytics.view", "View marketplace analytics"),
    ("categories.manage", "Manage marketplace categories"),
    ("messaging.manage", "Manage the messaging/ticket queue"),
    ("disputes.flag", "Flag and intake disputes"),
    ("staff.manage", "Create, invite, deactivate, or reassign staff accounts"),
]

ROLE_PERMISSIONS = {
    "super_admin": [codename for codename, _ in PERMISSIONS],
    "admin": ["kyc.approve", "listings.moderate", "users.view"],
    "accountant": ["escrow.view", "escrow.release", "disputes.resolve_financial", "transactions.report"],
    "marketing": ["promotions.manage", "analytics.view", "categories.manage"],
    "support": ["messaging.manage", "disputes.flag", "users.view"],
}


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")

    codename_to_permission = {}
    for codename, description in PERMISSIONS:
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"description": description}
        )
        codename_to_permission[codename] = permission

    for role_name, codenames in ROLE_PERMISSIONS.items():
        role, _ = Role.objects.get_or_create(name=role_name)
        role.permissions.set([codename_to_permission[c] for c in codenames])


def unseed(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    Permission = apps.get_model("accounts", "Permission")
    Role.objects.filter(name__in=ROLE_PERMISSIONS.keys()).delete()
    Permission.objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 7: Run migrations and the test to verify it passes**

Run: `docker compose run --rm web python manage.py migrate`
Expected: `Applying accounts.0001_initial... OK`, `Applying accounts.0002_seed_roles_permissions... OK`

Run: `docker compose run --rm web python manage.py test accounts.tests.test_roles_seed`
Expected: `Ran 4 tests in ...s OK`

- [ ] **Step 8: Commit**

```bash
git add backend/accounts/
git commit -m "feat: add Role/Permission RBAC models with seeded default matrix"
```

---

### Task 3: Account auth infrastructure — Customer model, JWT issue/resolve

**Files:**
- Modify: `backend/accounts/models.py`
- Create: `backend/accounts/mixins.py`
- Create: `backend/accounts/authentication.py`
- Modify: `backend/accounts/views.py` (create)
- Modify: `backend/accounts/urls.py`
- Test: `backend/accounts/tests/test_authentication.py`

**Interfaces:**
- Consumes: none from Task 2 directly (Customer has no Role FK).
- Produces: `Customer` model (`full_name`, `phone`, `email`, `password_hash`, `created_at`). `AuthenticatableAccountMixin` (adds `is_authenticated`/`is_anonymous` properties) — used by every account model going forward. `issue_token(account, account_type)` → JWT string. `MultiAccountJWTAuthentication` — DRF authentication class resolving `request.user` to a `Customer`, `BusinessOwner`, or `StaffUser` instance based on the token's `account_type` claim. `GET /api/accounts/me/` — protected endpoint returning `{"account_type": ..., "id": ...}` for whichever account type is authenticated.

- [ ] **Step 1: Write the failing test — `backend/accounts/tests/test_authentication.py`**

```python
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Customer


class MultiAccountAuthenticationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Owusu",
            phone="+233241234567",
            email="ama@example.com",
            password_hash="unused-in-this-test",
        )

    def test_me_endpoint_requires_authentication(self):
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 401)

    def test_me_endpoint_resolves_customer_from_token(self):
        token = issue_token(self.customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(), {"account_type": "customer", "id": self.customer.id}
        )

    def test_invalid_token_is_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
        response = self.client.get("/api/accounts/me/")
        self.assertEqual(response.status_code, 401)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_authentication`
Expected: FAIL — `ImportError: cannot import name 'issue_token'` / `Customer` doesn't exist.

- [ ] **Step 3: Write `backend/accounts/mixins.py`**

```python
class AuthenticatableAccountMixin:
    """Duck-types Django's auth.User enough to satisfy DRF's IsAuthenticated checks."""

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False
```

- [ ] **Step 4: Add `Customer` to `backend/accounts/models.py`** (append to the existing file from Task 2)

```python
from .mixins import AuthenticatableAccountMixin


class Customer(AuthenticatableAccountMixin, models.Model):
    full_name = models.CharField(max_length=150)
    phone = models.CharField(max_length=20, unique=True, null=True, blank=True)
    email = models.EmailField(unique=True, null=True, blank=True)
    password_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.full_name
```

- [ ] **Step 5: Write `backend/accounts/authentication.py`**

```python
from rest_framework import authentication, exceptions
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from .models import Customer

ACCOUNT_MODELS = {
    "customer": Customer,
}


def issue_token(account, account_type):
    if account_type not in ACCOUNT_MODELS:
        raise ValueError(f"Unknown account_type: {account_type}")
    token = AccessToken()
    token["sub"] = str(account.pk)
    token["account_type"] = account_type
    return str(token)


class MultiAccountJWTAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        header = request.headers.get("Authorization")
        if not header or not header.startswith(f"{self.keyword} "):
            return None

        raw_token = header[len(self.keyword) + 1 :]
        try:
            token = AccessToken(raw_token)
        except TokenError as exc:
            raise exceptions.AuthenticationFailed("Invalid or expired token") from exc

        account_type = token.get("account_type")
        model = ACCOUNT_MODELS.get(account_type)
        if model is None:
            raise exceptions.AuthenticationFailed("Unknown account type in token")

        try:
            account = model.objects.get(pk=token["sub"])
        except model.DoesNotExist as exc:
            raise exceptions.AuthenticationFailed("Account not found") from exc

        return (account, token)
```

- [ ] **Step 6: Write `backend/accounts/views.py`**

```python
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    token = request.auth
    return Response({"account_type": token["account_type"], "id": request.user.id})
```

- [ ] **Step 7: Write `backend/accounts/urls.py`**

```python
from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.me, name="accounts-me"),
]
```

- [ ] **Step 8: Generate the migration and run tests**

Run: `docker compose run --rm web python manage.py makemigrations accounts`
Expected: creates `0003_customer.py`.

Run: `docker compose run --rm web python manage.py migrate && docker compose run --rm web python manage.py test accounts.tests.test_authentication`
Expected: `Ran 3 tests in ...s OK`

- [ ] **Step 9: Commit**

```bash
git add backend/accounts/
git commit -m "feat: add Customer model and multi-account JWT authentication"
```

---

### Task 4: Customer registration endpoint

**Files:**
- Create: `backend/accounts/serializers.py`
- Modify: `backend/accounts/views.py`
- Modify: `backend/accounts/urls.py`
- Test: `backend/accounts/tests/test_customer_registration.py`

**Interfaces:**
- Consumes: `Customer` model (Task 3).
- Produces: `POST /api/accounts/customers/register/` → 201 with `{"id": ..., "full_name": ..., "phone": ..., "email": ...}` (never returns `password_hash`). `CustomerRegistrationSerializer` importable by later tests if needed.

- [ ] **Step 1: Write the failing test — `backend/accounts/tests/test_customer_registration.py`**

```python
from django.contrib.auth.hashers import check_password
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Customer


class CustomerRegistrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.valid_payload = {
            "full_name": "Kofi Mensah",
            "phone": "+233201112233",
            "email": "kofi@example.com",
            "password": "correct-horse-battery-staple",
        }

    def test_registration_creates_customer_with_hashed_password(self):
        response = self.client.post(
            "/api/accounts/customers/register/", self.valid_payload, format="json"
        )
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("password", response.json())
        self.assertNotIn("password_hash", response.json())

        customer = Customer.objects.get(phone="+233201112233")
        self.assertTrue(check_password("correct-horse-battery-staple", customer.password_hash))

    def test_duplicate_phone_is_rejected(self):
        Customer.objects.create(
            full_name="Existing", phone="+233201112233", password_hash="x"
        )
        response = self.client.post(
            "/api/accounts/customers/register/", self.valid_payload, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("phone", response.json())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_customer_registration`
Expected: FAIL — 404, endpoint doesn't exist.

- [ ] **Step 3: Write `backend/accounts/serializers.py`**

```python
from django.contrib.auth.hashers import make_password
from rest_framework import serializers

from .models import Customer


class CustomerRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = Customer
        fields = ["id", "full_name", "phone", "email", "password"]

    def create(self, validated_data):
        password = validated_data.pop("password")
        validated_data["password_hash"] = make_password(password)
        return Customer.objects.create(**validated_data)
```

- [ ] **Step 4: Add the registration view to `backend/accounts/views.py`**

```python
from rest_framework import generics
from rest_framework.permissions import AllowAny

from .serializers import CustomerRegistrationSerializer


class CustomerRegisterView(generics.CreateAPIView):
    serializer_class = CustomerRegistrationSerializer
    permission_classes = [AllowAny]
```

- [ ] **Step 5: Add the route to `backend/accounts/urls.py`**

```python
from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.me, name="accounts-me"),
    path("customers/register/", views.CustomerRegisterView.as_view(), name="customer-register"),
]
```

- [ ] **Step 6: Run test to verify it passes**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_customer_registration`
Expected: `Ran 2 tests in ...s OK`

- [ ] **Step 7: Commit**

```bash
git add backend/accounts/
git commit -m "feat: add customer self-registration endpoint"
```

---

### Task 5: StaffUser model, RBAC permission class, invite endpoint, bootstrap command

**Files:**
- Modify: `backend/accounts/models.py`
- Modify: `backend/accounts/authentication.py`
- Create: `backend/accounts/permissions.py`
- Modify: `backend/accounts/serializers.py`
- Modify: `backend/accounts/views.py`
- Modify: `backend/accounts/urls.py`
- Create: `backend/accounts/management/__init__.py`
- Create: `backend/accounts/management/commands/__init__.py`
- Create: `backend/accounts/management/commands/create_super_admin.py`
- Test: `backend/accounts/tests/test_staff_invite.py`
- Test: `backend/accounts/tests/test_permissions.py`

**Interfaces:**
- Consumes: `Role` (Task 2), `issue_token`/`MultiAccountJWTAuthentication` (Task 3).
- Produces: `StaffUser` model (`full_name`, `email`, `phone`, `password_hash`, `role` FK, `invited_by` FK nullable, `invite_token`/`invite_expires_at` nullable, `created_at`). `HasRolePermission(codename)` — a DRF permission class factory checking `request.user.role.permissions.filter(codename=...).exists()`; only usable when `request.user` is a `StaffUser` (returns `False` otherwise). `POST /api/accounts/staff/invite/` (requires `staff.manage` permission) → 201, creates a `StaffUser` with a 7-day invite token pending activation. `POST /api/accounts/staff/activate/` (public) → sets the password from a valid, unexpired invite token. `POST /api/accounts/staff/<id>/resend-invite/` (requires `staff.manage`) → regenerates the token/expiry. `create_super_admin` management command for bootstrapping the first account.

- [ ] **Step 1: Write the failing test — `backend/accounts/tests/test_permissions.py`**

```python
from django.test import TestCase

from accounts.models import Role, StaffUser
from accounts.permissions import HasRolePermission


class FakeRequest:
    def __init__(self, user):
        self.user = user


class HasRolePermissionTests(TestCase):
    def test_role_with_permission_is_granted(self):
        admin_role = Role.objects.get(name="admin")
        staff = StaffUser.objects.create(
            full_name="Adwoa Admin", email="adwoa@example.com", password_hash="x", role=admin_role
        )
        permission = HasRolePermission("kyc.approve")
        self.assertTrue(permission.has_permission(FakeRequest(staff), None))

    def test_role_without_permission_is_denied(self):
        accountant_role = Role.objects.get(name="accountant")
        staff = StaffUser.objects.create(
            full_name="Yaw Accounts", email="yaw@example.com", password_hash="x", role=accountant_role
        )
        permission = HasRolePermission("kyc.approve")
        self.assertFalse(permission.has_permission(FakeRequest(staff), None))

    def test_non_staff_account_is_denied(self):
        from accounts.models import Customer

        customer = Customer.objects.create(full_name="Ama", phone="+233200000000", password_hash="x")
        permission = HasRolePermission("kyc.approve")
        self.assertFalse(permission.has_permission(FakeRequest(customer), None))
```

- [ ] **Step 2: Write the failing test — `backend/accounts/tests/test_staff_invite.py`**

```python
import datetime

from django.contrib.auth.hashers import check_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser


class StaffInviteTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.super_admin = StaffUser.objects.create(
            full_name="Kwame Super",
            email="kwame@example.com",
            password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )
        self.token = issue_token(self.super_admin, "staff")

    def test_super_admin_can_invite_staff(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.post(
            "/api/accounts/staff/invite/",
            {"full_name": "Akosua Support", "email": "akosua@example.com", "role": "support"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        invited = StaffUser.objects.get(email="akosua@example.com")
        self.assertEqual(invited.role.name, "support")
        self.assertEqual(invited.invited_by, self.super_admin)

    def test_support_staff_cannot_invite_staff(self):
        support = StaffUser.objects.create(
            full_name="Akosua Support",
            email="akosua2@example.com",
            password_hash="x",
            role=Role.objects.get(name="support"),
        )
        token = issue_token(support, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.post(
            "/api/accounts/staff/invite/",
            {"full_name": "New Person", "email": "new@example.com", "role": "marketing"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_invite_sets_a_7_day_expiring_token(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.client.post(
            "/api/accounts/staff/invite/",
            {"full_name": "Akosua Support", "email": "akosua3@example.com", "role": "support"},
            format="json",
        )
        invited = StaffUser.objects.get(email="akosua3@example.com")
        self.assertIsNotNone(invited.invite_token)
        expected_expiry = timezone.now() + datetime.timedelta(days=7)
        self.assertAlmostEqual(
            invited.invite_expires_at, expected_expiry, delta=datetime.timedelta(minutes=1)
        )

    def test_activation_with_valid_token_sets_password_and_clears_token(self):
        invited = StaffUser.objects.create(
            full_name="New Hire",
            email="newhire@example.com",
            password_hash="unusable",
            role=Role.objects.get(name="support"),
            invited_by=self.super_admin,
            invite_token="valid-token-123",
            invite_expires_at=timezone.now() + datetime.timedelta(days=7),
        )
        response = self.client.post(
            "/api/accounts/staff/activate/",
            {"token": "valid-token-123", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        invited.refresh_from_db()
        self.assertIsNone(invited.invite_token)
        self.assertIsNone(invited.invite_expires_at)
        self.assertTrue(check_password("correct-horse-battery-staple", invited.password_hash))

    def test_activation_with_expired_token_is_rejected(self):
        StaffUser.objects.create(
            full_name="Stale Hire",
            email="stale@example.com",
            password_hash="unusable",
            role=Role.objects.get(name="support"),
            invited_by=self.super_admin,
            invite_token="expired-token-456",
            invite_expires_at=timezone.now() - datetime.timedelta(days=1),
        )
        response = self.client.post(
            "/api/accounts/staff/activate/",
            {"token": "expired-token-456", "password": "correct-horse-battery-staple"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_resend_invite_generates_a_new_token(self):
        invited = StaffUser.objects.create(
            full_name="Waiting Hire",
            email="waiting@example.com",
            password_hash="unusable",
            role=Role.objects.get(name="support"),
            invited_by=self.super_admin,
            invite_token="old-token-789",
            invite_expires_at=timezone.now() - datetime.timedelta(days=1),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.post(f"/api/accounts/staff/{invited.id}/resend-invite/")
        self.assertEqual(response.status_code, 200)
        invited.refresh_from_db()
        self.assertNotEqual(invited.invite_token, "old-token-789")
        self.assertGreater(invited.invite_expires_at, timezone.now())
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_permissions accounts.tests.test_staff_invite`
Expected: FAIL — `StaffUser`/`HasRolePermission` don't exist yet.

- [ ] **Step 4: Add `StaffUser` to `backend/accounts/models.py`**

```python
class StaffUser(AuthenticatableAccountMixin, models.Model):
    full_name = models.CharField(max_length=150)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=20, null=True, blank=True)
    password_hash = models.CharField(max_length=255)
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="staff_members")
    invited_by = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="invited"
    )
    invite_token = models.CharField(max_length=64, unique=True, null=True, blank=True)
    invite_expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.full_name} ({self.role.name})"
```

- [ ] **Step 5: Register `StaffUser` in `ACCOUNT_MODELS` — modify `backend/accounts/authentication.py`**

```python
from .models import Customer, StaffUser

ACCOUNT_MODELS = {
    "customer": Customer,
    "staff": StaffUser,
}
```

(Replace the single-entry dict from Task 3 with this two-entry version; leave the rest of the file unchanged.)

- [ ] **Step 6: Write `backend/accounts/permissions.py`**

```python
from rest_framework.permissions import BasePermission

from .models import StaffUser


class HasRolePermission(BasePermission):
    def __init__(self, codename):
        self.codename = codename

    def has_permission(self, request, view):
        user = request.user
        if not isinstance(user, StaffUser):
            return False
        return user.role.permissions.filter(codename=self.codename).exists()
```

- [ ] **Step 7: Add `StaffInviteSerializer`, `StaffActivateSerializer` to `backend/accounts/serializers.py`**

```python
import datetime

from django.contrib.auth.hashers import make_password
from django.utils import timezone
from django.utils.crypto import get_random_string

from .models import Role, StaffUser

INVITE_TOKEN_LIFETIME = datetime.timedelta(days=7)


class StaffInviteSerializer(serializers.ModelSerializer):
    role = serializers.SlugRelatedField(slug_field="name", queryset=Role.objects.all())

    class Meta:
        model = StaffUser
        fields = ["id", "full_name", "email", "phone", "role"]

    def create(self, validated_data):
        # password_hash stays unusable until /staff/activate/ sets a real password.
        validated_data["password_hash"] = make_password(get_random_string(32))
        validated_data["invited_by"] = self.context["request"].user
        validated_data["invite_token"] = get_random_string(43)
        validated_data["invite_expires_at"] = timezone.now() + INVITE_TOKEN_LIFETIME
        return StaffUser.objects.create(**validated_data)


class StaffActivateSerializer(serializers.Serializer):
    token = serializers.CharField()
    password = serializers.CharField(min_length=8)

    def validate_token(self, value):
        try:
            staff = StaffUser.objects.get(invite_token=value)
        except StaffUser.DoesNotExist as exc:
            raise serializers.ValidationError("Invalid invite token") from exc
        if staff.invite_expires_at is None or staff.invite_expires_at < timezone.now():
            raise serializers.ValidationError("Invite token has expired")
        self.staff = staff
        return value

    def save(self):
        self.staff.password_hash = make_password(self.validated_data["password"])
        self.staff.invite_token = None
        self.staff.invite_expires_at = None
        self.staff.save(update_fields=["password_hash", "invite_token", "invite_expires_at"])
        return self.staff
```

- [ ] **Step 8: Add the invite/activate/resend views to `backend/accounts/views.py`**

```python
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import HasRolePermission
from .serializers import StaffActivateSerializer, StaffInviteSerializer


class StaffInviteView(generics.CreateAPIView):
    serializer_class = StaffInviteSerializer

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]


class StaffActivateView(generics.GenericAPIView):
    serializer_class = StaffActivateSerializer
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"status": "activated"})


class StaffResendInviteView(APIView):
    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def post(self, request, pk):
        from django.utils import timezone
        from django.utils.crypto import get_random_string

        from .serializers import INVITE_TOKEN_LIFETIME

        staff = generics.get_object_or_404(StaffUser, pk=pk)
        staff.invite_token = get_random_string(43)
        staff.invite_expires_at = timezone.now() + INVITE_TOKEN_LIFETIME
        staff.save(update_fields=["invite_token", "invite_expires_at"])
        return Response({"status": "invite resent"})
```

- [ ] **Step 9: Add the routes to `backend/accounts/urls.py`**

```python
urlpatterns = [
    path("me/", views.me, name="accounts-me"),
    path("customers/register/", views.CustomerRegisterView.as_view(), name="customer-register"),
    path("staff/invite/", views.StaffInviteView.as_view(), name="staff-invite"),
    path("staff/activate/", views.StaffActivateView.as_view(), name="staff-activate"),
    path(
        "staff/<int:pk>/resend-invite/",
        views.StaffResendInviteView.as_view(),
        name="staff-resend-invite",
    ),
]
```

- [ ] **Step 10: Write the bootstrap command — `backend/accounts/management/commands/create_super_admin.py`**

```python
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError

from accounts.models import Role, StaffUser


class Command(BaseCommand):
    help = "Bootstraps the first super_admin StaffUser (invited_by is null for this one account only)."

    def add_arguments(self, parser):
        parser.add_argument("--full-name", required=True)
        parser.add_argument("--email", required=True)
        parser.add_argument("--password", required=True)

    def handle(self, *args, **options):
        if StaffUser.objects.filter(role__name="super_admin").exists():
            raise CommandError("A super_admin already exists; use the invite endpoint instead.")

        role = Role.objects.get(name="super_admin")
        StaffUser.objects.create(
            full_name=options["full_name"],
            email=options["email"],
            password_hash=make_password(options["password"]),
            role=role,
            invited_by=None,
        )
        self.stdout.write(self.style.SUCCESS(f"Created super_admin {options['email']}"))
```

- [ ] **Step 11: Create the management command package files**

```bash
mkdir -p backend/accounts/management/commands
touch backend/accounts/management/__init__.py
touch backend/accounts/management/commands/__init__.py
```

- [ ] **Step 12: Generate migration and run tests**

Run: `docker compose run --rm web python manage.py makemigrations accounts`
Expected: creates `0004_staffuser.py`.

Run: `docker compose run --rm web python manage.py migrate && docker compose run --rm web python manage.py test accounts.tests.test_permissions accounts.tests.test_staff_invite`
Expected: `Ran 9 tests in ...s OK`

- [ ] **Step 13: Commit**

```bash
git add backend/accounts/
git commit -m "feat: add StaffUser, RBAC permission checks, staff invite/activate/resend, bootstrap command"
```

---

### Task 6: BusinessOwner + BusinessOwnerProfile models

**Files:**
- Modify: `backend/accounts/models.py`
- Modify: `backend/accounts/authentication.py`
- Test: `backend/accounts/tests/test_business_owner_models.py`

**Interfaces:**
- Consumes: `AuthenticatableAccountMixin` (Task 3).
- Produces: `BusinessOwner` (`full_name`, `login_phone`, `email`, `password_hash`, `kyc_status`, `kyc_rejection_reason`, `created_at`). `BusinessOwnerProfile` (OneToOne, all KYC/payout fields from the spec). Later tasks (registration endpoint, KYC workflow, payout update) build on these field names directly.

- [ ] **Step 1: Write the failing test — `backend/accounts/tests/test_business_owner_models.py`**

```python
from django.db import IntegrityError
from django.test import TestCase

from accounts.models import BusinessOwner, BusinessOwnerProfile


class BusinessOwnerModelTests(TestCase):
    def _make_owner(self, **overrides):
        defaults = dict(
            full_name="Kojo Trader",
            login_phone="+233209998877",
            email="kojo@example.com",
            password_hash="x",
        )
        defaults.update(overrides)
        return BusinessOwner.objects.create(**defaults)

    def test_kyc_status_defaults_to_pending(self):
        owner = self._make_owner()
        self.assertEqual(owner.kyc_status, "pending")

    def test_ghana_card_number_is_unique_across_profiles(self):
        owner_one = self._make_owner()
        BusinessOwnerProfile.objects.create(
            business_owner=owner_one,
            ghana_card_number="GHA-000000001-0",
            gps_address="AK-039-5028",
            business_contact_phone="+233201234567",
            is_formal=False,
            default_payout_method="momo",
            payout_momo_network="MTN",
            payout_momo_number="+233201234567",
            payout_momo_name="Kojo Trader",
        )
        owner_two = self._make_owner(login_phone="+233209998878", email="kojo2@example.com")
        with self.assertRaises(IntegrityError):
            BusinessOwnerProfile.objects.create(
                business_owner=owner_two,
                ghana_card_number="GHA-000000001-0",
                gps_address="AK-039-5029",
                business_contact_phone="+233201234568",
                is_formal=False,
                default_payout_method="momo",
                payout_momo_network="MTN",
                payout_momo_number="+233201234568",
                payout_momo_name="Kojo Trader",
            )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_business_owner_models`
Expected: FAIL — `ImportError`, models don't exist.

- [ ] **Step 3: Add `BusinessOwner` and `BusinessOwnerProfile` to `backend/accounts/models.py`**

```python
class BusinessOwner(AuthenticatableAccountMixin, models.Model):
    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"
    KYC_STATUS_CHOICES = [
        (PENDING, "Pending"),
        (VERIFIED, "Verified"),
        (REJECTED, "Rejected"),
    ]

    full_name = models.CharField(max_length=150)
    login_phone = models.CharField(max_length=20, unique=True)
    email = models.EmailField(unique=True, null=True, blank=True)
    password_hash = models.CharField(max_length=255)
    kyc_status = models.CharField(max_length=10, choices=KYC_STATUS_CHOICES, default=PENDING)
    kyc_rejection_reason = models.CharField(max_length=500, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.full_name


class BusinessOwnerProfile(models.Model):
    BANK = "bank"
    MOMO = "momo"
    PAYOUT_METHOD_CHOICES = [(BANK, "Bank"), (MOMO, "Mobile Money")]

    business_owner = models.OneToOneField(
        BusinessOwner, on_delete=models.CASCADE, related_name="profile"
    )
    ghana_card_number = models.CharField(max_length=30, unique=True)
    ghana_card_front_image = models.ImageField(upload_to="ghana_cards/")
    ghana_card_back_image = models.ImageField(upload_to="ghana_cards/")
    gps_address = models.CharField(max_length=20)
    business_contact_phone = models.CharField(max_length=20)

    is_formal = models.BooleanField(default=False)
    business_reg_certificate = models.FileField(
        upload_to="business_reg_certificates/", null=True, blank=True
    )
    tin = models.CharField(max_length=30, null=True, blank=True)

    payout_bank_name = models.CharField(max_length=100, null=True, blank=True)
    payout_bank_account_number = models.CharField(max_length=50, null=True, blank=True)
    payout_bank_account_name = models.CharField(max_length=150, null=True, blank=True)
    payout_momo_network = models.CharField(max_length=20, null=True, blank=True)
    payout_momo_number = models.CharField(max_length=20, null=True, blank=True)
    payout_momo_name = models.CharField(max_length=150, null=True, blank=True)
    default_payout_method = models.CharField(max_length=10, choices=PAYOUT_METHOD_CHOICES)
    payout_verification_status = models.CharField(
        max_length=10,
        choices=[("pending", "Pending"), ("verified", "Verified")],
        default="pending",
    )

    def __str__(self):
        return f"Profile for {self.business_owner.full_name}"
```

- [ ] **Step 4: Register `BusinessOwner` in `ACCOUNT_MODELS` — modify `backend/accounts/authentication.py`**

```python
from .models import BusinessOwner, Customer, StaffUser

ACCOUNT_MODELS = {
    "customer": Customer,
    "staff": StaffUser,
    "business_owner": BusinessOwner,
}
```

- [ ] **Step 5: Generate migration and run tests**

Run: `docker compose run --rm web python manage.py makemigrations accounts`
Expected: creates `0005_businessowner_businessownerprofile.py`.

Run: `docker compose run --rm web python manage.py migrate && docker compose run --rm web python manage.py test accounts.tests.test_business_owner_models`
Expected: `Ran 2 tests in ...s OK`

- [ ] **Step 6: Commit**

```bash
git add backend/accounts/
git commit -m "feat: add BusinessOwner and BusinessOwnerProfile models"
```

---

### Task 7: Business owner registration endpoint

**Files:**
- Modify: `backend/accounts/serializers.py`
- Modify: `backend/accounts/views.py`
- Modify: `backend/accounts/urls.py`
- Test: `backend/accounts/tests/test_business_owner_registration.py`

**Interfaces:**
- Consumes: `BusinessOwner`/`BusinessOwnerProfile` (Task 6).
- Produces: `POST /api/accounts/business-owners/register/` (multipart/form-data) → 201 with the created owner+profile IDs and `kyc_status: "pending"`. Rejects `is_formal=true` submissions missing cert/TIN, and rejects `default_payout_method` values not backed by populated fields.

- [ ] **Step 1: Write the failing test — `backend/accounts/tests/test_business_owner_registration.py`**

```python
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import BusinessOwner

import tempfile

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image(name="card.jpg"):
    return SimpleUploadedFile(name, b"fake-image-bytes", content_type="image/jpeg")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class BusinessOwnerRegistrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.base_payload = {
            "full_name": "Abena Boateng",
            "login_phone": "+233245551122",
            "email": "abena@example.com",
            "password": "correct-horse-battery-staple",
            "ghana_card_number": "GHA-111222333-4",
            "ghana_card_front_image": _image("front.jpg"),
            "ghana_card_back_image": _image("back.jpg"),
            "gps_address": "AK-039-5028",
            "business_contact_phone": "+233209990000",
            "default_payout_method": "momo",
            "payout_momo_network": "MTN",
            "payout_momo_number": "+233209990000",
            "payout_momo_name": "Abena Boateng",
        }

    def test_informal_business_registers_without_documents(self):
        payload = {**self.base_payload, "is_formal": "false"}
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="multipart"
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["kyc_status"], "pending")
        owner = BusinessOwner.objects.get(login_phone="+233245551122")
        self.assertFalse(owner.profile.is_formal)
        self.assertFalse(owner.profile.business_reg_certificate)

    def test_formal_business_without_certificate_is_rejected(self):
        payload = {**self.base_payload, "is_formal": "true", "tin": "C0012345678"}
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("business_reg_certificate", response.json())

    def test_formal_business_with_documents_succeeds(self):
        payload = {
            **self.base_payload,
            "is_formal": "true",
            "tin": "C0012345678",
            "business_reg_certificate": SimpleUploadedFile(
                "cert.pdf", b"fake-pdf-bytes", content_type="application/pdf"
            ),
        }
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="multipart"
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_default_payout_method_must_match_populated_fields(self):
        payload = {**self.base_payload, "is_formal": "false", "default_payout_method": "bank"}
        response = self.client.post(
            "/api/accounts/business-owners/register/", payload, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("default_payout_method", response.json())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_business_owner_registration`
Expected: FAIL — 404, endpoint doesn't exist.

- [ ] **Step 3: Add `BusinessOwnerRegistrationSerializer` to `backend/accounts/serializers.py`**

```python
from .models import BusinessOwner, BusinessOwnerProfile


class BusinessOwnerRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    ghana_card_number = serializers.CharField()
    ghana_card_front_image = serializers.ImageField()
    ghana_card_back_image = serializers.ImageField()
    gps_address = serializers.CharField()
    business_contact_phone = serializers.CharField()
    is_formal = serializers.BooleanField(default=False)
    business_reg_certificate = serializers.FileField(required=False, allow_null=True)
    tin = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    payout_bank_name = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    payout_bank_account_number = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    payout_bank_account_name = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    payout_momo_network = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    payout_momo_number = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    payout_momo_name = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    default_payout_method = serializers.ChoiceField(choices=BusinessOwnerProfile.PAYOUT_METHOD_CHOICES)
    kyc_status = serializers.CharField(read_only=True)

    class Meta:
        model = BusinessOwner
        fields = [
            "id", "full_name", "login_phone", "email", "password", "kyc_status",
            "ghana_card_number", "ghana_card_front_image", "ghana_card_back_image",
            "gps_address", "business_contact_phone", "is_formal",
            "business_reg_certificate", "tin",
            "payout_bank_name", "payout_bank_account_number", "payout_bank_account_name",
            "payout_momo_network", "payout_momo_number", "payout_momo_name",
            "default_payout_method",
        ]

    def validate(self, data):
        if data.get("is_formal"):
            if not data.get("business_reg_certificate"):
                raise serializers.ValidationError(
                    {"business_reg_certificate": "Required for formally registered businesses."}
                )
            if not data.get("tin"):
                raise serializers.ValidationError({"tin": "Required for formally registered businesses."})

        method = data.get("default_payout_method")
        if method == BusinessOwnerProfile.BANK and not data.get("payout_bank_account_number"):
            raise serializers.ValidationError(
                {"default_payout_method": "Bank details must be provided to set bank as the default payout method."}
            )
        if method == BusinessOwnerProfile.MOMO and not data.get("payout_momo_number"):
            raise serializers.ValidationError(
                {"default_payout_method": "Mobile money details must be provided to set momo as the default payout method."}
            )
        return data

    def create(self, validated_data):
        password = validated_data.pop("password")
        profile_fields = {
            "ghana_card_number": validated_data.pop("ghana_card_number"),
            "ghana_card_front_image": validated_data.pop("ghana_card_front_image"),
            "ghana_card_back_image": validated_data.pop("ghana_card_back_image"),
            "gps_address": validated_data.pop("gps_address"),
            "business_contact_phone": validated_data.pop("business_contact_phone"),
            "is_formal": validated_data.pop("is_formal"),
            "business_reg_certificate": validated_data.pop("business_reg_certificate", None),
            "tin": validated_data.pop("tin", None),
            "payout_bank_name": validated_data.pop("payout_bank_name", None),
            "payout_bank_account_number": validated_data.pop("payout_bank_account_number", None),
            "payout_bank_account_name": validated_data.pop("payout_bank_account_name", None),
            "payout_momo_network": validated_data.pop("payout_momo_network", None),
            "payout_momo_number": validated_data.pop("payout_momo_number", None),
            "payout_momo_name": validated_data.pop("payout_momo_name", None),
            "default_payout_method": validated_data.pop("default_payout_method"),
        }
        validated_data["password_hash"] = make_password(password)
        owner = BusinessOwner.objects.create(**validated_data)
        BusinessOwnerProfile.objects.create(business_owner=owner, **profile_fields)
        return owner

    def to_representation(self, instance):
        return {
            "id": instance.id,
            "full_name": instance.full_name,
            "login_phone": instance.login_phone,
            "kyc_status": instance.kyc_status,
        }
```

- [ ] **Step 4: Add the registration view to `backend/accounts/views.py`**

```python
from rest_framework.parsers import FormParser, MultiPartParser

from .serializers import BusinessOwnerRegistrationSerializer


class BusinessOwnerRegisterView(generics.CreateAPIView):
    serializer_class = BusinessOwnerRegistrationSerializer
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]
```

- [ ] **Step 5: Add the route to `backend/accounts/urls.py`**

```python
urlpatterns = [
    path("me/", views.me, name="accounts-me"),
    path("customers/register/", views.CustomerRegisterView.as_view(), name="customer-register"),
    path("staff/invite/", views.StaffInviteView.as_view(), name="staff-invite"),
    path(
        "business-owners/register/",
        views.BusinessOwnerRegisterView.as_view(),
        name="business-owner-register",
    ),
]
```

- [ ] **Step 6: Run test to verify it passes**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_business_owner_registration`
Expected: `Ran 4 tests in ...s OK`

- [ ] **Step 7: Commit**

```bash
git add backend/accounts/
git commit -m "feat: add business owner registration endpoint with conditional KYC validation"
```

---

### Task 8: KYC approval workflow

**Files:**
- Modify: `backend/accounts/serializers.py`
- Modify: `backend/accounts/views.py`
- Modify: `backend/accounts/urls.py`
- Test: `backend/accounts/tests/test_kyc_workflow.py`

**Interfaces:**
- Consumes: `BusinessOwner.kyc_status`/`kyc_rejection_reason` (Task 6), `HasRolePermission` (Task 5), `issue_token` (Task 3, extended in Task 6 to cover `business_owner`).
- Produces: `GET /api/accounts/kyc/pending/` (requires `kyc.approve`) → list of pending owners. `POST /api/accounts/kyc/<id>/approve/` → `kyc_status="verified"`. `POST /api/accounts/kyc/<id>/reject/` with `{"reason": "..."}` → `kyc_status="rejected"`, `kyc_rejection_reason` set.

- [ ] **Step 1: Write the failing test — `backend/accounts/tests/test_kyc_workflow.py`**

```python
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Role, StaffUser


class KYCWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.admin_token = issue_token(self.admin, "staff")

        self.owner = BusinessOwner.objects.create(
            full_name="Yaa Trader", login_phone="+233207778899", password_hash="x"
        )
        BusinessOwnerProfile.objects.create(
            business_owner=self.owner,
            ghana_card_number="GHA-999888777-6",
            gps_address="AK-039-5030",
            business_contact_phone="+233207778899",
            is_formal=False,
            default_payout_method="momo",
            payout_momo_network="MTN",
            payout_momo_number="+233207778899",
            payout_momo_name="Yaa Trader",
        )

    def test_pending_queue_lists_the_owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.get("/api/accounts/kyc/pending/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([o["id"] for o in response.json()], [self.owner.id])

    def test_admin_can_approve(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.post(f"/api/accounts/kyc/{self.owner.id}/approve/")
        self.assertEqual(response.status_code, 200)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.kyc_status, "verified")

    def test_admin_can_reject_with_reason(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.post(
            f"/api/accounts/kyc/{self.owner.id}/reject/", {"reason": "Ghana Card image is blurry"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.kyc_status, "rejected")
        self.assertEqual(self.owner.kyc_rejection_reason, "Ghana Card image is blurry")

    def test_accountant_cannot_approve_kyc(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant Person", email="acc@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        token = issue_token(accountant, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.post(f"/api/accounts/kyc/{self.owner.id}/approve/")
        self.assertEqual(response.status_code, 403)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_kyc_workflow`
Expected: FAIL — 404s, endpoints don't exist.

- [ ] **Step 3: Add `BusinessOwnerKYCSerializer` to `backend/accounts/serializers.py`**

```python
class BusinessOwnerKYCSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessOwner
        fields = ["id", "full_name", "login_phone", "kyc_status", "created_at"]
```

- [ ] **Step 4: Add KYC views to `backend/accounts/views.py`**

```python
from rest_framework.views import APIView

from .models import BusinessOwner
from .serializers import BusinessOwnerKYCSerializer


class KYCPendingQueueView(generics.ListAPIView):
    serializer_class = BusinessOwnerKYCSerializer
    queryset = BusinessOwner.objects.filter(kyc_status=BusinessOwner.PENDING).order_by("created_at")

    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]


class KYCApproveView(APIView):
    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]

    def post(self, request, pk):
        owner = generics.get_object_or_404(BusinessOwner, pk=pk)
        owner.kyc_status = BusinessOwner.VERIFIED
        owner.kyc_rejection_reason = None
        owner.save(update_fields=["kyc_status", "kyc_rejection_reason"])
        return Response({"id": owner.id, "kyc_status": owner.kyc_status})


class KYCRejectView(APIView):
    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]

    def post(self, request, pk):
        reason = request.data.get("reason", "")
        owner = generics.get_object_or_404(BusinessOwner, pk=pk)
        owner.kyc_status = BusinessOwner.REJECTED
        owner.kyc_rejection_reason = reason
        owner.save(update_fields=["kyc_status", "kyc_rejection_reason"])
        return Response({"id": owner.id, "kyc_status": owner.kyc_status})
```

Add the missing `Response` import at the top of `views.py` if not already present: `from rest_framework.response import Response`.

- [ ] **Step 5: Add routes to `backend/accounts/urls.py`**

```python
urlpatterns = [
    path("me/", views.me, name="accounts-me"),
    path("customers/register/", views.CustomerRegisterView.as_view(), name="customer-register"),
    path("staff/invite/", views.StaffInviteView.as_view(), name="staff-invite"),
    path(
        "business-owners/register/",
        views.BusinessOwnerRegisterView.as_view(),
        name="business-owner-register",
    ),
    path("kyc/pending/", views.KYCPendingQueueView.as_view(), name="kyc-pending"),
    path("kyc/<int:pk>/approve/", views.KYCApproveView.as_view(), name="kyc-approve"),
    path("kyc/<int:pk>/reject/", views.KYCRejectView.as_view(), name="kyc-reject"),
]
```

- [ ] **Step 6: Run test to verify it passes**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_kyc_workflow`
Expected: `Ran 4 tests in ...s OK`

- [ ] **Step 7: Commit**

```bash
git add backend/accounts/
git commit -m "feat: add KYC pending queue, approve, and reject endpoints"
```

---

### Task 9: Payout detail update endpoint

**Files:**
- Modify: `backend/accounts/serializers.py`
- Modify: `backend/accounts/views.py`
- Modify: `backend/accounts/urls.py`
- Test: `backend/accounts/tests/test_payout_details.py`

**Interfaces:**
- Consumes: `BusinessOwnerProfile` (Task 6), `issue_token`/`MultiAccountJWTAuthentication` extended for `business_owner` (Task 6).
- Produces: `PATCH /api/accounts/business-owners/me/payout/` (requires an authenticated `business_owner`) → updates payout fields, always resets `payout_verification_status` to `"pending"`, never touches `kyc_status`.

- [ ] **Step 1: Write the failing test — `backend/accounts/tests/test_payout_details.py`**

```python
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile


class PayoutDetailUpdateTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Efua Seller", login_phone="+233206665544", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED,
        )
        self.profile = BusinessOwnerProfile.objects.create(
            business_owner=self.owner,
            ghana_card_number="GHA-555444333-2",
            gps_address="AK-039-5031",
            business_contact_phone="+233206665544",
            is_formal=False,
            default_payout_method="momo",
            payout_momo_network="MTN",
            payout_momo_number="+233206665544",
            payout_momo_name="Efua Seller",
            payout_verification_status="verified",
        )
        self.token = issue_token(self.owner, "business_owner")

    def test_updating_payout_details_resets_verification_only(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/payout/",
            {"default_payout_method": "bank", "payout_bank_name": "GCB Bank",
             "payout_bank_account_number": "1234567890", "payout_bank_account_name": "Efua Seller"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)

        self.profile.refresh_from_db()
        self.owner.refresh_from_db()
        self.assertEqual(self.profile.payout_verification_status, "pending")
        self.assertEqual(self.profile.default_payout_method, "bank")
        self.assertEqual(self.owner.kyc_status, BusinessOwner.VERIFIED)

    def test_customer_cannot_access_business_owner_payout_endpoint(self):
        from accounts.models import Customer

        customer = Customer.objects.create(full_name="Ama", phone="+233200001111", password_hash="x")
        token = issue_token(customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/payout/", {"default_payout_method": "bank"}, format="json"
        )
        self.assertEqual(response.status_code, 403)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_payout_details`
Expected: FAIL — 404, endpoint doesn't exist.

- [ ] **Step 3: Register `business_owner` in `ACCOUNT_MODELS` if not already present**

This was already added in Task 6, Step 4 — confirm `backend/accounts/authentication.py` has all three entries (`customer`, `staff`, `business_owner`) before continuing.

- [ ] **Step 4: Add `IsBusinessOwner` check and `PayoutDetailSerializer` to `backend/accounts/serializers.py`**

```python
class PayoutDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessOwnerProfile
        fields = [
            "payout_bank_name", "payout_bank_account_number", "payout_bank_account_name",
            "payout_momo_network", "payout_momo_number", "payout_momo_name",
            "default_payout_method",
        ]
        extra_kwargs = {field: {"required": False} for field in fields}

    def validate(self, data):
        method = data.get("default_payout_method", self.instance.default_payout_method if self.instance else None)
        bank_number = data.get("payout_bank_account_number", getattr(self.instance, "payout_bank_account_number", None))
        momo_number = data.get("payout_momo_number", getattr(self.instance, "payout_momo_number", None))

        if method == BusinessOwnerProfile.BANK and not bank_number:
            raise serializers.ValidationError(
                {"default_payout_method": "Bank details must be provided to set bank as the default payout method."}
            )
        if method == BusinessOwnerProfile.MOMO and not momo_number:
            raise serializers.ValidationError(
                {"default_payout_method": "Mobile money details must be provided to set momo as the default payout method."}
            )
        return data

    def update(self, instance, validated_data):
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.payout_verification_status = "pending"
        instance.save()
        return instance
```

- [ ] **Step 5: Add the view to `backend/accounts/views.py`**

```python
from rest_framework.permissions import BasePermission

from .models import BusinessOwner
from .serializers import PayoutDetailSerializer


class IsBusinessOwner(BasePermission):
    def has_permission(self, request, view):
        return isinstance(request.user, BusinessOwner)


class PayoutDetailUpdateView(generics.UpdateAPIView):
    serializer_class = PayoutDetailSerializer
    permission_classes = [IsBusinessOwner]
    http_method_names = ["patch"]

    def get_object(self):
        return self.request.user.profile
```

- [ ] **Step 6: Add the route to `backend/accounts/urls.py`**

```python
urlpatterns = [
    path("me/", views.me, name="accounts-me"),
    path("customers/register/", views.CustomerRegisterView.as_view(), name="customer-register"),
    path("staff/invite/", views.StaffInviteView.as_view(), name="staff-invite"),
    path(
        "business-owners/register/",
        views.BusinessOwnerRegisterView.as_view(),
        name="business-owner-register",
    ),
    path("business-owners/me/payout/", views.PayoutDetailUpdateView.as_view(), name="payout-update"),
    path("kyc/pending/", views.KYCPendingQueueView.as_view(), name="kyc-pending"),
    path("kyc/<int:pk>/approve/", views.KYCApproveView.as_view(), name="kyc-approve"),
    path("kyc/<int:pk>/reject/", views.KYCRejectView.as_view(), name="kyc-reject"),
]
```

- [ ] **Step 7: Run test to verify it passes**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_payout_details`
Expected: `Ran 2 tests in ...s OK`

- [ ] **Step 8: Run the full accounts test suite as a final check**

Run: `docker compose run --rm web python manage.py test accounts core`
Expected: all tests across every task pass together (31 tests: 1 health check + 4 role-seed + 3 authentication + 2 customer registration + 3 permissions + 6 staff invite/activate/resend + 2 business owner models + 4 business owner registration + 4 KYC workflow + 2 payout details).

- [ ] **Step 9: Commit**

```bash
git add backend/accounts/
git commit -m "feat: add business owner payout detail update endpoint"
```

---

## Addendum: Tasks 10-11 (added post-final-review)

The final whole-branch review (after Tasks 1-9 were each individually implemented and reviewed) found that this plan, while matching itself internally, under-delivered against `docs/superpowers/specs/2026-07-09-roles-registration-kyc-design.md` §5 ("KYC verification workflow"): the design spec requires (a) staff to be able to see the actual Ghana Card images / GPS address / registration docs before approving or rejecting, and (b) a rejected owner to be able to edit their profile and resubmit (resetting `kyc_status` back to `pending`). Neither endpoint existed anywhere in Tasks 1-9. These two tasks close that gap. They follow the same file structure and conventions as Tasks 1-9.

### Task 10: KYC detail view endpoint

**Files:**
- Modify: `backend/accounts/serializers.py`
- Modify: `backend/accounts/views.py`
- Modify: `backend/accounts/urls.py`
- Test: `backend/accounts/tests/test_kyc_detail.py`

**Interfaces:**
- Consumes: `BusinessOwner`/`BusinessOwnerProfile` (Task 6), `HasRolePermission` (Task 5).
- Produces: `GET /api/accounts/kyc/<id>/` (requires `kyc.approve`) → 200 with the owner's identity/KYC fields (not payout fields — those are a separate concern per the design spec) so a reviewer can actually inspect the submission before calling `/approve/` or `/reject/`.

- [ ] **Step 1: Write the failing test — `backend/accounts/tests/test_kyc_detail.py`**

```python
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Role, StaffUser


class KYCDetailViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-detail@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.admin_token = issue_token(self.admin, "staff")

        self.owner = BusinessOwner.objects.create(
            full_name="Kwabena Trader", login_phone="+233207001122", password_hash="x",
        )
        self.profile = BusinessOwnerProfile.objects.create(
            business_owner=self.owner,
            ghana_card_number="GHA-123123123-1",
            gps_address="AK-039-5040",
            business_contact_phone="+233207001122",
            is_formal=False,
            default_payout_method="momo",
            payout_momo_network="MTN",
            payout_momo_number="+233207001122",
            payout_momo_name="Kwabena Trader",
        )

    def test_admin_can_view_kyc_detail(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.get(f"/api/accounts/kyc/{self.owner.id}/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["id"], self.owner.id)
        self.assertEqual(body["profile"]["ghana_card_number"], "GHA-123123123-1")
        self.assertEqual(body["profile"]["gps_address"], "AK-039-5040")
        self.assertFalse(body["profile"]["is_formal"])
        self.assertIsNone(body["profile"]["business_reg_certificate"])
        self.assertNotIn("password_hash", body)
        self.assertNotIn("payout_bank_account_number", body["profile"])

    def test_accountant_cannot_view_kyc_detail(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant Detail", email="acc-detail@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        token = issue_token(accountant, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get(f"/api/accounts/kyc/{self.owner.id}/")
        self.assertEqual(response.status_code, 403)

    def test_detail_reflects_rejection_reason_after_reject(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        self.client.post(
            f"/api/accounts/kyc/{self.owner.id}/reject/",
            {"reason": "Ghana Card image is blurry"},
            format="json",
        )
        response = self.client.get(f"/api/accounts/kyc/{self.owner.id}/")
        self.assertEqual(response.json()["kyc_rejection_reason"], "Ghana Card image is blurry")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_kyc_detail`
Expected: FAIL — 404, endpoint doesn't exist.

- [ ] **Step 3: Add `BusinessOwnerProfileKYCDetailSerializer` and `BusinessOwnerKYCDetailSerializer` to `backend/accounts/serializers.py`**

```python
class BusinessOwnerProfileKYCDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessOwnerProfile
        fields = [
            "ghana_card_number", "ghana_card_front_image", "ghana_card_back_image",
            "gps_address", "business_contact_phone", "is_formal",
            "business_reg_certificate", "tin",
        ]


class BusinessOwnerKYCDetailSerializer(serializers.ModelSerializer):
    profile = BusinessOwnerProfileKYCDetailSerializer(read_only=True)

    class Meta:
        model = BusinessOwner
        fields = ["id", "full_name", "login_phone", "email", "kyc_status", "kyc_rejection_reason", "created_at", "profile"]
```

Deliberately excludes all `payout_*` fields — payout-destination verification is a separate concern from identity KYC per the design spec, and stays scoped to the accountant-facing payout review (not built yet; out of scope here, same as it was out of scope for Tasks 6-9).

- [ ] **Step 4: Add `KYCDetailView` to `backend/accounts/views.py`**

```python
class KYCDetailView(generics.RetrieveAPIView):
    queryset = BusinessOwner.objects.all()
    serializer_class = BusinessOwnerKYCDetailSerializer

    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]
```

- [ ] **Step 5: Add the route to `backend/accounts/urls.py`**

Add `path("kyc/<int:pk>/", views.KYCDetailView.as_view(), name="kyc-detail")` to the EXISTING `urlpatterns` list — do not replace the list. As of Task 9, `urls.py` has 10 routes; this adds an 11th. Verify all 10 survive.

- [ ] **Step 6: Run test to verify it passes, then the full suite**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_kyc_detail`
Expected: `Ran 3 tests in ...s OK`

Run: `docker compose run --rm web python manage.py test accounts core`
Expected: all tests pass (34 + 3 = 37).

- [ ] **Step 7: Commit**

```bash
git add backend/accounts/
git commit -m "feat: add KYC detail view so staff can inspect documents before approving"
```

---

### Task 11: Business owner profile edit / resubmission endpoint

**Files:**
- Modify: `backend/accounts/serializers.py`
- Modify: `backend/accounts/views.py`
- Modify: `backend/accounts/urls.py`
- Test: `backend/accounts/tests/test_business_owner_profile_update.py`

**Interfaces:**
- Consumes: `BusinessOwner`/`BusinessOwnerProfile` (Task 6), `IsBusinessOwner` (Task 9).
- Produces: `PATCH /api/accounts/business-owners/me/profile/` (requires an authenticated `business_owner`) → updates KYC/identity profile fields (not payout fields — that's Task 9's endpoint, a separate concern). If the owner's `kyc_status` is currently `rejected`, a successful edit resets it to `pending` and clears `kyc_rejection_reason` (resubmission, per design spec §5). If `kyc_status` is `pending`, the edit is applied with no status change. If `kyc_status` is `verified`, the edit is rejected (400) — the design spec states verification is staff-controlled thereafter with no self-service transition *out* of `verified` either, and re-opening a verified identity via self-service isn't specified, so this task treats it as not-yet-supported rather than inventing new unspecified behavior.

- [ ] **Step 1: Write the failing test — `backend/accounts/tests/test_business_owner_profile_update.py`**

```python
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer

import tempfile

TEST_MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class BusinessOwnerProfileUpdateTests(TestCase):
    def _make_owner(self, kyc_status, **profile_overrides):
        owner = BusinessOwner.objects.create(
            full_name="Adjoa Seller", login_phone="+233208889900", password_hash="x",
            kyc_status=kyc_status,
            kyc_rejection_reason="Blurry Ghana Card" if kyc_status == BusinessOwner.REJECTED else None,
        )
        defaults = dict(
            business_owner=owner,
            ghana_card_number="GHA-777888999-0",
            gps_address="AK-039-5050",
            business_contact_phone="+233208889900",
            is_formal=False,
            default_payout_method="momo",
            payout_momo_network="MTN",
            payout_momo_number="+233208889900",
            payout_momo_name="Adjoa Seller",
        )
        defaults.update(profile_overrides)
        BusinessOwnerProfile.objects.create(**defaults)
        return owner

    def _token(self, owner):
        return issue_token(owner, "business_owner")

    def test_rejected_owner_can_edit_and_resubmits_to_pending(self):
        owner = self._make_owner(BusinessOwner.REJECTED)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"gps_address": "AK-039-9999"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        owner.refresh_from_db()
        owner.profile.refresh_from_db()
        self.assertEqual(owner.kyc_status, BusinessOwner.PENDING)
        self.assertIsNone(owner.kyc_rejection_reason)
        self.assertEqual(owner.profile.gps_address, "AK-039-9999")

    def test_pending_owner_can_edit_without_status_change(self):
        owner = self._make_owner(BusinessOwner.PENDING)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"gps_address": "AK-039-1111"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        owner.refresh_from_db()
        self.assertEqual(owner.kyc_status, BusinessOwner.PENDING)

    def test_verified_owner_cannot_edit(self):
        owner = self._make_owner(BusinessOwner.VERIFIED)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"gps_address": "AK-039-2222"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_toggling_is_formal_true_without_documents_is_rejected(self):
        owner = self._make_owner(BusinessOwner.REJECTED)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._token(owner)}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/",
            {"is_formal": "true"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("business_reg_certificate", response.json())

    def test_customer_cannot_access_endpoint(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200002222", password_hash="x")
        token = issue_token(customer, "customer")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/profile/", {"gps_address": "x"}, format="json"
        )
        self.assertEqual(response.status_code, 403)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_business_owner_profile_update`
Expected: FAIL — 404, endpoint doesn't exist.

- [ ] **Step 3: Add `BusinessOwnerProfileUpdateSerializer` to `backend/accounts/serializers.py`**

```python
class BusinessOwnerProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessOwnerProfile
        fields = [
            "ghana_card_number", "ghana_card_front_image", "ghana_card_back_image",
            "gps_address", "business_contact_phone", "is_formal",
            "business_reg_certificate", "tin",
        ]
        extra_kwargs = {field: {"required": False} for field in fields}

    def validate(self, data):
        owner = self.instance.business_owner
        if owner.kyc_status == BusinessOwner.VERIFIED:
            raise serializers.ValidationError(
                {"kyc_status": "Cannot edit a verified KYC profile."}
            )

        is_formal = data.get("is_formal", self.instance.is_formal)
        if is_formal:
            cert = data.get("business_reg_certificate", self.instance.business_reg_certificate)
            tin = data.get("tin", self.instance.tin)
            if not cert:
                raise serializers.ValidationError(
                    {"business_reg_certificate": "Required for formally registered businesses."}
                )
            if not tin:
                raise serializers.ValidationError({"tin": "Required for formally registered businesses."})
        return data

    def update(self, instance, validated_data):
        owner = instance.business_owner
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        if owner.kyc_status == BusinessOwner.REJECTED:
            owner.kyc_status = BusinessOwner.PENDING
            owner.kyc_rejection_reason = None
            owner.save(update_fields=["kyc_status", "kyc_rejection_reason"])
        return instance
```

Note `BusinessOwner` must be imported in `serializers.py` if not already (it is, from Task 7).

- [ ] **Step 4: Add `BusinessOwnerProfileUpdateView` to `backend/accounts/views.py`**

```python
class BusinessOwnerProfileUpdateView(generics.UpdateAPIView):
    serializer_class = BusinessOwnerProfileUpdateSerializer
    permission_classes = [IsBusinessOwner]
    http_method_names = ["patch"]

    def get_object(self):
        return self.request.user.profile
```

Reuses `IsBusinessOwner` from Task 9 — do not redefine it.

- [ ] **Step 5: Add the route to `backend/accounts/urls.py`**

Add `path("business-owners/me/profile/", views.BusinessOwnerProfileUpdateView.as_view(), name="business-owner-profile-update")` to the EXISTING `urlpatterns` list — additive, not a replacement. This is the 12th route (after Task 10 adds the 11th).

- [ ] **Step 6: Run test to verify it passes, then the full suite**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_business_owner_profile_update`
Expected: `Ran 5 tests in ...s OK`

Run: `docker compose run --rm web python manage.py test accounts core`
Expected: all tests pass (37 + 5 = 42).

- [ ] **Step 7: Commit**

```bash
git add backend/accounts/
git commit -m "feat: add business owner profile edit/resubmission endpoint"
```

---

## Notes for the next sub-project (escrow)

The escrow payment model spec (sub-project 2 of 5) will read `BusinessOwnerProfile.default_payout_method`, `.payout_verification_status`, and `BusinessOwner.kyc_status` to decide whether a payout can be released — no changes to this plan's models should be needed, only additive fields/tables in that spec.
