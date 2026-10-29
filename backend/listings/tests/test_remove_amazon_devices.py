"""The data migration that removes the Amazon Devices & Accessories department: it deletes only categories nothing
references, and keeps (with its parent) anything that is still in use."""
import importlib
from datetime import timedelta
from io import StringIO
from contextlib import redirect_stdout

from django.apps import apps
from django.test import TestCase
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile
from events.models import Event
from listings.department_seed import DEPARTMENTS
from listings.models import Category, CategoryVisit, Listing, Zone

migration = importlib.import_module("listings.migrations.0038_remove_amazon_devices_department")

DEPARTMENT = "amazon-devices"
CHILDREN = [
    "amazon-devices-amazon-echo-alexa", "amazon-devices-fire-tablets", "amazon-devices-fire-tv",
    "amazon-devices-ring", "amazon-devices-device-accessories",
]


class RemoveAmazonDevicesTests(TestCase):
    def setUp(self):
        self.zone = Zone.objects.get(name="Manhyia")
        self.owner = BusinessOwner.objects.create(full_name="Owner", login_phone="+233207552001", password_hash="x")
        self.department = Category.objects.create(slug=DEPARTMENT, label="Amazon Devices & Accessories", icon="x", color="#000")
        for slug in CHILDREN:
            Category.objects.create(slug=slug, label=slug, icon="x", color="#000", parent=self.department)

    def run_forwards(self):
        out = StringIO()
        with redirect_stdout(out):
            migration.remove_amazon_devices(apps, None)
        return out.getvalue()

    def remaining(self):
        return set(Category.objects.filter(slug__in=[DEPARTMENT, *CHILDREN]).values_list("slug", flat=True))

    def test_seed_no_longer_lists_the_department(self):
        self.assertNotIn(DEPARTMENT, [d[0] for d in DEPARTMENTS])

    def test_unreferenced_department_and_children_are_all_removed(self):
        Category.objects.create(slug="electronics-keep", label="Keep", icon="x", color="#000")
        self.assertEqual(self.run_forwards(), "")
        self.assertEqual(self.remaining(), set())
        self.assertTrue(Category.objects.filter(slug="electronics-keep").exists())
        self.assertTrue(Category.objects.filter(slug="electronics").exists())

    def test_child_with_a_listing_is_kept_with_its_department(self):
        Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="amazon-devices-ring"), zone=self.zone,
            name="Ring", description="D.", contact_phone="+233207552999", price_amount="10.00", status=Listing.PUBLISHED,
        )
        output = self.run_forwards()
        self.assertEqual(self.remaining(), {DEPARTMENT, "amazon-devices-ring"})
        self.assertIn("amazon-devices-ring", output)

    def test_child_with_only_a_visit_is_deleted(self):
        CategoryVisit.objects.create(category=Category.objects.get(slug="amazon-devices-fire-tv"), day=timezone.now().date(), count=5)
        self.run_forwards()
        self.assertEqual(self.remaining(), set())
        self.assertFalse(CategoryVisit.objects.exists())

    def test_department_referenced_through_a_related_name_plus_relation_is_kept(self):
        BusinessOwnerProfile.objects.create(
            business_owner=self.owner, business_name="Shop", business_category=self.department)
        self.run_forwards()
        self.assertEqual(self.remaining(), {DEPARTMENT})

    def test_event_referencing_a_child_keeps_it(self):
        now = timezone.now()
        Event.objects.create(
            category=Category.objects.get(slug="amazon-devices-fire-tablets"), zone=self.zone,
            submitted_by_business=self.owner, name="Fest", description="D.", address="Kumasi",
            event_date=now + timedelta(days=9), visibility_days=14, status=Event.APPROVED, paid_at=now,
            expires_at=now + timedelta(days=14),
        )
        self.run_forwards()
        self.assertEqual(self.remaining(), {DEPARTMENT, "amazon-devices-fire-tablets"})

    def test_running_twice_is_harmless(self):
        Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="amazon-devices-ring"), zone=self.zone,
            name="Ring", description="D.", contact_phone="+233207552999", price_amount="10.00", status=Listing.PUBLISHED,
        )
        self.run_forwards()
        first = self.remaining()
        self.run_forwards()
        self.assertEqual(self.remaining(), first)

    def test_running_when_already_gone_is_harmless(self):
        Category.objects.filter(slug__in=CHILDREN).delete()
        Category.objects.filter(slug=DEPARTMENT).delete()
        self.assertEqual(self.run_forwards(), "")
