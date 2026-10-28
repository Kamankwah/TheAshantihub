"""The approval kind listing.staff_create (plan M3, Task 7): a staff-made listing goes live only after the owner confirmed
it and a second person approved it; the submit-at-confirm, deferred-until-KYC and retry paths; and the legacy doors."""
import json
from datetime import timedelta

from django.utils import timezone

from accounts import kyc
from accounts.models import BusinessOwner
from accounts.testing import make_staff
from approvals import services as approvals
from approvals.models import ApprovalRequest
from approvals.services import ApprovalError, MakerCannotDecide, StaleRequest
from events.models import Event
from listings.models import Listing, Zone
from portfolio import confirmations, staff_listing_kind
from portfolio.models import ListingDraft, OwnerConfirmation, StagedPhoto
from portfolio.tests.test_staff_drafts import DraftBase
from staff_tasks.models import Task
from targets import services as targets


class Base(DraftBase):
    def setUp(self):
        super().setUp()
        self.second = self.make_ops("beta@example.com")

    def make_ops(self, email):
        return make_staff("operations", email)

    def confirmed(self, maker=None, owner=None, **extra):
        """A draft made by `maker`, sent, and confirmed by the owner through the real link."""
        self.as_staff(maker or self.scout)
        draft = self.make_draft(owner, **extra)
        self.send([draft], owner)
        confirmations.confirm(self.raw())
        draft.refresh_from_db()
        return draft

    def approval_of(self, draft):
        draft.refresh_from_db()
        return ApprovalRequest.objects.get(pk=draft.approval_id)

    def event_body(self, **extra):
        return {
            "kind": "event", "category": self.event_cat.pk, "zone": Zone.objects.get(name="Adum").pk, "name": "Launch",
            "description": "Opening party", "address": "Adum high street",
            "event_date": (timezone.now() + timedelta(days=20)).isoformat(), "visibility_days": 30, **extra,
        }


