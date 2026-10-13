"""The note-leak contract: an internal note or a timeline event written by Support
must never reach a customer, a business owner or a guest, through any endpoint."""

import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from messaging import services
from messaging.models import Conversation, Message, SupportSettings

SECRET = "INTERNAL-ONLY-secret-note"
GUEST = "g" * 36


class NoteLeakContract(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(full_name="Ama Buyer", phone="+233200777001", password_hash="x")
        self.owner = BusinessOwner.objects.create(full_name="Kofi Trader", login_phone="+233207777001", password_hash="x")
        self.agent = StaffUser.objects.create(
            full_name="Esi Nyarko", email="esi-leak@example.com", password_hash="x", role=Role.objects.get(name="support"),
        )
        self.threads = {
            "customer": Conversation.objects.create(customer=self.customer),
            "owner": Conversation.objects.create(business_owner=self.owner),
            "guest": Conversation.objects.create(guest_token=GUEST),
        }
        for conversation in self.threads.values():
            Message.objects.create(conversation=conversation, sender_type=Message.CUSTOMER, body="Hello")
            Message.objects.create(
                conversation=conversation, sender_type=Message.STAFF, kind=Message.NOTE, body=SECRET, author=self.agent,
            )
            Message.objects.create(
                conversation=conversation, sender_type=Message.STAFF, kind=Message.EVENT, body=SECRET + " event",
            )
            Message.objects.create(conversation=conversation, sender_type=Message.STAFF, body="Public reply", author=self.agent)

    def _as(self, who):
        if who == "customer":
            self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        elif who == "owner":
            self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        else:
            self.client.credentials()

    def _assert_clean(self, response):
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn("INTERNAL-ONLY", response.content.decode())
        self.assertNotIn("is_internal", response.content.decode())
        self.assertNotIn("author", response.content.decode())

    def test_list_endpoint_hides_notes_from_every_non_staff_caller(self):
        for who in ("customer", "owner", "guest"):
            self._as(who)
            response = self.client.get("/api/messaging/conversations/", {"guest_token": GUEST} if who == "guest" else {})
            self._assert_clean(response)
            bodies = [m["body"] for c in response.json() for m in c["messages"]] if isinstance(response.json(), list) else [
                m["body"] for c in response.json()["results"] for m in c["messages"]
            ]
            self.assertEqual(sorted(bodies), ["Hello", "Public reply"], who)

    def test_create_response_never_includes_a_note(self):
        self._as("customer")
        response = self.client.post("/api/messaging/conversations/", {"subject": "x", "body": "Hi"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("INTERNAL-ONLY", response.content.decode())

    def test_staff_detail_includes_notes_and_events_with_their_kind(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.agent, 'staff')}")
        response = self.client.get(f"/api/messaging/staff/{self.threads['customer'].pk}/")
        self.assertEqual(response.status_code, 200)
        kinds = [m["kind"] for m in response.json()["messages"]]
        self.assertEqual(kinds, ["message", "note", "event", "message"])
        self.assertTrue(response.json()["messages"][1]["is_internal"])

    def test_staff_list_needs_reply_ignores_notes(self):
        conversation = Conversation.objects.create(customer=self.customer)
        Message.objects.create(conversation=conversation, sender_type=Message.CUSTOMER, body="q")
        Message.objects.create(conversation=conversation, sender_type=Message.STAFF, body="a", author=self.agent)
        Message.objects.create(conversation=conversation, sender_type=Message.STAFF, kind=Message.NOTE, body="n", author=self.agent)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.agent, 'staff')}")
        rows = self.client.get("/api/messaging/staff/").json()["results"]
        row = next(r for r in rows if r["id"] == conversation.pk)
        self.assertFalse(row["needs_reply"])

    def test_a_note_can_never_be_saved_as_a_public_message(self):
        note = Message.objects.create(conversation=self.threads["customer"], sender_type=Message.STAFF, kind=Message.NOTE, body="n")
        self.assertTrue(note.is_internal)
        self.assertFalse(note.is_public)
        event = Message.objects.create(conversation=self.threads["customer"], sender_type=Message.STAFF, kind=Message.EVENT, body="e")
        self.assertTrue(event.is_internal)


class SupportFoundationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(full_name="Ama Buyer", phone="+233200777002", password_hash="x")
        self.agent = StaffUser.objects.create(
            full_name="Esi Nyarko", email="esi-found@example.com", password_hash="x", role=Role.objects.get(name="support"),
        )

    def test_about_ids_are_context_only_and_bad_ids_are_dropped(self):
        from listings.models import Category, Listing, Zone

        owner = BusinessOwner.objects.create(full_name="Kofi Trader", login_phone="+233207777002", password_hash="x")
        Listing.objects.create(
            business_owner=owner, status=Listing.PUBLISHED, name="Stole", description="d", price_amount=10,
            category=Category.objects.filter(kind="product").first(), zone=Zone.objects.first(), contact_phone="+233207777999",
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        response = self.client.post(
            "/api/messaging/conversations/",
            {"subject": "About a shop", "body": "Hi", "about_business": owner.pk, "about_order": 999999, "source": "listing_page"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        conversation = Conversation.objects.get(pk=response.json()["id"])
        self.assertEqual(conversation.about_business, owner)
        self.assertIsNone(conversation.about_order)
        self.assertEqual(conversation.source, "listing_page")
        self.assertNotIn("about_business", response.json())
        self.assertIsNotNone(conversation.first_reply_due)
        self.assertIsNotNone(conversation.resolve_due)

    def test_guest_thread_source_is_guest_chat(self):
        response = APIClient().post(
            "/api/messaging/conversations/", {"body": "Hi", "guest_token": GUEST}, format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Conversation.objects.get(pk=response.json()["id"]).source, "guest_chat")

    def test_first_staff_reply_stamps_first_reply_at_once(self):
        conversation = Conversation.objects.create(customer=self.customer)
        Message.objects.create(conversation=conversation, sender_type=Message.CUSTOMER, body="Hi")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.agent, 'staff')}")
        self.assertEqual(self.client.post(f"/api/messaging/staff/{conversation.pk}/reply/", {"body": "one"}, format="json").status_code, 201)
        conversation.refresh_from_db()
        first = conversation.first_reply_at
        self.assertIsNotNone(first)
        self.client.post(f"/api/messaging/staff/{conversation.pk}/reply/", {"body": "two"}, format="json")
        conversation.refresh_from_db()
        self.assertEqual(conversation.first_reply_at, first)
        self.assertEqual(Message.objects.filter(conversation=conversation, author=self.agent).count(), 2)

    def test_business_hours_clock_skips_closed_time(self):
        settings = SupportSettings.load()
        tz = timezone.get_current_timezone()
        # 2026-10-10 is a Saturday (open, 08:00-20:00); 2026-10-11 is Sunday (closed).
        start = datetime.datetime(2026, 10, 10, 19, 30, tzinfo=tz)
        due = services.add_business_minutes(start, 60, settings)
        self.assertEqual(timezone.localtime(due, tz), datetime.datetime(2026, 10, 12, 8, 30, tzinfo=tz))

    def test_desk_counts(self):
        now = timezone.now()
        mine = Conversation.objects.create(customer=self.customer, assignee=self.agent)
        Conversation.objects.create(customer=self.customer)
        Conversation.objects.create(customer=self.customer, snoozed_until=now + datetime.timedelta(hours=2))
        Conversation.objects.create(customer=self.customer, status=Conversation.CLOSED)
        Conversation.objects.filter(pk=mine.pk).update(first_reply_due=now - datetime.timedelta(minutes=5))
        counts = services.desk_counts(self.agent, now)
        self.assertEqual(counts, {"mine": 1, "unassigned": 1, "all_open": 2, "past_limit": 1, "snoozed": 1})

    def test_support_role_permissions(self):
        perms = self.agent.effective_permission_codenames()
        self.assertIn("calls.view_peers", perms)
        self.assertIn("orders.support_update", perms)
        self.assertNotIn("orders.manage_delivery", perms)
        self.assertNotIn("support.limits", perms)
        ops = Role.objects.get(name="operations").permissions.values_list("codename", flat=True)
        self.assertIn("support.limits", ops)


class AboutLinkScopeTests(TestCase):
    """The about_* ids are staff context, so a caller can only name records they may see."""

    def setUp(self):
        from listings.models import Category, Listing, Zone
        from orders.models import Order, OrderItem

        self.me = Customer.objects.create(full_name="Me", phone="+233200888001", password_hash="x")
        self.other = Customer.objects.create(full_name="Other", phone="+233200888002", password_hash="x")
        self.owner = BusinessOwner.objects.create(full_name="Owner A", login_phone="+233207888001", password_hash="x")
        self.owner2 = BusinessOwner.objects.create(full_name="Owner B", login_phone="+233207888002", password_hash="x")
        fields = dict(name="Stole", description="d", category=Category.objects.filter(kind="product").first(), price_amount=10, zone=Zone.objects.first(), contact_phone="+233207888999")
        self.listing = Listing.objects.create(business_owner=self.owner, status=Listing.PUBLISHED, **fields)
        self.draft = Listing.objects.create(business_owner=self.owner2, status=Listing.DRAFT, **fields)
        self.my_order = Order.objects.create(customer=self.me, total_amount=10)
        self.other_order = Order.objects.create(customer=self.other, total_amount=10)
        for order in (self.my_order, self.other_order):
            OrderItem.objects.create(order=order, listing=self.listing, quantity=1, unit_price=10, line_total=10)

    def _post(self, account=None, kind=None, **extra):
        client = APIClient()
        if account:
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")
        else:
            extra["guest_token"] = GUEST
        response = client.post("/api/messaging/conversations/", {"body": "Hi", **extra}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return Conversation.objects.get(pk=response.json()["id"])

    def test_customer_links_own_order_but_not_anothers(self):
        self.assertEqual(self._post(self.me, "customer", about_order=self.my_order.pk).about_order, self.my_order)
        self.assertIsNone(self._post(self.me, "customer", about_order=self.other_order.pk).about_order)

    def test_guest_order_link_is_dropped(self):
        self.assertIsNone(self._post(about_order=self.my_order.pk).about_order)

    def test_listing_must_be_published_for_customers_and_guests(self):
        self.assertEqual(self._post(self.me, "customer", about_listing=self.listing.pk).about_business, self.owner)
        self.assertIsNone(self._post(self.me, "customer", about_listing=self.draft.pk).about_listing)
        self.assertIsNone(self._post(about_listing=self.draft.pk).about_listing)
        self.assertIsNone(self._post(self.me, "customer", about_business=self.owner2.pk).about_business)

    def test_owner_links_only_their_own_business_listing_and_orders(self):
        convo = self._post(self.owner, "business_owner", about_business=self.owner2.pk, about_listing=self.draft.pk)
        self.assertIsNone(convo.about_business)
        self.assertIsNone(convo.about_listing)
        convo = self._post(self.owner, "business_owner", about_business=self.owner.pk, about_order=self.my_order.pk)
        self.assertEqual(convo.about_business, self.owner)
        self.assertEqual(convo.about_order, self.my_order)
        self.assertIsNone(self._post(self.owner2, "business_owner", about_order=self.my_order.pk).about_order)
