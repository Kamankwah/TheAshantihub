"""Payout destinations (wallets plan 3b, Task 2; spec §8): name-checked, confirmed with a step-up code, usable after the
cooling period, never shown whole. Review Focus 6 (numbers leaking) and 8 (ledger off)."""
from datetime import timedelta

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from ashantihub.sentry import EXTRA_DENYLIST
from ledger.models import MoneySetting
from notifications.models import Notification
from otp import step_up
from wallets.models import PayoutDestination

from .helpers import MOMO_NUMBER, Holder, destination

URL = "/api/wallet/destinations/"
MOMO = {"rail": "momo", "institution": "MTN", "account_number": "024 123 4567"}


class DestinationBase(TestCase):
    def setUp(self):
        cache.clear()
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.ama = Holder(self.customer, "customer")

    def add(self, holder=None, body=MOMO, **kwargs):
        holder = holder or self.ama
        if "token" not in kwargs:
            kwargs["action"] = step_up.PAYOUT_DESTINATION
        return holder.post(URL, body, **kwargs)

    def kyc_vendor(self, **profile):
        owner = BusinessOwner.objects.create(
            full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x", kyc_status=BusinessOwner.VERIFIED,
        )
        BusinessOwnerProfile.objects.create(business_owner=owner, business_name="Adepa Ventures", **profile)
        return owner


