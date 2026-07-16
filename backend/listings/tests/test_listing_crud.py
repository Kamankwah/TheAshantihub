import io
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from PIL import Image

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from billing.models import Subscription, SubscriptionPlan
from listings.models import Category, Listing, Zone

TEST_MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class ListingCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207445566", password_hash="x",
        )
        BusinessOwnerProfile.objects.create(
            business_owner=self.owner, ghana_card_number="GHA-222333444-5",
            gps_address="AK-039-5060", business_contact_phone="+233207445566",
            is_formal=False, default_payout_method="momo", payout_momo_network="MTN",
            payout_momo_number="+233207445566", payout_momo_name="Kofi Trader",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Ama Seller", login_phone="+233207445577", password_hash="x",
        )
        self.hotels = Category.objects.get(slug="hotels")
        self.shops = Category.objects.get(slug="shops")
        self.manhyia = Zone.objects.get(name="Manhyia")
        self.token = issue_token(self.owner, "business_owner")

        # An active, unlimited-listings subscription for the default owner —
        # required as of the subscription-enforcement work so the many
        # pre-existing tests in this file (which predate that work and don't
        # otherwise set one up) keep exercising a normal, allowed create/edit
        # rather than tripping the new "no active subscription" check.
        self.service_plan = SubscriptionPlan.objects.get(tier="service")
        now = timezone.now()
        Subscription.objects.create(
            business_owner=self.owner, plan=self.service_plan,
            current_period_start=now, current_period_end=now + timedelta(days=30),
        )

    def _auth(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def test_create_listing_defaults_contact_phone_from_profile(self):
        self._auth(self.owner)
        response = self.client.post(
            "/api/listings/mine/",
            {"category": self.hotels.id, "zone": self.manhyia.id, "name": "New Lodge", "description": "Desc."},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        listing = Listing.objects.get(id=response.json()["id"])
        self.assertEqual(listing.contact_phone, "+233207445566")
        self.assertEqual(listing.status, Listing.DRAFT)
        self.assertEqual(listing.business_owner, self.owner)

    def test_create_listing_with_disallowed_main_photo_format_is_rejected(self):
        # A real, valid image Pillow will happily open — but in a format
        # validate_image_content_type disallows (only jpeg/png are allowed).
        # This proves the model-level validator wired on Listing.main_photo
        # actually runs through OwnerListingSerializer on this endpoint,
        # rather than relying on code-reading alone (per this plan's prior
        # experience, DRF's own ImageField/Pillow check would accept a valid
        # GIF just fine, so only validate_image_content_type explains a 400
        # here with this exact message).
        buf = io.BytesIO()
        Image.new("RGB", (1, 1)).save(buf, format="GIF")
        buf.seek(0)
        self._auth(self.owner)
        response = self.client.post(
            "/api/listings/mine/",
            {
                "category": self.hotels.id,
                "zone": self.manhyia.id,
                "name": "New Lodge",
                "description": "Desc.",
                "main_photo": SimpleUploadedFile("photo.gif", buf.read(), content_type="image/gif"),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("main_photo", response.json())
        self.assertIn("Unsupported file type: expected an image, got image/gif.", response.json()["main_photo"][0])

    def test_list_mine_returns_only_own_listings_any_status(self):
        Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Mine", description="D.", contact_phone="+233207445566", status=Listing.DRAFT,
        )
        Listing.objects.create(
            business_owner=self.other_owner, category=self.hotels, zone=self.manhyia,
            name="Not Mine", description="D.", contact_phone="+233207445577", status=Listing.PUBLISHED,
        )
        self._auth(self.owner)
        response = self.client.get("/api/listings/mine/")
        names = [item["name"] for item in response.json()]
        self.assertEqual(names, ["Mine"])

    def test_list_mine_includes_gallery_photos(self):
        from listings.models import ListingPhoto

        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Mine With Photos", description="D.", contact_phone="+233207445566",
        )
        buf = io.BytesIO()
        Image.new("RGB", (1, 1)).save(buf, format="JPEG")
        photo = ListingPhoto.objects.create(
            listing=listing,
            image=SimpleUploadedFile("gallery.jpg", buf.getvalue(), content_type="image/jpeg"),
            order=1,
        )
        self._auth(self.owner)
        response = self.client.get("/api/listings/mine/")
        self.assertEqual(response.status_code, 200, response.content)
        item = response.json()[0]
        self.assertIn("photos", item)
        self.assertEqual(len(item["photos"]), 1)
        self.assertEqual(item["photos"][0]["id"], photo.id)
        self.assertEqual(item["photos"][0]["order"], 1)
        self.assertIn("image", item["photos"][0])

    def test_owner_can_edit_own_draft_listing(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Old Name", description="D.", contact_phone="+233207445566",
        )
        self._auth(self.owner)
        response = self.client.patch(f"/api/listings/mine/{listing.id}/", {"name": "New Name"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertEqual(listing.name, "New Name")

    def test_other_owner_cannot_edit_listing(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Old Name", description="D.", contact_phone="+233207445566",
        )
        self._auth(self.other_owner)
        response = self.client.patch(f"/api/listings/mine/{listing.id}/", {"name": "Hijacked"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_cannot_edit_published_listing(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Live Listing", description="D.", contact_phone="+233207445566",
            status=Listing.PUBLISHED,
        )
        self._auth(self.owner)
        response = self.client.patch(f"/api/listings/mine/{listing.id}/", {"name": "Changed"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_submit_moves_draft_to_pending_review(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Ready Listing", description="D.", contact_phone="+233207445566",
        )
        self._auth(self.owner)
        response = self.client.post(f"/api/listings/mine/{listing.id}/submit/")
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.PENDING_REVIEW)

    def test_cannot_submit_a_published_listing(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Live Listing", description="D.", contact_phone="+233207445566",
            status=Listing.PUBLISHED,
        )
        self._auth(self.owner)
        response = self.client.post(f"/api/listings/mine/{listing.id}/submit/")
        self.assertEqual(response.status_code, 400)
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.PUBLISHED)

    def test_customer_cannot_edit_any_listing(self):
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.manhyia,
            name="Old Name", description="D.", contact_phone="+233207445566",
        )
        customer = Customer.objects.create(full_name="Ama", phone="+233200007777", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        response = self.client.patch(f"/api/listings/mine/{listing.id}/", {"name": "Hijacked"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_customer_cannot_create_a_listing(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200008888", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        response = self.client.post(
            "/api/listings/mine/",
            {"category": self.hotels.id, "zone": self.manhyia.id, "name": "Nope", "description": "D."},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    # --- Subscription-based enforcement (business-subscription follow-up) ---

    def test_regression_matching_kind_within_cap_active_subscription_succeeds(self):
        # The most important test here: confirms the new checks don't break
        # the existing, otherwise-valid happy path.
        self.owner.profile.business_kind = BusinessOwnerProfile.SERVICE
        self.owner.profile.save()
        self._auth(self.owner)
        response = self.client.post(
            "/api/listings/mine/",
            {"category": self.hotels.id, "zone": self.manhyia.id, "name": "New Lodge", "description": "Desc."},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_cannot_create_listing_with_mismatched_category_kind(self):
        # hotels is a "service" category; owner is registered product-only.
        self.owner.profile.business_kind = BusinessOwnerProfile.PRODUCT
        self.owner.profile.save()
        self._auth(self.owner)
        response = self.client.post(
            "/api/listings/mine/",
            {"category": self.hotels.id, "zone": self.manhyia.id, "name": "Nope", "description": "D."},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("category", response.json())

    def test_cannot_edit_listing_to_mismatched_category_kind(self):
        self.owner.profile.business_kind = BusinessOwnerProfile.PRODUCT
        self.owner.profile.save()
        listing = Listing.objects.create(
            business_owner=self.owner, category=self.shops, zone=self.manhyia,
            name="My Shop Item", description="D.", contact_phone="+233207445566",
        )
        self._auth(self.owner)
        response = self.client.patch(
            f"/api/listings/mine/{listing.id}/", {"category": self.hotels.id}, format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("category", response.json())

    def test_cannot_create_listing_without_a_subscription(self):
        no_sub_owner = BusinessOwner.objects.create(
            full_name="No Sub Owner", login_phone="+233207445588", password_hash="x",
        )
        BusinessOwnerProfile.objects.create(
            business_owner=no_sub_owner, ghana_card_number="GHA-333444555-6",
            gps_address="AK-039-5061", business_contact_phone="+233207445588",
            is_formal=False, default_payout_method="momo", payout_momo_network="MTN",
            payout_momo_number="+233207445588", payout_momo_name="No Sub Owner",
        )
        self._auth(no_sub_owner)
        response = self.client.post(
            "/api/listings/mine/",
            {"category": self.hotels.id, "zone": self.manhyia.id, "name": "Nope", "description": "D."},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("subscription", response.json())

    def test_cannot_create_listing_with_expired_subscription(self):
        now = timezone.now()
        self.owner.subscription.current_period_end = now - timedelta(days=1)
        self.owner.subscription.save()
        self._auth(self.owner)
        response = self.client.post(
            "/api/listings/mine/",
            {"category": self.hotels.id, "zone": self.manhyia.id, "name": "Nope", "description": "D."},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("subscription", response.json())

    def test_cannot_create_listing_at_active_listing_cap(self):
        basic_plan = SubscriptionPlan.objects.get(tier="product_basic")
        self.owner.subscription.plan = basic_plan
        self.owner.subscription.save()
        for i in range(basic_plan.max_active_listings):
            Listing.objects.create(
                business_owner=self.owner, category=self.shops, zone=self.manhyia,
                name=f"Published {i}", description="D.", contact_phone="+233207445566",
                status=Listing.PUBLISHED,
            )
        self._auth(self.owner)
        response = self.client.post(
            "/api/listings/mine/",
            {"category": self.shops.id, "zone": self.manhyia.id, "name": "One Too Many", "description": "D."},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("max_active_listings", response.json())

    def test_unlimited_plan_never_blocks_on_listing_count(self):
        unlimited_plan = SubscriptionPlan.objects.get(tier="product_unlimited")
        self.assertIsNone(unlimited_plan.max_active_listings)
        self.owner.subscription.plan = unlimited_plan
        self.owner.subscription.save()
        for i in range(20):
            Listing.objects.create(
                business_owner=self.owner, category=self.shops, zone=self.manhyia,
                name=f"Published {i}", description="D.", contact_phone="+233207445566",
                status=Listing.PUBLISHED,
            )
        self._auth(self.owner)
        response = self.client.post(
            "/api/listings/mine/",
            {
                "category": self.shops.id, "zone": self.manhyia.id, "name": "Yet Another",
                "description": "D.",
                # shops is a product-kind category, so the decision-field
                # requirements apply (see test_listing_decision_fields.py).
                "has_warranty": False, "has_expiry": False,
                "return_policy": "Returns within 7 days.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
