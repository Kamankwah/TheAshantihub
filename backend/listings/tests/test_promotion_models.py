from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from accounts.models import BusinessOwner
from listings.models import Category, Listing, Promotion, Zone


class PromotionModelTests(TestCase):
    def setUp(self):
        self.owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207881122", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Royal Lodge", description="Luxury kente-draped rooms.",
            contact_phone="+233207881122", price_amount="450.00", status=Listing.PUBLISHED,
        )

    def _promotion(self, **overrides):
        now = timezone.now()
        defaults = dict(
            listing=self.listing,
            kind=Promotion.FEATURED,
            starts_at=now,
            ends_at=now + timedelta(days=7),
            amount_paid="35.00",
        )
        defaults.update(overrides)
        return Promotion.objects.create(**defaults)

    def test_status_defaults_to_active(self):
        promotion = self._promotion()
        self.assertEqual(promotion.status, Promotion.ACTIVE)

    def test_keywords_defaults_to_blank(self):
        promotion = self._promotion()
        self.assertEqual(promotion.keywords, "")

    def test_ordering_is_most_recently_started_first(self):
        now = timezone.now()
        older = self._promotion(starts_at=now - timedelta(days=2), ends_at=now + timedelta(days=5))
        newer = self._promotion(starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=6))
        self.assertEqual(list(Promotion.objects.all()), [newer, older])

    def test_str_includes_listing_name_and_status(self):
        promotion = self._promotion()
        self.assertIn(self.listing.name, str(promotion))
        self.assertIn(promotion.status, str(promotion))

    def test_is_currently_active_true_within_window(self):
        promotion = self._promotion()
        self.assertTrue(promotion.is_currently_active)

    def test_is_currently_active_false_once_ended(self):
        now = timezone.now()
        promotion = self._promotion(
            starts_at=now - timedelta(days=10), ends_at=now - timedelta(days=1)
        )
        self.assertFalse(promotion.is_currently_active)

    def test_is_currently_active_false_before_start(self):
        now = timezone.now()
        promotion = self._promotion(
            starts_at=now + timedelta(days=1), ends_at=now + timedelta(days=5)
        )
        self.assertFalse(promotion.is_currently_active)

    def test_is_currently_active_false_when_cancelled(self):
        promotion = self._promotion(status=Promotion.CANCELLED)
        self.assertFalse(promotion.is_currently_active)

    def test_boost_kind_can_carry_keywords(self):
        promotion = self._promotion(kind=Promotion.BOOST, keywords="kente wedding gifts")
        self.assertEqual(promotion.kind, Promotion.BOOST)
        self.assertEqual(promotion.keywords, "kente wedding gifts")