class LedgerOffDestinationTests(DestinationBase):
    def test_review_focus_destinations_say_ledger_off(self):
        self.assertEqual(self.ama.get(URL).json()["code"], "ledger_off")
        response = self.add()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        self.assertFalse(PayoutDestination.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class DestinationTests(DestinationBase):
    def test_adding_needs_a_step_up_code_even_with_the_otp_switches_off(self):
        response = self.ama.post(URL, MOMO)
        self.assertEqual((response.status_code, response.json()["code"]), (403, "step_up_required"), response.content)
        self.assertFalse(PayoutDestination.objects.exists())

    def test_a_customer_adds_a_momo_number_in_their_own_name(self):
        response = self.add()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(
            (body["rail"], body["institution"], body["account_number_masked"], body["account_name"], body["name_check"], body["usable"]),
            ("momo", "MTN", "••••••••34567", "Ama Owusu", "simulated", False),
        )
        saved = PayoutDestination.objects.get()
        self.assertEqual((saved.account_number, saved.matched_name, saved.holder_type), (MOMO_NUMBER, "Ama Owusu", "customer"))
        self.assertAlmostEqual(saved.usable_from, timezone.now() + timedelta(hours=24), delta=timedelta(minutes=1))

    def test_a_name_that_does_not_match_is_refused_and_the_code_is_kept(self):
        token = self.ama.step_up(step_up.PAYOUT_DESTINATION)
        with override_settings(SIMULATED_ACCOUNT_NAMES={MOMO_NUMBER: "KOFI BOATENG"}):
            refused = self.ama.post(URL, MOMO, token=token)
        self.assertEqual((refused.status_code, refused.json()["code"]), (400, "name_mismatch"))
        self.assertNotIn("KOFI", refused.content.decode())                                       # never someone else's name
        again = self.ama.post(URL, {**MOMO, "account_number": "0241234568"}, token=token)
        self.assertEqual(again.status_code, 201, again.content)

    def test_a_vendor_needs_kyc_and_may_match_its_business_name(self):
        owner = BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x")
        kwame = Holder(owner, "business_owner")
        refused = self.add(kwame)
        self.assertEqual((refused.status_code, refused.json()["code"]), (409, "kyc_required"))
        owner.kyc_status = BusinessOwner.VERIFIED
        owner.save(update_fields=["kyc_status"])
        BusinessOwnerProfile.objects.create(business_owner=owner, business_name="Adepa Ventures")
        with override_settings(SIMULATED_ACCOUNT_NAMES={MOMO_NUMBER: "ADEPA VENTURES LTD"}):
            response = self.add(kwame)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(PayoutDestination.objects.get(holder_type="business_owner").matched_name, "Adepa Ventures")

    def test_a_vendor_may_copy_its_registered_payout_details(self):
        owner = self.kyc_vendor(default_payout_method="momo", payout_momo_network="mtn", payout_momo_number="0201112233")
        response = self.add(Holder(owner, "business_owner"), {"from_profile": True})
        self.assertEqual(response.status_code, 201, response.content)
        saved = PayoutDestination.objects.get()
        self.assertEqual((saved.rail, saved.institution, saved.account_number), ("momo", "MTN", "+233201112233"))
        owner.profile.refresh_from_db()
        self.assertEqual(owner.profile.payout_momo_number, "0201112233")                          # the registered details are untouched

    def test_bad_details_are_refused(self):
        cases = (
            {"rail": "card", "institution": "MTN", "account_number": "0241234567"},
            {"rail": "momo", "institution": "Vodafone", "account_number": "0241234567"},
            {"rail": "momo", "institution": "MTN", "account_number": "12345"},
            {"rail": "bank", "institution": "GCB Bank", "account_number": "12ab34"},
            {"rail": "bank", "institution": "", "account_number": "1234567890"},
            {"from_profile": True},
        )
        for body in cases:
            with self.subTest(body=body):
                response = self.add(body=body)
                self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(PayoutDestination.objects.exists())

    def test_a_bank_account_is_kept_as_digits(self):
        response = self.add(body={"rail": "bank", "institution": "GCB Bank", "account_number": "1234-5678-9012"})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["account_number_masked"], "•••••••89012")
        self.assertEqual(PayoutDestination.objects.get().account_number, "123456789012")

    def test_duplicates_and_more_than_five_are_refused(self):
        self.assertEqual(self.add().status_code, 201)
        self.assertEqual(self.add().json()["code"], "duplicate")
        for last in range(1, 5):
            self.assertEqual(self.add(body={**MOMO, "account_number": f"024123450{last}"}).status_code, 201)
        too_many = self.add(body={**MOMO, "account_number": "0241234509"})
        self.assertEqual((too_many.status_code, too_many.json()["code"]), (409, "too_many"))

    def test_removing_needs_a_code_and_only_your_own(self):
        mine = destination(self.customer)
        other = destination(Customer.objects.create(full_name="Kojo Asare", phone="+233241234568", password_hash="x"), name="Kojo Asare")
        self.assertEqual(self.ama.post(f"{URL}{mine.pk}/remove/").status_code, 403)
        self.assertEqual(self.ama.post(f"{URL}{other.pk}/remove/", action=step_up.PAYOUT_DESTINATION).status_code, 404)
        self.assertEqual(self.ama.post(f"{URL}{mine.pk}/remove/", action=step_up.PAYOUT_DESTINATION).status_code, 204)
        mine.refresh_from_db()
        self.assertIsNotNone(mine.removed_at)
        self.assertEqual(self.ama.get(URL).json()["results"], [])

    def test_review_focus_no_response_holds_a_whole_number(self):
        added = self.add()
        listed = self.ama.get(URL)
        for response in (added, listed):
            self.assertNotIn("241234567", response.content.decode())
        self.assertEqual(listed.json()["results"][0]["account_number_masked"], "••••••••34567")
        self.assertEqual(listed.json()["cooling_hours"], 24)
        self.assertNotIn("241234567", str(PayoutDestination.objects.get()))

    def test_the_holder_is_told_when_a_destination_is_added_or_removed(self):
        added = self.add()
        notice = Notification.objects.filter(customer=self.customer).latest("id")
        self.assertEqual((notice.kind, notice.title), ("payout_destination", "A payout destination was added"))
        self.assertIn("If this wasn't you", notice.body)
        self.assertNotIn("241234567", notice.body)
        removed = self.ama.post(f"{URL}{added.json()['id']}/remove/", action=step_up.PAYOUT_DESTINATION)
        self.assertEqual(removed.status_code, 204)
        self.assertEqual(Notification.objects.filter(customer=self.customer).latest("id").title, "A payout destination was removed")

    def test_the_cooling_period_is_the_governed_setting(self):
        MoneySetting.objects.create(key="payout_cooling_hours", value=1, effective_from=timezone.now() - timedelta(days=1))
        body = self.add().json()
        self.assertFalse(body["usable"])
        self.assertAlmostEqual(PayoutDestination.objects.get().usable_from, timezone.now() + timedelta(hours=1), delta=timedelta(minutes=1))

    @override_settings(PAYMENTS_PROVIDER="hubtel")
    def test_with_hubtel_names_cannot_be_checked_yet(self):
        response = self.add()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "name_check_unavailable"))

    def test_a_suspended_account_cannot_add_one(self):
        Customer.objects.filter(pk=self.customer.pk).update(is_suspended=True)
        response = self.add()
        self.assertEqual((response.status_code, response.json()["code"]), (403, "suspended"))


class SentryTests(SimpleTestCase):
    def test_sentry_filters_account_numbers(self):
        self.assertIn("account_number", EXTRA_DENYLIST)
