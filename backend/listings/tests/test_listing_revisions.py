"""Editing an approved listing through revisions: the approved version stays live, staff approve the rest."""
import io
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Role, StaffUser
from listings import revisions
from listings.models import Category, Listing, ListingPhoto, ListingRevision, ListingVariant, Zone
from listings.serializers import OwnerListingSerializer
from listings.views import OWN_LISTING
from notifications.models import Notification

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def make_owner(name, phone, kind=None):
    owner = BusinessOwner.objects.create(
        full_name=name, login_phone=phone, password_hash="x", kyc_status=BusinessOwner.VERIFIED,
    )
    BusinessOwnerProfile.objects.create(
        business_owner=owner, ghana_card_number=f"GHA-{phone[-9:]}-1", gps_address="AK-039-7001",
        business_contact_phone=phone, is_formal=False, default_payout_method="momo", payout_momo_network="MTN",
        payout_momo_number=phone, payout_momo_name=name, business_kind=kind,
    )
    return owner


def make_staff(email, role="operations"):
    return StaffUser.objects.create(full_name=email.split("@")[0], email=email, password_hash="x", role=Role.objects.get(name=role))


def png(name="new.png"):
    buf = io.BytesIO()
    Image.new("RGB", (2, 2)).save(buf, format="PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class ListingRevisionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = make_owner("Ama Bakes", "+233207774001")
        self.other = make_owner("Kofi Other", "+233207774002")
        self.shops = Category.objects.get(slug="shops")
        self.hotels = Category.objects.get(slug="hotels")
        self.zone = Zone.objects.get(name="Manhyia")
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=self.shops, zone=self.zone, name="Cake", description="A cake.",
            contact_phone="+233207774001", price_amount="10.00", stock_quantity=5, status=Listing.PUBLISHED,
            return_policy="Seven days",
        )
        self.staff = make_staff("checker@example.com")
        self.auth_owner()

    def auth_owner(self, who=None):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(who or self.owner, 'business_owner')}")

    def auth_staff(self, who=None):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(who or self.staff, 'staff')}")

    def url(self, suffix="", listing=None):
        return f"/api/listings/mine/{(listing or self.listing).pk}/revision/{suffix}"

    def draft(self, **body):
        body = body or {"changes": {"name": "Better Cake"}}
        response = self.client.put(self.url(), body, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def send(self, **body):
        self.draft(**body)
        response = self.client.post(self.url("submit/"))
        self.assertEqual(response.status_code, 200, response.content)
        return ListingRevision.objects.get(pk=response.json()["id"])

    def refresh(self):
        self.listing.refresh_from_db()
        return self.listing

    def two_variants(self):
        one = ListingVariant.objects.create(listing=self.listing, label="Vanilla", price_amount="20.00", stock_quantity=4)
        two = ListingVariant.objects.create(listing=self.listing, label="Lemon", price_amount="30.00", stock_quantity=6, position=1)
        from listings import variants

        variants.sync_listing(self.listing)
        return one, two

    # ── owner side ──

    def test_owner_saves_a_draft_revision_on_a_published_listing(self):
        body = self.draft(changes={"name": "Better Cake", "description": "Richer."})
        self.assertEqual(body["status"], "draft")
        self.assertEqual(body["changes"], {"name": "Better Cake", "description": "Richer."})
        self.assertEqual(body["diff"]["fields"]["name"], {"old": "Cake", "new": "Better Cake"})
        self.assertEqual(self.refresh().name, "Cake")
        self.assertEqual(self.listing.status, Listing.PUBLISHED)
        self.assertEqual(self.client.get(self.url()).json()["id"], body["id"])

    def test_review_focus_public_detail_is_unchanged_while_a_revision_is_pending(self):
        self.send(changes={"name": "Better Cake", "description": "Richer."})
        self.client.credentials()
        shown = self.client.get(f"/api/listings/{self.listing.pk}/").json()
        self.assertEqual((shown["name"], shown["description"]), ("Cake", "A cake."))
        self.auth_owner()
        mine = self.client.get("/api/listings/mine/").json()
        row = [item for item in (mine["results"] if isinstance(mine, dict) else mine) if item["id"] == self.listing.pk][0]
        self.assertEqual(row["name"], "Cake")
        self.assertEqual(row["pending_revision"]["status"], "pending")

    def test_review_focus_only_price_and_stock_are_live_edits(self):
        manage = f"/api/listings/mine/{self.listing.pk}/manage/"
        self.assertEqual(self.client.patch(manage, {"price_amount": "12.00"}, format="json").status_code, 200)
        restock = self.client.post(f"/api/listings/mine/{self.listing.pk}/restock/", {"stock_quantity": 9}, format="json")
        self.assertEqual(restock.status_code, 200, restock.content)
        self.assertEqual((str(self.refresh().price_amount), self.listing.stock_quantity), ("12.00", 9))
        # A name is no longer a live edit: manage refuses it, and the revision accepts it.
        refused = self.client.patch(manage, {"name": "Sneaky"}, format="json")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("name", refused.json())
        self.assertEqual(self.refresh().name, "Cake")
        self.assertIn("name", revisions.REVISABLE_FIELDS)
        self.assertEqual(self.client.put(self.url(), {"changes": {"name": "Fine"}}, format="json").status_code, 200)
        # price and stock cannot be queued in a revision.
        queued = self.client.put(self.url(), {"changes": {"price_amount": "1.00"}}, format="json")
        self.assertEqual(queued.status_code, 400)
        self.assertIn("price_amount", queued.json())

    def test_revisable_fields_are_every_editable_field_except_the_live_ones(self):
        fields = set(OwnerListingSerializer().fields)
        read_only = {
            "id", "variants", "has_variants", "pending_revision", "photos", "videos", "main_photo", "status", "rejection_reason",
            "dropped_at", "discontinued_at", "created_at", "updated_at", "sale_ends_at",
        }
        self.assertEqual(revisions.REVISABLE_FIELDS, fields - read_only - revisions.LIVE_FIELDS)

    def test_submit_puts_it_in_the_queue_and_notifies_staff(self):
        revision = self.send()
        self.assertEqual(revision.status, "pending")
        self.assertIsNotNone(revision.submitted_at)
        self.assertTrue(Notification.objects.filter(staff=self.staff, kind="listing_needs_moderation").exists())
        self.auth_staff()
        queue = self.client.get("/api/listings/revisions/pending/").json()
        self.assertEqual([row["id"] for row in queue], [revision.pk])
        self.assertEqual(queue[0]["listing_name"], "Cake")
        self.assertEqual(queue[0]["changed_fields"], ["name"])

    def test_submit_is_400_for_an_empty_edit_and_for_a_listing_that_is_not_live(self):
        self.client.put(self.url(), {"changes": {}}, format="json")
        self.assertEqual(self.client.post(self.url("submit/")).status_code, 400)
        draft = Listing.objects.create(
            business_owner=self.owner, category=self.shops, zone=self.zone, name="D", description="D.",
            contact_phone="+233207774001", status=Listing.DRAFT,
        )
        response = self.client.put(self.url(listing=draft), {"changes": {"name": "X"}}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_one_open_revision_per_listing(self):
        first = self.draft(changes={"name": "One"})
        second = self.draft(changes={"name": "Two"})
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(ListingRevision.objects.filter(listing=self.listing).count(), 1)
        self.assertEqual(second["changes"], {"name": "Two"})

    def test_a_pending_revision_cannot_be_edited_or_discarded(self):
        self.send()
        self.assertEqual(self.client.put(self.url(), {"changes": {"name": "Z"}}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(self.url()).status_code, 400)

    def test_revision_validates_like_a_new_listing(self):
        wrong_kind = make_owner("Service Sam", "+233207774003", kind=BusinessOwnerProfile.SERVICE)
        listing = Listing.objects.create(
            business_owner=wrong_kind, category=self.hotels, zone=self.zone, name="Lodge", description="L.",
            contact_phone="+233207774003", status=Listing.PUBLISHED,
        )
        self.auth_owner(wrong_kind)
        refused = self.client.put(self.url(listing=listing), {"changes": {"category": self.shops.pk}}, format="json")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("category", refused.json())
        self.auth_owner()
        bad_barcode = self.client.put(self.url(), {"changes": {"barcode": "123"}}, format="json")
        self.assertEqual(bad_barcode.status_code, 400)
        self.assertIn("barcode", bad_barcode.json())
        blank_policy = self.client.put(self.url(), {"changes": {"return_policy": " "}}, format="json")
        self.assertEqual(blank_policy.status_code, 400)
        # A hotel cannot carry a barcode (goods only).
        self.auth_owner(wrong_kind)
        hotel = self.client.put(self.url(listing=listing), {"changes": {"barcode": "6291041500213"}}, format="json")
        self.assertEqual(hotel.status_code, 400)
        self.auth_owner()
        self.assertEqual(
            self.client.put(self.url(), {"changes": {"barcode": "6291041500213"}}, format="json").status_code, 200,
        )

    def test_variant_listing_cannot_move_to_a_category_without_variants(self):
        self.two_variants()
        refused = self.client.put(self.url(), {"changes": {"category": self.hotels.pk}}, format="json")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("category", refused.json())
        # and the ordinary full edit of a draft listing refuses it too
        draft = Listing.objects.create(
            business_owner=self.owner, category=self.shops, zone=self.zone, name="D", description="D.",
            contact_phone="+233207774001", status=Listing.DRAFT, price_amount="5.00",
        )
        ListingVariant.objects.create(listing=draft, label="A", price_amount="5.00")
        patch = self.client.patch(f"/api/listings/mine/{draft.pk}/", {"category": self.hotels.pk}, format="json")
        self.assertEqual(patch.status_code, 400)
        self.assertIn("category", patch.json())

    def test_adding_variants_to_a_service_listing_is_refused(self):
        hotel = Listing.objects.create(
            business_owner=self.owner, category=self.hotels, zone=self.zone, name="Lodge", description="L.",
            contact_phone="+233207774001", status=Listing.PUBLISHED, price_amount="50.00",
        )
        op = {"op": "add", "label": "Suite", "price_amount": "90.00"}
        response = self.client.put(self.url(listing=hotel), {"variants": [op]}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_another_owner_gets_404(self):
        self.send()
        self.auth_owner(self.other)
        for call in (
            self.client.get(self.url()), self.client.put(self.url(), {"changes": {"name": "X"}}, format="json"),
            self.client.delete(self.url()), self.client.post(self.url("submit/")),
        ):
            self.assertEqual(call.status_code, 404)

    # ── staff queue ──

    def test_queue_defaults_to_pending_and_falls_back_on_an_unknown_status(self):
        revision = self.send()
        self.auth_staff()
        for query in ("", "?status=bogus", "?status=pending"):
            rows = self.client.get(f"/api/listings/revisions/pending/{query}").json()
            self.assertEqual([row["id"] for row in rows], [revision.pk], query)
        self.assertEqual(self.client.get("/api/listings/revisions/pending/?status=approved").json(), [])
        self.client.credentials()
        self.assertIn(self.client.get("/api/listings/revisions/pending/").status_code, (401, 403))
        self.auth_owner()
        self.assertIn(self.client.get("/api/listings/revisions/pending/").status_code, (401, 403))

    def test_pending_oldest_first_history_by_reviewed_at(self):
        from datetime import timedelta
        from django.utils import timezone

        others = []
        for index in range(2):
            listing = Listing.objects.create(
                business_owner=self.owner, category=self.shops, zone=self.zone, name=f"L{index}", description="D.",
                contact_phone="+233207774001", status=Listing.PUBLISHED,
            )
            others.append(ListingRevision.objects.create(
                listing=listing, status="pending", changes={"name": f"N{index}"},
                submitted_at=timezone.now() - timedelta(hours=index),
            ))
        self.auth_staff()
        rows = self.client.get("/api/listings/revisions/pending/").json()
        self.assertEqual([row["id"] for row in rows], [others[1].pk, others[0].pk])
        now = timezone.now()
        ListingRevision.objects.filter(pk=others[0].pk).update(status="approved", reviewed_at=now - timedelta(days=1))
        ListingRevision.objects.filter(pk=others[1].pk).update(status="approved", reviewed_at=now)
        rows = self.client.get("/api/listings/revisions/pending/?status=approved").json()
        self.assertEqual([row["id"] for row in rows], [others[1].pk, others[0].pk])

    def test_staff_detail_has_the_full_diff(self):
        one, _ = self.two_variants()
        revision = self.send(
            changes={"name": "Better Cake", "tag": "New"},
            variants=[{"op": "remove", "id": one.pk}, {"op": "add", "label": "Mango", "price_amount": "15", "stock_quantity": 2}],
        )
        self.auth_staff()
        detail = self.client.get(f"/api/listings/revisions/{revision.pk}/").json()
        self.assertEqual(detail["diff"]["fields"]["name"], {"old": "Cake", "new": "Better Cake"})
        self.assertEqual(detail["diff"]["fields"]["tag"], {"old": None, "new": "New"})
        self.assertEqual(detail["diff"]["variants"][0]["current_label"], "Vanilla")
        self.assertEqual(detail["diff"]["variants"][1]["label"], "Mango")
        self.assertIn("media", detail["diff"])

    def test_approve_applies_changes_and_stamps_reviewer(self):
        revision = self.send(changes={"name": "Better Cake", "specs": [{"label": "Size", "value": "L"}], "zone": self.zone.pk})
        self.auth_staff()
        response = self.client.post(f"/api/listings/revisions/{revision.pk}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        self.refresh()
        self.assertEqual((self.listing.name, self.listing.specs), ("Better Cake", [{"label": "Size", "value": "L"}]))
        self.assertEqual(self.listing.status, Listing.PUBLISHED)
        revision.refresh_from_db()
        self.assertEqual((revision.status, revision.reviewed_by_id), ("approved", self.staff.pk))
        self.assertIsNotNone(revision.reviewed_at)
        note = Notification.objects.get(business_owner=self.owner, title="Changes published")
        self.assertEqual(note.kind, "listing_approved")
        # approving twice is refused
        self.assertEqual(self.client.post(f"/api/listings/revisions/{revision.pk}/approve/").status_code, 400)

    def test_approve_swaps_the_main_photo_and_removes_queued_gallery_photos(self):
        gallery = ListingPhoto.objects.create(listing=self.listing, image=png("g.png"), order=0)
        keep = ListingPhoto.objects.create(listing=self.listing, image=png("k.png"), order=1)
        self.listing.main_photo = png("old.png")
        self.listing.save()
        response = self.client.put(
            self.url(), {"remove_photo_ids": f"[{gallery.pk}]", "new_main_photo": png("fresh.png")}, format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn("fresh", response.json()["new_main_photo"])
        revision = ListingRevision.objects.get(pk=response.json()["id"])
        self.assertEqual(self.client.post(self.url("submit/")).status_code, 200)
        self.assertIn("old", self.refresh().main_photo.name)
        self.auth_staff()
        self.assertEqual(self.client.post(f"/api/listings/revisions/{revision.pk}/approve/").status_code, 200)
        self.assertIn("fresh", self.refresh().main_photo.name)
        self.assertEqual(list(self.listing.photos.values_list("pk", flat=True)), [keep.pk])
        revision.refresh_from_db()
        self.assertFalse(revision.new_main_photo)

    def test_review_focus_apply_never_touches_price_or_stock_of_existing_rows(self):
        one, two = self.two_variants()
        revision = self.send(variants=[{"op": "update", "id": one.pk, "label": "Plain vanilla", "position": 5}])
        # The owner changes the live price and stock after sending; the approval must keep them.
        self.client.patch(f"/api/listings/mine/{self.listing.pk}/variants/{one.pk}/live/", {"price_amount": "22.00", "stock_quantity": 1}, format="json")
        self.auth_staff()
        self.assertEqual(self.client.post(f"/api/listings/revisions/{revision.pk}/approve/").status_code, 200)
        one.refresh_from_db()
        self.assertEqual((one.label, one.position, str(one.price_amount), one.stock_quantity), ("Plain vanilla", 5, "22.00", 1))
        self.assertEqual((str(self.refresh().price_amount), self.listing.stock_quantity), ("22.00", 7))

    def test_a_variant_update_that_carries_price_or_stock_is_refused(self):
        one, _ = self.two_variants()
        for extra in ({"price_amount": "1.00"}, {"stock_quantity": 3}):
            response = self.client.put(self.url(), {"variants": [{"op": "update", "id": one.pk, **extra}]}, format="json")
            self.assertEqual(response.status_code, 400, extra)

    def test_variant_ops_are_checked_against_the_result(self):
        one, two = self.two_variants()
        # another listing's variant
        other_listing = Listing.objects.create(
            business_owner=self.other, category=self.shops, zone=self.zone, name="O", description="O.",
            contact_phone="+233207774002", status=Listing.PUBLISHED,
        )
        foreign = ListingVariant.objects.create(listing=other_listing, label="Foreign", price_amount="5.00")
        put = lambda ops: self.client.put(self.url(), {"variants": ops}, format="json").status_code
        self.assertEqual(put([{"op": "remove", "id": foreign.pk}]), 400)
        self.assertEqual(put([{"op": "add", "label": "vanilla", "price_amount": "5.00"}]), 400)  # duplicate name
        self.assertEqual(put([{"op": "remove", "id": one.pk}, {"op": "add", "label": "vanilla", "price_amount": "5"}]), 200)
        self.assertEqual(put([{"op": "add", "label": "X", "price_amount": "0"}]), 400)
        self.assertEqual(put([{"op": "add", "label": "X", "price_amount": "5", "attributes": {"a": 1}}]), 400)
        self.assertEqual(put([{"op": "update", "id": one.pk}, {"op": "remove", "id": one.pk}]), 400)
        self.assertEqual(put([{"op": "explode"}]), 400)
        many = [{"op": "add", "label": f"V{n}", "price_amount": "1"} for n in range(39)]
        self.assertEqual(put(many), 400)  # 2 existing + 39 > 40

    def test_apply_creates_new_variants_with_initial_price_and_stock_and_deactivates_removed(self):
        one, two = self.two_variants()
        revision = self.send(variants=[
            {"op": "remove", "id": one.pk},
            {"op": "add", "label": "Mango", "attributes": {"size": "500 g"}, "price_amount": "15.00", "stock_quantity": 2},
        ])
        self.auth_staff()
        self.assertEqual(self.client.post(f"/api/listings/revisions/{revision.pk}/approve/").status_code, 200)
        one.refresh_from_db()
        self.assertFalse(one.is_active)
        self.assertTrue(ListingVariant.objects.filter(pk=one.pk).exists())  # kept for old orders
        mango = ListingVariant.objects.get(listing=self.listing, label="Mango")
        self.assertEqual((str(mango.price_amount), mango.stock_quantity, mango.attributes), ("15.00", 2, {"size": "500 g"}))
        self.assertGreater(mango.position, two.position)
        self.refresh()
        self.assertEqual((str(self.listing.price_amount), self.listing.stock_quantity), ("15.00", 8))

    def test_adding_variants_to_a_listing_that_had_none_is_allowed(self):
        revision = self.send(variants=[{"op": "add", "label": "Small", "price_amount": "8.00", "stock_quantity": 3}])
        self.auth_staff()
        self.assertEqual(self.client.post(f"/api/listings/revisions/{revision.pk}/approve/").status_code, 200)
        self.assertEqual((str(self.refresh().price_amount), self.listing.stock_quantity), ("8.00", 3))

    def test_reject_needs_a_reason_and_owner_can_edit_and_resubmit(self):
        revision = self.send()
        self.auth_staff()
        url = f"/api/listings/revisions/{revision.pk}/reject/"
        self.assertEqual(self.client.post(url, {"reason": "  "}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"reason": "Too vague"}, format="json").status_code, 200)
        revision.refresh_from_db()
        self.assertEqual((revision.status, revision.rejection_reason, revision.reviewed_by_id), ("rejected", "Too vague", self.staff.pk))
        self.assertIn("Too vague", Notification.objects.get(business_owner=self.owner, kind="listing_rejected").body)
        self.assertEqual(self.refresh().name, "Cake")
        self.auth_owner()
        self.assertEqual(self.client.get(f"/api/listings/mine/{self.listing.pk}/revision/").json()["status"], "rejected")
        edited = self.client.put(self.url(), {"changes": {"name": "Clearer Cake"}}, format="json").json()
        self.assertEqual((edited["id"], edited["status"]), (revision.pk, "draft"))
        resent = self.client.post(self.url("submit/")).json()
        self.assertEqual((resent["id"], resent["status"], resent["rejection_reason"]), (revision.pk, "pending", None))

    def test_re_review_400s_unless_rejected_and_clears_the_pair(self):
        revision = self.send()
        self.auth_staff()
        url = f"/api/listings/revisions/{revision.pk}/re-review/"
        self.assertEqual(self.client.post(url).status_code, 400)
        self.client.post(f"/api/listings/revisions/{revision.pk}/reject/", {"reason": "No"}, format="json")
        listed = self.client.get("/api/listings/revisions/pending/?status=rejected").json()
        self.assertEqual([row["id"] for row in listed], [revision.pk])
        self.assertEqual(self.client.post(url).status_code, 200)
        revision.refresh_from_db()
        self.assertEqual((revision.status, revision.rejection_reason, revision.reviewed_by_id, revision.reviewed_at), ("pending", None, None, None))

    def test_queue_row_names_the_staff_member_who_made_the_revision(self):
        revision = self.send()
        self.auth_staff()
        row = self.client.get("/api/listings/revisions/pending/").json()[0]
        self.assertFalse(row["made_by_staff"])
        self.assertIsNone(row["created_by_staff"])
        ListingRevision.objects.filter(pk=revision.pk).update(created_by_staff=self.staff)
        row = self.client.get("/api/listings/revisions/pending/").json()[0]
        self.assertEqual((row["made_by_staff"], row["created_by_staff"]), (True, self.staff.pk))
        self.assertEqual(self.client.get(f"/api/listings/revisions/{revision.pk}/").json()["created_by_staff"], self.staff.pk)

    def test_review_focus_the_creator_cannot_approve(self):
        revision = self.send()
        ListingRevision.objects.filter(pk=revision.pk).update(created_by_staff=self.staff)
        self.auth_staff()
        denied = self.client.post(f"/api/listings/revisions/{revision.pk}/approve/")
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.json(), {"detail": "You made this, so someone else must approve it."})
        self.assertEqual(ListingRevision.objects.get(pk=revision.pk).status, "pending")
        # a different reviewer can
        self.auth_staff(make_staff("second@example.com"))
        self.assertEqual(self.client.post(f"/api/listings/revisions/{revision.pk}/approve/").status_code, 200)
        # the same guard on approving a listing
        pending = Listing.objects.create(
            business_owner=self.owner, category=self.shops, zone=self.zone, name="Scout made", description="S.",
            contact_phone="+233207774001", status=Listing.PENDING_REVIEW, created_by_staff=self.staff,
        )
        self.auth_staff()
        denied = self.client.post(f"/api/listings/moderation/{pending.pk}/approve/")
        self.assertEqual(denied.status_code, 403)
        # the listing endpoints keep the staff pipeline's body (its UI reads code own_listing); a revision keeps its own message
        self.assertEqual(denied.json(), {"detail": OWN_LISTING, "code": "own_listing"})
        self.assertTrue(revisions.cannot_decide(self.staff, pending))
        self.assertFalse(revisions.cannot_decide(self.staff, self.listing))

    def test_discard_deletes_the_revision_and_staged_rows(self):
        response = self.client.put(self.url(), {"changes": '{"name": "X"}', "new_main_photo": png("staged.png")}, format="multipart")
        self.assertEqual(response.status_code, 200, response.content)
        revision = ListingRevision.objects.get(pk=response.json()["id"])
        storage = revision.new_main_photo.storage
        name = revision.new_main_photo.name
        self.assertTrue(storage.exists(name))
        self.assertEqual(self.client.delete(self.url()).status_code, 204)
        self.assertFalse(ListingRevision.objects.filter(pk=revision.pk).exists())
        self.assertFalse(storage.exists(name))
        self.assertEqual(self.client.get(self.url()).status_code, 404)

    def test_discontinue_deletes_the_open_revision(self):
        self.draft()
        self.assertEqual(self.client.post(f"/api/listings/mine/{self.listing.pk}/discontinue/").status_code, 200)
        self.assertFalse(ListingRevision.objects.filter(listing=self.listing).exists())

    def test_approving_a_revision_for_a_dropped_listing_keeps_it_dropped(self):
        self.assertEqual(self.client.post(f"/api/listings/mine/{self.listing.pk}/drop/").status_code, 200)
        revision = self.send(changes={"name": "Quiet change"})
        self.auth_staff()
        self.assertEqual(self.client.post(f"/api/listings/revisions/{revision.pk}/approve/").status_code, 200)
        self.refresh()
        self.assertEqual((self.listing.name, self.listing.status), ("Quiet change", Listing.DROPPED))

    def test_a_discontinued_listing_cannot_be_revised(self):
        Listing.objects.filter(pk=self.listing.pk).update(status=Listing.DISCONTINUED)
        self.assertEqual(self.client.put(self.url(), {"changes": {"name": "X"}}, format="json").status_code, 400)

    # ── fix round 1 ──

    def test_over_long_or_over_large_variant_ops_are_a_400_at_put(self):
        one, _ = self.two_variants()
        put = lambda op: self.client.put(self.url(), {"variants": [op]}, format="json").status_code
        self.assertEqual(put({"op": "add", "label": "x" * 101, "price_amount": "5"}), 400)
        self.assertEqual(put({"op": "update", "id": one.pk, "label": "y" * 101}), 400)
        self.assertEqual(put({"op": "update", "id": one.pk, "position": 32768}), 400)
        self.assertEqual(put({"op": "add", "label": "Big", "price_amount": "5", "stock_quantity": 1000001}), 400)
        self.assertEqual(put({"op": "update", "id": one.pk, "position": 32767}), 200)
        self.assertEqual(put({"op": "add", "label": "Big", "price_amount": "5", "stock_quantity": 1000000}), 200)
        live = self.client.patch(
            f"/api/listings/mine/{self.listing.pk}/variants/{one.pk}/live/", {"stock_quantity": 1000001}, format="json",
        )
        self.assertEqual(live.status_code, 400)

    def test_approve_rechecks_the_changes_and_answers_400_not_500(self):
        revision = self.send(changes={"name": "Better"})
        ListingRevision.objects.filter(pk=revision.pk).update(changes={"category": 999999})
        self.auth_staff()
        response = self.client.post(f"/api/listings/revisions/{revision.pk}/approve/")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(ListingRevision.objects.get(pk=revision.pk).status, "pending")

    def test_approving_a_revision_that_was_just_deleted_is_a_400(self):
        revision = self.send()
        ListingRevision.objects.filter(pk=revision.pk).delete()
        with self.assertRaises(revisions.RevisionError):
            revisions.apply_revision(revision, self.staff)

    def test_discontinue_removes_the_staged_file_too(self):
        response = self.client.put(self.url(), {"new_main_photo": png("gone.png")}, format="multipart")
        revision = ListingRevision.objects.get(pk=response.json()["id"])
        storage, name = revision.new_main_photo.storage, revision.new_main_photo.name
        self.assertTrue(storage.exists(name))
        self.client.post(f"/api/listings/mine/{self.listing.pk}/discontinue/")
        self.assertFalse(storage.exists(name))

    def test_changes_published_note_says_saved_for_a_dropped_listing(self):
        self.client.post(f"/api/listings/mine/{self.listing.pk}/drop/")
        revision = self.send(changes={"name": "Quiet"})
        self.auth_staff()
        self.client.post(f"/api/listings/revisions/{revision.pk}/approve/")
        note = Notification.objects.get(business_owner=self.owner, title="Changes published")
        self.assertIn("saved", note.body)
        self.assertNotIn("now live", note.body)
