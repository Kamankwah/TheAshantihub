# Listing Model & Marketplace Content Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `Category`/`Zone`/`Listing`/`ListingPhoto` models and the marketplace API (public browsing, owner CRUD/submit, staff moderation, category/zone management) described in `docs/superpowers/specs/2026-07-09-listing-model-design.md`.

**Architecture:** A new `listings` Django app (sibling to `core` and `accounts`) holds all marketplace-content models and endpoints. It depends on `accounts.BusinessOwner` (FK) and reuses `accounts.permissions.HasRolePermission` for role-gated endpoints. One new permission (`zones.manage`) is added to the existing RBAC seed data in `accounts`.

**Tech Stack:** Django 5.0, DRF 3.15 (already installed — no new dependencies). Filtering uses DRF's built-in `filters.SearchFilter`/`filters.OrderingFilter` plus manual query-param handling, not `django-filter`.

## Global Constraints

- `Listing.status` lifecycle: `draft` → `pending_review` → `published` | `rejected`. Owner may edit while `draft`/`pending_review`/`rejected`; editing is blocked (400) once `published`.
- Submitting a listing (`→ pending_review`) is never gated on the owner's `kyc_status`.
- Approving a listing (`→ published`) is blocked (400) unless `business_owner.kyc_status == "verified"`.
- Rejecting a listing requires a non-blank `reason` (400 if blank) — this must actually be enforced, unlike the prior sub-project's KYC-reject endpoint which allows blank reasons.
- The public browsing/detail endpoints only ever return `status == "published"` listings; non-published listings 404 for any unauthenticated or non-owning caller, even by direct ID guess.
- `categories.manage` stays granted to `marketing` only (unchanged from the prior sub-project). `zones.manage` is a new permission granted to `admin` and `marketing` (super_admin has both automatically, as with every permission).
- Every `mine/` endpoint enforces `request.user == listing.business_owner` server-side via a new `IsListingOwner` permission class (same shape as the existing `accounts.views.IsBusinessOwner`).
- Photo storage reuses the existing Pillow + local `MEDIA_ROOT` pattern (no new infrastructure).
- All backend code lives under `backend/listings/`, except the one new RBAC permission seed migration which lives under `backend/accounts/migrations/` (extending existing seed data, not creating a new app).
- Tests run via `docker compose run --rm web python manage.py test listings accounts core` — full-suite regression checks matter here since this plan adds a new permission to shared RBAC seed data that prior tests depend on.

---

## File Structure

```
backend/
  ashantihub/
    settings.py                          # modified: add "listings" to INSTALLED_APPS
    urls.py                              # modified: mount listings.urls
  accounts/
    migrations/
      0006_seed_zones_manage_permission.py   # new data migration: adds zones.manage permission,
                                              # grants it to admin + marketing
  listings/
    __init__.py
    apps.py
    models.py                            # Category, Zone, Listing, ListingPhoto
    permissions.py                       # IsListingOwner
    serializers.py
    views.py
    urls.py
    migrations/
      __init__.py
      0001_initial.py                    # generated (Task 1: Category)
      0002_seed_categories.py            # hand-written data migration (Task 1)
      0003_zone.py                       # generated (Task 2: Zone)
      0004_seed_zones.py                 # hand-written data migration (Task 2)
      0005_listing.py                    # generated (Task 3: Listing)
      0006_listingphoto.py               # generated (Task 4: ListingPhoto)
    tests/
      __init__.py
      test_category_models.py
      test_zone_models.py
      test_listing_models.py
      test_public_browsing.py
      test_listing_crud.py
      test_listing_photos.py
      test_listing_moderation.py
      test_category_zone_management.py
```

---

### Task 1: `listings` app scaffold + `Category` model + seed migration

**Files:**
- Create: `backend/listings/__init__.py`
- Create: `backend/listings/apps.py`
- Create: `backend/listings/models.py`
- Create: `backend/listings/urls.py` (empty `urlpatterns`, populated by later tasks)
- Create: `backend/listings/tests/__init__.py`
- Test: `backend/listings/tests/test_category_models.py`
- Modify: `backend/ashantihub/settings.py`
- Modify: `backend/ashantihub/urls.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Category` model with `.slug`, `.icon`, `.label`, `.color`. Later tasks (`Listing`, category-management endpoints) rely on `Category.objects.get(slug=...)`.

- [ ] **Step 1: Create the app package**

```bash
mkdir -p backend/listings/tests
touch backend/listings/__init__.py
touch backend/listings/tests/__init__.py
```

- [ ] **Step 2: Write `backend/listings/apps.py`**

```python
from django.apps import AppConfig


class ListingsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "listings"
```

- [ ] **Step 3: Write `backend/listings/urls.py`**

```python
from django.urls import path

urlpatterns = []
```

- [ ] **Step 4: Add `listings` to `INSTALLED_APPS` in `backend/ashantihub/settings.py`**

Find:
```python
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "core",
    "accounts",
]
```

Replace with:
```python
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "core",
    "accounts",
    "listings",
]
```

- [ ] **Step 5: Mount `listings.urls` in `backend/ashantihub/urls.py`**

Find:
```python
urlpatterns = [
    path("api/", include("core.urls")),
    path("api/accounts/", include("accounts.urls")),
]
```

Replace with:
```python
urlpatterns = [
    path("api/", include("core.urls")),
    path("api/accounts/", include("accounts.urls")),
    path("api/listings/", include("listings.urls")),
]
```

- [ ] **Step 6: Write the failing test — `backend/listings/tests/test_category_models.py`**

```python
from django.db import IntegrityError
from django.test import TestCase

from listings.models import Category

SEEDED_SLUGS = {
    "hotels", "tours", "food", "crafts", "transport", "pharmacy", "shops",
    "funeral", "suame", "grocery", "wedding", "petrol", "pubs", "lifestyle", "health",
}


class CategoryModelTests(TestCase):
    def test_all_fifteen_categories_are_seeded(self):
        self.assertEqual(set(Category.objects.values_list("slug", flat=True)), SEEDED_SLUGS)

    def test_hotels_category_has_expected_fields(self):
        hotels = Category.objects.get(slug="hotels")
        self.assertEqual(hotels.icon, "🏨")
        self.assertEqual(hotels.label, "Hotels")
        self.assertEqual(hotels.color, "#000080")

    def test_slug_is_unique(self):
        Category.objects.create(slug="unique-test", icon="🧪", label="Test", color="#000000")
        with self.assertRaises(IntegrityError):
            Category.objects.create(slug="unique-test", icon="🧪", label="Duplicate", color="#111111")
```

