"""Staff reads of third-party riders' money (wallets Plan 5, Task 7): wallets.view only (Accountant, Super Admin), never a
whole account number; 409 ledger_off while the ledger is off. Review Focus 5."""
from datetime import timedelta

from django.db import transaction
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from accounts.serializers import mask_but_last
from accounts.testing import make_staff, staff_token
from delivery.models import RiderEarning
from ledger import riders
from ledger.tests import rider_helpers
from wallets import withdrawals

from .helpers import MOMO_NUMBER, destination


@override_settings(LEDGER_ENABLED=True)
class StaffRiderWalletTests(TestCase):
    def setUp(self):
        self.swift = rider_helpers.rider()
        self.yesterday = timezone.now() - timedelta(days=1)
        rider_helpers.earning(self.swift, gross=1000, at=self.yesterday)                    # 900 + 100, posted below
        rider_helpers.earning(self.swift, gross=2000, at=timezone.now())                    # 1800 + 200, held today
        riders.post_commission(today=timezone.localdate())
        self.accountant = self.client_for(make_staff("accountant", "acc@example.com"))
        self.manager = self.client_for(make_staff("delivery_manager", "dm@example.com"))

    def client_for(self, staff):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
        return client

    def test_review_focus_staff_see_rider_balances_with_wallets_view_only(self):
        response = self.accountant.get("/api/wallet/staff/wallets/", {"kind": "rider"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["results"], [{
            "holder_id": self.swift.staff_id, "rider_id": self.swift.pk, "name": "Kojo Mensah",
            "company_name": "Swift Riders Ltd", "employment": "third_party", "balance": "27.00", "reserve": "2.00",
        }])
        self.assertEqual(self.manager.get("/api/wallet/staff/wallets/", {"kind": "rider"}).status_code, 403)
        self.assertEqual(self.accountant.get("/api/wallet/staff/wallets/", {"kind": "drivers"}).status_code, 400)

    def test_an_ashantihub_own_rider_is_not_listed_as_a_rider_wallet(self):
        rider_helpers.rider("own@example.com", name="Yaw Own", phone="+233244000009", third_party=False)
        rows = self.accountant.get("/api/wallet/staff/wallets/", {"kind": "rider"}).json()["results"]
        self.assertEqual([row["name"] for row in rows], ["Kojo Mensah"])

    def test_support_and_customers_and_owners_cannot_read_the_commission_report(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200990077", password_hash="x")
        owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207990077", password_hash="x")
        for client in (
            self.client_for(make_staff("support", "sup@example.com")), self.client_for(make_staff("delivery_manager", "dm2@example.com")),
        ):
            self.assertEqual(client.get("/api/delivery/rider-commission/").status_code, 403)
        for account, kind in ((customer, "customer"), (owner, "business_owner")):
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")
            self.assertEqual(client.get("/api/delivery/rider-commission/").status_code, 403)
            self.assertEqual(client.get(f"/api/delivery/riders/{self.swift.pk}/wallet/").status_code, 403)
        self.assertEqual(self.client_for(make_staff("support", "sup2@example.com")).get(f"/api/delivery/riders/{self.swift.pk}/wallet/").status_code, 403)

    def test_one_riders_wallet_lists_their_withdrawals_with_the_number_masked(self):
        rider_helpers.ghana_card(self.swift)
        to_swift = destination(self.swift.staff, name="Kojo Mensah")
        with transaction.atomic():
            withdrawals.request(self.swift.staff, destination_id=to_swift.pk, amount_pesewas=500, request_id="req-swift-0002")
        response = self.accountant.get(f"/api/delivery/riders/{self.swift.pk}/wallet/")
        body = response.json()
        self.assertEqual(len(body["withdrawals"]), 1)
        row = body["withdrawals"][0]
        self.assertEqual((row["holder_type"], row["holder_name"], row["amount"]), ("staff", "Kojo Mensah", "5.00"))
        self.assertEqual(row["destination"]["account_number_masked"], mask_but_last(MOMO_NUMBER))
        self.assertEqual(row["destination"]["account_number_masked"], "••••••••34567")
        self.assertNotIn(MOMO_NUMBER, response.content.decode())
        self.assertNotIn("1234567", response.content.decode())

    def test_an_ashantihub_own_rider_has_no_wallet_to_read(self):
        own = rider_helpers.rider("own2@example.com", name="Yaw Own", phone="+233244000008", third_party=False)
        response = self.accountant.get(f"/api/delivery/riders/{own.pk}/wallet/")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "wallet_disabled"))

    def test_the_withdrawals_queue_costs_the_same_queries_for_more_staff_holders(self):
        def sent(rider, n):
            rider_helpers.ghana_card(rider)
            to = destination(rider.staff, name=rider.staff.full_name)
            rider_helpers.earning(rider, gross=2000, at=self.yesterday)
            with transaction.atomic():
                withdrawals.request(rider.staff, destination_id=to.pk, amount_pesewas=500, request_id=f"req-pin-{n:05d}")

        def count():
            with CaptureQueriesContext(connection) as ctx:
                self.assertEqual(self.accountant.get("/api/wallet/staff/withdrawals/", {"status": "all"}).status_code, 200)
            return len(ctx)
        sent(self.swift, 1)
        count()                                                                              # warm one-off queries
        one = count()
        for n, (email, name) in enumerate((("b@example.com", "Ama Boateng"), ("c@example.com", "Esi Mensah")), start=2):
            sent(rider_helpers.rider(email, name=name, phone=f"+23324400010{n}"), n)
        self.assertEqual(count(), one)

    def test_the_withdrawals_queue_names_the_rider_and_masks_the_number(self):
        rider_helpers.ghana_card(self.swift)
        to_swift = destination(self.swift.staff, name="Kojo Mensah")
        with transaction.atomic():
            withdrawals.request(self.swift.staff, destination_id=to_swift.pk, amount_pesewas=500, request_id="req-swift-0001")
        response = self.accountant.get("/api/wallet/staff/withdrawals/", {"status": "all"})
        row = response.json()["results"][0]
        self.assertEqual((row["holder_type"], row["holder_name"]), ("staff", "Kojo Mensah"))
        self.assertNotIn("1234567", response.content.decode())

    def test_one_riders_wallet_and_a_days_commission(self):
        mine = self.accountant.get(f"/api/delivery/riders/{self.swift.pk}/wallet/")
        self.assertEqual(mine.status_code, 200, mine.content)
        body = mine.json()
        self.assertEqual((body["rider"]["name"], body["balance"], body["reserve"]), ("Kojo Mensah", "27.00", "2.00"))
        self.assertEqual(len(body["earnings"]), 2)
        self.assertEqual(body["days"][0]["commission"], "1.00")
        self.assertEqual(self.manager.get(f"/api/delivery/riders/{self.swift.pk}/wallet/").status_code, 403)
        day = self.accountant.get("/api/delivery/rider-commission/", {"day": timezone.localdate(self.yesterday).isoformat()}).json()
        self.assertEqual(day["totals"], {"deliveries": 1, "gross": "10.00", "commission": "1.00", "net": "9.00", "given_back": "0.00"})
        self.assertEqual([(row["name"], row["company_name"]) for row in day["results"]], [("Kojo Mensah", "Swift Riders Ltd")])
        default = self.accountant.get("/api/delivery/rider-commission/").json()
        self.assertEqual(default["day"], (timezone.localdate() - timedelta(days=1)).isoformat())
        self.assertEqual(self.accountant.get("/api/delivery/rider-commission/", {"day": "yesterday"}).status_code, 400)

    def test_a_day_shows_the_commission_given_back_after_a_full_refund(self):
        RiderEarning.objects.filter(rider=self.swift, earned_on=timezone.localdate(self.yesterday)).update(reversed_at=timezone.now())
        day = self.accountant.get("/api/delivery/rider-commission/", {"day": timezone.localdate(self.yesterday).isoformat()}).json()
        self.assertEqual((day["results"][0]["commission"], day["results"][0]["given_back"], day["totals"]["given_back"]), ("1.00", "1.00", "1.00"))
        wallet = self.accountant.get(f"/api/delivery/riders/{self.swift.pk}/wallet/").json()
        self.assertEqual((wallet["days"][0]["commission"], wallet["days"][0]["given_back"]), ("1.00", "1.00"))

    def test_with_the_ledger_off_staff_reads_answer_ledger_off(self):
        with override_settings(LEDGER_ENABLED=False):
            for url in (
                "/api/wallet/staff/wallets/?kind=rider", f"/api/delivery/riders/{self.swift.pk}/wallet/",
                "/api/delivery/rider-commission/",
            ):
                response = self.accountant.get(url)
                self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"), url)

    def test_the_rider_list_costs_the_same_queries_for_more_riders(self):
        def count():
            with CaptureQueriesContext(connection) as ctx:
                self.assertEqual(self.accountant.get("/api/wallet/staff/wallets/", {"kind": "rider"}).status_code, 200)
            return len(ctx)
        one = count()
        other = rider_helpers.rider("ama@example.com", name="Ama Boateng", phone="+233244000003")
        rider_helpers.earning(other, gross=1000, at=self.yesterday)
        riders.post_commission(today=timezone.localdate())
        self.assertEqual(count(), one)
