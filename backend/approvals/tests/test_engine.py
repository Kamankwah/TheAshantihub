import threading
from dataclasses import replace
from datetime import timedelta

from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from accounts.models import StaffUser
from accounts.testing import make_staff
from activity.models import ActivityEvent
from approvals import registry, services
from approvals.models import ApprovalRequest
from approvals.tests.kinds import BROKEN_APPLY, RENAME_STAFF
from notifications.models import Notification


class Base(TestCase):
    def setUp(self):
        registry.register(RENAME_STAFF)
        self.addCleanup(registry.unregister, RENAME_STAFF.key)
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.other_ops = make_staff("operations", "kojo@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.esi = make_staff("support", "esi@example.com")

    def submit(self, maker=None, kind=RENAME_STAFF):
        return services.submit(
            maker or self.scout, kind.key, target=self.esi, title="Rename Esi", payload={"full_name": "Esi Nyarko"}
        )


class SubmitTests(Base):
    def test_a_request_goes_to_the_makers_manager_first(self):
        approval = self.submit()
        self.assertEqual((approval.status, approval.stage, approval.assigned_to), ("pending", "manager", self.lead))
        self.assertEqual(approval.before, {"full_name": "Esi"})
        self.assertEqual((approval.target_type, approval.target_id), ("accounts.staffuser", str(self.esi.pk)))
        self.assertTrue(
            Notification.objects.filter(staff=self.lead, kind="approval_waiting", link=f"approvals/{approval.pk}").exists()
        )
        self.assertTrue(ActivityEvent.objects.filter(verb="approval.requested", actor_id=self.scout.id).exists())

    def test_a_maker_without_a_manager_starts_at_the_pool(self):
        approval = self.submit(maker=self.other_ops)
        self.assertEqual((approval.stage, approval.assigned_to), ("pool", None))
        self.assertTrue(Notification.objects.filter(staff=self.lead, kind="approval_waiting").exists())
        self.assertFalse(Notification.objects.filter(staff=self.other_ops, kind="approval_waiting").exists())

    def test_an_unknown_kind_is_refused(self):
        with self.assertRaises(services.UnknownKind):
            services.submit(self.scout, "no.such.kind", title="x", payload={})

    def test_a_super_admins_own_change_applies_at_once_and_other_super_admins_hear(self):
        second = make_staff("super_admin", "abena@example.com")
        approval = self.submit(maker=self.boss)
        self.esi.refresh_from_db()
        self.assertEqual((approval.status, approval.decided_by, self.esi.full_name), ("approved", self.boss, "Esi Nyarko"))
        self.assertTrue(Notification.objects.filter(staff=second, kind="approval_applied_directly").exists())
        self.assertFalse(Notification.objects.filter(staff=self.boss, kind="approval_applied_directly").exists())
        self.assertTrue(ActivityEvent.objects.filter(verb="approval.applied_directly").exists())


class DirectApplyTests(Base):
    def test_a_super_admins_change_is_validated_first(self):
        def refuse(request):
            raise services.ApprovalError("Not allowed yet.")

        applied = []
        guarded = replace(RENAME_STAFF, key="test.guarded_direct", validate=refuse,
                          apply=lambda request: applied.append(request.pk))
        registry.register(guarded)
        self.addCleanup(registry.unregister, guarded.key)
        with self.assertRaises(services.ApprovalError):
            self.submit(maker=self.boss, kind=guarded)
        self.assertEqual(applied, [])
        self.assertFalse(ApprovalRequest.objects.filter(kind=guarded.key).exists())

    def test_apply_receives_a_saved_request_on_the_direct_path(self):
        seen = []
        saving = replace(RENAME_STAFF, key="test.saved_direct", apply=lambda request: seen.append(request.pk))
        registry.register(saving)
        self.addCleanup(registry.unregister, saving.key)
        approval = self.submit(maker=self.boss, kind=saving)
        self.assertEqual(seen, [approval.pk])
        self.assertIsNotNone(seen[0])

    def test_a_failing_direct_apply_saves_nothing(self):
        registry.register(BROKEN_APPLY)
        self.addCleanup(registry.unregister, BROKEN_APPLY.key)
        with self.assertRaises(services.ApplyFailed):
            self.submit(maker=self.boss, kind=BROKEN_APPLY)
        self.assertFalse(ApprovalRequest.objects.filter(kind=BROKEN_APPLY.key).exists())


class VisibilityTests(Base):
    def test_visible_to_and_waiting_for(self):
        stranger = make_staff("support", "stranger@example.com")
        approval = self.submit()  # scout -> lead
        # own, manager's (assigned + waiting), super admin sees all
        self.assertIn(approval, services.visible_to(self.scout))
        self.assertIn(approval, services.visible_to(self.lead))
        self.assertIn(approval, services.waiting_for(self.lead))
        self.assertIn(approval, services.visible_to(self.boss))
        self.assertNotIn(approval, services.waiting_for(self.scout))
        self.assertNotIn(approval, services.visible_to(stranger))
        self.assertNotIn(approval, services.waiting_for(stranger))
        # the direct report's request is visible to the manager even once decided by someone else
        services.approve(approval.pk, self.boss)
        self.assertIn(approval, services.visible_to(self.lead))
        self.assertIn(approval, services.visible_to(self.boss))
        self.assertNotIn(approval, services.waiting_for(self.lead))
        self.assertNotIn(approval, services.visible_to(self.other_ops))

    def test_decided_by_me_is_visible(self):
        approval = self.submit(maker=self.other_ops)  # pool stage
        self.assertIn(approval, services.waiting_for(self.lead))
        services.approve(approval.pk, self.lead)
        self.assertIn(approval, services.visible_to(self.lead))

    def test_a_manager_suspended_at_submit_time_starts_the_pool(self):
        StaffUser.objects.filter(pk=self.lead.pk).update(is_suspended=True)
        self.scout.refresh_from_db()
        approval = self.submit()
        self.assertEqual((approval.stage, approval.assigned_to), ("pool", None))

    def test_the_maker_cannot_reject_their_own_request(self):
        approval = self.submit(maker=self.other_ops)
        with self.assertRaises(services.MakerCannotDecide):
            services.reject(approval.pk, self.other_ops, note="no")


class DecisionTests(Base):
    def test_the_maker_can_never_approve_their_own_request(self):
        approval = self.submit(maker=self.other_ops)  # pool stage; the maker holds the pool permission
        self.assertFalse(services.can_decide(approval, self.other_ops))
        with self.assertRaises(services.MakerCannotDecide):
            services.approve(approval.pk, self.other_ops)

    def test_approving_applies_the_change_and_tells_the_maker(self):
        approval = self.submit()
        services.approve(approval.pk, self.lead, note="Looks right")
        approval.refresh_from_db()
        self.esi.refresh_from_db()
        self.assertEqual((approval.status, approval.decided_by, approval.decision_note), ("approved", self.lead, "Looks right"))
        self.assertEqual(self.esi.full_name, "Esi Nyarko")
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="approval_decided").exists())

    def test_a_failed_apply_rolls_the_decision_back(self):
        registry.register(BROKEN_APPLY)
        self.addCleanup(registry.unregister, BROKEN_APPLY.key)
        approval = self.submit(kind=BROKEN_APPLY)
        with self.assertRaises(services.ApplyFailed) as raised:
            services.approve(approval.pk, self.lead)
        self.assertEqual(raised.exception.status_code, 500)
        self.assertEqual(
            raised.exception.message,
            "Couldn't apply this change, so nothing was changed. Try again, or tell a Super Admin.",
        )
        approval.refresh_from_db()
        self.assertEqual(approval.status, "pending")
        self.assertFalse(ActivityEvent.objects.filter(verb="approval.approved").exists())

    def test_a_stale_request_cannot_be_approved(self):
        approval = self.submit()
        StaffUser.objects.filter(pk=self.esi.pk).update(full_name="Esi Changed")
        self.assertTrue(services.is_stale(approval))
        with self.assertRaises(services.StaleRequest) as raised:
            services.approve(approval.pk, self.lead)
        self.assertEqual(raised.exception.message, "This changed since it was requested — ask for a fresh request.")

    def test_only_the_current_approver_or_a_super_admin_decides(self):
        approval = self.submit()
        with self.assertRaises(services.NotYourDecision):
            services.approve(approval.pk, self.other_ops)
        services.approve(approval.pk, self.boss)
        approval.refresh_from_db()
        self.assertEqual((approval.status, approval.decided_by), ("approved", self.boss))

    def test_a_kind_can_refuse_a_decision_with_its_own_reason(self):
        def not_yet(request):
            raise services.ApprovalError("Approve the business's KYC first.")

        guarded = replace(RENAME_STAFF, key="test.guarded", validate=not_yet)
        registry.register(guarded)
        self.addCleanup(registry.unregister, guarded.key)
        approval = self.submit(kind=guarded)
        with self.assertRaises(services.ApprovalError) as raised:
            services.approve(approval.pk, self.lead)
        self.assertEqual(raised.exception.message, "Approve the business's KYC first.")
        approval.refresh_from_db()
        self.assertEqual(approval.status, "pending")

    def test_returning_needs_a_note(self):
        approval = self.submit()
        with self.assertRaises(services.NoteRequired):
            services.reject(approval.pk, self.lead, note="  ")
        services.reject(approval.pk, self.lead, note="Wrong spelling")
        approval.refresh_from_db()
        self.assertEqual(approval.status, "rejected")
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="approval_decided", body="Wrong spelling").exists())

    def test_only_the_maker_cancels_and_only_while_pending(self):
        approval = self.submit()
        with self.assertRaises(services.NotYourDecision):
            services.cancel(approval.pk, self.lead)
        services.cancel(approval.pk, self.scout)
        with self.assertRaises(services.NotPending):
            services.cancel(approval.pk, self.scout)

    def test_a_decided_request_cannot_be_decided_again(self):
        approval = self.submit()
        services.approve(approval.pk, self.lead)
        with self.assertRaises(services.NotPending):
            services.reject(approval.pk, self.boss, note="late")


