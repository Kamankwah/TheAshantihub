from dataclasses import replace

from django.test import TestCase

from accounts.testing import make_staff
from activity.models import ActivityEvent
from approvals import registry, services
from approvals.tests.kinds import BROKEN_APPLY, RENAME_STAFF
from notifications.models import Notification

OTHER_KIND = replace(RENAME_STAFF, key="test.other_rename", label="Another rename (test only)")


class Base(TestCase):
    def setUp(self):
        for kind in (RENAME_STAFF, OTHER_KIND):
            registry.register(kind)
            self.addCleanup(registry.unregister, kind.key)
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.other_ops = make_staff("operations", "kojo@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.esi = make_staff("support", "esi@example.com")
        self.yaw = make_staff("support", "yaw@example.com")

    def submit(self, maker=None, target=None, name="Esi Nyarko", kind=RENAME_STAFF):
        return services.submit(
            maker or self.scout, kind.key, target=target or self.esi, title=f"Rename to {name}",
            payload={"full_name": name},
        )

    def close(self, staff, *, approved=True, note="Settled in the queue", target=None):
        return services.close_pending_for_target(
            RENAME_STAFF.key, target_type="accounts.staffuser", target_id=str((target or self.esi).pk),
            staff=staff, approved=approved, note=note,
        )


class ClosePendingTests(Base):
    def test_approving_settles_every_pending_request_on_the_target_without_applying(self):
        first = self.submit()
        second = self.submit(name="Esi A. Nyarko")
        elsewhere = self.submit(target=self.yaw, name="Yaw Mensah")
        events = ActivityEvent.objects.count()
        closed = self.close(self.lead)
        self.assertEqual([approval.pk for approval in closed], [first.pk, second.pk])
        for approval in (first, second):
            approval.refresh_from_db()
            self.assertEqual(
                (approval.status, approval.decided_by, approval.decision_note),
                ("approved", self.lead, "Settled in the queue"),
            )
            self.assertIsNotNone(approval.decided_at)
            self.assertTrue(Notification.objects.filter(
                staff=self.scout, kind="approval_decided", title=f"Approved: {approval.title}",
                body="Settled in the queue", link=f"approvals/{approval.pk}",
            ).exists())
        elsewhere.refresh_from_db()
        self.assertEqual(elsewhere.status, "pending")
        self.esi.refresh_from_db()
        self.assertEqual(self.esi.full_name, "Esi")  # apply never ran
        self.assertEqual(ActivityEvent.objects.count(), events)  # the caller records, not the engine

    def test_returning_settles_them_as_returned_with_the_note(self):
        approval = self.submit()
        self.close(self.lead, approved=False, note="Card unreadable")
        approval.refresh_from_db()
        self.assertEqual((approval.status, approval.decision_note), ("rejected", "Card unreadable"))
        self.assertTrue(Notification.objects.filter(
            staff=self.scout, kind="approval_decided", title=f"Returned: {approval.title}", body="Card unreadable",
        ).exists())

    def test_a_maker_cannot_close_a_request_they_made(self):
        theirs = self.submit()
        mine = self.submit(maker=self.other_ops, name="Esi B. Nyarko")
        with self.assertRaises(services.MakerCannotDecide) as raised:
            self.close(self.other_ops)
        self.assertEqual(
            (raised.exception.status_code, raised.exception.message), (403, "You can't approve your own request."),
        )
        for approval in (theirs, mine):
            approval.refresh_from_db()
            self.assertEqual(approval.status, "pending")

    def test_only_pending_requests_of_that_kind_are_touched(self):
        decided = self.submit()
        services.approve(decided.pk, self.lead)
        other_kind = self.submit(kind=OTHER_KIND, name="Esi C. Nyarko")
        self.assertEqual(self.close(self.boss), [])
        decided.refresh_from_db()
        other_kind.refresh_from_db()
        self.assertEqual((decided.status, decided.decided_by), ("approved", self.lead))
        self.assertEqual(other_kind.status, "pending")

    def test_nothing_pending_is_fine(self):
        self.assertEqual(self.close(self.lead), [])


class DeciderBeforeApplyTests(Base):
    def test_apply_knows_who_is_deciding(self):
        seen = []
        watching = replace(
            RENAME_STAFF, key="test.sees_decider",
            apply=lambda request: seen.append((request.decided_by, request.decided_at is not None)),
        )
        registry.register(watching)
        self.addCleanup(registry.unregister, watching.key)
        approval = self.submit(kind=watching)
        services.approve(approval.pk, self.lead)
        self.assertEqual(seen, [(self.lead, True)])

    def test_a_failed_apply_leaves_no_decider_behind(self):
        registry.register(BROKEN_APPLY)
        self.addCleanup(registry.unregister, BROKEN_APPLY.key)
        approval = self.submit(kind=BROKEN_APPLY)
        with self.assertLogs("approvals.services", level="ERROR"), self.assertRaises(services.ApplyFailed):
            services.approve(approval.pk, self.lead)
        approval.refresh_from_db()
        self.assertEqual((approval.status, approval.decided_by, approval.decided_at), ("pending", None, None))
