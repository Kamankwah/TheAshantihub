"""The three scout approval kinds (Task 9): what approving applies, what makes
a request stale or refused, and what the approver sees."""
from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff
from approvals import registry, services
from approvals.models import ApprovalRequest
from approvals.services import STALE_MESSAGE, ApprovalError, StaleRequest
from listings.models import Category, Listing, ListingPhoto, Zone
from listings.serializers import validate_listing_for_owner
from notifications.models import Notification
from portfolio import proposals
from portfolio.models import AppliedChange, StagedPhoto
from portfolio.tests.change_fixtures import ChangeTestBase, jpeg, make_business, make_listing, product_body


class KindsRegisteredTests(TestCase):
    def test_the_three_kinds_are_registered(self):
        for key, label in (
            ("business.update", "Business details change"),
            ("listing.create", "New product or service"),
            ("listing.photos", "Listing photos"),
        ):
            kind = registry.get_kind(key)
            self.assertEqual((kind.label, kind.pool_permission, kind.response_hours), (label, "portfolio.manage", 24))
            self.assertIsNotNone(kind.render_diff)
            self.assertIsNotNone(kind.validate)


class BusinessUpdateKindTests(ChangeTestBase):
    def propose(self, fields, reason="Owner asked"):
        return proposals.propose_update(self.scout, self.owner, fields, reason=reason)

    def profile(self):
        return BusinessOwnerProfile.objects.get(business_owner=self.owner)

    def test_approving_applies_the_change_and_tells_the_owner(self):
        adum = Zone.objects.get(name="Adum")
        approval = self.propose({"business_name": "Abena Kente Palace", "zone_id": adum.id})
        services.approve(approval.pk, self.lead)
        profile = self.profile()
        self.assertEqual((profile.business_name, profile.zone_id), ("Abena Kente Palace", adum.id))
        change = AppliedChange.objects.get(approval=approval)
        self.assertEqual(
            (change.business_owner, change.kind, change.summary, change.result),
            (self.owner, "business.update", "Changed business name and area", {}),
        )
        self.assertEqual(change.undo_until - change.applied_at, timedelta(days=7))
        self.assertIsNone(change.undone_at)
        note = Notification.objects.get(business_owner=self.owner, kind="account_manager_change")
        self.assertEqual(
            (note.title, note.link),
            ("Your account manager Kwame changed your business name and area", "/business-dashboard"),
        )

    def test_the_approver_sees_plain_words(self):
        approval = self.propose({"zone_id": Zone.objects.get(name="Adum").id, "business_name": "Abena Kente Palace"})
        self.assertEqual(services.diff_rows(approval), [
            {"field": "Business name", "before": "Abena Kente House", "after": "Abena Kente Palace"},
            {"field": "Area", "before": "Manhyia", "after": "Adum"},
        ])
        self.as_staff(self.lead)
        self.assertEqual(self.client.get(f"/api/approvals/{approval.pk}/").json()["diff"], services.diff_rows(approval))

    def test_moving_the_pin_marks_it_as_set_by_the_scout(self):
        approval = self.propose({"lat": "6.7012341", "lng": "-1.62", "location_accuracy_m": 9})
        started = timezone.now()
        services.approve(approval.pk, self.lead)
        profile = self.profile()
        self.assertEqual(
            (profile.lat, profile.lng, profile.location_accuracy_m, profile.location_is_manual),
            (Decimal("6.701234"), Decimal("-1.620000"), 9, False),
        )
        self.assertEqual(profile.location_set_by, "scout")
        self.assertGreaterEqual(profile.location_set_at, started)
        self.assertEqual(AppliedChange.objects.get(approval=approval).result["location_set_by_before"], "owner")

    def test_a_second_change_to_the_same_field_goes_stale_once_the_first_is_approved(self):
        first = self.propose({"business_name": "Abena Kente Palace"})
        second = self.propose({"business_name": "Abena Fabrics"})
        other_field = self.propose({"opening_hours": "Mon–Sun 7am–8pm"})
        services.approve(first.pk, self.lead)
        self.as_staff(self.lead)
        response = self.client.post(f"/api/approvals/{second.pk}/approve/", {}, format="json")
        self.assertEqual((response.status_code, response.json()["detail"]), (409, STALE_MESSAGE))
        # A pending change to a different field is not stale.
        self.assertEqual(self.client.post(f"/api/approvals/{other_field.pk}/approve/", {}, format="json").status_code, 200)
        profile = self.profile()
        self.assertEqual((profile.business_name, profile.opening_hours), ("Abena Kente Palace", "Mon–Sun 7am–8pm"))
        self.assertEqual(ApprovalRequest.objects.get(pk=second.pk).status, ApprovalRequest.PENDING)

    def test_approving_re_runs_the_duplicate_check(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(claimed_at=None)
        approval = self.propose({"login_phone": "024 555 0101"})
        BusinessOwner.objects.create(full_name="Yaa Asantewaa", login_phone="0245550101", password_hash="x")
        self.as_staff(self.lead)
        response = self.client.post(f"/api/approvals/{approval.pk}/approve/", {}, format="json")
        self.assertEqual((response.status_code, response.json()["detail"]), (400, proposals.DUPLICATE_PHONE))
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.login_phone, "+233244100200")
        self.assertFalse(AppliedChange.objects.exists())

    def test_a_new_sign_in_phone_is_stored_in_plus_233_form(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(claimed_at=None)
        approval = self.propose({"login_phone": "024 555 0101"})
        services.approve(approval.pk, self.lead)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.login_phone, "+233245550101")

    def decide_address(self):
        decided_at = timezone.now() - timedelta(days=3)
        BusinessOwnerProfile.objects.filter(business_owner=self.owner).update(
            address_verified=True, address_verified_by=self.lead, address_verified_at=decided_at,
        )
        return decided_at

    def test_a_new_ghana_post_address_clears_the_address_decision(self):
        decided_at = self.decide_address()
        approval = self.propose({"gps_address": "ak-041-7788"})
        services.approve(approval.pk, self.lead)
        profile = self.profile()
        self.assertEqual(
            (profile.gps_address, profile.address_verified, profile.address_verified_by, profile.address_verified_at),
            ("AK-041-7788", False, None, None),
        )
        self.assertEqual(AppliedChange.objects.get(approval=approval).result, {
            "address_verified_before": True,
            "address_verified_by_id_before": self.lead.pk,
            "address_verified_at_before": decided_at.isoformat(),
        })

    def test_other_changes_keep_the_address_decision(self):
        decided_at = self.decide_address()
        approval = self.propose({"business_name": "Abena Kente Palace"})
        services.approve(approval.pk, self.lead)
        profile = self.profile()
        self.assertEqual(
            (profile.address_verified, profile.address_verified_by, profile.address_verified_at),
            (True, self.lead, decided_at),
        )
        self.assertEqual(AppliedChange.objects.get(approval=approval).result, {})

    def test_kyc_waits_for_a_decision_on_the_new_address(self):
        # A scout-registered business still waiting for KYC: the new address
        # must be decided again before either door approves it.
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status=BusinessOwner.PENDING)
        self.decide_address()
        approval = self.propose({"gps_address": "AK-041-7788"})
        services.approve(approval.pk, self.lead)
        self.as_staff(self.lead)
        response = self.client.post(f"/api/accounts/kyc/{self.owner.pk}/approve/", {}, format="json")
        self.assertEqual(
            (response.status_code, response.json()), (400, {"detail": "Record the Ghana Post address decision first."}),
        )
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.kyc_status, BusinessOwner.PENDING)


