"""The public seller page (marketplace plan 2, task 10): GET /api/listings/sellers/<id>/ and the ?seller= filters."""
from datetime import timedelta
from itertools import count

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile
from events.models import Event
from listings.models import Category, Listing, Zone

_phones = count(500)
ALLOWED_KEYS = {"id", "name", "since", "is_ashanti_direct", "counts"}
COUNT_KEYS = {"products", "services", "stays", "events"}


class SellerPageTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.zone = Zone.objects.get(name="Manhyia")
        self.shops = Category.objects.get(slug="shops")
        self.festivals = Category.objects.get(slug="festivals")
        self.stay_cat = Category.objects.filter(is_accommodation=True).first()
        self.service_cat = Category.objects.filter(kind=Category.SERVICE, is_accommodation=False).first()
        self.owner = self.make_owner("Adwoa Fabrics")

    def make_owner(self, name):
        n = next(_phones)
        owner = BusinessOwner.objects.create(
            full_name=f"{name} Personal", login_phone=f"+233207770{n:03d}", password_hash="x",
        )
        BusinessOwnerProfile.objects.create(
            business_owner=owner, business_name=name, business_contact_phone="+233207770999",
            gps_address="AK-123-4567",
        )
        return owner

    def make_listing(self, owner, name, category=None, status=Listing.PUBLISHED):
        return Listing.objects.create(
            business_owner=owner, category=category or self.shops, zone=self.zone, name=name,
            description="D.", contact_phone="+233207770999", price_amount="10.00", status=status,
        )

    def make_event(self, owner, name, **extra):
        now = timezone.now()
        fields = dict(
            category=self.festivals, zone=self.zone, submitted_by_business=owner, name=name, description="D.",
            address="Bantama", event_date=now + timedelta(days=30), visibility_days=14, status=Event.APPROVED,
            paid_at=now, expires_at=now + timedelta(days=14),
        )
        fields.update(extra)
        return Event.objects.create(**fields)

    def get(self, owner_id):
        return self.client.get(f"/api/listings/sellers/{owner_id}/")

    def test_the_payload_is_exactly_id_name_since_and_counts(self):
        response = self.get(self.owner.id)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), ALLOWED_KEYS)
        self.assertEqual(set(body["counts"]), COUNT_KEYS)
        self.assertEqual(body["id"], self.owner.id)
        self.assertEqual(body["name"], "Adwoa Fabrics")
        self.assertTrue(body["since"].startswith(str(self.owner.created_at.year)))

    def test_no_contact_field_or_value_appears_anywhere(self):
        text = self.get(self.owner.id).content.decode()
        for needle in ("+233207770999", "207770999", "AK-123-4567", self.owner.login_phone, "Personal", "email"):
            self.assertNotIn(needle, text)

    def test_the_name_falls_back_to_the_owner_name_without_a_business_name(self):
        BusinessOwnerProfile.objects.filter(business_owner=self.owner).update(business_name="")
        self.assertEqual(self.get(self.owner.id).json()["name"], "Adwoa Fabrics Personal")

    def test_counts_cover_only_live_listings_by_kind(self):
        self.make_listing(self.owner, "Cloth")
        self.make_listing(self.owner, "Kente")
        self.make_listing(self.owner, "Draft cloth", status=Listing.DRAFT)
        self.make_listing(self.owner, "Pending cloth", status=Listing.PENDING_REVIEW)
        if self.service_cat:
            self.make_listing(self.owner, "Tailoring", self.service_cat)
        if self.stay_cat:
            self.make_listing(self.owner, "Guest room", self.stay_cat)
        self.make_listing(self.make_owner("Other shop"), "Not mine")
        self.make_event(self.owner, "Cloth fair")
        self.make_event(self.owner, "Unpaid fair", paid_at=None, expires_at=None)
        self.make_event(self.owner, "Pending fair", status=Event.PENDING)
        counts = self.get(self.owner.id).json()["counts"]
        self.assertEqual(counts["products"], 2)
        self.assertEqual(counts["services"], 1 if self.service_cat else 0)
        self.assertEqual(counts["stays"], 1 if self.stay_cat else 0)
        self.assertEqual(counts["events"], 1)

    def test_a_business_with_nothing_live_has_zero_counts(self):
        counts = self.get(self.owner.id).json()["counts"]
        self.assertEqual(counts, {"products": 0, "services": 0, "stays": 0, "events": 0})

    def test_a_suspended_business_is_a_404(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(is_suspended=True)
        self.assertEqual(self.get(self.owner.id).status_code, 404)

    def test_an_unknown_business_is_a_404(self):
        self.assertEqual(self.get(999999).status_code, 404)

    def test_the_page_needs_no_sign_in(self):
        self.assertEqual(APIClient().get(f"/api/listings/sellers/{self.owner.id}/").status_code, 200)

    def test_the_listing_list_filters_to_one_seller(self):
        mine = self.make_listing(self.owner, "Cloth")
        self.make_listing(self.make_owner("Other shop"), "Not mine")
        results = self.client.get(f"/api/listings/?seller={self.owner.id}").json()["results"]
        self.assertEqual([r["id"] for r in results], [mine.id])

    def test_the_seller_filter_ignores_a_non_number(self):
        self.make_listing(self.owner, "Cloth")
        self.assertEqual(self.client.get("/api/listings/?seller=abc").status_code, 200)

    def test_the_event_list_filters_to_one_seller(self):
        mine = self.make_event(self.owner, "Cloth fair")
        self.make_event(self.make_owner("Other shop"), "Other fair")
        results = self.client.get(f"/api/events/?seller={self.owner.id}").json()["results"]
        self.assertEqual([r["id"] for r in results], [mine.id])
