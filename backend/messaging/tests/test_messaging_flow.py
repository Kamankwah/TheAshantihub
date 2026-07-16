from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser

from messaging.models import Conversation, Message

CONVERSATIONS_URL = "/api/messaging/conversations/"
STAFF_URL = "/api/messaging/staff/"


class MessagingTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200666001", password_hash="x",
        )
        self.other_customer = Customer.objects.create(
            full_name="Yaw Buyer", phone="+233200666002", password_hash="x",
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207666001", password_hash="x",
        )
        self.support = StaffUser.objects.create(
            full_name="Support Person", email="support-msg@example.com", password_hash="x",
            role=Role.objects.get(name="support"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Marketing Person", email="marketing-msg@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )

    def _auth(self, account, kind):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")


class ConversationModelConstraintTests(MessagingTestsBase):
    def test_exactly_one_of_customer_or_business_owner_required(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Conversation.objects.create(customer=None, business_owner=None)

    def test_cannot_set_both_customer_and_business_owner(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Conversation.objects.create(customer=self.customer, business_owner=self.owner)

    def test_customer_only_is_valid(self):
        conversation = Conversation.objects.create(customer=self.customer)
        self.assertIsNone(conversation.business_owner)

    def test_business_owner_only_is_valid(self):
        conversation = Conversation.objects.create(business_owner=self.owner)
        self.assertIsNone(conversation.customer)


class ConversationCreateTests(MessagingTestsBase):
    def test_unauthenticated_cannot_start_conversation(self):
        response = self.client.post(CONVERSATIONS_URL, {"body": "Help please"}, format="json")
        self.assertEqual(response.status_code, 401)

    def test_customer_starts_conversation_with_first_message(self):
        self._auth(self.customer, "customer")
        response = self.client.post(
            CONVERSATIONS_URL, {"subject": "Order issue", "body": "Where is my order?"}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        conversation = Conversation.objects.get(customer=self.customer)
        self.assertEqual(conversation.status, Conversation.OPEN)
        self.assertEqual(conversation.messages.count(), 1)
        message = conversation.messages.first()
        self.assertEqual(message.sender_type, Message.CUSTOMER)
        self.assertEqual(message.body, "Where is my order?")

    def test_business_owner_starts_conversation_with_first_message(self):
        self._auth(self.owner, "business_owner")
        response = self.client.post(CONVERSATIONS_URL, {"body": "Need help with my listing."}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        conversation = Conversation.objects.get(business_owner=self.owner)
        self.assertEqual(conversation.messages.first().sender_type, Message.BUSINESS_OWNER)

    def test_subject_is_optional(self):
        self._auth(self.customer, "customer")
        response = self.client.post(CONVERSATIONS_URL, {"body": "Hi"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["subject"], "")

    def test_list_returns_only_own_conversations(self):
        Conversation.objects.create(customer=self.customer, subject="Mine")
        Conversation.objects.create(customer=self.other_customer, subject="Not mine")
        self._auth(self.customer, "customer")
        response = self.client.get(CONVERSATIONS_URL)
        self.assertEqual(response.status_code, 200, response.content)
        subjects = [c["subject"] for c in response.json()]
        self.assertIn("Mine", subjects)
        self.assertNotIn("Not mine", subjects)


class ConversationMessageReplyTests(MessagingTestsBase):
    def setUp(self):
        super().setUp()
        self.conversation = Conversation.objects.create(customer=self.customer, subject="Order issue")
        Message.objects.create(conversation=self.conversation, sender_type=Message.CUSTOMER, body="Initial message")

    def _reply_url(self, pk=None):
        return f"/api/messaging/conversations/{pk or self.conversation.id}/messages/"

    def test_owner_can_reply_within_own_conversation(self):
        self._auth(self.customer, "customer")
        response = self.client.post(self._reply_url(), {"body": "Follow-up message"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(self.conversation.messages.count(), 2)

    def test_reply_bumps_updated_at(self):
        original_updated_at = self.conversation.updated_at
        self._auth(self.customer, "customer")
        self.client.post(self._reply_url(), {"body": "Follow-up message"}, format="json")
        self.conversation.refresh_from_db()
        self.assertGreater(self.conversation.updated_at, original_updated_at)

    def test_other_customer_cannot_reply_to_someone_elses_conversation(self):
        self._auth(self.other_customer, "customer")
        response = self.client.post(self._reply_url(), {"body": "Sneaky"}, format="json")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.conversation.messages.count(), 1)

    def test_business_owner_cannot_reply_to_a_customer_conversation(self):
        self._auth(self.owner, "business_owner")
        response = self.client.post(self._reply_url(), {"body": "Sneaky"}, format="json")
        self.assertEqual(response.status_code, 404)


class StaffConversationQueueTests(MessagingTestsBase):
    def setUp(self):
        super().setUp()
        self.conversation = Conversation.objects.create(customer=self.customer, subject="Order issue")
        Message.objects.create(conversation=self.conversation, sender_type=Message.CUSTOMER, body="Where is my order?")

    def test_unauthenticated_is_401(self):
        response = self.client.get(STAFF_URL)
        self.assertEqual(response.status_code, 401)

    def test_without_messaging_manage_permission_is_403(self):
        self._auth(self.marketing, "staff")
        response = self.client.get(STAFF_URL)
        self.assertEqual(response.status_code, 403)

    def test_customer_cannot_access_staff_queue(self):
        self._auth(self.customer, "customer")
        response = self.client.get(STAFF_URL)
        self.assertEqual(response.status_code, 403)

    def test_support_role_sees_queue_with_needs_reply_true(self):
        self._auth(self.support, "staff")
        response = self.client.get(STAFF_URL)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertIn("results", data)
        row = next(r for r in data["results"] if r["id"] == self.conversation.id)
        self.assertTrue(row["needs_reply"])
        self.assertEqual(row["starter_name"], "Ama Buyer")

    def test_needs_reply_false_after_staff_reply(self):
        self._auth(self.support, "staff")
        reply = self.client.post(
            f"/api/messaging/staff/{self.conversation.id}/reply/", {"body": "We're looking into it."}, format="json",
        )
        self.assertEqual(reply.status_code, 201, reply.content)
        response = self.client.get(STAFF_URL)
        row = next(r for r in response.json()["results"] if r["id"] == self.conversation.id)
        self.assertFalse(row["needs_reply"])

    def test_needs_reply_true_again_after_customer_follows_up(self):
        self._auth(self.support, "staff")
        self.client.post(
            f"/api/messaging/staff/{self.conversation.id}/reply/", {"body": "We're looking into it."}, format="json",
        )
        self._auth(self.customer, "customer")
        self.client.post(
            f"/api/messaging/conversations/{self.conversation.id}/messages/",
            {"body": "Still waiting."}, format="json",
        )
        self._auth(self.support, "staff")
        response = self.client.get(STAFF_URL)
        row = next(r for r in response.json()["results"] if r["id"] == self.conversation.id)
        self.assertTrue(row["needs_reply"])

    def test_staff_reply_creates_staff_sender_message(self):
        self._auth(self.support, "staff")
        response = self.client.post(
            f"/api/messaging/staff/{self.conversation.id}/reply/", {"body": "We're on it."}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["sender_type"], "staff")
        self.conversation.refresh_from_db()
        self.assertEqual(self.conversation.messages.count(), 2)

    def test_staff_reply_without_permission_is_403(self):
        self._auth(self.marketing, "staff")
        response = self.client.post(
            f"/api/messaging/staff/{self.conversation.id}/reply/", {"body": "Nope"}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_staff_detail_view_returns_full_thread(self):
        self._auth(self.support, "staff")
        response = self.client.get(f"/api/messaging/staff/{self.conversation.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()["messages"]), 1)


GUEST_TOKEN = "guest-4f9a2b7c-1d3e-4a5b-8c6d-0e1f2a3b4c5d"
OTHER_GUEST_TOKEN = "guest-ffffffff-aaaa-bbbb-cccc-dddddddddddd"


class GuestConversationTests(MessagingTestsBase):
    """Anonymous guest support chat — a browser-generated guest_token stands
    in for an account (Conversation.guest_token). No sign-in is required to
    talk to support; the token scopes reads/replies exactly the way the
    account FK does for signed-in callers."""

    def _start_guest_conversation(self, token=GUEST_TOKEN, body="Hello from a guest"):
        return self.client.post(
            CONVERSATIONS_URL,
            {"body": body, "guest_token": token},
            format="json",
        )

    def test_guest_starts_conversation_without_account(self):
        response = self._start_guest_conversation()
        self.assertEqual(response.status_code, 201)
        conversation = Conversation.objects.get(pk=response.data["id"])
        self.assertEqual(conversation.guest_token, GUEST_TOKEN)
        self.assertIsNone(conversation.customer)
        self.assertIsNone(conversation.business_owner)
        self.assertEqual(conversation.messages.get().sender_type, Message.GUEST)

    def test_guest_list_is_scoped_to_their_token(self):
        self._start_guest_conversation()
        self._start_guest_conversation(token=OTHER_GUEST_TOKEN, body="Different guest")
        response = self.client.get(CONVERSATIONS_URL, {"guest_token": GUEST_TOKEN})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["messages"][0]["body"], "Hello from a guest")

    def test_guest_cannot_reply_in_another_guests_conversation(self):
        created = self._start_guest_conversation()
        response = self.client.post(
            f"{CONVERSATIONS_URL}{created.data['id']}/messages/",
            {"body": "sneaky", "guest_token": OTHER_GUEST_TOKEN},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_guest_reply_in_own_conversation(self):
        created = self._start_guest_conversation()
        response = self.client.post(
            f"{CONVERSATIONS_URL}{created.data['id']}/messages/",
            {"body": "follow-up", "guest_token": GUEST_TOKEN},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["sender_type"], "guest")

    def test_short_guest_token_rejected(self):
        # DRF reports a permission denial as 401 (not 403) when the caller
        # is anonymous — same shape the no-token test above asserts.
        response = self._start_guest_conversation(token="short")
        self.assertEqual(response.status_code, 401)

    def test_staff_queue_shows_guest_starter_name(self):
        self._start_guest_conversation()
        self._auth(self.support, "staff")
        response = self.client.get(STAFF_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["starter_name"], "Guest")

    def test_staff_can_reply_to_guest_conversation(self):
        created = self._start_guest_conversation()
        self._auth(self.support, "staff")
        response = self.client.post(
            f"/api/messaging/staff/{created.data['id']}/reply/",
            {"body": "Hello Guest, how can we help?"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    def test_staff_session_cannot_use_customer_endpoint(self):
        self._auth(self.support, "staff")
        response = self.client.post(CONVERSATIONS_URL, {"body": "hi"}, format="json")
        self.assertEqual(response.status_code, 403)
