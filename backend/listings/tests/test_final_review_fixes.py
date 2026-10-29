"""Marketplace Plan 2, final review: moderation sees variants and videos, no media changes during review, lifecycle
guards on approve and reject, take-down closes the open edit, labels follow attributes, Direct writes need staff."""
import tempfile
from unittest import mock

from django.core.files.base import ContentFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from cart.models import Cart, CartItem
from listings import media, revisions, variants
from listings.models import Category, Listing, ListingRevision, ListingVariant, ListingVideo, Zone
from listings.tests.test_listing_media import YT, jpeg
from orders.models import Order

TEST_MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class FinalFixBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Ama Bakes", login_phone="+233207776001", password_hash="x", kyc_status=BusinessOwner.VERIFIED,
        )
        BusinessOwnerProfile.objects.create(
            business_owner=self.owner, ghana_card_number="GHA-207776001-1", gps_address="AK-039-7001",
            business_contact_phone="+233207776001", is_formal=False, default_payout_method="momo",
            payout_momo_network="MTN", payout_momo_number="+233207776001", payout_momo_name="Ama",
        )
        self.shops = Category.objects.get(slug="shops")
        self.zone = Zone.objects.get(name="Manhyia")
        self.checker = make_staff("operations", "checker@example.com")
        self.second = make_staff("operations", "second@example.com")

    def listing(self, status, **extra):
        return Listing.objects.create(
            business_owner=self.owner, category=self.shops, zone=self.zone, name="Cake", description="A cake.",
            contact_phone="+233207776001", price_amount="10.00", stock_quantity=5, status=status, **extra,
        )

    def as_owner(self, who=None):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(who or self.owner, 'business_owner')}")

    def as_staff(self, who=None):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(who or self.checker)}")

    def variant(self, listing, label, price="20.00", stock=3, **extra):
        row = ListingVariant.objects.create(listing=listing, label=label, price_amount=price, stock_quantity=stock, **extra)
        variants.sync_listing(listing)
        return row


class ModerationSeesEverythingTests(FinalFixBase):
    def test_the_staff_detail_lists_every_variant_row_with_is_active(self):
        listing = self.listing(Listing.PENDING_REVIEW)
        self.variant(listing, "Vanilla", attributes={"flavour": "Vanilla"})
        gone = self.variant(listing, "Lemon", "30.00", 2)
        ListingVariant.objects.filter(pk=gone.pk).update(is_active=False)
        self.as_staff()
        body = self.client.get(f"/api/listings/moderation/{listing.pk}/").json()
        rows = {row["label"]: row for row in body["variants"]}
        self.assertEqual(set(rows), {"Vanilla", "Lemon"})
        self.assertTrue(rows["Vanilla"]["is_active"])
        self.assertFalse(rows["Lemon"]["is_active"])
        self.assertEqual(rows["Vanilla"]["attributes"], {"flavour": "Vanilla"})
        self.assertEqual((rows["Lemon"]["price_amount"], rows["Lemon"]["stock_quantity"]), ("30.00", 2))

    def test_approve_waits_for_a_converting_video(self):
        listing = self.listing(Listing.PENDING_REVIEW)
        video = ListingVideo.objects.create(
            listing=listing, kind=ListingVideo.UPLOAD, status=ListingVideo.CONVERTING, source=ContentFile(b"x", name="c.mp4"),
        )
        self.as_staff()
        response = self.client.post(f"/api/listings/moderation/{listing.pk}/approve/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Wait for the video to finish converting before approving."})
        self.assertEqual(Listing.objects.get(pk=listing.pk).status, Listing.PENDING_REVIEW)
        ListingVideo.objects.filter(pk=video.pk).update(status=ListingVideo.READY)
        self.assertEqual(self.client.post(f"/api/listings/moderation/{listing.pk}/approve/").status_code, 200)


