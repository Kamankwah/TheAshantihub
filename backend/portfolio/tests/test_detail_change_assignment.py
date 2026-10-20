"""Operations assigns a scout to a business's detail change request and the scout verifies it on site (plan 7F-C
Task 7, ruling R3)."""
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from approvals import registry
from approvals.models import ApprovalRequest
from approvals.services import MakerCannotDecide, approve
from field.models import VisitCheckIn
from notifications.models import Notification
from portfolio import detail_changes
from portfolio.models import BusinessDetailChangeRequest as Request
from portfolio.tests.change_fixtures import make_business
from staff_tasks.models import Task
from wallets.tests.helpers import Holder

BASE = "/api/portfolio/detail-changes/"
VISITS = "/api/field/visits/"
NEW_PHONE = "+233207654321"
PIN = (6.700000, -1.610000)  # change_fixtures.make_business pins the business here
NOTE = "Met the owner at the shop; she showed the new SIM and her Ghana card."


def fix(metres_north=0.0, accuracy=12):
    return {"lat": PIN[0] + metres_north / 111195.0, "lng": PIN[1], "accuracy_m": accuracy}


def stub_kind():
    """A stand-in for business.detail_change (Task 8 registers the real one): two people, the portfolio.manage pool."""
    return registry.ApprovalKind(
        key=detail_changes.APPROVAL_KIND, label="Business name or contact change", pool_permission="portfolio.manage",
        current_state=lambda approval: {}, apply=lambda approval: None, requires_sudo=True, two_people=True,
        public_payload=lambda approval: {**approval.payload, "new_value": "masked"},
    )


class DetailChangeAssignmentBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.registrar = make_staff("scout", "kofi.scout@example.com", phone="0501112223")
        self.scout = make_staff("scout", "ama.scout@example.com", phone="0501112225")
        self.other_scout = make_staff("scout", "yaw.scout@example.com", phone="0501112226")
        self.ops = make_staff("operations", "ops.lead@example.com", phone="0501112224")
        self.support = make_staff("support", "support.desk@example.com", phone="0501112227")
        self.owner = make_business(self.registrar, email="abena@example.com")
        self.change = Request.objects.create(
            business_owner=self.owner, field="login_phone", new_value=NEW_PHONE, reason="I lost my old SIM card.",
        )

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def assign(self, scout=None, who=None, change=None):
        self.as_staff(who or self.ops)
        return self.client.post(
            f"{BASE}{(change or self.change).pk}/assign/", {"scout": (scout or self.scout).pk}, format="json",
        )

    def check_in(self, scout=None, change=None, metres=20):
        self.as_staff(scout or self.scout)
        return self.client.post(VISITS, {"change_request": (change or self.change).pk, **fix(metres)}, format="json")

    def check_out(self, visit_id, scout=None):
        self.as_staff(scout or self.scout)
        return self.client.post(f"{VISITS}{visit_id}/check-out/", fix(20), format="json")

    def verify(self, outcome="verified", note=NOTE, scout=None, change=None):
        self.as_staff(scout or self.scout)
        return self.client.post(
            f"{BASE}{(change or self.change).pk}/verify/", {"outcome": outcome, "note": note}, format="json",
        )