class UpdateGuardsAtApprovalTests(ChangeTestBase):
    def approve_error(self, approval):
        self.as_staff(self.lead)
        response = self.client.post(f"/api/approvals/{approval.pk}/approve/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        return response.json()["detail"]

    def test_an_owner_who_claims_before_approval_keeps_their_sign_in(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(claimed_at=None)
        approval = proposals.propose_update(self.scout, self.owner, {"email": "me@example.com"}, reason="Asked")
        BusinessOwner.objects.filter(pk=self.owner.pk).update(claimed_at=timezone.now())
        self.assertEqual(self.approve_error(approval), "Sign-in email is changed by the owner once they have a login.")
        self.owner.refresh_from_db()
        self.assertIsNone(self.owner.email)

    def test_a_staff_phone_added_after_the_proposal_is_refused(self):
        approval = proposals.propose_update(
            self.scout, self.owner, {"business_contact_phone": "0201112223"}, reason="Asked")
        make_staff("accountant", "pat@example.com", phone="0201112223")
        self.assertEqual(self.approve_error(approval), proposals.STAFF_PHONE)
        self.assertFalse(AppliedChange.objects.exists())


class ListingCreateKindTests(ChangeTestBase):
    def propose(self, listing=None):
        main, extra = self.staged(), self.staged()
        approval = proposals.propose_listing(
            self.scout, self.owner, listing or product_body(), main_photo_id=main.pk, photo_ids=[extra.pk],
            reason="Owner showed me the stock",
        )
        return approval, main, extra

    def test_approving_publishes_the_listing_for_the_public(self):
        approval, main, extra = self.propose()
        services.approve(approval.pk, self.lead)
        listing = Listing.objects.get(business_owner=self.owner)
        self.assertEqual(
            (listing.status, listing.created_by_staff, listing.reviewed_by),
            (Listing.PUBLISHED, self.scout, self.lead),
        )
        self.assertIsNotNone(listing.reviewed_at)
        self.assertEqual((listing.contact_phone, listing.zone.name), ("+233244100200", "Adum"))
        self.assertTrue(listing.main_photo.name.startswith("listing_photos/main/"))
        self.assertEqual(listing.photos.count(), 1)
        self.assertEqual(StagedPhoto.objects.filter(pk__in=[main.pk, extra.pk], used_at__isnull=False).count(), 2)
        change = AppliedChange.objects.get(approval=approval)
        self.assertEqual(
            (change.kind, change.summary, change.result),
            ("listing.create", "Added “Kente stole”", {"listing_id": listing.pk}),
        )
        self.assertTrue(Notification.objects.filter(
            business_owner=self.owner, kind="account_manager_change",
            title="Your account manager Kwame added “Kente stole”",
        ).exists())
        public = self.client.get("/api/listings/").json()["results"]
        self.assertIn(listing.pk, [row["id"] for row in public])

    def test_approving_while_kyc_is_pending_is_refused(self):
        approval, _, _ = self.propose()
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status=BusinessOwner.PENDING)
        self.as_staff(self.lead)
        response = self.client.post(f"/api/approvals/{approval.pk}/approve/", {}, format="json")
        self.assertEqual((response.status_code, response.json()["detail"]), (400, "Approve the business's KYC first."))
        self.assertFalse(Listing.objects.filter(business_owner=self.owner).exists())
        self.assertEqual(ApprovalRequest.objects.get(pk=approval.pk).status, ApprovalRequest.PENDING)

    def test_a_photo_can_only_be_used_once(self):
        main = self.staged()
        first = proposals.propose_listing(self.scout, self.owner, product_body(), main_photo_id=main.pk,
                                          photo_ids=[], reason="Owner asked")
        second = proposals.propose_listing(self.scout, self.owner, product_body(name="Kente cloth"),
                                           main_photo_id=main.pk, photo_ids=[], reason="Owner asked")
        services.approve(first.pk, self.lead)
        with self.assertRaisesMessage(ApprovalError, proposals.PHOTOS_UNAVAILABLE):
            services.approve(second.pk, self.lead)
        self.assertEqual(Listing.objects.filter(business_owner=self.owner).count(), 1)

    def test_the_plans_listing_limit_is_checked_again_on_approval(self):
        approval, _, _ = self.propose()
        for n in range(5):
            make_listing(self.owner, name=f"Stole {n}")
        with self.assertRaisesMessage(ApprovalError, proposals.LISTING_LIMIT):
            services.approve(approval.pk, self.lead)

    def test_the_approver_sees_the_listing_and_its_photos(self):
        approval, main, extra = self.propose()
        rows = {row["field"]: row for row in services.diff_rows(approval)}
        self.assertEqual(rows["Name"], {"field": "Name", "before": None, "after": "Kente stole"})
        self.assertEqual((rows["Category"]["after"], rows["Area"]["after"], rows["Warranty"]["after"]), ("Shops", "Adum", "No"))
        self.assertEqual(rows["Main photo"], {"field": "Main photo", "before": None, "after": {"images": [main.image.url]}})
        self.assertEqual(rows["Photos"], {"field": "Photos", "before": None, "after": {"images": [extra.image.url]}})


class ListingPhotosKindTests(ChangeTestBase):
    def setUp(self):
        super().setUp()
        self.listing = make_listing(self.owner)
        self.own_photo = ListingPhoto.objects.create(listing=self.listing, image=jpeg("own.jpg"), order=3)

    def test_approving_attaches_the_photos_after_the_owners_own(self):
        first, second = self.staged(), self.staged()
        approval = proposals.propose_photos(self.scout, self.listing, photo_ids=[first.pk, second.pk], reason="Better light")
        services.approve(approval.pk, self.lead)
        added = list(self.listing.photos.exclude(pk=self.own_photo.pk).order_by("order"))
        self.assertEqual([photo.order for photo in added], [4, 5])
        self.listing.refresh_from_db()
        self.assertTrue(self.listing.main_photo.name.startswith("listing_photos/main/"))
        change = AppliedChange.objects.get(approval=approval)
        self.assertEqual(change.result["photo_ids"], [photo.pk for photo in added])
        self.assertTrue(change.result["set_main_photo"])
        self.assertEqual(change.summary, "Added 2 photos to “Kente stole”")
        self.assertTrue(Notification.objects.filter(
            business_owner=self.owner, kind="account_manager_change", title="Your account manager Kwame added 2 photos",
        ).exists())
        self.assertEqual(services.diff_rows(approval), [
            {"field": "Listing", "before": None, "after": "Kente stole"},
            {"field": "Photos", "before": None, "after": {"images": [first.image.url, second.image.url]}},
        ])

    def test_an_existing_main_photo_is_kept(self):
        self.listing.main_photo.save("main.jpg", jpeg("main.jpg"), save=True)
        original = self.listing.main_photo.name
        approval = proposals.propose_photos(self.scout, self.listing, photo_ids=[self.staged().pk], reason="More angles")
        services.approve(approval.pk, self.lead)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.main_photo.name, original)
        self.assertFalse(AppliedChange.objects.get(approval=approval).result["set_main_photo"])

    def test_a_deleted_listing_makes_the_request_stale(self):
        approval = proposals.propose_photos(self.scout, self.listing, photo_ids=[self.staged().pk], reason="More angles")
        Listing.objects.filter(pk=self.listing.pk).delete()
        with self.assertRaisesMessage(StaleRequest, STALE_MESSAGE):
            services.approve(approval.pk, self.lead)


class SharedListingRulesTests(ChangeTestBase):
    def test_the_owner_listing_rules_run_for_any_given_owner(self):
        unsubscribed = make_business(self.scout, phone="+233244900900", name="Kofi Spare Parts", gps="AK-100-2000",
                                     subscribed=False)
        shops = Category.objects.get(slug="shops")
        with self.assertRaises(ValidationError) as ctx:
            validate_listing_for_owner(unsubscribed, {"category": shops}, initial_data={})
        self.assertIn("subscription", ctx.exception.detail)
        data = {"category": shops, "return_policy": "Exchange within 7 days."}
        self.assertIs(
            validate_listing_for_owner(self.owner, data, initial_data={"has_warranty": False, "has_expiry": False}),
            data,
        )
