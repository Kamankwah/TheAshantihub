"""Chatbot intake: a Support conversation carrying the visitor's contact details.
No business attached, no automated answer; contact is visible to staff only."""

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff, staff_token
from messaging.models import Conversation, Message, SupportAgentState

URL = "/api/messaging/conversations/"
GUEST = "c" * 36
EMAIL = "visitor@example.com"


def payload(**over):
    data = {
        "subject": "Chat assistant", "body": "My order never arrived", "source": "chatbot",
        "contact_name": "Efua Visitor", "contact_email": EMAIL, "contact_phone": "024 555 3553",
        "guest_token": GUEST,
    }
    data.update(over)
    return {k: v for k, v in data.items() if v is not None}


class ChatbotIntakeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.agent = make_staff("support", "esi-bot@example.com")
        self.customer = Customer.objects.create(full_name="Yaw Mensah", phone="+233245553554", password_hash="x")
        self.owner = BusinessOwner.objects.create(full_name="Adwoa Pokuaa", login_phone="+233207111223", password_hash="x")

    def post(self, **over):
        return self.client.post(URL, payload(**over), format="json")

    def test_guest_chat_stores_contact_and_first_message(self):
        response = self.post()
        self.assertEqual(response.status_code, 201, response.content)
        conversation = Conversation.objects.get()
        self.assertEqual(conversation.source, "chatbot")
        self.assertEqual(conversation.guest_token, GUEST)
        self.assertEqual(
            (conversation.contact_name, conversation.contact_email, conversation.contact_phone),
            ("Efua Visitor", EMAIL, "+233245553553"),
        )
        message = Message.objects.get()
        self.assertEqual((message.body, message.sender_type), ("My order never arrived", Message.GUEST))

    def test_missing_email_or_phone_or_name_400_for_chatbot_source(self):
        for missing in ("contact_name", "contact_email", "contact_phone"):
            for blank in (None, "", "  "):
                data = payload()
                if blank is None:
                    del data[missing]
                else:
                    data[missing] = blank
                response = self.client.post(URL, data, format="json")
                self.assertEqual(response.status_code, 400, (missing, blank))
        self.assertEqual(self.post(contact_name="x" * 121).status_code, 400)

    def test_over_long_email_is_a_400_not_a_500(self):
        # The column holds 254 characters; a longer (still well-formed) address is refused by the serializer.
        long_email = "a" * 64 + "@" + ".".join(["b" * 60] * 4) + ".com"
        self.assertGreater(len(long_email), 254)
        response = self.post(contact_email=long_email)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("contact_email", response.json())
        self.assertFalse(Conversation.objects.exists())
        self.assertEqual(Conversation.objects.count(), 0)

    def test_invalid_email_rejected(self):
        self.assertEqual(self.post(contact_email="not-an-email").status_code, 400)

    def test_invalid_phone_rejected(self):
        self.assertEqual(self.post(contact_phone="12345").status_code, 400)
        self.assertEqual(Conversation.objects.count(), 0)

    def test_phone_normalised_to_plus233(self):
        for raw in ("0245553553", "245553553", "+233 24 555 3553", "233245553553"):
            Conversation.objects.all().delete()
            self.assertEqual(self.post(contact_phone=raw).status_code, 201, raw)
            self.assertEqual(Conversation.objects.get().contact_phone, "+233245553553", raw)

    def test_business_owner_chat_has_no_business_link_and_stays_support_only(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        response = self.post(guest_token=None, about_business=self.owner.pk)
        self.assertEqual(response.status_code, 201, response.content)
        conversation = Conversation.objects.get()
        self.assertEqual(conversation.business_owner, self.owner)
        self.assertIsNone(conversation.about_business)
        self.assertIsNone(conversation.about_listing)
        self.assertIsNone(conversation.about_order)
        self.assertEqual(Message.objects.get().sender_type, Message.BUSINESS_OWNER)

    def test_about_links_ignored_for_chatbot_source(self):
        owner = BusinessOwner.objects.create(full_name="Shop", login_phone="+233207111224", password_hash="x")
        response = self.post(about_business=owner.pk, about_listing=1, about_order=1)
        self.assertEqual(response.status_code, 201)
        conversation = Conversation.objects.get()
        self.assertIsNone(conversation.about_business)
        self.assertIsNone(conversation.about_listing)
        self.assertIsNone(conversation.about_order)

    def test_conversation_is_auto_assigned_or_queued_like_any_other(self):
        SupportAgentState.objects.all().delete()
        response = self.post()
        conversation = Conversation.objects.get(pk=response.json()["id"])
        # Either an agent took it or it is queued with a stated reason; the clocks are stamped either way.
        self.assertTrue(conversation.assignee_id or conversation.unassigned_reason)
        self.assertIsNotNone(conversation.first_reply_due)

    def test_staff_thread_shows_contact(self):
        conversation_id = self.post().json()["id"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.agent)}")
        detail = self.client.get(f"/api/messaging/staff/{conversation_id}/").json()
        self.assertEqual(
            detail["contact"], {"name": "Efua Visitor", "email": EMAIL, "phone": "+233245553553"},
        )
        rows = self.client.get("/api/messaging/staff/", {"scope": "all"}).json()["results"]
        self.assertEqual(next(r for r in rows if r["id"] == conversation_id)["contact"]["email"], EMAIL)

    def test_staff_row_without_contact_is_null(self):
        Conversation.objects.create(customer=self.customer)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.agent)}")
        rows = self.client.get("/api/messaging/staff/", {"scope": "all"}).json()["results"]
        self.assertIsNone(rows[0]["contact"])

    def test_customer_serializer_does_not_echo_other_parties(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        created = self.post(guest_token=None)
        self.assertEqual(created.status_code, 201, created.content)
        listed = self.client.get(URL)
        for response in (created, listed):
            text = response.content.decode()
            for secret in (EMAIL, "+233245553553", "Efua Visitor", "contact"):
                self.assertNotIn(secret, text)
        self.client.credentials()
        guest = self.post(guest_token="d" * 36)
        self.assertNotIn(EMAIL, guest.content.decode())
        self.assertNotIn("contact", guest.content.decode())
        self.assertNotIn(EMAIL, self.client.get(URL, {"guest_token": "d" * 36}).content.decode())

    def test_no_automated_message_created(self):
        self.post()
        self.assertEqual(Message.objects.count(), 1)

    def test_contact_fields_ignored_for_other_sources(self):
        self.post(source="app")
        conversation = Conversation.objects.get()
        self.assertEqual((conversation.contact_name, conversation.contact_email, conversation.contact_phone), ("", "", ""))
