"""The platform fees a business pays, as it sees them (vendor plan 4, Task 4): the approved tiers in force, the next
approved change, the cap, and a server-side quote. Review Focus 1 (customers and staff never see them)."""
from datetime import timedelta

from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from wallets import vendor
from ledger.models import FeeBand, FeeRuleSet, MoneySetting

from .vendor_helpers import VendorBase, paid_order, signed_in

FEES = "/api/wallet/vendor/fees/"
PRODUCT_LADDER = [
    {"from": "0.00", "to": "99.99", "percent": "1", "flat": None, "fee": "1%"},
    {"from": "100.00", "to": "499.99", "percent": None, "flat": "5.00", "fee": "GH₵ 5.00 flat"},
    {"from": "500.00", "to": "49999.99", "percent": "1", "flat": None, "fee": "1%"},
    {"from": "50000.00", "to": None, "percent": None, "flat": "500.00", "fee": "GH₵ 500.00 flat"},
]


class LedgerOffTests(VendorBase):
    def test_review_focus_the_fees_say_ledger_off(self):
        response = self.kofi.get(FEES)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))


@override_settings(LEDGER_ENABLED=True)
class FeeScheduleTests(VendorBase):
    def categories(self, params=None):
        response = self.kofi.get(FEES, params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json(), {category["category"]: category for category in response.json()["categories"]}

    def test_the_tiers_in_force_for_each_category(self):
        body, by_category = self.categories()
        self.assertEqual(list(by_category), ["product", "service", "event"])
        product = by_category["product"]
        self.assertEqual(
            (product["label"], product["applies_to"], product["charged"], product["bands"], product["next"]),
            ("Products", "Product orders", True, PRODUCT_LADDER, None),
        )
        self.assertIsNotNone(product["in_force_from"])
        self.assertIn("never on delivery", body["fee_base"])
        self.assertEqual(body["fee_cap"], {"limit": None, "used": "0.00", "remaining": None})
        self.assertNotIn("quote", body)

    def test_review_focus_an_approved_change_shows_with_its_start_and_a_proposal_waiting_does_not(self):
        starts = timezone.now() + timedelta(days=7)
        later = FeeRuleSet.objects.create(category=FeeRuleSet.PRODUCT, effective_from=starts)
        FeeBand.objects.create(rule_set=later, lower_pesewas=0, upper_pesewas=None, percent_bp=150)
        accountant = APIClient()
        accountant.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('accountant', 'fees@example.com'))}")
        proposed = accountant.post("/api/ledger/fees/", {
            "category": "service", "bands": [{"lower": 0, "upper": None, "percent_bp": 900, "flat": None}],
        }, format="json")
        self.assertEqual(proposed.status_code, 201, proposed.content)
        body, by_category = self.categories()
        upcoming = by_category["product"]["next"]
        self.assertEqual(upcoming["bands"], [{"from": "0.00", "to": None, "percent": "1.5", "flat": None, "fee": "1.5%"}])
        self.assertEqual(parse_datetime(upcoming["from"]), starts)
        self.assertEqual(by_category["product"]["bands"], PRODUCT_LADDER)                    # still today's ladder
        self.assertIsNone(by_category["service"]["next"])
        self.assertNotIn("9%", str(body))                                                    # a waiting proposal is never shown

    def test_review_focus_a_quote_counts_the_lifetime_cap(self):
        body, _ = self.categories({"amount": "120.00", "category": "product"})
        self.assertEqual(body["quote"], {"category": "product", "amount": "120.00", "fee": "5.00", "you_receive": "115.00", "charged": True})
        MoneySetting.objects.create(key="fee_cap_pesewas", value=700, effective_from=timezone.now() - timedelta(days=1))
        paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])                           # 5.00 of the 7.00 cap used
        body, _ = self.categories({"amount": "120.00"})
        self.assertEqual((body["quote"]["fee"], body["quote"]["you_receive"]), ("2.00", "118.00"))
        self.assertEqual(body["fee_cap"], {"limit": "7.00", "used": "5.00", "remaining": "2.00"})

    def test_bad_quote_input_is_refused(self):
        self.assertIn("amount", self.kofi.get(FEES, {"amount": "abc"}).json())
        self.assertEqual(self.kofi.get(FEES, {"amount": "0"}).status_code, 400)
        response = self.kofi.get(FEES, {"amount": "10", "category": "rides"})
        self.assertEqual((response.status_code, list(response.json())), (400, ["category"]))

    def test_review_focus_customers_and_staff_never_see_the_fees(self):
        support = APIClient()
        support.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('support', 'desk@example.com'))}")
        self.assertEqual(support.get(FEES).status_code, 403)
        self.assertEqual(signed_in(self.buyer, "customer").get(FEES).status_code, 403)
        self.assertEqual(signed_in(self.twin(), "customer").get(FEES, {"amount": "120"}).status_code, 403)

    def test_the_cap_used_is_the_businesss_own(self):
        MoneySetting.objects.create(key="fee_cap_pesewas", value=700, effective_from=timezone.now() - timedelta(days=1))
        paid_order(self.buyer, [(self.esi.listing("120.00"), 1)])                            # Esi's 5.00, not Kofi's
        twin = self.twin()
        self.assertEqual(self.kofi.get(FEES).json()["fee_cap"], {"limit": "7.00", "used": "0.00", "remaining": "7.00"})
        self.assertEqual(self.esi.get(FEES).json()["fee_cap"], {"limit": "7.00", "used": "5.00", "remaining": "2.00"})
        self.assertEqual(signed_in(twin, "customer").get(FEES).status_code, 403)

    def test_a_category_with_no_rules_in_force_has_no_tiers_and_no_quote(self):
        FeeRuleSet.objects.filter(category=FeeRuleSet.SERVICE).delete()
        body = self.kofi.get(FEES, {"amount": "100", "category": "service"}).json()
        service = {c["category"]: c for c in body["categories"]}["service"]
        self.assertEqual((service["in_force_from"], service["bands"], service["next"]), (None, [], None))
        self.assertIsNone(body["quote"])

    def test_a_version_starting_exactly_now_is_current_and_the_soonest_future_one_is_next(self):
        now = timezone.now()
        FeeRuleSet.objects.filter(category=FeeRuleSet.EVENT).delete()
        for offset, bp in ((0, 200), (3, 300), (9, 900), (6, 600)):                          # created out of order
            rules = FeeRuleSet.objects.create(category=FeeRuleSet.EVENT, effective_from=now + timedelta(days=offset))
            FeeBand.objects.create(rule_set=rules, lower_pesewas=0, upper_pesewas=None, percent_bp=bp)
        event = {c["category"]: c for c in vendor.fee_schedule(self.kofi.owner, now)["categories"]}["event"]
        self.assertEqual(event["bands"][0]["percent"], "2")
        self.assertEqual(event["in_force_from"], now)
        self.assertEqual((event["next"]["from"], event["next"]["bands"][0]["percent"]), (now + timedelta(days=3), "3"))

    def test_the_number_of_queries_does_not_grow_with_the_number_of_versions(self):
        def add(days):
            rules = FeeRuleSet.objects.create(category=FeeRuleSet.PRODUCT, effective_from=timezone.now() + timedelta(days=days))
            FeeBand.objects.create(rule_set=rules, lower_pesewas=0, upper_pesewas=None, percent_bp=100 + days)

        add(1)                                                                               # one change waiting: the baseline
        self.kofi.get(FEES)                                                                  # warm caches
        with CaptureQueriesContext(connection) as before:
            self.kofi.get(FEES)
        for days in range(2, 6):
            add(days)
        with self.assertNumQueries(len(before.captured_queries)):
            self.kofi.get(FEES)


@override_settings(LEDGER_ENABLED=True)
class ChargedCategoriesTests(VendorBase):
    """Plan 1b records services, stays and tickets in the ledger, so every category's fee is charged."""

    def test_products_services_and_events_are_all_charged(self):
        by_category = {c["category"]: c for c in self.kofi.get(FEES).json()["categories"]}
        self.assertEqual([by_category[c]["charged"] for c in ("product", "service", "event")], [True, True, True])
        self.assertEqual(vendor.charged_categories(), (FeeRuleSet.PRODUCT, FeeRuleSet.SERVICE, FeeRuleSet.EVENT))

    def test_a_service_or_event_quote_says_it_is_charged(self):
        for category in ("service", "event"):
            quote = self.kofi.get(FEES, {"amount": "120.00", "category": category}).json()["quote"]
            self.assertEqual((quote["category"], quote["charged"]), (category, True))
