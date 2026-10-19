"""The business.detail_change approval (plan 7F-C Task 8, ruling R3; spec §13 (xxxiv)): two people with the password,
never the scout who verified, the value re-checked at approval, payout destinations cooling again, the old contact told
and nothing raw in the log. Also the Task 7 review minors (fresh visit after a reassign, the scout's masked view once
verified, task closing)."""
from datetime import timedelta
from unittest import mock

from django.utils import timezone

from accounts import kyc
from accounts.models import BusinessOwner, Permission
from accounts.testing import make_staff
from activity.models import ActivityEvent
from approvals import services as approvals
from approvals.models import ApprovalRequest
from approvals.services import MakerCannotDecide
from ledger import settings_store
from notifications.models import Notification
from otp.models import OtpEvent
from portfolio import detail_changes
from portfolio.models import AppliedChange
from portfolio.models import BusinessDetailChangeRequest as Request
from portfolio.tests.change_fixtures import make_business
from portfolio.tests.test_detail_change_assignment import NEW_PHONE, NOTE, DetailChangeAssignmentBase
from staff_tasks.models import Task
from wallets.models import PayoutDestination
from wallets.tests.helpers import Holder, destination

APPROVALS = "/api/approvals/"
OLD_PHONE = "+233244100200"  # change_fixtures.make_business's sign-in phone
RAW = ("7654321", "207654321", "244100200")


class DetailChangeApprovalBase(DetailChangeAssignmentBase):
    def setUp(self):
        super().setUp()
        self.ops2 = make_staff("operations", "ops.two@example.com", phone="0501112228")
        self.boss = make_staff("super_admin", "boss@example.com", phone="0501112229")
        self.boss2 = make_staff("super_admin", "boss.two@example.com", phone="0501112230")

    def verified(self, change=None, scout=None):
        """Assign, check in and verify: the approval exists, made by the scout."""
        change = change or self.change
        scout = scout or self.scout
        self.assertEqual(self.assign(scout, change=change).status_code, 200)
        self.assertEqual(self.check_in(scout, change=change).status_code, 201)
        self.assertEqual(self.verify(scout=scout, change=change).status_code, 200)
        change.refresh_from_db()
        self.assertEqual(change.status, Request.VERIFIED)
        self.assertIsNotNone(change.approval_id)
        return change.approval

    def post_as(self, staff, path, body=None, sudo=True):
        from rest_framework.test import APIClient

        from accounts.testing import staff_token

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")
        return client.post(path, body or {}, format="json")

    def approve(self, approval, staff=None, sudo=True):
        return self.post_as(staff or self.ops2, f"{APPROVALS}{approval.pk}/approve/", {"note": ""}, sudo=sudo)

    def reject(self, approval, staff=None, note="The owner's story does not match the shop's records."):
        return self.post_as(staff or self.ops2, f"{APPROVALS}{approval.pk}/reject/", {"note": note})


