"""People lookup, Customer 360 and the profile audit, staff-started conversations.
The no-PII contract: nothing the Support desk may not see appears in any payload."""
import json
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from calls.models import CallLog
from disputes.models import Dispute
from fraud.models import FraudFlag
from marketplace.tests.base import make_customer, make_order
from messaging.models import Conversation, Message
from notifications.models import Notification
from orders.models import Order
from portfolio.tests.health_fixtures import add_listings, make_business, subscribe_overdue
from reviews.models import Review
from support import views

SECRETS = {
    "payout_bank_account_number": "9988776655443",
    "payout_bank_account_name": "SECRET BANK HOLDER",
    "payout_momo_number": "0551119999",
    "payout_momo_name": "SECRET MOMO HOLDER",
    "tin": "C0099887766",
    "ghana_card_number": "GHA-123456789-0",
}


class PeopleBase(TestCase):
    def setUp(self):
        self.support = make_staff("support", "esi@example.com")
        self.scout = make_staff("scout", "kwame@example.com")
        self.client = APIClient()
        self.sign_in(self.support)
        self.business = make_business("Akosua Ntoma Kente", phone="+233208450845")
        profile = self.business.profile
        profile.payout_bank_account_number = SECRETS["payout_bank_account_number"]
        profile.payout_bank_account_name = SECRETS["payout_bank_account_name"]
        profile.payout_momo_number = SECRETS["payout_momo_number"]
        profile.payout_momo_name = SECRETS["payout_momo_name"]
        profile.tin = SECRETS["tin"]
        profile.ghana_card_number = SECRETS["ghana_card_number"]
        profile.save()
        self.listing = add_listings(self.business, 1)[0]
        self.customer = make_customer("Yaw Mensah", address="12 Secret Street, Ahodwo")
        self.order = make_order(self.customer, self.listing, total="450.00")

    def sign_in(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def assert_no_pii(self, payload):
        text = json.dumps(payload, default=str)
        for value in SECRETS.values():
            self.assertNotIn(value, text)
        lowered = text.lower()
        for word in ("payout", "momo", "tin\"", "ghana_card", "password", "secret street", "address"):
            self.assertNotIn(word, lowered, word)
        self.assertNotIn(self.customer.phone, text)
        self.assertNotIn(self.business.login_phone, text)
        self.assertNotIn(self.customer.email, text)


class PermissionTests(PeopleBase):
    def test_roles_without_users_view_are_refused(self):
        from accounts.models import Role

        # delivery roles hold no users.view
        outsider = make_staff("dispatch", "rider@example.com")
        self.sign_in(outsider)
        for url in (
            "/api/support/staff/people/?q=yaw", "/api/support/staff/people/recent/",
            f"/api/support/staff/customers/{self.customer.pk}/360/", f"/api/support/staff/businesses/{self.business.pk}/360/",
        ):
            self.assertEqual(self.client.get(url).status_code, 403, url)
        self.assertEqual(self.client.post("/api/support/staff/profile-opened/", {"kind": "customer", "id": self.customer.pk}, format="json").status_code, 403)

    def test_starting_a_conversation_needs_messaging_manage(self):
        self.sign_in(make_staff("dispatch", "rider@example.com"))
        response = self.client.post(f"/api/support/staff/customers/{self.customer.pk}/start-conversation/", {"body": "Hi", "topic": "x"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_anonymous_is_refused(self):
        self.client.credentials()
        self.assertIn(self.client.get("/api/support/staff/people/?q=yaw").status_code, (401, 403))


class LookupTests(PeopleBase):
    def search(self, q, kind="all"):
        response = self.client.get("/api/support/staff/people/", {"q": q, "type": kind})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_name_search_finds_customers_and_businesses_with_masked_phones(self):
        rows = self.search("yaw")
        self.assertEqual([(r["kind"], r["name"]) for r in rows], [("customer", "Yaw Mensah")])
        self.assertRegex(rows[0]["phone"], r"^\d{3} \*\*\* \d{4}$")
        rows = self.search("akosua")
        self.assertEqual(rows[0]["kind"], "business")
        self.assertEqual(rows[0]["name"], "Akosua Ntoma Kente")
        self.assertEqual(rows[0]["area"], "Bantama")
        self.assertEqual(rows[0]["activity"], "1 listing live")
        self.assert_no_pii(rows)

    def test_order_number_finds_the_buyer_and_the_seller(self):
        rows = self.search(f"#{self.order.pk}")
        self.assertEqual({r["kind"] for r in rows}, {"customer", "business"})
        customer = next(r for r in rows if r["kind"] == "customer")
        self.assertEqual(customer["matched_order"], self.order.pk)

    def test_full_phone_search_works_but_the_result_stays_masked(self):
        rows = self.search(self.customer.phone)
        self.assertEqual(rows[0]["id"], self.customer.pk)
        self.assertNotIn(self.customer.phone, json.dumps(rows))
        self.assertEqual(self.search("0208450845")[0]["kind"], "business")

    def test_type_filter_and_short_queries(self):
        self.assertEqual(self.search("a", "all"), [])
        self.assertEqual(self.search("akosua", "customers"), [])
        self.assertEqual(self.search("yaw", "businesses"), [])
        self.assertEqual(self.client.get("/api/support/staff/people/?q=yaw&type=bogus").status_code, 400)

    def test_open_conversation_counts_and_status_chips_come_from_real_flags(self):
        Conversation.objects.create(customer=self.customer)
        Conversation.objects.create(customer=self.customer, status=Conversation.CLOSED)
        Conversation.objects.create(business_owner=self.business)
        Conversation.objects.create(customer=self.customer, about_business=self.business)
        self.assertEqual(self.search("yaw")[0]["open_conversations"], 2)
        self.assertEqual(self.search("yaw")[0]["status"], {"key": "active", "label": "Active"})
        Dispute.objects.create(order=self.order, raised_by=self.customer, reason="other", description="d")
        self.assertEqual(self.search("yaw")[0]["status"]["label"], "Open dispute")
        biz = self.search("akosua")[0]
        self.assertEqual(biz["open_conversations"], 2)
        # KYC-verified (address checked) but identity not approved: no verified chip.
        self.assertEqual(biz["status"], {"key": "active", "label": "Active"})
        self.business.profile.identity_status = "verified"
        self.business.profile.save()
        biz = self.search("akosua")[0]
        self.assertEqual(biz["status"]["label"], "Verified business")
        FraudFlag.objects.create(kind="other", status="open", source="staff", title="t", business_owner=self.business)
        self.assertEqual(self.search("akosua")[0]["status"]["label"], "Under Operations review")

    def test_business_360_verified_follows_identity_not_kyc(self):
        url = f"/api/support/staff/businesses/{self.business.pk}/360/"
        self.assertIs(self.client.get(url).json()["profile"]["verified"], False)   # KYC-verified, identity not approved
        self.business.profile.identity_status = "verified"
        self.business.profile.save()
        self.assertIs(self.client.get(url).json()["profile"]["verified"], True)

    def test_overdue_subscription_shows_its_day_and_suspension_wins(self):
        subscribe_overdue(self.business, timezone.now() - timezone.timedelta(days=3))
        self.assertTrue(self.search("akosua")[0]["status"]["label"].startswith("Subscription overdue"))
        self.business.is_suspended = True
        self.business.save()
        self.assertEqual(self.search("akosua")[0]["status"]["label"], "Suspended")

    def test_recents_come_from_conversations_and_calls(self):
        other = make_customer("Akua Boakye")
        Conversation.objects.create(customer=self.customer)
        CallLog.objects.create(
            staff=self.support, direction="in", counterpart_type="customer", counterpart_id=other.pk, purpose="order_question",
            outcome="connected", started_at=timezone.now(),
        )
        Conversation.objects.create(guest_token="g" * 36)  # a guest has no profile
        rows = self.client.get("/api/support/staff/people/recent/").json()
        self.assertEqual({r["name"] for r in rows}, {"Yaw Mensah", "Akua Boakye"})
        self.assert_no_pii(rows)

    def test_lookup_writes_nothing(self):
        before = ActivityEvent.objects.count()
        self.search("yaw")
        self.client.get("/api/support/staff/people/recent/")
        self.assertEqual(ActivityEvent.objects.count(), before)


class CustomerProfileTests(PeopleBase):
    def test_360_carries_kpis_orders_threads_calls_disputes_and_reviews(self):
        conv = Conversation.objects.create(customer=self.customer, about_order=self.order, subject="Order running late", priority="high")
        CallLog.objects.create(
            staff=self.support, direction="in", counterpart_type="customer", counterpart_id=self.customer.pk,
            purpose="order_question", outcome="connected", started_at=timezone.now(), duration_seconds=180, notes="asked about the charger",
        )
        Dispute.objects.create(order=self.order, raised_by=self.customer, reason="other", description="d")
        Review.objects.create(target_type=Review.LISTING, listing=self.listing, author=self.customer, rating=4, comment="Good")
        data = self.client.get(f"/api/support/staff/customers/{self.customer.pk}/360/").json()
        self.assertEqual(data["profile"]["name"], "Yaw Mensah")
        self.assertRegex(data["profile"]["phone"], r"\*\*\*")
        self.assertEqual(data["kpis"]["orders"], 1)
        self.assertEqual(data["kpis"]["order_value"], "450.00")
        self.assertEqual(data["kpis"]["open_conversations"], 1)
        self.assertEqual(data["kpis"]["calls"], 1)
        self.assertEqual(data["kpis"]["disputes"], 1)
        self.assertEqual((data["kpis"]["reviews"], data["kpis"]["pending_reviews"]), (1, 1))
        self.assertEqual(data["orders"][0]["from"], "Akosua Ntoma Kente")
        self.assertEqual(data["orders"][0]["total"], "450.00")
        self.assertEqual(data["conversations"][0]["id"], conv.pk)
        self.assertEqual(data["conversations"][0]["about"], f"Order #{self.order.pk}")
        self.assertEqual(data["calls"][0]["purpose"], "Order question")
        self.assertEqual(data["disputes"][0]["status"], "Open")
        self.assertEqual(data["reviews"][0]["target"], self.listing.name)
        self.assert_no_pii(data)

    def test_unpaid_orders_do_not_count_toward_value(self):
        make_order(self.customer, self.listing, status=Order.PENDING, total="99.00")
        data = self.client.get(f"/api/support/staff/customers/{self.customer.pk}/360/").json()
        self.assertEqual(data["kpis"]["order_value"], "450.00")
        self.assertEqual(data["kpis"]["orders"], 2)

    def test_calls_follow_the_call_log_visibility_rules(self):
        mate = make_staff("support", "mate@example.com")
        CallLog.objects.create(
            staff=mate, direction="in", counterpart_type="customer", counterpart_id=self.customer.pk, purpose="delivery",
            outcome="connected", started_at=timezone.now(),
        )
        data = self.client.get(f"/api/support/staff/customers/{self.customer.pk}/360/").json()
        # Support holds calls.view_peers, so a teammate's call shows; a scout's would not.
        self.assertEqual(data["kpis"]["calls"], 1)
        scout_call = CallLog.objects.create(
            staff=self.scout, direction="out", counterpart_type="customer", counterpart_id=self.customer.pk, purpose="other",
            outcome="connected", started_at=timezone.now(),
        )
        data = self.client.get(f"/api/support/staff/customers/{self.customer.pk}/360/").json()
        self.assertNotIn(scout_call.pk, [c["id"] for c in data["calls"]])

    def test_an_empty_customer_has_honest_zeroes(self):
        fresh = make_customer("New Person")
        data = self.client.get(f"/api/support/staff/customers/{fresh.pk}/360/").json()
        self.assertEqual(data["kpis"]["orders"], 0)
        self.assertEqual(data["kpis"]["order_value"], "0")
        self.assertIsNone(data["kpis"]["last_call_at"])
        self.assertEqual((data["orders"], data["conversations"], data["calls"], data["disputes"], data["reviews"]), ([], [], [], [], []))

    def test_unknown_customer_is_404_and_the_read_writes_nothing(self):
        self.assertEqual(self.client.get("/api/support/staff/customers/999999/360/").status_code, 404)
        before = ActivityEvent.objects.count()
        self.client.get(f"/api/support/staff/customers/{self.customer.pk}/360/")
        self.assertEqual(ActivityEvent.objects.count(), before)


class BusinessProfileTests(PeopleBase):
    def test_business_360_never_carries_payout_tax_or_card_details(self):
        manager = make_staff("scout", "am@example.com")
        self.business.account_manager = manager
        self.business.save()
        subscribe_overdue(self.business, timezone.now() - timezone.timedelta(days=2))
        Conversation.objects.create(business_owner=self.business, subject="Renewal")
        Conversation.objects.create(customer=self.customer, about_business=self.business)
        data = self.client.get(f"/api/support/staff/businesses/{self.business.pk}/360/").json()
        self.assertEqual(data["profile"]["name"], "Akosua Ntoma Kente")
        self.assertEqual(data["profile"]["account_manager"], manager.full_name)
        self.assertEqual(data["kpis"]["listings_live"], 1)
        self.assertEqual(data["kpis"]["conversations"], 2)
        self.assertEqual(data["subscription"]["state"], "overdue")
        self.assert_no_pii(data)

    def test_lookup_360_and_recents_never_leak_secrets_in_any_payload(self):
        blobs = [
            self.client.get("/api/support/staff/people/?q=akosua").json(),
            self.client.get(f"/api/support/staff/businesses/{self.business.pk}/360/").json(),
            self.client.get(f"/api/support/staff/customers/{self.customer.pk}/360/").json(),
            self.client.get("/api/support/staff/people/recent/").json(),
        ]
        for blob in blobs:
            self.assert_no_pii(blob)


class ProfileAuditTests(PeopleBase):
    def ping(self, kind="customer", pk=None):
        return self.client.post("/api/support/staff/profile-opened/", {"kind": kind, "id": pk or self.customer.pk}, format="json")

    def test_opening_a_profile_is_logged_once_per_hour_per_agent_and_profile(self):
        self.assertTrue(self.ping().json()["recorded"])
        self.assertFalse(self.ping().json()["recorded"])
        self.assertEqual(ActivityEvent.objects.filter(verb="support.profile_viewed").count(), 1)
        event = ActivityEvent.objects.get(verb="support.profile_viewed")
        self.assertEqual(event.target_type, "accounts.customer")
        self.assertEqual(event.target_id, str(self.customer.pk))
        self.assertEqual(event.target_label, "Yaw Mensah")
        self.assertEqual(event.actor_id, self.support.pk)
        # a different profile, and a different agent, each log their own
        self.assertTrue(self.ping("business", self.business.pk).json()["recorded"])
        other = make_staff("support", "other@example.com")
        self.sign_in(other)
        self.assertTrue(self.ping().json()["recorded"])
        self.assertEqual(ActivityEvent.objects.filter(verb="support.profile_viewed").count(), 3)

    def test_after_an_hour_it_logs_again(self):
        self.ping()
        # The window is an hour: shrink it so the first event is "older than an hour".
        with mock.patch.object(views, "PROFILE_AUDIT_WINDOW", timezone.timedelta(microseconds=1)):
            self.assertTrue(self.ping().json()["recorded"])

    def test_bad_input(self):
        self.assertEqual(self.client.post("/api/support/staff/profile-opened/", {"kind": "staff", "id": 1}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/support/staff/profile-opened/", {"kind": "customer", "id": "x"}, format="json").status_code, 400)
        self.assertEqual(self.ping(pk=999999).status_code, 404)

    def test_only_the_dedicated_event_is_written_not_a_request_log_row(self):
        self.ping()
        self.assertEqual(list(ActivityEvent.objects.values_list("verb", flat=True)), ["support.profile_viewed"])


class StartConversationTests(PeopleBase):
    def url(self, customer=None):
        return f"/api/support/staff/customers/{(customer or self.customer).pk}/start-conversation/"

    def start(self, **body):
        return self.client.post(self.url(), {"body": "Hello Yaw, we saw your order is late.", **body}, format="json")

    def test_starts_a_support_thread_about_an_order_and_notifies_the_customer(self):
        response = self.start(about_order=self.order.pk)
        self.assertEqual(response.status_code, 201, response.content)
        conv = Conversation.objects.get(pk=response.json()["id"])
        self.assertEqual((conv.customer_id, conv.source, conv.assignee_id, conv.about_order_id), (self.customer.pk, "staff_started", self.support.pk, self.order.pk))
        self.assertEqual(conv.subject, f"Order #{self.order.pk}")
        self.assertIsNotNone(conv.first_reply_at)
        message = conv.messages.get()
        self.assertEqual((message.sender_type, message.author_id, message.kind), (Message.STAFF, self.support.pk, Message.MESSAGE))
        note = Notification.objects.get(customer=self.customer)
        self.assertIn("Support", note.title)

    def test_about_a_business_or_a_topic(self):
        self.assertEqual(self.start(about_business=self.business.pk).status_code, 201)
        self.assertEqual(Conversation.objects.latest("pk").subject, "Akosua Ntoma Kente")
        self.assertEqual(self.start(topic="Your review").status_code, 201)

    def test_must_say_what_it_is_about_and_cannot_name_other_peoples_orders(self):
        self.assertEqual(self.start().status_code, 400)
        stranger = make_customer("Stranger")
        theirs = make_order(stranger, self.listing)
        self.assertEqual(self.start(about_order=theirs.pk).status_code, 400)
        self.assertEqual(self.start(about_business=999999).status_code, 400)
        self.assertEqual(self.client.post(self.url(), {"body": " ", "topic": "x"}, format="json").status_code, 400)
        self.assertEqual(Conversation.objects.count(), 0)

    def test_there_is_no_route_for_business_owners_or_guests(self):
        for path in (f"/api/support/staff/businesses/{self.business.pk}/start-conversation/", "/api/support/staff/guests/1/start-conversation/"):
            self.assertEqual(self.client.post(path, {"body": "x", "topic": "y"}, format="json").status_code, 404)
        self.assertEqual(self.client.post("/api/support/staff/customers/999999/start-conversation/", {"body": "x", "topic": "y"}, format="json").status_code, 404)

    def test_per_agent_hourly_cap(self):
        original = views.START_PER_HOUR
        views.START_PER_HOUR = 2
        try:
            self.assertEqual(self.start(topic="a").status_code, 201)
            self.assertEqual(self.start(topic="b").status_code, 201)
            self.assertEqual(self.start(topic="c").status_code, 429)
            # another agent has their own allowance
            self.sign_in(make_staff("support", "other@example.com"))
            self.assertEqual(self.start(topic="d").status_code, 201)
        finally:
            views.START_PER_HOUR = original

    def test_the_customer_sees_the_message_but_no_staff_internals(self):
        from accounts.authentication import issue_token

        self.start(topic="Hello")
        customer_client = APIClient()
        customer_client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        data = customer_client.get("/api/messaging/conversations/").json()
        text = json.dumps(data)
        self.assertIn("we saw your order is late", text)
        self.assertNotIn("is_internal", text)
        self.assertNotIn("assignee", text)