class EscalationTests(Base):
    def test_reminder_at_three_quarters_then_up_a_level_at_the_deadline(self):
        approval = self.submit()
        start = approval.stage_started_at
        services.escalate_due(now=start + timedelta(hours=17))
        self.assertFalse(Notification.objects.filter(kind="approval_reminder").exists())
        services.escalate_due(now=start + timedelta(hours=18))
        self.assertTrue(Notification.objects.filter(staff=self.lead, kind="approval_reminder").exists())
        services.escalate_due(now=start + timedelta(hours=24))
        approval.refresh_from_db()
        self.assertEqual((approval.stage, approval.escalation_level, approval.assigned_to), ("pool", 1, None))
        self.assertTrue(Notification.objects.filter(staff=self.other_ops, kind="approval_escalated").exists())
        self.assertTrue(ActivityEvent.objects.filter(verb="approval.escalated", actor_type="system").exists())
        services.escalate_due(now=approval.due_at)
        approval.refresh_from_db()
        self.assertEqual((approval.stage, approval.escalation_level), ("super_admin", 2))
        self.assertTrue(Notification.objects.filter(staff=self.boss, kind="approval_escalated").exists())

    def test_the_last_level_keeps_reminding(self):
        approval = self.submit(maker=self.other_ops)
        services.escalate_due(now=approval.due_at)
        approval.refresh_from_db()
        self.assertEqual(approval.stage, "super_admin")
        before = Notification.objects.filter(staff=self.boss).count()
        services.escalate_due(now=approval.due_at)
        approval.refresh_from_db()
        self.assertEqual(approval.stage, "super_admin")
        self.assertEqual(Notification.objects.filter(staff=self.boss).count(), before + 1)

    def test_a_deactivated_manager_is_skipped_straight_away(self):
        approval = self.submit()
        StaffUser.objects.filter(pk=self.lead.pk).update(is_active=False)
        services.escalate_due(now=timezone.now())
        approval.refresh_from_db()
        self.assertEqual(approval.stage, "pool")

    def test_one_bad_row_does_not_stop_the_run(self):
        def broken_chain(request):
            raise RuntimeError("resolver blew up")

        bad_kind = replace(RENAME_STAFF, key="test.bad_chain", resolve_approver=broken_chain)
        registry.register(bad_kind)
        self.addCleanup(registry.unregister, bad_kind.key)
        good = self.submit()
        bad = self.submit(maker=self.other_ops, kind=RENAME_STAFF)
        ApprovalRequest.objects.filter(pk=bad.pk).update(kind=bad_kind.key)
        past = max(good.due_at, bad.due_at) + timedelta(hours=1)
        self.assertEqual(services.escalate_due(now=past), 1)
        good.refresh_from_db()
        self.assertEqual(good.stage, "pool")

    def test_decided_requests_are_left_alone(self):
        approval = self.submit()
        services.approve(approval.pk, self.lead)
        services.escalate_due(now=approval.due_at + timedelta(days=1))
        approval.refresh_from_db()
        self.assertEqual((approval.stage, approval.status), ("manager", "approved"))