class ApprovalGateTests(DetailChangeApprovalBase):
    def test_kind_is_registered_two_people_with_sudo(self):
        from approvals.registry import get_kind

        kind = get_kind("business.detail_change")
        self.assertIsNotNone(kind)
        self.assertTrue(kind.requires_sudo)
        self.assertTrue(kind.two_people)
        self.assertEqual(kind.pool_permission, "portfolio.manage")

    def test_approval_needs_sudo(self):
        approval = self.verified()
        response = self.approve(approval, sudo=False)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["code"], "sudo_required")
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.login_phone, OLD_PHONE)
        approval.refresh_from_db()
        self.assertEqual(approval.status, ApprovalRequest.PENDING)

    def test_scout_maker_cannot_approve_own(self):
        approval = self.verified()
        self.assertEqual(approval.maker, self.scout)
        response = self.approve(approval, staff=self.scout)
        self.assertEqual(response.status_code, 403, response.content)
        with self.assertRaises(MakerCannotDecide):
            approvals.approve(approval.pk, self.scout)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.login_phone, OLD_PHONE)

    def test_verifying_scout_never_decides_even_when_not_the_maker(self):
        # A Super Admin stages the verified change themselves; the scout who verified it (given portfolio.manage)
        # still cannot be the person who approves it.
        approval = self.verified()
        approvals.cancel(approval.pk, self.scout)  # closes this request; stage a fresh one as the Super Admin
        change = Request.objects.create(
            business_owner=self.owner, field="login_phone", new_value=NEW_PHONE, reason="I lost my old SIM card.",
            status=Request.VERIFIED, assigned_scout=self.scout, assigned_at=timezone.now(), verified_at=timezone.now(),
        )
        staged = detail_changes.submit_for_approval(change, self.boss, NOTE)
        self.assertEqual(staged.status, ApprovalRequest.PENDING)
        self.scout.extra_permissions.add(Permission.objects.get(codename="portfolio.manage"))
        response = self.approve(staged, staff=self.scout)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["code"], "verified_it")
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.login_phone, OLD_PHONE)
        self.assertEqual(self.approve(staged).status_code, 200)

    def test_super_admin_request_waits_for_second_person(self):
        change = Request.objects.create(
            business_owner=self.owner, field="full_name", new_value="Abena Serwaa Owusu", reason="Married name.",
            status=Request.VERIFIED, assigned_scout=self.scout, assigned_at=timezone.now(), verified_at=timezone.now(),
        )
        approval = detail_changes.submit_for_approval(change, self.boss, NOTE)
        self.assertEqual(approval.status, ApprovalRequest.PENDING)  # not applied at once, Super Admin or not
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.full_name, "Abena Owusu")
        with self.assertRaises(MakerCannotDecide):
            approvals.approve(approval.pk, self.boss)
        self.assertEqual(self.approve(approval, staff=self.boss2, sudo=False).json()["code"], "sudo_required")
        response = self.approve(approval, staff=self.boss2)
        self.assertEqual(response.status_code, 200, response.content)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.full_name, "Abena Serwaa Owusu")