- [ ] **Step 7: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test listings.tests.test_category_models`
Expected: FAIL — `ModuleNotFoundError: No module named 'listings.models'`

- [ ] **Step 8: Write `backend/listings/models.py`**

```python
from django.db import models


class Category(models.Model):
    slug = models.SlugField(max_length=50, unique=True)
    icon = models.CharField(max_length=10)
    label = models.CharField(max_length=100)
    color = models.CharField(max_length=20)

    def __str__(self):
        return self.label
```

- [ ] **Step 9: Generate the schema migration**

Run: `docker compose run --rm web python manage.py makemigrations listings`
Expected: creates `backend/listings/migrations/0001_initial.py` with the `Category` model. Verify the migration file lists `Category` before continuing.

- [ ] **Step 10: Write the data migration — `backend/listings/migrations/0002_seed_categories.py`**

```python
from django.db import migrations

CATEGORIES = [
    ("hotels", "🏨", "Hotels", "#000080"),
    ("tours", "🗺️", "Tours", "#006400"),
    ("food", "🍲", "Food", "#CC0000"),
    ("crafts", "🧵", "Crafts", "#B8860B"),
    ("transport", "🚕", "Transport", "#E8621A"),
    ("pharmacy", "💊", "Pharmacy", "#2E8B57"),
    ("shops", "🛍️", "Shops", "#6A0572"),
    ("funeral", "🕊️", "Funeral Services", "#4A4A6A"),
    ("suame", "🔧", "Suame Magazine", "#8B4513"),
    ("grocery", "🛒", "Grocery Concierge", "#2E86AB"),
    ("wedding", "💍", "Wedding Planners", "#C2185B"),
    ("petrol", "⛽", "Petrol Stations", "#F57F17"),
    ("pubs", "🍺", "Pubs & Bars", "#4527A0"),
    ("lifestyle", "💅", "Lifestyle", "#E91E8C"),
    ("health", "🏥", "Health & Wellness", "#00897B"),
]


