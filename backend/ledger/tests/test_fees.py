from django.test import SimpleTestCase, TestCase

from accounts.models import BusinessOwner
from ledger import fees
from ledger.models import FeeBand, FeeRuleSet

PRODUCT = [
    {"lower": 0, "upper": 9999, "percent_bp": 100, "flat": None},
    {"lower": 10000, "upper": 49999, "percent_bp": None, "flat": 500},
    {"lower": 50000, "upper": 4999999, "percent_bp": 100, "flat": None},
    {"lower": 5000000, "upper": None, "percent_bp": None, "flat": 50000},
]


def as_bands(spec):
    return [FeeBand(lower_pesewas=b["lower"], upper_pesewas=b["upper"], percent_bp=b["percent_bp"], flat_pesewas=b["flat"]) for b in spec]


class BandFeeTests(SimpleTestCase):
    def fee(self, pesewas):
        return fees.band_fee(as_bands(PRODUCT), pesewas)

    def test_the_brief_tier_boundaries(self):
        self.assertEqual(self.fee(9999), 100)         # GHS 99.99  -> 1% = GHS 1.00
        self.assertEqual(self.fee(10000), 500)        # GHS 100.00 -> GHS 5.00 flat
        self.assertEqual(self.fee(49999), 500)        # GHS 499.99 -> GHS 5.00 flat
        self.assertEqual(self.fee(50000), 500)        # GHS 500.00 -> 1% = GHS 5.00
        self.assertEqual(self.fee(4999999), 50000)    # GHS 49,999.99 -> 1% = GHS 500.00
        self.assertEqual(self.fee(5000000), 50000)    # GHS 50,000.00 -> GHS 500 flat
        self.assertEqual(self.fee(12345678), 50000)   # far above: still GHS 500 flat

    def test_one_percent_rounds_half_up_to_the_pesewa(self):
        self.assertEqual(self.fee(150), 2)   # 1.5 pesewas -> 2
        self.assertEqual(self.fee(149), 1)   # 1.49 pesewas -> 1
        self.assertEqual(self.fee(0), 0)
        self.assertEqual(self.fee(1234), 12)

    def test_an_amount_with_no_band_raises(self):
        with self.assertRaises(fees.FeeError):
            fees.band_fee(as_bands(PRODUCT[1:]), 5)


class CapTests(SimpleTestCase):
    def test_no_cap_charges_the_full_fee(self):
        self.assertEqual(fees.apply_cap(500, None, 10**9), 500)

    def test_the_fee_that_crosses_the_cap_is_trimmed_to_the_remainder(self):
        self.assertEqual(fees.apply_cap(500, 1000, 700), 300)

    def test_nothing_is_charged_once_the_cap_is_reached_or_passed(self):
        self.assertEqual(fees.apply_cap(500, 1000, 1000), 0)
        self.assertEqual(fees.apply_cap(500, 1000, 1500), 0)


