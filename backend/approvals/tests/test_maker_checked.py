"""Maker-checked = two_people: a kind that is never applied by the person who made it, a Super Admin included.

Task 3 of marketplace plan M3 reuses the engine's existing `two_people` flag for this (`listing.staff_create` will
set it); these tests pin the guarantee, the chain a Super Admin maker's request takes, the permission seed and the
KYC kind's use of it."""
from dataclasses import replace

from django.test import TestCase

from accounts.models import Role, StaffUser
from accounts.testing import make_staff
from activity.models import ActivityEvent
from approvals import registry, services
from approvals.models import ApprovalRequest
from approvals.tests.kinds import RENAME_STAFF
from notifications.models import Notification

TWO_PEOPLE = replace(RENAME_STAFF, key="test.maker_checked", two_people=True)


def perms(role):
    return set(Role.objects.get(name=role).permissions.values_list("codename", flat=True))


class MakerCheckedBase(TestCase):
    def setUp(self):
        for kind in (RENAME_STAFF, TWO_PEOPLE):
            registry.register(kind)
            self.addCleanup(registry.unregister, kind.key)
        self.boss = make_staff("super_admin", "boss@example.com")
        self.other_boss = make_staff("super_admin", "boss2@example.com")
        self.ops = make_staff("operations", "ama@example.com")
        self.gm = make_staff("general_manager", "gm@example.com")
        self.esi = make_staff("support", "esi@example.com")

    def submit(self, maker, kind=TWO_PEOPLE):
        return services.submit(maker, kind.key, target=self.esi, title="Rename Esi", payload={"full_name": "Esi Nyarko"})


class MakerCheckedSubmitTests(MakerCheckedBase):
    def test_super_admin_maker_of_maker_checked_kind_is_pending_not_applied(self):
        approval = self.submit(self.boss)
        self.assertEqual(approval.status, "pending")
        self.assertIsNone(approval.decided_by)
        self.esi.refresh_from_db()
        self.assertEqual(self.esi.full_name, "Esi")  # nothing was applied
        self.assertTrue(ActivityEvent.objects.filter(verb="approval.requested", actor_id=self.boss.id).exists())
        self.assertFalse(ActivityEvent.objects.filter(verb="approval.applied_directly").exists())
        self.assertTrue(Notification.objects.filter(staff=self.ops, kind="approval_waiting").exists())
        self.assertFalse(Notification.objects.filter(staff=self.boss, kind="approval_waiting").exists())

    def test_super_admin_maker_cannot_approve_own(self):
        approval = self.submit(self.boss)
        with self.assertRaises(services.MakerCannotDecide):
            services.approve(approval.pk, self.boss)
        approval.refresh_from_db()
        self.assertEqual(approval.status, "pending")

    def test_other_super_admin_can_approve_super_admin_made_request(self):
        approval = self.submit(self.boss)
        services.approve(approval.pk, self.other_boss)
        approval.refresh_from_db()
        self.assertEqual((approval.status, approval.decided_by), ("approved", self.other_boss))
        self.esi.refresh_from_db()
        self.assertEqual(self.esi.full_name, "Esi Nyarko")

    def test_non_maker_checked_kind_still_applies_directly(self):
        approval = self.submit(self.boss, kind=RENAME_STAFF)
        self.assertEqual((approval.status, approval.decided_by), ("approved", self.boss))
        self.assertTrue(ActivityEvent.objects.filter(verb="approval.applied_directly").exists())

    def test_chain_for_super_admin_maker_reaches_pool_gm_and_other_super_admins_never_maker(self):
        approval = self.submit(self.boss)
        deciders = set(services.approvers_for(approval).values_list("pk", flat=True))
        self.assertTrue({self.ops.pk, self.gm.pk, self.other_boss.pk} <= deciders)
        self.assertNotIn(self.boss.pk, deciders)
        for staff in (self.ops, self.gm, self.other_boss):
            self.assertTrue(services.can_decide(approval, staff), staff.email)
        self.assertFalse(services.can_decide(approval, self.boss))


class ListingStagingPermissionSeedTests(TestCase):
    def test_permission_seed(self):
        for role in ("operations", "super_admin", "general_manager"):
            self.assertIn("listings.approve_staffed", perms(role), role)
        self.assertNotIn("listings.approve_staffed", perms("scout"))
        for role in ("scout", "operations", "super_admin"):
            self.assertIn("listings.stage", perms(role), role)
        self.assertNotIn("listings.stage", perms("general_manager"))  # the GM checks, it does not make
