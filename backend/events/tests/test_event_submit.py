import io
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from billing.models import Transaction
from listings.models import Category, Zone

from events.models import Event, EventMedia

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image(name="event.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


class EventSubmitTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200772211", password_hash="x",
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207772211", password_hash="x",
        )
        self.event_category = Category.objects.get(slug="festivals")
        self.product_category = Category.objects.get(slug="grocery")
        self.zone = Zone.objects.get(name="Manhyia")
        self.payload = {
            "category": self.event_category.id,
            "zone": self.zone.id,
            "name": "Akwasidae Festival",
            "description": "Royal durbar at Manhyia Palace.",
            "address": "Manhyia Palace, Kumasi",
            "event_date": (timezone.now() + timezone.timedelta(days=30)).isoformat(),
            "visibility_days": 14,
        }

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_customer_can_submit_event(self):
        self._auth(issue_token(self.customer, "customer"))
        response = self.client.post("/api/events/submit/", self.payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        event = Event.objects.get(pk=response.json()["id"])
        self.assertEqual(event.submitted_by_customer, self.customer)
        self.assertIsNone(event.submitted_by_business)
        self.assertEqual(event.status, Event.PENDING)
        self.assertTrue(event.access_code)

    def test_business_owner_can_submit_event(self):
        self._auth(issue_token(self.owner, "business_owner"))
        response = self.client.post("/api/events/submit/", self.payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        event = Event.objects.get(pk=response.json()["id"])
        self.assertEqual(event.submitted_by_business, self.owner)
        self.assertIsNone(event.submitted_by_customer)

    def test_submission_does_not_create_a_transaction(self):
        self._auth(issue_token(self.customer, "customer"))
        self.client.post("/api/events/submit/", self.payload, format="json")
        self.assertEqual(Transaction.objects.count(), 0)

    def test_default_access_level_is_public(self):
        self._auth(issue_token(self.customer, "customer"))
        response = self.client.post("/api/events/submit/", self.payload, format="json")
        self.assertEqual(response.json()["access_level"], Event.PUBLIC)

    def test_can_submit_as_private(self):
        self._auth(issue_token(self.customer, "customer"))
        payload = dict(self.payload, access_level="private")
        response = self.client.post("/api/events/submit/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["access_level"], "private")

    def test_non_event_category_is_rejected(self):
        self._auth(issue_token(self.customer, "customer"))
        payload = dict(self.payload, category=self.product_category.id)
        response = self.client.post("/api/events/submit/", payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("category", response.json())

    def test_visibility_days_below_minimum_rejected(self):
        self._auth(issue_token(self.customer, "customer"))
        payload = dict(self.payload, visibility_days=6)
        response = self.client.post("/api/events/submit/", payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_visibility_days_above_maximum_rejected(self):
        self._auth(issue_token(self.customer, "customer"))
        payload = dict(self.payload, visibility_days=91)
        response = self.client.post("/api/events/submit/", payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_staff_cannot_submit(self):
        staff = StaffUser.objects.create(
            full_name="Staffer", email="staffer-submit@example.com", password_hash="x",
            role=Role.objects.get(name="support"),
        )
        self._auth(issue_token(staff, "staff"))
        response = self.client.post("/api/events/submit/", self.payload, format="json")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_submit(self):
        response = self.client.post("/api/events/submit/", self.payload, format="json")
        self.assertEqual(response.status_code, 401)


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class EventMediaUploadTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200772222", password_hash="x",
        )
        self.other_customer = Customer.objects.create(
            full_name="Yaw Buyer", phone="+233200772233", password_hash="x",
        )
        self.event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=Zone.objects.get(name="Manhyia"),
            submitted_by_customer=self.customer,
            name="Akwasidae Festival", description="Royal durbar.", address="Manhyia Palace",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
        )

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_owner_can_upload_media(self):
        self._auth(issue_token(self.customer, "customer"))
        response = self.client.post(
            f"/api/events/{self.event.id}/media/",
            {"media": _image(), "media_type": "image", "order": 0},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(EventMedia.objects.filter(event=self.event).count(), 1)

    def test_non_owner_cannot_upload_media(self):
        self._auth(issue_token(self.other_customer, "customer"))
        response = self.client.post(
            f"/api/events/{self.event.id}/media/",
            {"media": _image(), "media_type": "image", "order": 0},
            format="multipart",
        )
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_upload_media(self):
        response = self.client.post(
            f"/api/events/{self.event.id}/media/",
            {"media": _image(), "media_type": "image", "order": 0},
            format="multipart",
        )
        self.assertEqual(response.status_code, 401)