class ValidateBandsTests(SimpleTestCase):
    def test_the_brief_tiers_are_valid(self):
        fees.validate_bands(PRODUCT)

    def bad(self, spec):
        with self.assertRaises(fees.FeeError):
            fees.validate_bands(spec)

    def test_must_start_at_zero(self):
        self.bad([{"lower": 1, "upper": None, "percent_bp": 100, "flat": None}])

    def test_must_be_contiguous(self):
        self.bad([{"lower": 0, "upper": 99, "percent_bp": 100, "flat": None}, {"lower": 101, "upper": None, "percent_bp": 100, "flat": None}])

    def test_last_band_must_be_open_ended(self):
        self.bad([{"lower": 0, "upper": 99, "percent_bp": 100, "flat": None}])

    def test_only_the_last_band_may_be_open_ended(self):
        self.bad([{"lower": 0, "upper": None, "percent_bp": 100, "flat": None}, {"lower": 100, "upper": None, "percent_bp": 100, "flat": None}])

    def test_exactly_one_of_percent_or_flat(self):
        self.bad([{"lower": 0, "upper": None, "percent_bp": 100, "flat": 5}])
        self.bad([{"lower": 0, "upper": None, "percent_bp": None, "flat": None}])

    def test_percent_is_whole_basis_points_up_to_100_percent(self):
        self.bad([{"lower": 0, "upper": None, "percent_bp": 10001, "flat": None}])
        self.bad([{"lower": 0, "upper": None, "percent_bp": -1, "flat": None}])

    def test_empty_is_refused(self):
        self.bad([])

    def test_non_list_or_non_dict_bands_are_refused(self):
        for spec in ([1], ["x"], [None], "abc", {"a": 1}, 5, True):
            self.bad(spec)

    def test_amounts_above_the_ceiling_are_refused(self):
        big = fees.MAX_PESEWAS + 1
        self.bad([{"lower": 0, "upper": None, "percent_bp": None, "flat": big}])
        self.bad([{"lower": 0, "upper": big, "percent_bp": 1, "flat": None}, {"lower": big + 1, "upper": None, "percent_bp": 1, "flat": None}])

    def test_json_booleans_are_not_numbers(self):
        self.bad([{"lower": False, "upper": None, "percent_bp": 100, "flat": None}])
        self.bad([{"lower": 0, "upper": None, "percent_bp": True, "flat": None}])
        self.bad([{"lower": 0, "upper": None, "percent_bp": None, "flat": True}])
        self.bad([{"lower": 0, "upper": True, "percent_bp": 100, "flat": None}, {"lower": 2, "upper": None, "percent_bp": 100, "flat": None}])


class SeededDefaultsTests(TestCase):
    def test_each_category_has_the_brief_tiers_in_force(self):
        for category in ("product", "service", "event"):
            rule_set = fees.rule_set_in_force(category)
            self.assertIsNotNone(rule_set, category)
            self.assertEqual(fees.band_fee(list(rule_set.bands.all()), 10000), 500, category)
            self.assertEqual(fees.band_fee(list(rule_set.bands.all()), 5000000), 50000, category)

    def test_the_latest_rule_set_in_force_wins_and_a_future_one_waits(self):
        from datetime import timedelta

        from django.utils import timezone

        now = timezone.now()
        newer = FeeRuleSet.objects.create(category="product", effective_from=now - timedelta(hours=1))
        FeeBand.objects.create(rule_set=newer, lower_pesewas=0, upper_pesewas=None, percent_bp=200)
        later = FeeRuleSet.objects.create(category="product", effective_from=now + timedelta(days=1))
        FeeBand.objects.create(rule_set=later, lower_pesewas=0, upper_pesewas=None, percent_bp=300)
        self.assertEqual(fees.rule_set_in_force("product", now).pk, newer.pk)
        self.assertEqual(fees.rule_set_in_force("product", now + timedelta(days=2)).pk, later.pk)

    def test_quote_applies_band_then_cap(self):
        quote = fees.quote("product", 10000, cap=800, already_charged=500)
        self.assertEqual((quote.base, quote.computed, quote.charged), (10000, 500, 300))

    def test_charged_to_date_ignores_reversed_snapshots(self):
        from django.utils import timezone

        from orders.models import Order
        from accounts.models import Customer

        owner = BusinessOwner.objects.create(full_name="K", login_phone="+233207000002", password_hash="x")
        customer = Customer.objects.create(full_name="A", phone="+233200000002", password_hash="x")
        order = Order.objects.create(customer=customer, total_amount="10.00")
        rule_set = fees.rule_set_in_force("product")
        from ledger.models import OrderFeeSnapshot

        OrderFeeSnapshot.objects.create(order=order, business_owner=owner, category="product", rule_set=rule_set, base_pesewas=1000, computed_pesewas=10, charged_pesewas=10)
        OrderFeeSnapshot.objects.create(order=order, business_owner=owner, category="service", rule_set=rule_set, base_pesewas=1000, computed_pesewas=10, charged_pesewas=10, reversed_at=timezone.now())
        self.assertEqual(fees.charged_to_date(owner), 10)
