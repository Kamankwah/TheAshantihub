from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Customer, Role, StaffUser
from contact.models import ContactMessage, ContactReply
from notifications.models import Notification
from staff_tasks.models import Task

BASE = "/api/core/contact-messages/"


class SupportContactTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ops = StaffUser.objects.create(
            full_name="Ama Boateng", email="ops-lead-sc@example.com", password_hash="x",
            role=Role.objects.get(name="operations"),
        )
        self.support = StaffUser.objects.create(
            full_name="Esi Nyarko", email="support-sc@example.com", password_hash="x",
            role=Role.objects.get(name="support"), manager=self.ops,
        )
        self.marketing = StaffUser.objects.create(
            full_name="Mark Eting", email="mkt-sc@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )
        self.message = ContactMessage.objects.create(
            category=ContactMessage.SALES, name="Kwadwo Ampofo", email="kwadwo@example.com",
            phone="0245550731", subject="How do I join?", message="I sell shoes at Adum.",
        )

    def auth(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def test_support_list_masks_email_and_phone(self):
        self.auth(self.support)
        data = self.client.get(BASE).json()["results"][0]
        self.assertNotIn("kwadwo@example.com", str(data))
        self.assertNotIn("245550731", str(data))
        self.assertEqual(data["phone"], "024 *** 0731")
        self.assertTrue(data["email"].endswith("@example.com"))
        self.assertTrue(data["has_email"])

    def test_operations_still_sees_the_full_contact_details(self):
        self.auth(self.ops)
        data = self.client.get(BASE).json()["results"][0]
        self.assertEqual(data["email"], "kwadwo@example.com")

    def test_account_match_is_masked(self):
        Customer.objects.create(full_name="Kwadwo A", email="kwadwo@example.com", phone="+233245550731", password_hash="x")
        self.auth(self.support)
        account = self.client.get(BASE).json()["results"][0]["account"]
        self.assertEqual(account["name"], "Kwadwo A")
        self.assertEqual(account["phone"], "024 *** 0731")
        self.assertNotIn("kwadwo@example.com", str(account))

    def test_no_account_match_is_null(self):
        self.auth(self.support)
        self.assertIsNone(self.client.get(BASE).json()["results"][0]["account"])

    def test_mark_unread_returns_a_read_message_to_new(self):
        self.message.status = ContactMessage.READ
        self.message.save()
        self.auth(self.support)
        response = self.client.post(f"{BASE}{self.message.pk}/mark-unread/")
        self.assertEqual(response.status_code, 200)
        self.message.refresh_from_db()
        self.assertEqual(self.message.status, ContactMessage.NEW)

    def test_mark_unread_refuses_a_resolved_message(self):
        self.message.status = ContactMessage.RESOLVED
        self.message.save()
        self.auth(self.support)
        self.assertEqual(self.client.post(f"{BASE}{self.message.pk}/mark-unread/").status_code, 409)

    def test_mark_unread_needs_the_permission(self):
        self.auth(self.marketing)
        self.assertEqual(self.client.post(f"{BASE}{self.message.pk}/mark-unread/").status_code, 403)

    @override_settings(DEFAULT_FROM_EMAIL="help@example.org")
    def test_reply_sends_email_from_the_default_sender_and_keeps_a_row(self):
        self.auth(self.support)
        response = self.client.post(f"{BASE}{self.message.pk}/reply/", {"body": "Hello Kwadwo."}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].from_email, "help@example.org")
        self.assertEqual(mail.outbox[0].to, ["kwadwo@example.com"])
        reply = ContactReply.objects.get()
        self.assertTrue(reply.email_sent)
        self.assertEqual(reply.staff, self.support)
        self.message.refresh_from_db()
        self.assertEqual(self.message.status, ContactMessage.READ)
        # No conversation is created for a person with no account.
        from messaging.models import Conversation
        self.assertEqual(Conversation.objects.count(), 0)
        self.assertEqual(response.json()["replies"][0]["body"], "Hello Kwadwo.")
        self.assertNotIn("kwadwo@example.com", str(response.json()))

    def test_reply_needs_a_body_and_the_permission(self):
        self.auth(self.support)
        self.assertEqual(self.client.post(f"{BASE}{self.message.pk}/reply/", {"body": "  "}, format="json").status_code, 400)
        self.auth(self.marketing)
        self.assertEqual(self.client.post(f"{BASE}{self.message.pk}/reply/", {"body": "x"}, format="json").status_code, 403)
        self.assertEqual(len(mail.outbox), 0)

    def test_reply_to_a_message_without_an_email_is_refused(self):
        self.message.email = ""
        self.message.save()
        self.auth(self.support)
        response = self.client.post(f"{BASE}{self.message.pk}/reply/", {"body": "Hello"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(ContactReply.objects.count(), 0)

    def test_a_failed_send_is_recorded_as_not_sent_and_answers_502(self):
        from unittest import mock
        self.auth(self.support)
        with mock.patch("contact.views.send_mail", side_effect=OSError("down")):
            response = self.client.post(f"{BASE}{self.message.pk}/reply/", {"body": "Hello"}, format="json")
        self.assertEqual(response.status_code, 502)
        self.assertFalse(ContactReply.objects.get().email_sent)

    def test_pass_to_operations_makes_a_task_for_the_lead_once(self):
        self.auth(self.support)
        response = self.client.post(f"{BASE}{self.message.pk}/pass-to-operations/", {"note": "Adum shop"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        task = Task.objects.get()
        self.assertEqual(task.owner, self.ops)
        self.assertEqual(task.kind, Task.OPS_FOLLOW_UP)
        self.assertIn("I sell shoes at Adum.", task.notes)
        self.assertIn("Adum shop", task.notes)
        self.assertTrue(Notification.objects.filter(staff=self.ops, kind="contact_message").exists())
        self.assertEqual(response.json()["passed_by_name"], "Esi Nyarko")
        self.assertEqual(self.client.post(f"{BASE}{self.message.pk}/pass-to-operations/").status_code, 409)
        self.assertEqual(Task.objects.count(), 1)

    def test_pass_to_operations_needs_the_permission(self):
        self.auth(self.marketing)
        self.assertEqual(self.client.post(f"{BASE}{self.message.pk}/pass-to-operations/").status_code, 403)
        self.assertEqual(Task.objects.count(), 0)

    def test_the_new_views_refuse_anonymous_callers(self):
        for suffix in ("mark-unread", "reply", "pass-to-operations"):
            self.assertEqual(self.client.post(f"{BASE}{self.message.pk}/{suffix}/").status_code, 401)
