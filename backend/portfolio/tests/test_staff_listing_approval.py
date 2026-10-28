"""The approval kind listing.staff_create (plan M3, Task 7): a staff-made listing goes live only after the owner confirmed
it and a second person approved it; the submit-at-confirm, deferred-until-KYC and retry paths; and the legacy doors."""
import json
from datetime import timedelta

from django.utils import timezone

from accounts import kyc
from accounts.claims import ClaimError
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


def approvals_diff(approval):
    return staff_listing_kind.render_diff(approval)


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
        self.assertEqual((approval.payload["draft_id"], approval.payload["kind"]), (draft.pk, "product"))
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

    def test_an_approved_draft_reads_published_and_a_returned_one_reads_draft(self):
        # M1: the panel must not say "submitted" for ever once the listing is live
        draft = self.confirmed()
        self.as_staff(self.scout)
        listed = self.call("get", self.url()).json()
        self.assertEqual(listed[0]["status"], "submitted")
        approvals.approve(draft.approval_id, self.lead)
        listed = self.call("get", self.url()).json()
        self.assertEqual((listed[0]["status"], listed[0]["confirmation"]["state"]), ("published", "published"))
        self.assertFalse(listed[0]["confirmation"]["can_resend"])
        other = self.confirmed()
        approvals.reject(other.approval_id, self.lead, "Fix the price")
        states = {row["id"]: row["status"] for row in self.call("get", self.url()).json()}
        self.assertEqual(states[other.pk], "draft")
        self.assertEqual(states[draft.pk], "published")

    def test_the_draft_list_stays_bulk_with_the_approval_state(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        for _ in range(2):
            approvals.approve(self.confirmed().approval_id, self.lead)
        self.as_staff(self.scout)
        with CaptureQueriesContext(connection) as three:
            self.call("get", self.url())
        for _ in range(2):
            approvals.approve(self.confirmed().approval_id, self.lead)
        with CaptureQueriesContext(connection) as six:
            self.call("get", self.url())
        self.assertEqual(len(three), len(six))

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
        raw = self.raw()
        OwnerConfirmation.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        with self.assertRaises(ClaimError) as caught:
            confirmations.confirm(raw)
        self.assertEqual(caught.exception.code, "expired")
        draft.refresh_from_db()
        self.assertEqual((draft.status, draft.approval), ("awaiting_owner", None))
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

    def test_a_listing_counts_once_on_its_approval_day_whatever_happens_to_it_after(self):
        # F3: the target reads the decision, so expiring, an owner edit and a legacy-queue re-approval change nothing.
        self.as_staff(self.scout)
        draft = ListingDraft.objects.get(pk=self.call("post", self.url(), self.event_body()).json()["id"])
        self.send([draft])
        confirmations.confirm(self.raw())
        approvals.approve(self.approval_of(draft).pk, self.lead)
        day = timezone.localdate()
        event = Event.objects.get()
        self.assertEqual(targets.actual(self.scout, "listings", day, day), 1)
        Event.objects.filter(pk=event.pk).update(status=Event.EXPIRED)  # the event window ended
        self.assertEqual(targets.actual(self.scout, "listings", day, day), 1)
        # the owner edits it: back to pending with reviewed_at cleared; a second person re-approves in the event queue
        Event.objects.filter(pk=event.pk).update(status=Event.PENDING, reviewed_by=None, reviewed_at=None)
        self.as_staff(self.second)
        self.assertEqual(self.client.post(f"/api/events/moderation/{event.pk}/approve/").status_code, 200)
        self.assertEqual(targets.actual(self.scout, "listings", day, day), 1)
        self.assertEqual(targets.actual(self.second, "listings", day, day), 0)

    def test_a_returned_or_rejected_listing_never_counts(self):
        draft = self.confirmed()
        approvals.reject(draft.approval_id, self.lead, "Fix the price")
        day = timezone.localdate()
        self.assertEqual(targets.actual(self.scout, "listings", day, day), 0)

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
        self.assertRegex(rows["Text sent to"], r"^\d{3} \*\*\* \d{4}")
        self.assertEqual(rows["Owner confirmed"], f"{timezone.localtime(timezone.now()):%-d %b %Y}")
        self.assertEqual(rows["Listed by"], "Kwame (Scout)")
        # the approver's "Show full phone number" reveals through this owner's id (the audited reveal endpoint)
        self.assertEqual(approval.payload["business_owner_id"], self.owner.pk)
        self.assertEqual(staff_listing_kind.consequences(approval)[-1], "It counts toward Kwame's listings today.")
        blob = json.dumps([rows, approval.payload, staff_listing_kind.consequences(approval)], default=str)
        for needle in ("token", "http", "0244100200", "233244100200"):
            self.assertNotIn(needle, blob)


class DecidedApprovalKeepsItsFactsTests(Base):
    def test_a_returned_approval_still_shows_what_was_confirmed_after_the_draft_is_edited_and_resent(self):
        draft = self.confirmed()
        approval = self.approval_of(draft)
        before = approvals_diff(approval)
        self.assertNotIn("no owner text was needed", json.dumps(before))
        approvals.reject(approval.pk, self.lead, "Wrong price")
        approval.refresh_from_db()
        self.assertEqual(approvals_diff(approval), before)
        rows = {row["field"]: row["after"] for row in before}
        self.assertEqual(rows["Owner confirmed"], f"{timezone.localtime(timezone.now()):%-d %b %Y}")
        self.assertRegex(rows["Text sent to"], r"^\d{3} \*\*\* \d{4}")
        # the maker edits and sends it again: the old approval does not change
        self.as_staff(self.scout)
        response = self.call("patch", self.url(tail=f"{draft.pk}/"), {"name": "New name", "price_amount": "999.00"})
        self.assertEqual(response.status_code, 200, response.content)
        self.send([draft])
        confirmations.confirm(self.raw())
        approval.refresh_from_db()
        self.assertEqual(approvals_diff(approval), before)
        self.assertNotEqual(self.approval_of(draft).pk, approval.pk)

    def test_the_snapshot_holds_no_whole_phone_token_or_link(self):
        draft = self.confirmed(contact_phone="024 555 0101")
        blob = json.dumps(self.approval_of(draft).payload, default=str)
        for needle in ("token", "http", "0245550101", "233245550101", "0244100200"):
            self.assertNotIn(needle, blob)
        self.assertIn("024 *** 0101", blob)


class EditAndWithdrawTests(Base):
    def test_a_confirmed_draft_that_cannot_submit_can_be_edited_and_needs_a_new_confirmation(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status=BusinessOwner.PENDING)
        draft = self.confirmed()
        self.assertEqual(draft.status, "owner_confirmed")
        self.as_staff(self.scout)
        response = self.call("patch", self.url(tail=f"{draft.pk}/"), {"name": "Better name"})
        self.assertEqual(response.status_code, 200, response.content)
        draft.refresh_from_db()
        self.assertEqual((draft.status, draft.confirmation, draft.payload["name"]), ("draft", None, "Better name"))

    def test_a_confirmed_draft_can_be_withdrawn(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(kyc_status=BusinessOwner.PENDING)
        draft = self.confirmed()
        self.as_staff(self.lead)  # withdrawing authors nothing: anyone in scope may
        response = self.call("delete", self.url(tail=f"{draft.pk}/"))
        self.assertEqual(response.status_code, 200, response.content)
        draft.refresh_from_db()
        self.assertEqual(draft.status, "withdrawn")

    def test_a_submitted_draft_stays_locked(self):
        draft = self.confirmed()
        self.as_staff(self.scout)
        self.assertEqual(self.call("patch", self.url(tail=f"{draft.pk}/"), {"name": "x"}).status_code, 409)
        self.assertEqual(self.call("delete", self.url(tail=f"{draft.pk}/")).status_code, 409)

    def test_only_the_maker_edits_a_draft(self):
        self.as_staff(self.scout)
        draft = self.make_draft()
        for other in (self.lead, self.admin):
            self.as_staff(other)
            response = self.call("patch", self.url(tail=f"{draft.pk}/"), {"name": "Rewritten"})
            self.assertEqual((response.status_code, response.json()["code"]), (403, "not_your_draft"))
        draft.refresh_from_db()
        self.assertEqual(draft.payload["name"], "Kente stole")
        # withdraw, send and resend stay open to anyone in scope
        self.as_staff(self.lead)
        self.assertEqual(self.call("post", self.url(tail="send/"), {"draft_ids": [draft.pk]}).status_code, 200)


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