class SubmitAtConfirmTests(Base):
    def test_scout_draft_confirmed_by_owner_creates_pending_approval_not_listing(self):
        draft = self.confirmed()
        approval = self.approval_of(draft)
        self.assertEqual(draft.status, "submitted")
        self.assertEqual((approval.kind, approval.status, approval.maker), ("listing.staff_create", "pending", self.scout))
        self.assertEqual(approval.payload, {"draft_id": draft.pk})
        self.assertFalse(Listing.objects.filter(business_owner=self.owner).exists())

    def test_operations_approves_scout_listing_publishes_with_created_by_staff(self):
        draft = self.confirmed()
        approvals.approve(draft.approval_id, self.lead)
        listing = Listing.objects.get(business_owner=self.owner)
        self.assertEqual(
            (listing.status, listing.created_by_staff, listing.reviewed_by, listing.name),
            ("published", self.scout, self.lead, "Kente stole"),
        )
        self.assertIsNotNone(listing.reviewed_at)

    def test_the_general_manager_may_approve_it_too(self):
        draft = self.confirmed()
        approvals.approve(draft.approval_id, self.gm)
        self.assertTrue(Listing.objects.filter(business_owner=self.owner, created_by_staff=self.scout).exists())

    def test_super_admin_made_listing_waits_for_someone_else(self):
        draft = self.confirmed(maker=self.admin)
        approval = self.approval_of(draft)
        self.assertEqual(approval.status, "pending")
        self.assertFalse(Listing.objects.filter(business_owner=self.owner).exists())
        with self.assertRaises(MakerCannotDecide):
            approvals.approve(approval.pk, self.admin)
        approvals.approve(approval.pk, self.lead)
        self.assertEqual(Listing.objects.get(business_owner=self.owner).created_by_staff, self.admin)

    def test_operations_made_listing_cannot_be_approved_by_that_operations_user(self):
        draft = self.confirmed(maker=self.lead)
        with self.assertRaises(MakerCannotDecide):
            approvals.approve(draft.approval_id, self.lead)
        approvals.approve(draft.approval_id, self.second)
        self.assertEqual(Listing.objects.get(business_owner=self.owner).created_by_staff, self.lead)

    def test_unconfirmed_draft_cannot_be_approved(self):
        self.as_staff(self.scout)
        draft = self.make_draft()  # still a draft: the owner never confirmed it
        approval = approvals.submit(
            self.scout, "listing.staff_create", title="x", payload={"draft_id": draft.pk},
            target_type="portfolio.listingdraft", target_id=str(draft.pk), target_label="x",
        )
        with self.assertRaises(ApprovalError):
            approvals.approve(approval.pk, self.lead)
        self.assertFalse(Listing.objects.filter(business_owner=self.owner).exists())

    def test_lapsed_confirmation_blocks_submit(self):
        self.as_staff(self.scout)
        draft = self.make_draft()
        self.send([draft])
        OwnerConfirmation.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        draft.refresh_from_db()
        with self.assertRaises(ApprovalError):
            staff_listing_kind.submit_draft(draft)
        self.assertFalse(ApprovalRequest.objects.filter(kind="listing.staff_create").exists())

    def test_event_draft_apply_creates_approved_unpaid_event(self):
        self.as_staff(self.scout)
        draft = ListingDraft.objects.get(pk=self.call("post", self.url(), self.event_body()).json()["id"])
        self.send([draft])
        confirmations.confirm(self.raw())
        approvals.approve(self.approval_of(draft).pk, self.lead)
        event = Event.objects.get()
        self.assertEqual(
            (event.status, event.submitted_by_business, event.created_by_staff, event.approved_by, event.reviewed_by),
            ("approved", self.owner, self.scout, self.lead, self.lead),
        )
        self.assertIsNotNone(event.reviewed_at)
        self.assertIsNone(event.paid_at)

    def test_a_scouts_approved_event_draft_counts_in_the_listings_target_on_the_approval_day(self):
        self.as_staff(self.scout)
        draft = ListingDraft.objects.get(pk=self.call("post", self.url(), self.event_body()).json()["id"])
        self.send([draft])
        confirmations.confirm(self.raw())
        today = timezone.localdate()
        self.assertEqual(targets.actual(self.scout, "listings", today, today), 0)  # submitted is not counted
        approvals.approve(self.approval_of(draft).pk, self.lead)
        self.assertEqual(targets.actual(self.scout, "listings", today, today), 1)
        tomorrow = today + timedelta(days=1)
        self.assertEqual(targets.actual(self.scout, "listings", tomorrow, tomorrow), 0)

    def test_stay_draft_creates_accommodation_listing(self):
        self.as_staff(self.scout)
        body = self.service_body(
            kind="stay", category=self.stay_cat.pk, name="Room 1", units_total=4, price_amount="300.00", price_unit="night",
        )
        draft = ListingDraft.objects.get(pk=self.call("post", self.url(self.salon), body).json()["id"])
        self.send([draft], self.salon)
        confirmations.confirm(self.raw())
        approvals.approve(self.approval_of(draft).pk, self.lead)
        listing = Listing.objects.get(business_owner=self.salon)
        self.assertEqual((listing.category, listing.units_total, listing.created_by_staff), (self.stay_cat, 4, self.scout))

    def test_a_staged_photo_is_copied_and_marked_used(self):
        photo = self.staged()
        draft = self.confirmed(main_photo_id=photo.pk)
        approvals.approve(draft.approval_id, self.lead)
        self.assertTrue(Listing.objects.get(business_owner=self.owner).main_photo)
        self.assertIsNotNone(StagedPhoto.objects.get(pk=photo.pk).used_at)

    def test_reject_returns_task_to_maker(self):
        draft = self.confirmed()
        approvals.reject(draft.approval_id, self.lead, "Wrong price")
        draft.refresh_from_db()
        self.assertEqual((draft.status, draft.confirmation), ("draft", None))
        task = Task.objects.get(kind=Task.RETURNED_APPROVAL)
        self.assertEqual((task.owner, task.business_owner), (self.scout, self.owner))
        self.assertFalse(Listing.objects.filter(business_owner=self.owner).exists())

    def test_stale_approval_409_when_owner_suspended(self):
        draft = self.confirmed()
        BusinessOwner.objects.filter(pk=self.owner.pk).update(is_suspended=True)
        with self.assertRaises(StaleRequest):
            approvals.approve(draft.approval_id, self.lead)
        self.assertFalse(Listing.objects.filter(business_owner=self.owner).exists())

    def test_the_approver_sees_the_masked_number_the_date_and_who_listed_it(self):
        draft = self.confirmed()
        approval = self.approval_of(draft)
        rows = {row["field"]: row["after"] for row in staff_listing_kind.render_diff(approval)}
        self.assertRegex(rows["Text sent to"], r"^\d{3} \*\*\* \d{4}$")
        self.assertEqual(rows["Owner confirmed"], f"{timezone.localtime(timezone.now()):%-d %b %Y}")
        self.assertEqual(rows["Listed by"], "Kwame (Scout)")
        self.assertEqual(staff_listing_kind.consequences(approval)[-1], "It counts toward Kwame's listings today.")
        blob = json.dumps([rows, approval.payload, staff_listing_kind.consequences(approval)], default=str)
        for needle in ("token", "http", "0244100200", "233244100200"):
            self.assertNotIn(needle, blob)