class ApplyTests(DetailChangeApprovalBase):
    def test_approve_writes_value_and_restarts_cooling(self):
        dest = destination(self.owner)
        approval = self.verified()
        before = timezone.now()
        response = self.approve(approval)
        self.assertEqual(response.status_code, 200, response.content)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.login_phone, NEW_PHONE)
        hours = settings_store.current("payout_cooling_hours", before)
        dest.refresh_from_db()
        self.assertGreaterEqual(dest.usable_from, before + timedelta(hours=hours))
        self.change.refresh_from_db()
        self.assertEqual(self.change.status, Request.APPROVED)
        self.assertIsNotNone(self.change.decided_at)
        approval.refresh_from_db()
        self.assertEqual((approval.status, approval.decided_by), (ApprovalRequest.APPROVED, self.ops2))
        notice = Notification.objects.get(business_owner=self.owner, kind="detail_change_approved")
        self.assertIn("cooling period", notice.body)
        for raw in RAW:
            self.assertNotIn(raw, notice.title + notice.body)

    def test_name_change_restarts_cooling_too(self):
        dest = destination(self.owner)
        self.change.field, self.change.new_value = "full_name", "Abena Serwaa Owusu"
        self.change.save(update_fields=["field", "new_value"])
        approval = self.verified()
        self.assertEqual(self.approve(approval).status_code, 200)
        dest.refresh_from_db()
        self.assertGreater(dest.usable_from, timezone.now() + timedelta(hours=1))

    def test_cooling_never_shortened(self):
        far = timezone.now() + timedelta(days=60)
        dest = destination(self.owner)
        PayoutDestination.objects.filter(pk=dest.pk).update(usable_from=far)
        self.assertEqual(self.approve(self.verified()).status_code, 200)
        dest.refresh_from_db()
        self.assertEqual(dest.usable_from, far)

    def test_stale_when_owner_changed_value_meanwhile(self):
        approval = self.verified()
        # Masks alike ("024 *** 0200"): only the digest sees the difference.
        BusinessOwner.objects.filter(pk=self.owner.pk).update(login_phone="+233245550200")
        response = self.approve(approval)
        self.assertEqual(response.status_code, 409, response.content)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.login_phone, "+233245550200")
        self.change.refresh_from_db()
        self.assertEqual(self.change.status, Request.VERIFIED)
        # The approver rejects the stale one; the request closes.
        self.assertEqual(self.reject(approval).status_code, 200)
        self.change.refresh_from_db()
        self.assertEqual(self.change.status, Request.REJECTED)

    def test_apply_revalidates_duplicates(self):
        # Two businesses' live requests name the same new email; the first approved takes it, the second is refused
        # at approval with the detailed (staff-side) reason.
        other = make_business(self.registrar, phone="+233244100300", name="Kwame Wood Works", email="kwame@example.com")
        self.change.field, self.change.new_value = "email", "shared@example.com"
        self.change.save(update_fields=["field", "new_value"])
        second = Request.objects.create(
            business_owner=other, field="email", new_value="shared@example.com", reason="New shop email.",
        )
        first_approval = self.verified()
        second_approval = self.verified(change=second, scout=self.other_scout)
        self.assertEqual(self.approve(first_approval).status_code, 200)
        response = self.approve(second_approval)
        self.assertEqual(response.status_code, 409, response.content)
        body = response.json()
        self.assertEqual(body["code"], "taken")
        self.assertNotEqual(body["detail"], detail_changes.UNAVAILABLE)
        other.refresh_from_db()
        self.assertEqual(other.email, "kwame@example.com")

    def test_request_no_longer_verified_is_refused(self):
        approval = self.verified()
        Request.objects.filter(pk=self.change.pk).update(status=Request.REJECTED)
        response = self.approve(approval)
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "not_waiting")

    def test_old_contact_notified_masked_in_log(self):
        approval = self.verified()
        with mock.patch("otp.notices.senders.deliver") as deliver, self.captureOnCommitCallbacks(execute=True):
            deliver.return_value = mock.Mock(ok=True, provider="test")
            self.assertEqual(self.approve(approval).status_code, 200)
        deliver.assert_called_once()
        channel, to, _subject, text = deliver.call_args.args
        self.assertEqual((channel, to), ("sms", OLD_PHONE))  # the old phone, raw only on the delivery path
        self.assertNotIn("7654321", text)
        self.assertTrue(OtpEvent.objects.filter(note="notice: contact changed", destination=OLD_PHONE).exists())
        event = ActivityEvent.objects.get(verb="business.detail_changed")
        self.assertEqual(event.before, {"login_phone": "024 *** 0200"})
        self.assertEqual(event.after["login_phone"], "020 *** 4321")

    def test_old_email_is_told_of_an_email_change(self):
        self.change.field, self.change.new_value = "email", "abena.new@example.com"
        self.change.save(update_fields=["field", "new_value"])
        approval = self.verified()
        with mock.patch("otp.notices.senders.deliver") as deliver, self.captureOnCommitCallbacks(execute=True):
            deliver.return_value = mock.Mock(ok=True, provider="test")
            self.assertEqual(self.approve(approval).status_code, 200)
        self.assertEqual(deliver.call_args.args[:2], ("email", "abena@example.com"))
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.email, "abena.new@example.com")

    def test_applied_change_row_created(self):
        approval = self.verified()
        self.assertEqual(self.approve(approval).status_code, 200)
        row = AppliedChange.objects.get(approval=approval)
        self.assertEqual((row.business_owner, row.kind, row.summary), (self.owner, "business.detail_change",
                                                                       "Changed your sign-in phone"))
        self.assertEqual(row.undo_until, row.applied_at)  # the owner asked for it: nothing to undo
        response = Holder(self.owner, "business_owner").get("/api/portfolio/owner/changes/")
        self.assertEqual(response.status_code, 200, response.content)
        mine = [item for item in response.json() if item["id"] == row.pk]
        self.assertEqual(len(mine), 1)
        self.assertFalse(mine[0]["can_undo"])
        self.assertEqual(mine[0]["summary"], "Changed your sign-in phone")

    def test_activity_event_has_no_raw_contact(self):
        approval = self.verified()
        self.assertEqual(self.approve(approval).status_code, 200)
        for verb in ("approval.requested", "business.detail_changed", "business.detail_change_verified"):
            for event in ActivityEvent.objects.filter(verb=verb):
                text = f"{event.summary} {event.before} {event.after}"
                for raw in RAW:
                    self.assertNotIn(raw, text, verb)
        requested = ActivityEvent.objects.get(verb="approval.requested", target_id=str(approval.pk))
        self.assertEqual(requested.after["payload"]["new_value"], "020 *** 4321")
        approval.refresh_from_db()
        for raw in RAW:
            self.assertNotIn(raw, approval.title + approval.maker_note + str(approval.before))
        rows = approvals.diff_rows(approval)
        self.assertEqual(rows[0]["after"], "020 *** 4321")


