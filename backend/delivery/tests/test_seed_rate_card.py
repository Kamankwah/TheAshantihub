from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase

from delivery.models import RateCard


class SeedDefaultRateCardTests(TestCase):
    def test_creates_one_live_card_with_the_suggested_figures(self):
        call_command("seed_default_rate_card")
        card = RateCard.objects.get(status=RateCard.LIVE)
        self.assertEqual(card.customer_base, Decimal("5.00"))
        self.assertEqual(card.customer_per_km, Decimal("1.50"))
        self.assertEqual(card.customer_min_fee, Decimal("8.00"))
        self.assertEqual(card.rider_per_job, Decimal("4.00"))
        self.assertEqual(card.rider_per_km, Decimal("1.00"))

    def test_running_it_twice_keeps_one_live_card(self):
        call_command("seed_default_rate_card")
        call_command("seed_default_rate_card")
        self.assertEqual(RateCard.objects.filter(status=RateCard.LIVE).count(), 1)
        self.assertEqual(RateCard.objects.count(), 1)

    def test_an_existing_live_card_is_left_alone(self):
        RateCard.objects.create(
            version=7, status=RateCard.LIVE, customer_base=1, customer_per_km=1, customer_min_fee=1, rider_per_job=1, rider_per_km=1,
        )
        call_command("seed_default_rate_card")
        self.assertEqual(RateCard.objects.count(), 1)
        self.assertEqual(RateCard.objects.get().version, 7)