def seed(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    for slug, icon, label, color in CATEGORIES:
        Category.objects.get_or_create(slug=slug, defaults={"icon": icon, "label": label, "color": color})


def unseed(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    Category.objects.filter(slug__in=[c[0] for c in CATEGORIES]).delete()


class Migration(migrations.Migration):
    dependencies = [("listings", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 11: Run migrations and the test to verify it passes**

Run: `docker compose run --rm web python manage.py migrate`
Expected: `Applying listings.0001_initial... OK`, `Applying listings.0002_seed_categories... OK`

Run: `docker compose run --rm web python manage.py test listings.tests.test_category_models`
Expected: `Ran 3 tests in ...s OK`

- [ ] **Step 12: Run the full test suite to confirm no regressions**

Run: `docker compose run --rm web python manage.py test accounts core listings`
Expected: `Ran 45 tests in ...s OK` (42 existing + 3 new)

- [ ] **Step 13: Commit**

```bash
git add backend/listings/ backend/ashantihub/settings.py backend/ashantihub/urls.py
git commit -m "feat: scaffold listings app with seeded Category model"
```

---

### Task 2: `Zone` model + seed migration + `zones.manage` permission

**Files:**
- Modify: `backend/listings/models.py`
- Test: `backend/listings/tests/test_zone_models.py`
- Create: `backend/accounts/migrations/0006_seed_zones_manage_permission.py`
- Test: `backend/accounts/tests/test_zones_manage_permission.py`

**Interfaces:**
- Consumes: `Role`/`Permission` (from `accounts`, prior sub-project).
- Produces: `Zone` model with `.name`. New `Permission` row `codename="zones.manage"`, granted to `admin` and `marketing` roles. Later tasks (`Listing`, zone-management endpoints) rely on `Zone.objects.get(name=...)` and `role.permissions.filter(codename="zones.manage").exists()`.

- [ ] **Step 1: Write the failing test — `backend/listings/tests/test_zone_models.py`**

```python
from django.db import IntegrityError
from django.test import TestCase

from listings.models import Zone

SEEDED_ZONES = {
    "Manhyia", "Adum", "Kejetia", "Asokwa", "Nhyiaeso", "Bantama", "Suame", "Bonwire", "Citywide",
}


class ZoneModelTests(TestCase):
    def test_all_nine_zones_are_seeded(self):
        self.assertEqual(set(Zone.objects.values_list("name", flat=True)), SEEDED_ZONES)

    def test_name_is_unique(self):
        with self.assertRaises(IntegrityError):
            Zone.objects.create(name="Manhyia")
```

- [ ] **Step 2: Write the failing test — `backend/accounts/tests/test_zones_manage_permission.py`**

```python
from django.test import TestCase

from accounts.models import Permission, Role


class ZonesManagePermissionTests(TestCase):
    def test_zones_manage_permission_exists(self):
        self.assertTrue(Permission.objects.filter(codename="zones.manage").exists())

    def test_admin_and_marketing_have_zones_manage(self):
        for role_name in ("admin", "marketing"):
            role = Role.objects.get(name=role_name)
            self.assertTrue(role.permissions.filter(codename="zones.manage").exists())

    def test_accountant_and_support_do_not_have_zones_manage(self):
        for role_name in ("accountant", "support"):
            role = Role.objects.get(name=role_name)
            self.assertFalse(role.permissions.filter(codename="zones.manage").exists())

    def test_super_admin_has_zones_manage(self):
        super_admin = Role.objects.get(name="super_admin")
        self.assertTrue(super_admin.permissions.filter(codename="zones.manage").exists())
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `docker compose run --rm web python manage.py test listings.tests.test_zone_models accounts.tests.test_zones_manage_permission`
Expected: FAIL — `ImportError: cannot import name 'Zone'` and `Permission.objects.filter(codename="zones.manage").exists()` is `False`.

- [ ] **Step 4: Add `Zone` to `backend/listings/models.py`** (append to the existing file from Task 1)

```python
class Zone(models.Model):
    name = models.CharField(max_length=50, unique=True)

    def __str__(self):
        return self.name
```

- [ ] **Step 5: Generate the schema migration**

Run: `docker compose run --rm web python manage.py makemigrations listings`
Expected: creates `backend/listings/migrations/0003_zone.py` with the `Zone` model.

- [ ] **Step 6: Write the data migration — `backend/listings/migrations/0004_seed_zones.py`**

```python
from django.db import migrations

ZONES = ["Manhyia", "Adum", "Kejetia", "Asokwa", "Nhyiaeso", "Bantama", "Suame", "Bonwire", "Citywide"]


def seed(apps, schema_editor):
    Zone = apps.get_model("listings", "Zone")
    for name in ZONES:
        Zone.objects.get_or_create(name=name)


def unseed(apps, schema_editor):
    Zone = apps.get_model("listings", "Zone")
    Zone.objects.filter(name__in=ZONES).delete()


class Migration(migrations.Migration):
    dependencies = [("listings", "0003_zone")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 7: Write the data migration — `backend/accounts/migrations/0006_seed_zones_manage_permission.py`**

```python
from django.db import migrations


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")

    permission, _ = Permission.objects.get_or_create(
        codename="zones.manage", defaults={"description": "Manage marketplace zones"}
    )
    for role_name in ("admin", "marketing"):
        role = Role.objects.get(name=role_name)
        role.permissions.add(permission)

    super_admin = Role.objects.get(name="super_admin")
    super_admin.permissions.add(permission)


def unseed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Permission.objects.filter(codename="zones.manage").delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0005_businessowner_businessownerprofile")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 8: Run migrations and both tests to verify they pass**

Run: `docker compose run --rm web python manage.py migrate`
Expected: `Applying listings.0003_zone... OK`, `Applying listings.0004_seed_zones... OK`, `Applying accounts.0006_seed_zones_manage_permission... OK`

Run: `docker compose run --rm web python manage.py test listings.tests.test_zone_models accounts.tests.test_zones_manage_permission`
Expected: `Ran 6 tests in ...s OK`

- [ ] **Step 9: Run the full test suite to confirm no regressions**

Run: `docker compose run --rm web python manage.py test accounts core listings`
Expected: `Ran 51 tests in ...s OK` (45 from Task 1 + 6 new)

- [ ] **Step 10: Commit**

```bash
git add backend/listings/ backend/accounts/
git commit -m "feat: add seeded Zone model and zones.manage permission"
```

---

### Task 3: `Listing` model (core fields + status lifecycle)

**Files:**
- Modify: `backend/listings/models.py`
- Test: `backend/listings/tests/test_listing_models.py`

**Interfaces:**
- Consumes: `Category`, `Zone` (Task 1-2), `accounts.models.BusinessOwner`.
- Produces: `Listing` model with `.business_owner`, `.category`, `.zone`, `.name`, `.description`, `.price_amount`, `.price_unit`, `.tag`, `.contact_phone`, `.lat`, `.lng`, `.main_photo`, `.status` (`DRAFT`/`PENDING_REVIEW`/`PUBLISHED`/`REJECTED` class constants), `.rejection_reason`, `.created_at`, `.updated_at`. Later tasks (CRUD, moderation, public browsing) rely on these field names and status constants directly.

- [ ] **Step 1: Write the failing test — `backend/listings/tests/test_listing_models.py`**

```python
from django.test import TestCase

from accounts.models import BusinessOwner
from listings.models import Category, Listing, Zone


class ListingModelTests(TestCase):
    def setUp(self):
        self.owner = BusinessOwner.objects.create(
            full_name="Kwaku Farmer", login_phone="+233207112233", password_hash="x",
        )
        self.category = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")

    def test_status_defaults_to_draft(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Test Lodge", description="A test lodge.", contact_phone="+233207112233",
        )
        self.assertEqual(listing.status, Listing.DRAFT)

    def test_price_amount_and_lat_lng_are_optional(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Test Lodge", description="A test lodge.", contact_phone="+233207112233",
        )
        self.assertIsNone(listing.price_amount)
        self.assertIsNone(listing.lat)
        self.assertIsNone(listing.lng)

    def test_one_owner_can_have_multiple_listings(self):
        Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Lodge One", description="First.", contact_phone="+233207112233",
        )
        Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone,
            name="Lodge Two", description="Second.", contact_phone="+233207112233",
        )
        self.assertEqual(self.owner.listings.count(), 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test listings.tests.test_listing_models`
Expected: FAIL — `ImportError: cannot import name 'Listing' from 'listings.models'`

- [ ] **Step 3: Add `Listing` to `backend/listings/models.py`** (append to the existing file from Tasks 1-2)

```python
from accounts.models import BusinessOwner


class Listing(models.Model):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    PUBLISHED = "published"
    REJECTED = "rejected"
    STATUS_CHOICES = [
        (DRAFT, "Draft"),
        (PENDING_REVIEW, "Pending Review"),
        (PUBLISHED, "Published"),
        (REJECTED, "Rejected"),
    ]

    business_owner = models.ForeignKey(BusinessOwner, on_delete=models.CASCADE, related_name="listings")
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="listings")
    zone = models.ForeignKey(Zone, on_delete=models.PROTECT, related_name="listings")

    name = models.CharField(max_length=150)
    description = models.TextField()
    price_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    price_unit = models.CharField(max_length=30, null=True, blank=True)
    tag = models.CharField(max_length=50, null=True, blank=True)
    contact_phone = models.CharField(max_length=20)
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    main_photo = models.ImageField(upload_to="listing_photos/main/", null=True, blank=True)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=DRAFT)
    rejection_reason = models.CharField(max_length=500, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name
```

- [ ] **Step 4: Generate migration and run tests**

Run: `docker compose run --rm web python manage.py makemigrations listings`
Expected: creates `backend/listings/migrations/0005_listing.py`.

Run: `docker compose run --rm web python manage.py migrate && docker compose run --rm web python manage.py test listings.tests.test_listing_models`
Expected: `Ran 3 tests in ...s OK`

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `docker compose run --rm web python manage.py test accounts core listings`
Expected: `Ran 54 tests in ...s OK` (51 from Task 2 + 3 new)

- [ ] **Step 6: Commit**

```bash
git add backend/listings/
git commit -m "feat: add Listing model with draft/pending_review/published/rejected lifecycle"
```

---

### Task 4: `ListingPhoto` model + owner gallery endpoints

**Files:**
- Modify: `backend/listings/models.py`
- Create: `backend/listings/serializers.py`
- Create: `backend/listings/permissions.py`
- Create: `backend/listings/views.py`
- Modify: `backend/listings/urls.py`
- Test: `backend/listings/tests/test_listing_photos.py`

**Interfaces:**
- Consumes: `Listing` (Task 3), `accounts.authentication.issue_token`.
- Produces: `ListingPhoto` model with `.listing`, `.image`, `.order`. `IsListingOwner` permission class (checks `request.user == obj.business_owner`, importable by later tasks). `POST /api/listings/mine/<id>/photos/` (requires owning `business_owner`) → 201, adds a gallery photo. `DELETE /api/listings/mine/<id>/photos/<photo_id>/` → 204, removes it.

- [ ] **Step 1: Write the failing test — `backend/listings/tests/test_listing_photos.py`**

```python
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

import tempfile

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from listings.models import Category, Listing, ListingPhoto, Zone

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image(name="photo.jpg"):
    return SimpleUploadedFile(name, b"fake-image-bytes", content_type="image/jpeg")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class ListingPhotoTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207223344", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Yaw Trader", login_phone="+233207223355", password_hash="x",
        )
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"),
            zone=Zone.objects.get(name="Manhyia"), name="Test Lodge", description="Desc.",
            contact_phone="+233207223344",
        )
        self.token = issue_token(self.owner, "business_owner")

    def test_owner_can_add_a_photo(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.post(
            f"/api/listings/mine/{self.listing.id}/photos/",
            {"image": _image(), "order": 1}, format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(ListingPhoto.objects.filter(listing=self.listing).count(), 1)

    def test_other_owner_cannot_add_a_photo(self):
        other_token = issue_token(self.other_owner, "business_owner")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {other_token}")
        response = self.client.post(
            f"/api/listings/mine/{self.listing.id}/photos/",
            {"image": _image(), "order": 1}, format="multipart",
        )
        self.assertEqual(response.status_code, 403)

    def test_owner_can_delete_own_photo(self):
        photo = ListingPhoto.objects.create(listing=self.listing, image=_image(), order=1)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.delete(f"/api/listings/mine/{self.listing.id}/photos/{photo.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(ListingPhoto.objects.filter(id=photo.id).exists())

    def test_customer_cannot_add_a_photo(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200009999", password_hash="x")
        token = issue_token(customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.post(
            f"/api/listings/mine/{self.listing.id}/photos/",
            {"image": _image(), "order": 1}, format="multipart",
        )
        self.assertEqual(response.status_code, 403)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test listings.tests.test_listing_photos`
Expected: FAIL — 404s, endpoints/models don't exist.

- [ ] **Step 3: Add `ListingPhoto` to `backend/listings/models.py`** (append to the existing file)

```python
class ListingPhoto(models.Model):
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="photos")
    image = models.ImageField(upload_to="listing_photos/gallery/")
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return f"Photo {self.order} for {self.listing.name}"
```

- [ ] **Step 4: Write `backend/listings/permissions.py`**

```python
from rest_framework.permissions import BasePermission

from accounts.models import BusinessOwner


class IsListingOwner(BasePermission):
    def has_object_permission(self, request, view, obj):
        return isinstance(request.user, BusinessOwner) and obj.business_owner_id == request.user.id
```

- [ ] **Step 5: Write `backend/listings/serializers.py`**

```python
from rest_framework import serializers

from .models import ListingPhoto


class ListingPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingPhoto
        fields = ["id", "image", "order"]
```

- [ ] **Step 6: Write `backend/listings/views.py`**

```python
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Listing, ListingPhoto
from .permissions import IsListingOwner
from .serializers import ListingPhotoSerializer


class ListingPhotoCreateView(generics.CreateAPIView):
    serializer_class = ListingPhotoSerializer
    permission_classes = [IsAuthenticated, IsListingOwner]

    def get_listing(self):
        listing = generics.get_object_or_404(Listing, pk=self.kwargs["pk"])
        self.check_object_permissions(self.request, listing)
        return listing

    def perform_create(self, serializer):
        serializer.save(listing=self.get_listing())


class ListingPhotoDeleteView(APIView):
    permission_classes = [IsAuthenticated, IsListingOwner]

    def delete(self, request, pk, photo_id):
        listing = generics.get_object_or_404(Listing, pk=pk)
        self.check_object_permissions(request, listing)
        photo = generics.get_object_or_404(ListingPhoto, pk=photo_id, listing=listing)
        photo.delete()
        return Response(status=204)
```

- [ ] **Step 7: Write `backend/listings/urls.py`** (replace the empty file from Task 1)

```python
from django.urls import path

from . import views

urlpatterns = [
    path("mine/<int:pk>/photos/", views.ListingPhotoCreateView.as_view(), name="listing-photo-create"),
    path(
        "mine/<int:pk>/photos/<int:photo_id>/",
        views.ListingPhotoDeleteView.as_view(),
        name="listing-photo-delete",
    ),
]
```

- [ ] **Step 8: Generate migration and run tests**

Run: `docker compose run --rm web python manage.py makemigrations listings`
Expected: creates `backend/listings/migrations/0006_listingphoto.py`.

Run: `docker compose run --rm web python manage.py migrate && docker compose run --rm web python manage.py test listings.tests.test_listing_photos`
Expected: `Ran 4 tests in ...s OK`

- [ ] **Step 9: Run the full test suite to confirm no regressions**

Run: `docker compose run --rm web python manage.py test accounts core listings`
Expected: `Ran 58 tests in ...s OK` (54 from Task 3 + 4 new)

- [ ] **Step 10: Commit**

```bash
git add backend/listings/
git commit -m "feat: add ListingPhoto gallery with owner-only add/delete"
```

---

### Task 5: Public browsing endpoints (categories, zones, listings list/detail with filters)

**Files:**
- Modify: `backend/listings/serializers.py`
- Modify: `backend/listings/views.py`
- Modify: `backend/listings/urls.py`
- Test: `backend/listings/tests/test_public_browsing.py`

**Interfaces:**
- Consumes: `Category`, `Zone`, `Listing` (Tasks 1-3).
- Produces: `GET /api/listings/categories/` → all categories. `GET /api/listings/zones/` → all zones. `GET /api/listings/` → published listings, filterable by `?category=<slug>`, `?zone=<name>`, `?search=`, `?min_price=`/`?max_price=`, `?ordering=price_amount`. `GET /api/listings/<id>/` → published listing detail, 404 otherwise.

- [ ] **Step 1: Write the failing test — `backend/listings/tests/test_public_browsing.py`**

```python
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from listings.models import Category, Listing, Zone


class PublicBrowsingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Efua Trader", login_phone="+233207334455", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.food = Category.objects.get(slug="food")
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.adum = Zone.objects.get(name="Adum")

        self.published_hotel = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Royal Lodge", description="Luxury kente-draped rooms.",
            contact_phone="+233207334455", price_amount="450.00", status=Listing.PUBLISHED,
        )
        self.published_food = Listing.objects.create(
            business_owner=self.owner, category=self.food, zone=self.adum,
            name="Afia's Kitchen", description="Authentic fufu and light soup.",
            contact_phone="+233207334455", price_amount="25.00", status=Listing.PUBLISHED,
        )
        self.draft_listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Unfinished Lodge", description="Not ready.",
            contact_phone="+233207334455", status=Listing.DRAFT,
        )

    def test_categories_endpoint_lists_all_fifteen(self):
        response = self.client.get("/api/listings/categories/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 15)

    def test_zones_endpoint_lists_all_nine(self):
        response = self.client.get("/api/listings/zones/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 9)

    def test_listings_endpoint_only_returns_published(self):
        response = self.client.get("/api/listings/")
        ids = [item["id"] for item in response.json()]
        self.assertIn(self.published_hotel.id, ids)
        self.assertIn(self.published_food.id, ids)
        self.assertNotIn(self.draft_listing.id, ids)

    def test_filter_by_category(self):
        response = self.client.get("/api/listings/?category=hotels")
        ids = [item["id"] for item in response.json()]
        self.assertEqual(ids, [self.published_hotel.id])

    def test_filter_by_zone(self):
        response = self.client.get("/api/listings/?zone=Adum")
        ids = [item["id"] for item in response.json()]
        self.assertEqual(ids, [self.published_food.id])

    def test_search_by_name(self):
        response = self.client.get("/api/listings/?search=Royal")
        ids = [item["id"] for item in response.json()]
        self.assertEqual(ids, [self.published_hotel.id])

    def test_price_range_filter(self):
        response = self.client.get("/api/listings/?min_price=100&max_price=500")
        ids = [item["id"] for item in response.json()]
        self.assertEqual(ids, [self.published_hotel.id])

    def test_ordering_by_price(self):
        response = self.client.get("/api/listings/?ordering=price_amount")
        ids = [item["id"] for item in response.json()]
        self.assertEqual(ids, [self.published_food.id, self.published_hotel.id])

    def test_draft_listing_detail_returns_404_for_public(self):
        response = self.client.get(f"/api/listings/{self.draft_listing.id}/")
        self.assertEqual(response.status_code, 404)

    def test_published_listing_detail_returns_200(self):
        response = self.client.get(f"/api/listings/{self.published_hotel.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["name"], "Royal Lodge")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test listings.tests.test_public_browsing`
Expected: FAIL — 404s, endpoints don't exist.

- [ ] **Step 3: Add serializers to `backend/listings/serializers.py`** (append to the existing file from Task 4)

```python
from .models import Category, Listing, Zone


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "slug", "icon", "label", "color"]


class ZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Zone
        fields = ["id", "name"]


class PublicListingSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    zone = ZoneSerializer(read_only=True)
    photos = ListingPhotoSerializer(many=True, read_only=True)

    class Meta:
        model = Listing
        fields = [
            "id", "name", "description", "category", "zone", "price_amount", "price_unit",
            "tag", "contact_phone", "lat", "lng", "main_photo", "photos", "created_at",
        ]
```

- [ ] **Step 4: Add views to `backend/listings/views.py`** (append to the existing file from Task 4)

```python
from rest_framework import filters
from rest_framework.permissions import AllowAny

from .models import Category, Zone
from .serializers import CategorySerializer, PublicListingSerializer, ZoneSerializer


class CategoryListView(generics.ListAPIView):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [AllowAny]


class ZoneListView(generics.ListAPIView):
    queryset = Zone.objects.all()
    serializer_class = ZoneSerializer
    permission_classes = [AllowAny]


class PublicListingListView(generics.ListAPIView):
    serializer_class = PublicListingSerializer
    permission_classes = [AllowAny]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "description"]
    ordering_fields = ["price_amount", "created_at"]

    def get_queryset(self):
        queryset = Listing.objects.filter(status=Listing.PUBLISHED)

        category_slug = self.request.query_params.get("category")
        if category_slug:
            queryset = queryset.filter(category__slug=category_slug)

        zone_name = self.request.query_params.get("zone")
        if zone_name:
            queryset = queryset.filter(zone__name=zone_name)

        min_price = self.request.query_params.get("min_price")
        if min_price:
            queryset = queryset.filter(price_amount__gte=min_price)

        max_price = self.request.query_params.get("max_price")
        if max_price:
            queryset = queryset.filter(price_amount__lte=max_price)

        return queryset


class PublicListingDetailView(generics.RetrieveAPIView):
    queryset = Listing.objects.filter(status=Listing.PUBLISHED)
    serializer_class = PublicListingSerializer
    permission_classes = [AllowAny]
```

- [ ] **Step 5: Add routes to `backend/listings/urls.py`** (add to the existing list from Task 4 — do not replace it)

```python
urlpatterns = [
    path("mine/<int:pk>/photos/", views.ListingPhotoCreateView.as_view(), name="listing-photo-create"),
    path(
        "mine/<int:pk>/photos/<int:photo_id>/",
        views.ListingPhotoDeleteView.as_view(),
        name="listing-photo-delete",
    ),
    path("categories/", views.CategoryListView.as_view(), name="category-list"),
    path("zones/", views.ZoneListView.as_view(), name="zone-list"),
    path("", views.PublicListingListView.as_view(), name="listing-list"),
    path("<int:pk>/", views.PublicListingDetailView.as_view(), name="listing-detail"),
]
```

Route ordering matters here: `mine/...` and `categories/`/`zones/` are literal prefixes checked before the catch-all `<int:pk>/` and `""` patterns, so there's no ambiguity — Django matches the most specific literal path first regardless of list order, but keep `categories/`/`zones/` and `mine/...` above `<int:pk>/` for readability.

- [ ] **Step 6: Run test to verify it passes**

Run: `docker compose run --rm web python manage.py test listings.tests.test_public_browsing`
Expected: `Ran 10 tests in ...s OK`

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run: `docker compose run --rm web python manage.py test accounts core listings`
Expected: `Ran 68 tests in ...s OK` (58 from Task 4 + 10 new)

- [ ] **Step 8: Commit**

```bash
git add backend/listings/
git commit -m "feat: add public listing browsing with category/zone/search/price filters"
```

---

### Task 6: Business owner listing CRUD (create draft, list mine, edit, submit)

**Files:**
- Modify: `backend/listings/serializers.py`
- Modify: `backend/listings/views.py`
- Modify: `backend/listings/urls.py`
- Test: `backend/listings/tests/test_listing_crud.py`

**Interfaces:**
- Consumes: `Listing`, `IsListingOwner` (Tasks 3-4).
- Produces: `POST /api/listings/mine/` → 201, creates a draft listing (`contact_phone` defaults to the owner's `profile.business_contact_phone` if omitted). `GET /api/listings/mine/` → list of the caller's own listings, any status. `PATCH /api/listings/mine/<id>/` → edit own listing (400 if `status == published`). `POST /api/listings/mine/<id>/submit/` → `draft`/`rejected` → `pending_review`.

- [ ] **Step 1: Write the failing test — `backend/listings/tests/test_listing_crud.py`**

```python
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from listings.models import Category, Listing, Zone


class ListingCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207445566", password_hash="x",
        )
        BusinessOwnerProfile.objects.create(
            business_owner=self.owner, ghana_card_number="GHA-222333444-5",
            gps_address="AK-039-5060", business_contact_phone="+233207445566",
            is_formal=False, default_payout_method="momo", payout_momo_network="MTN",
            payout_momo_number="+233207445566", payout_momo_name="Kofi Trader",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Ama Seller", login_phone="+233207445577", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.token = issue_token(self.owner, "business_owner")

    def _auth(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def test_create_listing_defaults_contact_phone_from_profile(self):
        self._auth(self.owner)
        response = self.client.post(
            "/api/listings/mine/",
            {"category": self.hotels.id, "zone": self.manhyia.id, "name": "New Lodge", "description": "Desc."},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        listing = Listing.objects.get(id=response.json()["id"])
        self.assertEqual(listing.contact_phone, "+233207445566")
        self.assertEqual(listing.status, Listing.DRAFT)
        self.assertEqual(listing.business_owner, self.owner)

    def test_list_mine_returns_only_own_listings_any_status(self):
        Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Mine", description="D.", contact_phone="+233207445566", status=Listing.DRAFT,
        )
        Listing.objects.create(
            business_owner=self.other_owner, category=self.hotels, zone=self.manhyia,
            name="Not Mine", description="D.", contact_phone="+233207445577", status=Listing.PUBLISHED,
        )
        self._auth(self.owner)
        response = self.client.get("/api/listings/mine/")
        names = [item["name"] for item in response.json()]
        self.assertEqual(names, ["Mine"])

    def test_owner_can_edit_own_draft_listing(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Old Name", description="D.", contact_phone="+233207445566",
        )
        self._auth(self.owner)
        response = self.client.patch(f"/api/listings/mine/{listing.id}/", {"name": "New Name"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertEqual(listing.name, "New Name")

    def test_other_owner_cannot_edit_listing(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Old Name", description="D.", contact_phone="+233207445566",
        )
        self._auth(self.other_owner)
        response = self.client.patch(f"/api/listings/mine/{listing.id}/", {"name": "Hijacked"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_cannot_edit_published_listing(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Live Listing", description="D.", contact_phone="+233207445566",
            status=Listing.PUBLISHED,
        )
        self._auth(self.owner)
        response = self.client.patch(f"/api/listings/mine/{listing.id}/", {"name": "Changed"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_submit_moves_draft_to_pending_review(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Ready Listing", description="D.", contact_phone="+233207445566",
        )
        self._auth(self.owner)
        response = self.client.post(f"/api/listings/mine/{listing.id}/submit/")
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.PENDING_REVIEW)

    def test_customer_cannot_create_a_listing(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200008888", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        response = self.client.post(
            "/api/listings/mine/",
            {"category": self.hotels.id, "zone": self.manhyia.id, "name": "Nope", "description": "D."},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test listings.tests.test_listing_crud`
Expected: FAIL — 404s, endpoints don't exist.

- [ ] **Step 3: Add `OwnerListingSerializer` to `backend/listings/serializers.py`** (append to the existing file from Task 5)

```python
class OwnerListingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Listing
        fields = [
            "id", "category", "zone", "name", "description", "price_amount", "price_unit",
            "tag", "contact_phone", "lat", "lng", "main_photo", "status", "rejection_reason",
            "created_at", "updated_at",
        ]
        read_only_fields = ["status", "rejection_reason", "created_at", "updated_at"]
        extra_kwargs = {"contact_phone": {"required": False}}

    def validate(self, data):
        if self.instance is not None and self.instance.status == Listing.PUBLISHED:
            raise serializers.ValidationError(
                {"status": "Cannot edit a published listing."}
            )
        return data

    def create(self, validated_data):
        owner = self.context["request"].user
        if not validated_data.get("contact_phone"):
            validated_data["contact_phone"] = owner.profile.business_contact_phone
        return Listing.objects.create(business_owner=owner, **validated_data)
```

- [ ] **Step 4: Add views to `backend/listings/views.py`** (append to the existing file from Task 5)

```python
from .serializers import OwnerListingSerializer


class OwnerListingCreateListView(generics.ListCreateAPIView):
    serializer_class = OwnerListingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Listing.objects.filter(business_owner=self.request.user)


class OwnerListingUpdateView(generics.UpdateAPIView):
    queryset = Listing.objects.all()
    serializer_class = OwnerListingSerializer
    permission_classes = [IsAuthenticated, IsListingOwner]
    http_method_names = ["patch"]


class ListingSubmitView(APIView):
    permission_classes = [IsAuthenticated, IsListingOwner]

    def post(self, request, pk):
        listing = generics.get_object_or_404(Listing, pk=pk)
        self.check_object_permissions(request, listing)
        listing.status = Listing.PENDING_REVIEW
        listing.save(update_fields=["status"])
        return Response({"id": listing.id, "status": listing.status})
```

- [ ] **Step 5: Add routes to `backend/listings/urls.py`** (add to the existing list from Task 5 — do not replace it)

```python
urlpatterns = [
    path("mine/", views.OwnerListingCreateListView.as_view(), name="listing-mine-list-create"),
    path("mine/<int:pk>/", views.OwnerListingUpdateView.as_view(), name="listing-mine-update"),
    path("mine/<int:pk>/submit/", views.ListingSubmitView.as_view(), name="listing-submit"),
    path("mine/<int:pk>/photos/", views.ListingPhotoCreateView.as_view(), name="listing-photo-create"),
    path(
        "mine/<int:pk>/photos/<int:photo_id>/",
        views.ListingPhotoDeleteView.as_view(),
        name="listing-photo-delete",
    ),
    path("categories/", views.CategoryListView.as_view(), name="category-list"),
    path("zones/", views.ZoneListView.as_view(), name="zone-list"),
    path("", views.PublicListingListView.as_view(), name="listing-list"),
    path("<int:pk>/", views.PublicListingDetailView.as_view(), name="listing-detail"),
]
```

`mine/` (exact) and `mine/<int:pk>/` are distinct literal-then-converter patterns checked before the trailing catch-alls, same reasoning as Task 5's ordering note.

- [ ] **Step 6: Run test to verify it passes**

Run: `docker compose run --rm web python manage.py test listings.tests.test_listing_crud`
Expected: `Ran 7 tests in ...s OK`

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run: `docker compose run --rm web python manage.py test accounts core listings`
Expected: `Ran 75 tests in ...s OK` (68 from Task 5 + 7 new)

- [ ] **Step 8: Commit**

```bash
git add backend/listings/
git commit -m "feat: add business owner listing create/list/edit/submit endpoints"
```

---

### Task 7: Staff moderation endpoints (pending queue, detail, approve, reject)

**Files:**
- Modify: `backend/listings/serializers.py`
- Modify: `backend/listings/views.py`
- Modify: `backend/listings/urls.py`
- Test: `backend/listings/tests/test_listing_moderation.py`

**Interfaces:**
- Consumes: `Listing` (Task 3), `accounts.permissions.HasRolePermission`, `accounts.models.BusinessOwner`.
- Produces: `GET /api/listings/moderation/pending/` (requires `listings.moderate`) → `pending_review` queue. `GET /api/listings/moderation/<id>/` → full detail, any status. `POST /api/listings/moderation/<id>/approve/` → `published` (400 if owner not KYC-verified). `POST /api/listings/moderation/<id>/reject/` with `{"reason": "..."}` → `rejected` (400 if reason blank).

- [ ] **Step 1: Write the failing test — `backend/listings/tests/test_listing_moderation.py`**

```python
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Role, StaffUser
from listings.models import Category, Listing, Zone


class ListingModerationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-listing@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.admin_token = issue_token(self.admin, "staff")

        self.verified_owner = BusinessOwner.objects.create(
            full_name="Verified Trader", login_phone="+233207556677", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED,
        )
        self.pending_owner = BusinessOwner.objects.create(
            full_name="Pending Trader", login_phone="+233207556688", password_hash="x",
            kyc_status=BusinessOwner.PENDING,
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")

        self.listing_verified_owner = Listing.objects.create(
            business_owner=self.verified_owner, category=self.hotels, zone=self.manhyia,
            name="Verified Lodge", description="D.", contact_phone="+233207556677",
            status=Listing.PENDING_REVIEW,
        )
        self.listing_pending_owner = Listing.objects.create(
            business_owner=self.pending_owner, category=self.hotels, zone=self.manhyia,
            name="Unverified Lodge", description="D.", contact_phone="+233207556688",
            status=Listing.PENDING_REVIEW,
        )

    def test_pending_queue_lists_pending_review_listings(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.get("/api/listings/moderation/pending/")
        ids = [item["id"] for item in response.json()]
        self.assertIn(self.listing_verified_owner.id, ids)
        self.assertIn(self.listing_pending_owner.id, ids)

    def test_admin_can_approve_listing_of_verified_owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.post(f"/api/listings/moderation/{self.listing_verified_owner.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        self.listing_verified_owner.refresh_from_db()
        self.assertEqual(self.listing_verified_owner.status, Listing.PUBLISHED)

    def test_approve_blocked_if_owner_not_kyc_verified(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.post(f"/api/listings/moderation/{self.listing_pending_owner.id}/approve/")
        self.assertEqual(response.status_code, 400)
        self.listing_pending_owner.refresh_from_db()
        self.assertEqual(self.listing_pending_owner.status, Listing.PENDING_REVIEW)

    def test_admin_can_reject_with_reason(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.post(
            f"/api/listings/moderation/{self.listing_verified_owner.id}/reject/",
            {"reason": "Description too short"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.listing_verified_owner.refresh_from_db()
        self.assertEqual(self.listing_verified_owner.status, Listing.REJECTED)
        self.assertEqual(self.listing_verified_owner.rejection_reason, "Description too short")

    def test_reject_requires_non_blank_reason(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.post(
            f"/api/listings/moderation/{self.listing_verified_owner.id}/reject/",
            {"reason": ""}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_accountant_cannot_moderate_listings(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant Person", email="acc-listing@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        token = issue_token(accountant, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.post(f"/api/listings/moderation/{self.listing_verified_owner.id}/approve/")
        self.assertEqual(response.status_code, 403)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test listings.tests.test_listing_moderation`
Expected: FAIL — 404s, endpoints don't exist.

- [ ] **Step 3: Add `ModerationListingSerializer` to `backend/listings/serializers.py`** (append to the existing file from Task 6)

```python
class ModerationListingSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    zone = ZoneSerializer(read_only=True)
    photos = ListingPhotoSerializer(many=True, read_only=True)

    class Meta:
        model = Listing
        fields = [
            "id", "business_owner", "name", "description", "category", "zone", "price_amount",
            "price_unit", "tag", "contact_phone", "lat", "lng", "main_photo", "photos",
            "status", "rejection_reason", "created_at",
        ]
```

- [ ] **Step 4: Add views to `backend/listings/views.py`** (append to the existing file from Task 6)

```python
from accounts.models import BusinessOwner
from accounts.permissions import HasRolePermission

from .serializers import ModerationListingSerializer


class ModerationPendingQueueView(generics.ListAPIView):
    serializer_class = ModerationListingSerializer
    queryset = Listing.objects.filter(status=Listing.PENDING_REVIEW).order_by("created_at")

    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]


class ModerationListingDetailView(generics.RetrieveAPIView):
    queryset = Listing.objects.all()
    serializer_class = ModerationListingSerializer

    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]


class ModerationApproveView(APIView):
    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]

    def post(self, request, pk):
        listing = generics.get_object_or_404(Listing, pk=pk)
        if listing.business_owner.kyc_status != BusinessOwner.VERIFIED:
            return Response(
                {"detail": "Cannot publish a listing whose owner is not KYC-verified."}, status=400
            )
        listing.status = Listing.PUBLISHED
        listing.rejection_reason = None
        listing.save(update_fields=["status", "rejection_reason"])
        return Response({"id": listing.id, "status": listing.status})


class ModerationRejectView(APIView):
    def get_permissions(self):
        return [HasRolePermission("listings.moderate")]

    def post(self, request, pk):
        reason = request.data.get("reason", "").strip()
        if not reason:
            return Response({"reason": "A rejection reason is required."}, status=400)
        listing = generics.get_object_or_404(Listing, pk=pk)
        listing.status = Listing.REJECTED
        listing.rejection_reason = reason
        listing.save(update_fields=["status", "rejection_reason"])
        return Response({"id": listing.id, "status": listing.status})
```

- [ ] **Step 5: Add routes to `backend/listings/urls.py`** (add to the existing list from Task 6 — do not replace it)

```python
urlpatterns = [
    path("mine/", views.OwnerListingCreateListView.as_view(), name="listing-mine-list-create"),
    path("mine/<int:pk>/", views.OwnerListingUpdateView.as_view(), name="listing-mine-update"),
    path("mine/<int:pk>/submit/", views.ListingSubmitView.as_view(), name="listing-submit"),
    path("mine/<int:pk>/photos/", views.ListingPhotoCreateView.as_view(), name="listing-photo-create"),
    path(
        "mine/<int:pk>/photos/<int:photo_id>/",
        views.ListingPhotoDeleteView.as_view(),
        name="listing-photo-delete",
    ),
    path("moderation/pending/", views.ModerationPendingQueueView.as_view(), name="moderation-pending"),
    path("moderation/<int:pk>/", views.ModerationListingDetailView.as_view(), name="moderation-detail"),
    path("moderation/<int:pk>/approve/", views.ModerationApproveView.as_view(), name="moderation-approve"),
    path("moderation/<int:pk>/reject/", views.ModerationRejectView.as_view(), name="moderation-reject"),
    path("categories/", views.CategoryListView.as_view(), name="category-list"),
    path("zones/", views.ZoneListView.as_view(), name="zone-list"),
    path("", views.PublicListingListView.as_view(), name="listing-list"),
    path("<int:pk>/", views.PublicListingDetailView.as_view(), name="listing-detail"),
]
```

`moderation/...` is a distinct literal prefix from `<int:pk>/`, same non-ambiguity reasoning as Tasks 5-6.

- [ ] **Step 6: Run test to verify it passes**

Run: `docker compose run --rm web python manage.py test listings.tests.test_listing_moderation`
Expected: `Ran 6 tests in ...s OK`

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run: `docker compose run --rm web python manage.py test accounts core listings`
Expected: `Ran 81 tests in ...s OK` (75 from Task 6 + 6 new)

- [ ] **Step 8: Commit**

```bash
git add backend/listings/
git commit -m "feat: add listing moderation queue with KYC-gated approve and reasoned reject"
```

---

### Task 8: Category/Zone management create endpoints

**Files:**
- Modify: `backend/listings/serializers.py`
- Modify: `backend/listings/views.py`
- Modify: `backend/listings/urls.py`
- Test: `backend/listings/tests/test_category_zone_management.py`

**Interfaces:**
- Consumes: `Category`, `Zone` (Tasks 1-2), `accounts.permissions.HasRolePermission`.
- Produces: `POST /api/listings/categories/` (requires `categories.manage`) → 201, creates a category. `POST /api/listings/zones/` (requires `zones.manage`) → 201, creates a zone.

- [ ] **Step 1: Write the failing test — `backend/listings/tests/test_category_zone_management.py`**

```python
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser
from listings.models import Category, Zone


class CategoryZoneManagementTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _staff(self, role_name, suffix):
        staff = StaffUser.objects.create(
            full_name=f"{role_name} Person", email=f"{role_name}-{suffix}@example.com",
            password_hash="x", role=Role.objects.get(name=role_name),
        )
        return issue_token(staff, "staff")

    def test_marketing_can_create_category(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('marketing', 1)}")
        response = self.client.post(
            "/api/listings/categories/",
            {"slug": "new-cat", "icon": "🆕", "label": "New Category", "color": "#123456"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(Category.objects.filter(slug="new-cat").exists())

    def test_admin_cannot_create_category(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('admin', 1)}")
        response = self.client.post(
            "/api/listings/categories/",
            {"slug": "blocked-cat", "icon": "🚫", "label": "Blocked", "color": "#000000"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_can_create_zone(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('admin', 2)}")
        response = self.client.post("/api/listings/zones/", {"name": "New Zone"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(Zone.objects.filter(name="New Zone").exists())

    def test_marketing_can_create_zone(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('marketing', 2)}")
        response = self.client.post("/api/listings/zones/", {"name": "Another Zone"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)

    def test_accountant_cannot_create_zone(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._staff('accountant', 1)}")
        response = self.client.post("/api/listings/zones/", {"name": "Nope Zone"}, format="json")
        self.assertEqual(response.status_code, 403)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose run --rm web python manage.py test listings.tests.test_category_zone_management`
Expected: FAIL — 405/404, create endpoints don't exist (list-only views from Task 5 don't accept POST).

- [ ] **Step 3: Change `CategoryListView`/`ZoneListView` to `ListCreateAPIView` in `backend/listings/views.py`**

Find (from Task 5):
```python
class CategoryListView(generics.ListAPIView):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [AllowAny]


class ZoneListView(generics.ListAPIView):
    queryset = Zone.objects.all()
    serializer_class = ZoneSerializer
    permission_classes = [AllowAny]
```

Replace with:
```python
class CategoryListView(generics.ListCreateAPIView):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission("categories.manage")]
        return [AllowAny()]


class ZoneListView(generics.ListCreateAPIView):
    queryset = Zone.objects.all()
    serializer_class = ZoneSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission("zones.manage")]
        return [AllowAny()]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose run --rm web python manage.py test listings.tests.test_category_zone_management`
Expected: `Ran 5 tests in ...s OK`

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `docker compose run --rm web python manage.py test accounts core listings`
Expected: `Ran 86 tests in ...s OK` (81 from Task 7 + 5 new)

- [ ] **Step 6: Commit**

```bash
git add backend/listings/
git commit -m "feat: add permission-gated category and zone creation endpoints"
```

---

## Notes for the next sub-project (frontend API wiring)

The frontend-wiring sub-project (deferred per `docs/superpowers/specs/2026-07-09-listing-model-design.md` §1) will read `GET /api/listings/categories/`, `GET /api/listings/zones/`, and `GET /api/listings/` (with its four filters) to replace `App.jsx`'s hardcoded `CATEGORIES`/`LISTINGS` — no changes to this plan's models should be needed, only the frontend consuming these already-shaped endpoints.
