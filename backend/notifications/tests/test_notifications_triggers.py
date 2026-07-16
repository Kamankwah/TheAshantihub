import io
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from events.models import Event
from listings.models import Category, HeroMediaSubmission, Listing, ListingPhoto, Zone
from messaging.models import Conversation, Message
from orders.models import Order, OrderItem

from notifications.models import Notification

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image(name="photo.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class NotificationTriggerTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        # super_admin holds every permission, so it receives every
        # staff-role fan-out (kyc.approve / listings.moderate / event.approve
        # / hero_media.approve / contact_messages.manage / messaging.manage).
        self.super_admin = StaffUser.objects.create(
            full_name="Super", email="super-trig@example.com", password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233201110001", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED,
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233201110002", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.festivals = Category.objects.get(slug="festivals")
        self.manhyia = Zone.objects.get(name="Manhyia")

    def _auth(self, account, kind):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")

    def _staff_notes(self, kind):
        return Notification.objects.filter(staff=self.super_admin, kind=kind)

    # ── contact ──────────────────────────────────────────────────────────
    def test_contact_submission_notifies_staff(self):
        resp = self.client.post(
            "/api/core/contact/",
            {"category": "support", "name": "Ama", "email": "a@b.com",
             "subject": "Help", "message": "Please help."},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(self._staff_notes(Notification.CONTACT_MESSAGE).exists())

    # ── KYC ──────────────────────────────────────────────────────────────
    def test_kyc_approve_notifies_owner(self):
        pending = BusinessOwner.objects.create(
            full_name="Pending Trader", login_phone="+233201110003", password_hash="x",
            kyc_status=BusinessOwner.PENDING,
        )
        self._auth(self.super_admin, "staff")
        resp = self.client.post(f"/api/accounts/kyc/{pending.id}/approve/")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(
            Notification.objects.filter(business_owner=pending, kind=Notification.KYC_APPROVED).exists()
        )

    def test_kyc_reject_notifies_owner_with_reason(self):
        pending = BusinessOwner.objects.create(
            full_name="Pending Trader", login_phone="+233201110004", password_hash="x",
            kyc_status=BusinessOwner.PENDING,
        )
        self._auth(self.super_admin, "staff")
        resp = self.client.post(
            f"/api/accounts/kyc/{pending.id}/reject/", {"reason": "Blurry card"}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        note = Notification.objects.get(business_owner=pending, kind=Notification.KYC_REJECTED)
        self.assertIn("Blurry card", note.body)

    # ── listings ─────────────────────────────────────────────────────────
    def test_listing_submit_notifies_moderators(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Draft Lodge", description="D.", contact_phone="+233201110001",
            status=Listing.DRAFT,
        )
        self._auth(self.owner, "business_owner")
        resp = self.client.post(f"/api/listings/mine/{listing.id}/submit/")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(self._staff_notes(Notification.LISTING_NEEDS_MODERATION).exists())

    def test_listing_approve_notifies_owner(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Pending Lodge", description="D.", contact_phone="+233201110001",
            status=Listing.PENDING_REVIEW,
        )
        self._auth(self.super_admin, "staff")
        resp = self.client.post(f"/api/listings/moderation/{listing.id}/approve/")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(
            Notification.objects.filter(business_owner=self.owner, kind=Notification.LISTING_APPROVED).exists()
        )

    def test_listing_reject_notifies_owner(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Pending Lodge 2", description="D.", contact_phone="+233201110001",
            status=Listing.PENDING_REVIEW,
        )
        self._auth(self.super_admin, "staff")
        resp = self.client.post(
            f"/api/listings/moderation/{listing.id}/reject/", {"reason": "No good"}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(
            Notification.objects.filter(business_owner=self.owner, kind=Notification.LISTING_REJECTED).exists()
        )

    # ── hero ─────────────────────────────────────────────────────────────
    def test_hero_submit_notifies_approvers(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Hero Lodge", description="D.", contact_phone="+233201110001",
        )
        photo = ListingPhoto.objects.create(listing=listing, image=_image(), order=1)
        self._auth(self.owner, "business_owner")
        resp = self.client.post(
            "/api/hero/submit/", {"listing_photo": photo.id, "caption": "Great"}, format="json"
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(self._staff_notes(Notification.HERO_NEEDS_APPROVAL).exists())

    def test_hero_approve_and_reject_notify_owner(self):
        approved = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media_type=HeroMediaSubmission.IMAGE, caption="c",
            status=HeroMediaSubmission.PENDING,
        )
        rejected = HeroMediaSubmission.objects.create(
            business_owner=self.owner, media_type=HeroMediaSubmission.IMAGE, caption="c",
            status=HeroMediaSubmission.PENDING,
        )
        self._auth(self.super_admin, "staff")
        ar = self.client.post(f"/api/listings/hero/{approved.id}/approve/")
        self.assertEqual(ar.status_code, 200, ar.content)
        rr = self.client.post(f"/api/listings/hero/{rejected.id}/reject/", {"reason": "no"}, format="json")
        self.assertEqual(rr.status_code, 200, rr.content)
        self.assertTrue(
            Notification.objects.filter(business_owner=self.owner, kind=Notification.HERO_APPROVED).exists()
        )
        self.assertTrue(
            Notification.objects.filter(business_owner=self.owner, kind=Notification.HERO_REJECTED).exists()
        )

    # ── events ───────────────────────────────────────────────────────────
    def _submit_event(self):
        self._auth(self.customer, "customer")
        resp = self.client.post(
            "/api/events/submit/",
            {
                "category": self.festivals.id, "zone": self.manhyia.id,
                "name": "Akwasidae", "description": "Durbar.",
                "address": "Manhyia Palace", "visibility_days": 15,
                "event_date": (timezone.now() + timezone.timedelta(days=30)).isoformat(),
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        return Event.objects.get(pk=resp.json()["id"])

    def test_event_submit_notifies_approvers(self):
        self._submit_event()
        self.assertTrue(self._staff_notes(Notification.EVENT_NEEDS_APPROVAL).exists())

    def test_event_approve_notifies_customer_organizer(self):
        event = self._submit_event()
        self._auth(self.super_admin, "staff")
        resp = self.client.post(f"/api/events/moderation/{event.id}/approve/")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(
            Notification.objects.filter(customer=self.customer, kind=Notification.EVENT_APPROVED).exists()
        )

    def test_event_reject_notifies_customer_organizer(self):
        event = self._submit_event()
        self._auth(self.super_admin, "staff")
        resp = self.client.post(
            f"/api/events/moderation/{event.id}/reject/", {"reason": "no"}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(
            Notification.objects.filter(customer=self.customer, kind=Notification.EVENT_REJECTED).exists()
        )

    # ── orders ───────────────────────────────────────────────────────────
    def test_order_delivery_status_notifies_customer(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Room", description="D.", contact_phone="+233201110001",
            price_amount="150.00", status=Listing.PUBLISHED,
        )
        order = Order.objects.create(customer=self.customer, status=Order.PAID, total_amount="150.00")
        OrderItem.objects.create(
            order=order, listing=listing, quantity=1, unit_price="150.00", line_total="150.00"
        )
        self._auth(self.super_admin, "staff")
        resp = self.client.patch(
            f"/api/orders/{order.id}/delivery-status/", {"delivery_status": "shipped"}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        note = Notification.objects.get(customer=self.customer, kind=Notification.ORDER_STATUS)
        self.assertIn("shipped", note.body.lower())

    # ── messaging ────────────────────────────────────────────────────────
    def test_staff_reply_notifies_customer(self):
        conversation = Conversation.objects.create(customer=self.customer, subject="Help")
        Message.objects.create(
            conversation=conversation, sender_type=Message.CUSTOMER, body="Hi"
        )
        self._auth(self.super_admin, "staff")
        resp = self.client.post(
            f"/api/messaging/staff/{conversation.id}/reply/", {"body": "We can help."}, format="json"
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(
            Notification.objects.filter(customer=self.customer, kind=Notification.SUPPORT_REPLY).exists()
        )
