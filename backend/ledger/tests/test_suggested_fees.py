from django.test import TestCase
from django.utils import timezone

from ledger import fees


class SuggestedFeeTiersTests(TestCase):
    """Plan 7A T2: services and events get their own suggested ladders (the owner edits them); products keep theirs."""

    def charged(self, category, base):
        return fees.quote(category, base, cap=None, already_charged=0, at=timezone.now()).charged

    def test_service_ladder(self):
        self.assertEqual(self.charged("service", 30_000), 600)      # 2% under GH₵500
        self.assertEqual(self.charged("service", 100_000), 1_500)   # 1.5% from GH₵500
        self.assertEqual(self.charged("service", 600_000), 6_000)   # 1% from GH₵5,000

    def test_event_ladder(self):
        self.assertEqual(self.charged("event", 5_000), 150)         # 3% under GH₵100
        self.assertEqual(self.charged("event", 50_000), 1_250)      # 2.5%
        self.assertEqual(self.charged("event", 200_000), 4_000)     # 2%

    def test_products_keep_the_original_ladder(self):
        self.assertEqual(self.charged("product", 5_000), 50)        # 1%
        self.assertEqual(self.charged("product", 20_000), 500)      # flat GH₵5

    def test_the_ladders_are_complete_and_valid(self):
        for category in ("service", "event"):
            rule_set = fees.rule_set_in_force(category)
            bands = [{"lower": b.lower_pesewas, "upper": b.upper_pesewas, "percent_bp": b.percent_bp, "flat": b.flat_pesewas}
                     for b in rule_set.bands.all()]
            fees.validate_bands(bands)