class CloseTests(DetailChangeApprovalBase):
    def test_reject_marks_request_and_notifies_owner(self):
        approval = self.verified()
        response = self.reject(approval)
        self.assertEqual(response.status_code, 200, response.content)
        self.change.refresh_from_db()
        self.assertEqual(self.change.status, Request.REJECTED)
        self.assertIsNotNone(self.change.decided_at)
        self.assertTrue(Notification.objects.filter(business_owner=self.owner, kind="detail_change_rejected").exists())
        self.assertFalse(Task.objects.filter(kind=Task.RETURNED_APPROVAL).exists())  # nothing for the scout to redo
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.login_phone, OLD_PHONE)
        # It has ended: the business can ask again.
        response = Holder(self.owner, "business_owner").post(
            "/api/accounts/business-owners/me/detail-changes/",
            {"field": "login_phone", "new_value": NEW_PHONE, "reason": "Asking again."},
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_cancelled_approval_closes_the_request(self):
        approval = self.verified()
        approvals.cancel(approval.pk, self.scout)
        self.change.refresh_from_db()
        self.assertEqual(self.change.status, Request.REJECTED)
        self.assertTrue(Notification.objects.filter(business_owner=self.owner, kind="detail_change_rejected").exists())

    def test_kyc_submitter_rule_includes_this_kind(self):
        self.assertFalse(kyc.is_kyc_submitter(self.owner, self.scout))
        self.verified()
        self.assertTrue(kyc.is_kyc_submitter(self.owner, self.scout))
        self.assertIn("business.detail_change", kyc.SUBMITTER_KINDS)


class TaskSevenMinorTests(DetailChangeApprovalBase):
    def test_reassigned_away_and_back_needs_a_fresh_visit(self):
        self.assign()
        self.assertEqual(self.check_in().status_code, 201)
        self.assertEqual(self.assign(self.other_scout).status_code, 200)
        # Back to the first scout: their old check-in is from before this assignment.
        self.assertEqual(self.assign(self.scout).status_code, 200)
        response = self.verify()
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "no_visit")

    def test_scout_sees_value_masked_once_verified(self):
        self.verified()
        self.as_staff(self.scout)
        mine = self.client.get("/api/portfolio/detail-changes/mine/").json()["results"]
        self.assertEqual(mine[0]["status"], Request.VERIFIED)
        self.assertEqual(mine[0]["new_value"], "020 *** 4321")

    def test_cancelled_task_has_no_done_time(self):
        self.assign()
        self.assign(self.other_scout)
        cancelled = Task.objects.get(owner=self.scout)
        self.assertEqual(cancelled.status, Task.CANCELLED)
        self.assertIsNone(cancelled.done_at)
        self.assertEqual(self.check_in(self.other_scout).status_code, 201)
        self.assertEqual(self.verify(scout=self.other_scout).status_code, 200)
        done = Task.objects.get(owner=self.other_scout)
        self.assertEqual(done.status, Task.DONE)
        self.assertIsNotNone(done.done_at)


class TrustedDeviceTests(DetailChangeApprovalBase):
    def _device(self):
        from otp import devices
        from otp.models import TrustedDevice

        devices.trust(self.owner, None)
        return TrustedDevice.objects.get(account_type="business_owner", account_id=self.owner.pk)

    def test_sign_in_contact_change_ends_trusted_devices(self):
        from otp.models import TrustedDevice

        for field, value in (("login_phone", NEW_PHONE), ("email", "abena.new@example.com")):
            with self.subTest(field=field):
                TrustedDevice.objects.all().delete()
                Request.objects.filter(business_owner=self.owner).delete()
                self.change = Request.objects.create(
                    business_owner=self.owner, field=field, new_value=value, reason="New contact for the shop.",
                )
                device = self._device()
                scout = self.scout if field == "login_phone" else self.other_scout
                self.assertEqual(self.approve(self.verified(scout=scout)).status_code, 200)
                device.refresh_from_db()
                self.assertIsNotNone(device.revoked_at)
                self.assertEqual(device.revoked_reason, TrustedDevice.STAFF_RECOVERY)
                event = ActivityEvent.objects.filter(verb="business.detail_changed").latest("id")
                self.assertEqual(event.after["trusted_devices_ended"], 1)

    def test_name_change_keeps_trusted_devices(self):
        self.change.field, self.change.new_value = "full_name", "Abena Serwaa Owusu"
        self.change.save(update_fields=["field", "new_value"])
        device = self._device()
        self.assertEqual(self.approve(self.verified()).status_code, 200)
        device.refresh_from_db()
        self.assertIsNone(device.revoked_at)
