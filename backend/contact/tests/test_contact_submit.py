from django.test import TestCase
from rest_framework.test import APIClient

from contact.models import ContactMessage

URL = "/api/core/contact/"


class ContactMessageSubmitTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _payload(self, **overrides):
        payload = {
            "category": "general",
            "name": "Ama Buyer",
            "email": "ama@example.com",
            "phone": "+233200881100",
            "subject": "A question",
            "message": "Hello, I have a question about my order.",
        }
        payload.update(overrides)
        return payload

    def test_submit_succeeds_for_each_category(self):
        for category in ("general", "support", "account", "sales"):
            response = self.client.post(URL, self._payload(category=category), format="json")
            self.assertEqual(response.status_code, 201, response.content)
            self.assertEqual(response.json()["category"], category)

        self.assertEqual(ContactMessage.objects.count(), 4)

    def test_submit_creates_row_with_new_status(self):
        response = self.client.post(URL, self._payload(), format="json")
        self.assertEqual(response.status_code, 201, response.content)
        message = ContactMessage.objects.get(pk=response.json()["id"])
        self.assertEqual(message.status, ContactMessage.NEW)
        self.assertEqual(message.name, "Ama Buyer")
        self.assertEqual(message.email, "ama@example.com")

    def test_submit_without_phone_defaults_to_blank(self):
        payload = self._payload()
        del payload["phone"]
        response = self.client.post(URL, payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["phone"], "")

    def test_submit_missing_name_is_400(self):
        payload = self._payload()
        del payload["name"]
        response = self.client.post(URL, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_submit_missing_email_is_400(self):
        payload = self._payload()
        del payload["email"]
        response = self.client.post(URL, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_submit_missing_subject_is_400(self):
        payload = self._payload()
        del payload["subject"]
        response = self.client.post(URL, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_submit_missing_message_is_400(self):
        payload = self._payload()
        del payload["message"]
        response = self.client.post(URL, payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_submit_invalid_category_is_400(self):
        response = self.client.post(URL, self._payload(category="not-a-real-category"), format="json")
        self.assertEqual(response.status_code, 400)
