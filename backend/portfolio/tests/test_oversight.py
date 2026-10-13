from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from billing.models import Transaction
from disputes.models import Dispute
from fraud.models import FraudFlag
from marketplace.tests.base import make_customer, make_order
from messaging.models import Conversation
from portfolio.tests.health_fixtures import add_listings, make_business, subscribe, subscribe_overdue

URL = "/api/portfolio/businesses/"


class OversightBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.scout = make_staff("scout", "efua@example.com")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss)}")


class BusinessListFilterTests(OversightBase):
    def test_kyc_suspended_and_flag_filters(self):
        live = make_business("Live Shop", manager=self.scout)
        waiting = make_business("Waiting Shop", kyc=BusinessOwner.PENDING)
        suspended = make_business("Suspended Shop", is_suspended=True, suspension_reason="Duplicate")
        unclaimed = make_business("No Login Shop", registration_channel="scout")
        flagged = make_business("Flagged Shop")
        FraudFlag.objects.create(kind="fake_business", title="Fake", business_owner=flagged, status=FraudFlag.OPEN, source="staff")
        names = lambda q: {row["business_name"] for row in self.client.get(f"{URL}?scope=all&{q}").json()["results"]}
        self.assertEqual(names("kyc=pending"), {"Waiting Shop"})
        self.assertEqual(names("kyc=suspended"), {"Suspended Shop"})
        self.assertIn("Live Shop", names("kyc=verified"))
        self.assertNotIn("Waiting Shop", names("kyc=verified"))
        self.assertEqual(names("flag=fraud"), {"Flagged Shop"})
        self.assertEqual(names("flag=no_login"), {"No Login Shop"})
        row = next(r for r in self.client.get(f"{URL}?scope=all&kyc=suspended").json()["results"])
        self.assertTrue(row["is_suspended"])
        self.assertEqual(row["suspension_reason"], "Duplicate")
        self.assertEqual(self.client.get(f"{URL}?scope=all&kyc=nonsense").status_code, 400)

    def test_open_dispute_flag(self):
        shop = make_business("Dispute Shop")
        listing = add_listings(shop, 1)[0]
        customer = make_customer()
        Dispute.objects.create(order=make_order(customer, listing), raised_by=customer, reason="other", description="x")
        make_business("Quiet Shop")
        rows = self.client.get(f"{URL}?scope=all&flag=dispute").json()["results"]
        self.assertEqual([r["business_name"] for r in rows], ["Dispute Shop"])


class BusinessCountsTests(OversightBase):
    def test_counts_cover_every_business_whatever_the_filters(self):
        make_business("Verified One")
        make_business("Waiting One", kyc=BusinessOwner.PENDING)
        make_business("Suspended One", is_suspended=True)
        make_business("Rejected One", kyc=BusinessOwner.REJECTED)
        overdue = make_business("Overdue One")
        subscribe_overdue(overdue, timezone.now() - timedelta(days=6))
        flagged = make_business("Flagged One")
        FraudFlag.objects.create(kind="fake_business", title="Fake", business_owner=flagged, status=FraudFlag.OPEN, source="staff")
        body = self.client.get(f"{URL}counts/").json()
        self.assertEqual(body["total"], 5)  # rejected is left out
        self.assertEqual(body["kyc_waiting"], 1)
        self.assertEqual(body["suspended"], 1)
        self.assertEqual(body["overdue"], 1)
        self.assertEqual(body["paused"], 0)
        self.assertEqual(body["fraud_open"], 1)
        self.assertEqual(body["fraud_open_names"], ["Flagged One"])
        self.assertEqual(body["live"], 3)  # verified and not suspended

    def test_a_scout_cannot_read_the_counts(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.scout)}")
        self.assertEqual(self.client.get(f"{URL}counts/").status_code, 403)


class BusinessExportTests(OversightBase):
    def test_csv_has_business_facts_only_and_is_recorded_as_not_personal(self):
        shop = make_business("Akosua Ntoma Kente", manager=self.scout)
        subscribe(shop)
        response = self.client.get(f"{URL}export/?scope=all")
        text = b"".join(response.streaming_content).decode("utf-8-sig")
        self.assertIn("Akosua Ntoma Kente", text)
        self.assertNotIn(shop.login_phone, text)
        self.assertNotIn("Owner", text.splitlines()[0])
        event = ActivityEvent.objects.get(verb="report.exported")
        self.assertEqual((event.after["kind"], event.after["personal_data"], event.after["rows"]), ("businesses", False, 1))


class BusinessOversightTests(OversightBase):
    @override_settings(PAYMENTS_PROVIDER="simulated")
    def test_sales_rating_disputes_conversations_and_payments(self):
        shop = make_business("Akosua Ntoma Kente", manager=self.scout)
        listing = add_listings(shop, 1)[0]
        customer = make_customer("Akua Boakye")
        order = make_order(customer, listing, total="450.00")
        make_order(customer, listing, total="999.00", status="pending")
        Dispute.objects.create(order=order, raised_by=customer, reason="quality_issue", description="Damaged", status=Dispute.RESOLVED, refund_amount="120.00", resolved_by=self.boss)
        Conversation.objects.create(business_owner=shop, subject="Plan question")
        Transaction.objects.create(business_owner=shop, amount="150.00", purpose="Premium subscription", reference="SUB-1")
        body = self.client.get(f"{URL}{shop.pk}/oversight/").json()
        self.assertTrue(body["payments_simulated"])
        self.assertEqual(Decimal(body["sales_month"]["amount"]), Decimal("450.00"))
        self.assertEqual(body["sales_month"]["orders"], 1)
        self.assertEqual(body["orders_total"], 1)
        self.assertEqual(body["orders"][0]["customer"], "Akua Boakye")
        self.assertIsNone(body["rating"]["average"])  # nobody rated: no 0.0
        self.assertEqual(body["open_disputes"], 0)
        self.assertEqual(body["disputes"][0]["refund_amount"], "120.00")
        self.assertEqual(body["disputes"][0]["resolved_by"], self.boss.full_name)
        self.assertEqual(body["conversations"][0]["subject"], "Plan question")
        self.assertEqual(body["payments"][0]["amount"], "150.00")
        for key in ("held", "settlement", "on_time"):
            self.assertFalse(any(key in k for k in body), key)

    def test_another_scouts_credentials_cannot_read_it(self):
        shop = make_business("Shop")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.scout)}")
        self.assertEqual(self.client.get(f"{URL}{shop.pk}/oversight/").status_code, 403)