class ConcurrentDecisionTests(TransactionTestCase):
    """Review Focus 3: two approvers press Approve at the same moment."""

    serialized_rollback = True

    def test_two_approvers_at_once_decide_it_exactly_once(self):
        applied = []
        counting = replace(RENAME_STAFF, key="test.counting", apply=lambda request: applied.append(request.pk))
        registry.register(counting)
        self.addCleanup(registry.unregister, counting.key)
        lead = make_staff("operations", "ama@example.com")
        boss = make_staff("super_admin", "boss@example.com")
        scout = make_staff("scout", "kwame@example.com", manager=lead)
        esi = make_staff("support", "esi@example.com")
        approval = services.submit(scout, counting.key, target=esi, title="Rename Esi", payload={"full_name": "Esi Nyarko"})
        results = []
        barrier = threading.Barrier(2)

        def decide(staff):
            try:
                barrier.wait()
                services.approve(approval.pk, staff)
                results.append("approved")
            except services.NotPending:
                results.append("already decided")
            finally:
                connection.close()

        threads = [threading.Thread(target=decide, args=(staff,)) for staff in (lead, boss)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(results), ["already decided", "approved"])
        self.assertEqual(applied, [approval.pk])


class ConcurrentSameTargetTests(TransactionTestCase):
    """Two pending requests on one target, approved at once: one applies, one is stale."""

    serialized_rollback = True

    def test_only_one_of_two_requests_on_the_same_target_applies(self):
        registry.register(RENAME_STAFF)
        self.addCleanup(registry.unregister, RENAME_STAFF.key)
        lead = make_staff("operations", "ama@example.com")
        boss = make_staff("super_admin", "boss@example.com")
        scout = make_staff("scout", "kwame@example.com", manager=lead)
        esi = make_staff("support", "esi@example.com")
        first = services.submit(scout, RENAME_STAFF.key, target=esi, title="A", payload={"full_name": "Name A"})
        second = services.submit(scout, RENAME_STAFF.key, target=esi, title="B", payload={"full_name": "Name B"})
        results = []
        barrier = threading.Barrier(2)

        def decide(approval, staff):
            try:
                barrier.wait()
                services.approve(approval.pk, staff)
                results.append(("approved", approval.payload["full_name"]))
            except services.StaleRequest as exc:
                results.append(("stale", exc.status_code))
            finally:
                connection.close()

        threads = [threading.Thread(target=decide, args=args) for args in ((first, lead), (second, boss))]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        kinds = sorted(r[0] for r in results)
        self.assertEqual(kinds, ["approved", "stale"])
        self.assertIn(("stale", 409), results)
        winner = [r[1] for r in results if r[0] == "approved"][0]
        esi.refresh_from_db()
        self.assertEqual(esi.full_name, winner)
