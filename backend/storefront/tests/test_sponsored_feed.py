"""GET /api/storefront/sponsored/ - the public sponsored carousel feed (Marketplace Plan 4, Task 3b)."""
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from listings.models import Category, Listing, Zone

URL = "/api/storefront/sponsored/"


class SponsoredFeedTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(full_name="Spons Shop", login_phone="+233207771001", password_hash="x")
        self.zone = Zone.objects.get(name="Manhyia")
        self.shops = Category.objects.get(slug="shops")

    def make(self, name, sponsored=True, status=Listing.PUBLISHED, owner=None, category=None):
        return Listing.objects.create(
            business_owner=owner or self.owner, category=category or self.shops, zone=self.zone, name=name,
            description="D.", contact_phone="+233207771001", price_amount="10.00", status=status, sponsored=sponsored,
        )

    def ids(self, **params):
        response = self.client.get(URL, params)
        self.assertEqual(response.status_code, 200, response.content)
        return [row["id"] for row in response.json()]

    def test_unicode_digit_filters_are_not_a_500(self):
        # "\u00b2" (superscript two) is str.isdigit() but not an int.
        live = self.make("Live")
        self.assertEqual(self.ids(category="\u00b2", exclude="\u00b2"), [])  # an unknown category, nothing excluded
        self.assertEqual(self.ids(exclude="\u00b2"), [live.pk])

    def test_lists_only_live_sponsored_listings(self):
        live = self.make("Live")
        self.make("Plain", sponsored=False)
        self.assertEqual(self.ids(), [live.pk])

    def test_hidden_business_and_draft_and_dropped_never_appear(self):
        live = self.make("Live")
        suspended = BusinessOwner.objects.create(full_name="Sus", login_phone="+233207771002", password_hash="x", is_suspended=True)
        self.make("Hidden", owner=suspended)
        for status in (Listing.DRAFT, Listing.DROPPED, Listing.DISCONTINUED):
            self.make(status, status=status)
        self.assertEqual(self.ids(), [live.pk])

    def test_category_filter_and_exclude(self):
        a = self.make("A")
        b = self.make("B")
        child = Category.objects.create(slug="zz-spons-child", label="C", icon="x", color="#000", kind=Category.PRODUCT, parent=self.shops)
        c = self.make("C", category=child)
        other = Category.objects.create(slug="zz-spons-other", label="O", icon="x", color="#000", kind=Category.PRODUCT)
        self.make("Elsewhere", category=other)
        self.assertEqual(set(self.ids(category=self.shops.pk)), {a.pk, b.pk, c.pk})  # the category and its descendants
        self.assertEqual(self.ids(category=child.pk), [c.pk])
        self.assertEqual(set(self.ids(category=self.shops.pk, exclude=a.pk)), {b.pk, c.pk})
        self.assertEqual(self.ids(category=99999999), [])

    def test_limit_is_clamped_and_defaults_to_12(self):
        for i in range(30):
            self.make(f"L{i}")
        self.assertEqual(len(self.ids()), 12)
        self.assertEqual(len(self.ids(limit="abc")), 12)
        self.assertEqual(len(self.ids(limit=5)), 5)
        self.assertEqual(len(self.ids(limit=0)), 1)
        self.assertEqual(len(self.ids(limit=500)), 24)

    def test_anonymous_can_read(self):
        self.make("Live")
        self.assertEqual(self.client.get(URL).status_code, 200)

    def test_rows_use_the_public_card_shape(self):
        self.make("Live")
        card = self.client.get("/api/listings/").json()
        card = card["results"][0] if isinstance(card, dict) else card[0]
        row = self.client.get(URL).json()[0]
        self.assertEqual(set(row), set(card))
        self.assertNotIn("contact_phone", row)