class AssignmentTests(DetailChangeAssignmentBase):
    def test_operations_assigns_independent_scout(self):
        response = self.assign()
        self.assertEqual(response.status_code, 200, response.content)
        self.change.refresh_from_db()
        self.assertEqual(self.change.status, Request.ASSIGNED)
        self.assertEqual(self.change.assigned_scout, self.scout)
        self.assertEqual(self.change.assigned_by, self.ops)
        self.assertIsNotNone(self.change.assigned_at)
        self.assertEqual(response.data["new_value"], "020 *** 4321")  # Operations sees it masked
        event = ActivityEvent.objects.get(verb="business.detail_change_assigned")
        self.assertNotIn("7654321", str(event.after) + event.summary)
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="detail_change_assigned").exists())

    def test_registrar_or_account_manager_cannot_be_assigned(self):
        response = self.assign(self.registrar)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "kyc_submitter")
        self.assertEqual(
            response.data["detail"], f"{self.registrar.full_name} registered or manages this business — assign another scout.",
        )
        # An account manager who did not register the business is refused too.
        self.owner.account_manager = self.other_scout
        self.owner.save(update_fields=["account_manager"])
        self.assertEqual(self.assign(self.other_scout).data["code"], "kyc_submitter")
        self.change.refresh_from_db()
        self.assertEqual(self.change.status, Request.REQUESTED)
        self.assertFalse(Task.objects.exists())

    def test_assign_requires_scouts_assign(self):
        response = self.assign(who=self.support)
        self.assertEqual(response.status_code, 403)
        response = self.assign(who=self.scout)  # a scout holds scouts.verify, not scouts.assign
        self.assertEqual(response.status_code, 403)
        self.as_staff(self.support)
        self.assertEqual(self.client.get(BASE).status_code, 403)
        self.change.refresh_from_db()
        self.assertEqual(self.change.status, Request.REQUESTED)

    def test_only_an_active_scout_with_scouts_verify(self):
        self.assertEqual(self.assign(self.support).data["code"], "not_a_scout")
        self.scout.is_suspended = True
        self.scout.save(update_fields=["is_suspended"])
        self.assertEqual(self.assign().data["code"], "not_a_scout")

    def test_scout_task_created_on_assign(self):
        self.assertEqual(self.assign().status_code, 200)
        self.change.refresh_from_db()
        task = Task.objects.get(owner=self.scout)
        self.assertEqual(task.status, Task.OPEN)
        self.assertEqual(task.kind, Task.OPS_FOLLOW_UP)
        self.assertEqual(task.business_owner, self.owner)
        self.assertEqual((task.source_type, task.source_id), ("portfolio.businessdetailchangerequest", str(self.change.pk)))
        self.assertAlmostEqual((task.due_at - self.change.assigned_at).total_seconds(), 48 * 3600, delta=5)
        self.assertNotIn("7654321", task.title + task.notes)

    def test_reassign_cancels_the_first_scouts_task(self):
        self.assign()
        response = self.assign(self.other_scout)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(Task.objects.get(owner=self.scout).status, Task.CANCELLED)
        self.assertEqual(Task.objects.get(owner=self.other_scout).status, Task.OPEN)
        self.assertEqual(self.assign(self.other_scout).data["code"], "already_assigned")

    def test_withdrawing_an_assigned_request_closes_the_scouts_task(self):
        self.assign()
        response = Holder(self.owner, "business_owner").post(
            f"/api/accounts/business-owners/me/detail-changes/{self.change.pk}/withdraw/",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(Task.objects.get(owner=self.scout).status, Task.CANCELLED)
        # The scout can no longer check in for it, nor verify it.
        self.assertEqual(self.check_in().status_code, 404)
        self.assertEqual(self.verify().status_code, 409)
        self.assertEqual(self.assign().data["code"], "not_assignable")

    def test_operations_lists_and_scout_sees_value_in_full(self):
        self.assign()
        self.as_staff(self.ops)
        rows = self.client.get(BASE).data["results"]
        self.assertEqual([row["id"] for row in rows], [self.change.pk])
        self.assertEqual(rows[0]["new_value"], "020 *** 4321")
        self.assertEqual(self.client.get(BASE, {"status": "requested"}).data["results"], [])
        self.assertEqual(self.client.get(BASE, {"status": "nonsense"}).status_code, 400)
        self.as_staff(self.scout)
        mine = self.client.get(f"{BASE}mine/").data["results"]
        self.assertEqual(mine[0]["new_value"], NEW_PHONE)
        self.assertEqual(mine[0]["field_label"], "Sign-in phone")
        self.assertNotIn("100200", mine[0]["current_value"])
        self.as_staff(self.other_scout)
        self.assertEqual(self.client.get(f"{BASE}mine/").data["results"], [])


class VerifyTests(DetailChangeAssignmentBase):
    def setUp(self):
        super().setUp()
        self.assign()

    def test_verify_without_visit_409(self):
        response = self.verify()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "no_visit")
        self.change.refresh_from_db()
        self.assertEqual(self.change.status, Request.ASSIGNED)

    def test_verify_requires_visit_inside_radius(self):
        far = self.check_in(metres=400)
        self.assertEqual(far.status_code, 201, far.content)
        self.assertTrue(far.data["outside_radius"])
        response = self.verify()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "outside_radius")
        # The scout revisits: a check-in at the business now counts, open or checked out.
        self.assertEqual(self.check_out(far.data["id"]).status_code, 200)
        near = self.check_in(metres=20)
        self.assertEqual(near.status_code, 201)
        self.assertEqual(self.verify().status_code, 200)
        self.change.refresh_from_db()
        self.assertEqual(self.change.visit_id, near.data["id"])

    def test_an_abandoned_or_other_purpose_visit_does_not_count(self):
        visit = self.check_in()
        VisitCheckIn.objects.filter(pk=visit.data["id"]).update(status=VisitCheckIn.ABANDONED)
        self.assertEqual(self.verify().data["code"], "no_visit")

    def test_unmeasurable_visit_does_not_count(self):
        profile = self.owner.profile
        profile.lat = profile.lng = None
        profile.save(update_fields=["lat", "lng"])
        self.assertEqual(self.check_in().status_code, 201)
        self.assertEqual(self.verify().data["code"], "no_pin")

    def test_verify_by_other_scout_404(self):
        self.check_in()
        response = self.verify(scout=self.other_scout)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["code"], "not_found")
        self.assertEqual(self.verify(scout=self.other_scout, change=Request(pk=999999)).status_code, 404)

    def test_note_and_outcome_are_checked(self):
        self.check_in()
        self.assertEqual(self.verify(note="ok").data["code"], "note_invalid")
        self.assertEqual(self.verify(note="x" * 501).data["code"], "note_invalid")
        self.assertEqual(self.verify(outcome="approved").data["code"], "outcome_invalid")

    def test_scout_who_became_account_manager_cannot_verify(self):
        self.check_in()
        self.owner.account_manager = self.scout
        self.owner.save(update_fields=["account_manager"])
        response = self.verify()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["code"], "kyc_submitter")

    def test_not_verified_ends_request_and_notifies(self):
        self.check_in()
        response = self.verify("not_verified", note="The owner was away; her husband did not know the number 0207654321.")
        self.assertEqual(response.status_code, 200, response.content)
        self.change.refresh_from_db()
        self.assertEqual(self.change.status, Request.NOT_VERIFIED)
        self.assertIsNotNone(self.change.decided_at)
        self.assertIsNone(self.change.verified_at)
        self.assertIsNotNone(self.change.visit_id)
        self.assertNotIn("7654321", self.change.verification_note)  # staff-facing text is masked
        self.assertIsNone(self.change.approval_id)
        self.assertTrue(Notification.objects.filter(business_owner=self.owner, kind="detail_change_not_verified").exists())
        self.assertTrue(Notification.objects.filter(staff=self.ops, kind="detail_change_not_verified").exists())
        self.assertEqual(Task.objects.get(owner=self.scout).status, Task.DONE)
        event = ActivityEvent.objects.get(verb="business.detail_change_not_verified")
        self.assertEqual(event.actor_id, self.scout.pk)
        self.assertNotIn("7654321", str(event.after) + event.summary)
        # It has ended: the business files a new request for the same field.
        response = Holder(self.owner, "business_owner").post(
            "/api/accounts/business-owners/me/detail-changes/",
            {"field": "login_phone", "new_value": NEW_PHONE, "reason": "Trying again with the scout."},
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_verified_without_the_kind_waits_for_it(self):
        self.check_in()
        with mock.patch.dict(registry._KINDS, clear=False):
            registry._KINDS.pop(detail_changes.APPROVAL_KIND, None)
            response = self.verify()
        self.assertEqual(response.status_code, 200, response.content)
        self.change.refresh_from_db()
        self.assertEqual(self.change.status, Request.VERIFIED)
        self.assertIsNone(self.change.approval_id)

    def test_verified_submits_approval_with_scout_as_maker(self):
        self.check_in()
        with mock.patch.dict(registry._KINDS, {detail_changes.APPROVAL_KIND: stub_kind()}):
            response = self.verify()
            self.assertEqual(response.status_code, 200, response.content)
            self.change.refresh_from_db()
            self.assertEqual(self.change.status, Request.VERIFIED)
            self.assertIsNotNone(self.change.verified_at)
            self.assertEqual(self.change.verification_note, NOTE)
            approval = self.change.approval
            self.assertEqual(approval.kind, "business.detail_change")
            self.assertEqual(approval.maker, self.scout)
            self.assertEqual(approval.status, ApprovalRequest.PENDING)
            self.assertEqual((approval.target_type, approval.target_id), ("accounts.businessowner", str(self.owner.pk)))
            self.assertEqual(approval.payload, {
                "change_request_id": self.change.pk, "business_owner_id": self.owner.pk, "field": "login_phone",
                "new_value": NEW_PHONE,
            })
            self.assertNotIn("7654321", approval.title)
            # The verifying scout is never the decider.
            with self.assertRaises(MakerCannotDecide):
                approve(approval.pk, self.scout)
        self.assertEqual(Task.objects.get(owner=self.scout).status, Task.DONE)
        self.assertTrue(Notification.objects.filter(business_owner=self.owner, kind="detail_change_verified").exists())
        event = ActivityEvent.objects.get(verb="business.detail_change_verified")
        self.assertEqual(event.after["approval_id"], approval.pk)
        self.assertNotIn("7654321", str(event.after) + event.summary)
        # Done once: a second verify is refused.
        self.assertEqual(self.verify().data["code"], "not_waiting")