class WaitForKycTests(Base):
    """R-T7a: a draft the owner confirmed while KYC was pending waits, without failing the owner's confirm."""

    def setUp(self):
        super().setUp()
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status=BusinessOwner.PENDING)
        profile = self.owner.profile
        profile.address_verified, profile.address_verified_by = True, self.lead
        profile.address_verified_at = timezone.now()
        profile.save()

    def test_confirm_succeeds_and_the_draft_waits_with_no_approval_row(self):
        draft = self.confirmed()
        self.assertEqual((draft.status, draft.approval), ("owner_confirmed", None))
        self.assertFalse(ApprovalRequest.objects.filter(kind="listing.staff_create").exists())

    def test_kyc_approval_submits_the_waiting_drafts_after_commit(self):
        draft = self.confirmed()
        with self.captureOnCommitCallbacks(execute=True):
            kyc.approve_owner(self.owner.pk, self.lead)
        draft.refresh_from_db()
        self.assertEqual(draft.status, "submitted")
        self.assertEqual(self.approval_of(draft).status, "pending")
        self.assertFalse(Listing.objects.filter(business_owner=self.owner).exists())

    def test_kyc_approval_without_commit_submits_nothing_yet(self):
        draft = self.confirmed()
        kyc.approve_owner(self.owner.pk, self.lead)  # the callbacks only run on commit
        draft.refresh_from_db()
        self.assertEqual(draft.status, "owner_confirmed")

    def test_retry_endpoint_409_with_the_reason_then_200(self):
        draft = self.confirmed()
        self.as_staff(self.scout)
        url = self.url(tail=f"{draft.pk}/submit/")
        response = self.call("post", url)
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["detail"], "Approve the business's KYC first.")
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status=BusinessOwner.VERIFIED)
        response = self.call("post", url)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "submitted")
        self.assertEqual(self.call("post", url).status_code, 409)  # already gone for approval
        self.assertEqual(ApprovalRequest.objects.filter(kind="listing.staff_create").count(), 1)

    def test_retry_follows_the_draft_scope_rules(self):
        draft = self.confirmed()
        self.as_staff(self.other_scout)
        self.assertEqual(self.call("post", self.url(tail=f"{draft.pk}/submit/")).status_code, 404)
        self.as_staff(self.gm)
        self.assertEqual(self.call("post", self.url(tail=f"{draft.pk}/submit/")).status_code, 403)