class NoMediaChangesDuringReviewTests(FinalFixBase):
    def test_photos_and_videos_cannot_be_added_or_removed_while_pending_review(self):
        listing = self.listing(Listing.PENDING_REVIEW)
        photo = listing.photos.create(image=jpeg(), order=1)
        video = ListingVideo.objects.create(listing=listing, kind=ListingVideo.YOUTUBE, youtube_id=YT, status=ListingVideo.READY)
        self.as_owner()
        base = f"/api/listings/mine/{listing.pk}"
        calls = [
            self.client.post(f"{base}/photos/", {"image": jpeg()}, format="multipart"),
            self.client.post(f"{base}/videos/", {"youtube_url": f"https://youtu.be/{YT}"}, format="json"),
            self.client.delete(f"{base}/photos/{photo.pk}/"),
            self.client.delete(f"{base}/videos/{video.pk}/"),
        ]
        for response in calls:
            self.assertEqual(response.status_code, 400, response.content)
            self.assertIn("waiting for review", response.json()["detail"])
        self.assertEqual((listing.photos.count(), listing.videos.count()), (1, 1))


class ApproveAndRejectGuardTests(FinalFixBase):
    def test_approve_only_works_from_pending_review(self):
        self.as_staff()
        for status in (Listing.DROPPED, Listing.DISCONTINUED, Listing.PUBLISHED, Listing.DRAFT, Listing.REJECTED):
            listing = self.listing(status)
            response = self.client.post(f"/api/listings/moderation/{listing.pk}/approve/")
            self.assertEqual(response.status_code, 400, status)
            self.assertEqual(Listing.objects.get(pk=listing.pk).status, status)

    def test_reject_works_from_pending_review_or_published_only(self):
        self.as_staff()
        for status in (Listing.DROPPED, Listing.DISCONTINUED, Listing.DRAFT, Listing.REJECTED):
            listing = self.listing(status)
            response = self.client.post(f"/api/listings/moderation/{listing.pk}/reject/", {"reason": "No"}, format="json")
            self.assertEqual(response.status_code, 400, status)
            self.assertEqual(Listing.objects.get(pk=listing.pk).status, status)
        for status in (Listing.PENDING_REVIEW, Listing.PUBLISHED):
            listing = self.listing(status)
            response = self.client.post(f"/api/listings/moderation/{listing.pk}/reject/", {"reason": "No"}, format="json")
            self.assertEqual(response.status_code, 200, status)
            self.assertEqual(Listing.objects.get(pk=listing.pk).status, Listing.REJECTED)

    def test_a_take_down_rejects_the_pending_edit_and_deletes_a_draft_one(self):
        pending_listing, draft_listing = self.listing(Listing.PUBLISHED), self.listing(Listing.PUBLISHED)
        for listing in (pending_listing, draft_listing):
            self.as_owner()
            self.client.put(f"/api/listings/mine/{listing.pk}/revision/", {"changes": {"name": "Better Cake"}}, format="json")
        self.client.post(f"/api/listings/mine/{pending_listing.pk}/revision/submit/")
        self.as_staff()
        for listing in (pending_listing, draft_listing):
            response = self.client.post(f"/api/listings/moderation/{listing.pk}/reject/", {"reason": "Fraud"}, format="json")
            self.assertEqual(response.status_code, 200, response.content)
        edit = ListingRevision.objects.get(listing=pending_listing)
        self.assertEqual((edit.status, edit.rejection_reason), (ListingRevision.REJECTED, "The listing was taken down."))
        self.assertFalse(ListingRevision.objects.filter(listing=draft_listing).exists())

    def test_rejecting_a_revision_is_refused_to_its_maker(self):
        listing = self.listing(Listing.PUBLISHED)
        self.as_owner()
        self.client.put(f"/api/listings/mine/{listing.pk}/revision/", {"changes": {"name": "Better"}}, format="json")
        revision = ListingRevision.objects.get(listing=listing)
        self.client.post(f"/api/listings/mine/{listing.pk}/revision/submit/")
        ListingRevision.objects.filter(pk=revision.pk).update(created_by_staff=self.checker)
        self.as_staff()
        denied = self.client.post(f"/api/listings/revisions/{revision.pk}/reject/", {"reason": "No"}, format="json")
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.json(), {"detail": revisions.OWN_APPROVAL_MESSAGE})
        self.as_staff(self.second)
        self.assertEqual(
            self.client.post(f"/api/listings/revisions/{revision.pk}/reject/", {"reason": "No"}, format="json").status_code, 200,
        )


