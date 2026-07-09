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