class VariantEditTests(FinalFixBase):
    def edit(self, listing, ops):
        self.as_owner()
        response = self.client.put(f"/api/listings/mine/{listing.pk}/revision/", {"variants": ops}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.client.post(f"/api/listings/mine/{listing.pk}/revision/submit/")
        return ListingRevision.objects.get(listing=listing)

    def test_the_label_follows_a_changed_attribute_after_apply_and_the_diff_shows_old_and_new(self):
        listing = self.listing(Listing.PUBLISHED)
        row = self.variant(listing, "Large", attributes={"Size": "Large"})
        self.variant(listing, "Small", attributes={"Size": "Small"})
        revision = self.edit(listing, [{"op": "update", "id": row.pk, "attributes": {"Size": "Extra large"}}])
        self.assertEqual(revision.variants[0]["label"], "Extra large")
        self.as_staff()
        diff = self.client.get(f"/api/listings/revisions/{revision.pk}/").json()["diff"]["variants"][0]
        self.assertEqual(diff["current_attributes"], {"Size": "Large"})
        self.assertEqual(diff["attributes"], {"Size": "Extra large"})
        self.assertEqual(self.client.post(f"/api/listings/revisions/{revision.pk}/approve/").status_code, 200)
        row.refresh_from_db()
        self.assertEqual((row.label, row.attributes), ("Extra large", {"Size": "Extra large"}))

    def test_a_label_sent_with_the_attributes_is_kept(self):
        listing = self.listing(Listing.PUBLISHED)
        row = self.variant(listing, "Large", attributes={"Size": "Large"})
        revision = self.edit(listing, [{"op": "update", "id": row.pk, "attributes": {"Size": "XL"}, "label": "The big one"}])
        self.assertEqual(revision.variants[0]["label"], "The big one")

    def test_removing_the_last_variant_leaves_a_plain_listing_with_no_stock_and_the_same_price(self):
        listing = self.listing(Listing.DRAFT)
        first = self.variant(listing, "Vanilla", "25.00", 4)
        second = self.variant(listing, "Lemon", "30.00", 6)
        self.as_owner()
        for row in (first, second):
            self.assertEqual(self.client.delete(f"/api/listings/mine/{listing.pk}/variants/{row.pk}/").status_code, 204)
        listing.refresh_from_db()
        self.assertEqual(listing.stock_quantity, 0)
        self.assertEqual(str(listing.price_amount), "30.00")  # the from-price of the last state is kept
        self.assertFalse(variants.active(listing).exists())

    def test_removing_the_last_variant_through_an_edit_does_the_same(self):
        listing = self.listing(Listing.PUBLISHED)
        row = self.variant(listing, "Vanilla", "25.00", 4)
        revision = self.edit(listing, [{"op": "remove", "id": row.pk}])
        self.as_staff()
        self.assertEqual(self.client.post(f"/api/listings/revisions/{revision.pk}/approve/").status_code, 200)
        listing.refresh_from_db()
        self.assertEqual((listing.stock_quantity, str(listing.price_amount)), (0, "25.00"))

    def test_a_plain_listing_that_once_had_variants_keeps_its_stock_on_a_later_apply(self):
        listing = self.listing(Listing.PUBLISHED)
        row = self.variant(listing, "Vanilla", "25.00", 4)
        revision = self.edit(listing, [{"op": "remove", "id": row.pk}])
        self.as_staff()
        self.client.post(f"/api/listings/revisions/{revision.pk}/approve/")
        Listing.objects.filter(pk=listing.pk).update(stock_quantity=7)
        self.as_owner()
        self.client.put(f"/api/listings/mine/{listing.pk}/revision/", {"changes": {"name": "Better"}}, format="json")
        self.client.post(f"/api/listings/mine/{listing.pk}/revision/submit/")
        revision = ListingRevision.objects.filter(listing=listing, status="pending").get()
        self.as_staff(self.second)
        self.assertEqual(self.client.post(f"/api/listings/revisions/{revision.pk}/approve/").status_code, 200)
        listing.refresh_from_db()
        self.assertEqual(listing.stock_quantity, 7)

    def test_remove_video_ids_must_belong_to_the_listing(self):
        listing, other = self.listing(Listing.PUBLISHED), self.listing(Listing.PUBLISHED)
        theirs = ListingVideo.objects.create(listing=other, kind=ListingVideo.YOUTUBE, youtube_id=YT, status=ListingVideo.READY)
        mine = ListingVideo.objects.create(listing=listing, kind=ListingVideo.YOUTUBE, youtube_id=YT, status=ListingVideo.READY)
        self.as_owner()
        url = f"/api/listings/mine/{listing.pk}/revision/"
        bad = self.client.put(url, {"remove_video_ids": [theirs.pk]}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json(), {"remove_video_ids": "That video is not on this listing."})
        self.assertEqual(self.client.put(url, {"remove_video_ids": [mine.pk]}, format="json").status_code, 200)


class DirectFromStaffTests(FinalFixBase):
    def test_the_direct_login_cannot_write_listings_on_the_owner_mount_but_can_read(self):
        from io import StringIO

        from django.core.management import call_command

        from accounts import direct

        with override_settings(ASHANTI_DIRECT_PHONE="0244000111", ASHANTI_DIRECT_EMAIL="direct@theashantihub.com"):
            call_command("ensure_ashanti_direct", stdout=StringIO())
        company = direct.ashanti_direct()
        listing = Listing.objects.create(
            business_owner=company, category=self.shops, zone=self.zone, name="Kettle", description="D.",
            contact_phone="+233244000111", price_amount="10.00", status=Listing.DRAFT,
        )
        self.as_owner(company)
        self.assertEqual(self.client.get("/api/listings/mine/").status_code, 200)
        for response in (
            self.client.patch(f"/api/listings/mine/{listing.pk}/", {"name": "New"}, format="json"),
            self.client.post(f"/api/listings/mine/{listing.pk}/photos/", {"image": jpeg()}, format="multipart"),
            self.client.post(f"/api/listings/mine/{listing.pk}/submit/"),
        ):
            self.assertEqual(response.status_code, 403, response.content)
            self.assertIn("staff dashboard", response.json()["detail"])
        self.assertEqual(Listing.objects.get(pk=listing.pk).name, "Kettle")
        # a partner business is not affected
        self.as_owner()
        self.assertEqual(
            self.client.patch(f"/api/listings/mine/{self.listing(Listing.DRAFT).pk}/", {"name": "New"}, format="json").status_code, 200,
        )


class CheckoutRecheckTests(FinalFixBase):
    def test_a_listing_taken_down_while_checkout_runs_is_refused_under_the_lock(self):
        from listings.visibility import hidden_business_q

        from accounts.models import Customer

        listing = self.listing(Listing.PUBLISHED)
        customer = Customer.objects.create(full_name="Yaw", phone="+233200776001", password_hash="x")
        cart = Cart.objects.create(customer=customer)
        CartItem.objects.create(cart=cart, listing=listing, quantity=1, unit_price_snapshot="10.00")

        def race(*args, **kwargs):  # the listing is dropped after the first availability check, before the lock
            Listing.objects.filter(pk=listing.pk).update(status=Listing.DROPPED)
            return hidden_business_q(*args, **kwargs)

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        with mock.patch("orders.views.hidden_business_q", side_effect=race):
            response = self.client.post("/api/orders/checkout/", {}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["code"], "listing_unavailable")
        self.assertFalse(Order.objects.exists())
        self.assertEqual(Listing.objects.get(pk=listing.pk).stock_quantity, 5)
