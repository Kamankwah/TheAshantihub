"""SA-3: the co-signer second approval, editable timers and thresholds."""
import threading
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Permission, Role
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from approvals import registry, rules, services
from approvals.models import ApprovalDecision, ApprovalRequest, ApprovalRule, ApprovalSettings
from approvals.tests.kinds import RENAME_STAFF

applied = []
MONEY = replace(
    RENAME_STAFF, key="test.cosign_money", label="Money (test only)", requires_sudo=True,
    amount_of=lambda request: Decimal(str(request.payload.get("amount", "0"))),
    apply=lambda request: applied.append(request.pk),
)


class Base(TestCase):
    def setUp(self):
        applied.clear()
        registry.register(MONEY)
        self.addCleanup(registry.unregister, MONEY.key)
        self.boss = make_staff("super_admin", "boss@example.com")
        self.cosigner = make_staff("cosigner", "cosign@example.com")
        self.accountant = make_staff("accountant", "kwabena@example.com")
        self.esi = make_staff("support", "esi@example.com")

    def submit(self, amount, maker=None):
        return services.submit(
            maker or self.accountant, MONEY.key, target=self.esi, title="Pay out", payload={"full_name": "Esi N", "amount": str(amount)},
        )


class ThresholdTests(Base):
    def test_defaults_equal_the_old_hard_coded_values(self):
        settings = rules.get_settings()
        self.assertEqual(
            (settings.cosign_threshold, settings.refund_threshold, settings.campaign_threshold, settings.remind_fraction),
            (Decimal("20000.00"), Decimal("500.00"), Decimal("25.00"), Decimal("0.75")),
        )
        self.assertEqual(rules.response_hours(MONEY.key), MONEY.response_hours)

    def test_only_amounts_strictly_above_the_limit_need_two(self):
        self.assertEqual(self.submit("20000.00").required_approvals, 1)
        self.assertEqual(self.submit("20000.01").required_approvals, 2)

    def test_a_kind_without_an_amount_never_needs_two(self):
        registry.register(RENAME_STAFF)
        self.addCleanup(registry.unregister, RENAME_STAFF.key)
        approval = services.submit(self.accountant, RENAME_STAFF.key, target=self.esi, title="x", payload={"full_name": "A"})
        self.assertEqual(approval.required_approvals, 1)

    def test_raising_the_limit_changes_later_requests_not_earlier_ones(self):
        early = self.submit("30000")
        s = rules.get_settings()
        s.cosign_threshold = Decimal("50000")
        s.save()
        self.assertEqual(early.required_approvals, 2)
        self.assertEqual(self.submit("30000").required_approvals, 1)

    def test_a_super_admins_own_change_still_applies_at_once(self):
        approval = self.submit("90000", maker=self.boss)
        self.assertEqual((approval.status, approval.required_approvals), ("approved", 1))


class TwoApprovalTests(Base):
    def test_approver_then_cosigner_applies_once(self):
        approval = self.submit("25000")
        services.approve(approval.pk, self.boss)
        approval.refresh_from_db()
        self.assertEqual((approval.status, applied), ("pending", []))
        self.assertEqual(services.waiting_on(approval), "cosigner")
        services.approve(approval.pk, self.cosigner)
        approval.refresh_from_db()
        self.assertEqual((approval.status, applied, approval.decided_by), ("approved", [approval.pk], self.boss))
        self.assertEqual(
            list(approval.decisions.values_list("slot", "staff__email")),
            [("approver", "boss@example.com"), ("cosigner", "cosign@example.com")],
        )

    def test_cosigner_may_sign_first(self):
        approval = self.submit("25000")
        services.approve(approval.pk, self.cosigner)
        approval.refresh_from_db()
        self.assertEqual((approval.status, services.waiting_on(approval)), ("pending", "approver"))
        services.approve(approval.pk, self.boss)
        approval.refresh_from_db()
        self.assertEqual((approval.status, applied), ("approved", [approval.pk]))

    def test_the_same_person_cannot_count_twice(self):
        approval = self.submit("25000")
        services.approve(approval.pk, self.boss)
        with self.assertRaises(services.NotYourDecision):
            services.approve(approval.pk, self.boss)
        self.assertEqual(approval.decisions.count(), 1)
        services.approve(approval.pk, self.cosigner)
        with self.assertRaises(services.NotPending):
            services.approve(approval.pk, self.cosigner)

    def test_a_second_super_admin_is_not_a_cosigner(self):
        other = make_staff("super_admin", "second@example.com")
        approval = self.submit("25000")
        services.approve(approval.pk, self.boss)
        with self.assertRaises(services.NotYourDecision):
            services.approve(approval.pk, other)

    def test_the_maker_can_never_decide_even_holding_cosign(self):
        # A co-signer who somehow made the request still cannot sign it.
        approval = self.submit("25000", maker=self.cosigner)
        with self.assertRaises(services.MakerCannotDecide):
            services.approve(approval.pk, self.cosigner)
        self.assertFalse(services.can_decide(approval, self.cosigner))

    def test_nobody_named_means_it_waits_and_cannot_be_released(self):
        self.cosigner.delete()
        approval = self.submit("25000")
        services.approve(approval.pk, self.boss)
        approval.refresh_from_db()
        self.assertEqual((approval.status, applied, rules.cosigner_named()), ("pending", [], False))

    def test_an_unaccepted_invite_is_not_a_named_cosigner(self):
        self.cosigner.invite_token = "tok"
        self.cosigner.save()
        self.assertFalse(rules.cosigner_named())

    def test_cosigner_cannot_decide_a_one_approval_request(self):
        approval = self.submit("100")
        self.assertFalse(services.can_decide(approval, self.cosigner))
        with self.assertRaises(services.NotYourDecision):
            services.approve(approval.pk, self.cosigner)

    def test_either_person_can_return_it(self):
        approval = self.submit("25000")
        services.approve(approval.pk, self.boss)
        services.reject(approval.pk, self.cosigner, "Amount looks wrong")
        approval.refresh_from_db()
        self.assertEqual((approval.status, applied), ("rejected", []))

    def test_cosigner_inbox_and_visibility_are_only_cosign_requests(self):
        big, small = self.submit("25000"), self.submit("100")
        self.assertEqual(list(services.waiting_for(self.cosigner)), [big])
        self.assertEqual(list(services.visible_to(self.cosigner)), [big])
        services.approve(big.pk, self.cosigner)
        self.assertEqual(list(services.waiting_for(self.cosigner)), [])
        self.assertEqual(list(services.visible_to(self.cosigner)), [big])
        self.assertIn(big.pk, [a.pk for a in services.waiting_for(self.boss)])
        self.assertNotIn(small, services.visible_to(self.cosigner))

    def test_once_the_approver_signed_the_super_admin_inbox_no_longer_waits(self):
        approval = self.submit("25000")
        services.approve(approval.pk, self.boss)
        self.assertEqual(list(services.waiting_for(self.boss)), [])
        self.assertEqual(list(services.waiting_for(self.cosigner)), [approval])

    def test_stale_target_blocks_the_second_signature(self):
        approval = self.submit("25000")
        services.approve(approval.pk, self.boss)
        self.esi.full_name = "Changed"
        self.esi.save()
        with self.assertRaises(services.StaleRequest):
            services.approve(approval.pk, self.cosigner)

    def test_cosigner_waiting_is_never_escalated_only_reminded(self):
        approval = self.submit("25000")
        services.approve(approval.pk, self.boss)
        approval.refresh_from_db()
        moved = services.escalate_due(now=approval.due_at + timedelta(minutes=1))
        approval.refresh_from_db()
        self.assertEqual((moved, approval.escalation_level, approval.status), (0, 0, "pending"))
        self.assertTrue(approval.due_at > timezone.now())


class ApiTests(Base):
    def setUp(self):
        super().setUp()
        self.client = APIClient()

    def as_(self, staff, **kw):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, **kw)}")

    def test_detail_reports_who_has_signed_and_what_is_missing(self):
        approval = self.submit("25000")
        services.approve(approval.pk, self.boss)
        self.as_(self.cosigner)
        body = self.client.get(f"/api/approvals/{approval.pk}/").json()
        self.assertEqual(body["signoff"]["required"], 2)
        self.assertEqual(body["signoff"]["waiting_on"], "cosigner")
        self.assertEqual(body["signoff"]["cosigner_named"], True)
        self.assertEqual([s["slot"] for s in body["signoff"]["signed"]], ["approver"])
        self.assertTrue(body["can_decide"])

    def test_cosigner_sees_nothing_else_over_the_api(self):
        big, small = self.submit("25000"), self.submit("100")
        self.as_(self.cosigner)
        self.assertEqual(self.client.get(f"/api/approvals/{small.pk}/").status_code, 404)
        ids = [r["id"] for r in self.client.get("/api/approvals/?box=mine").json()["results"]]
        self.assertEqual(ids, [big.pk])
        self.assertEqual(self.client.get("/api/approvals/?box=all").status_code, 403)
        self.assertEqual(self.client.get("/api/approvals/rules/").status_code, 403)
        self.assertEqual(self.client.patch("/api/approvals/rules/", {"cosign_threshold": "1"}, format="json").status_code, 403)

    def test_money_approval_by_the_cosigner_needs_the_password(self):
        approval = self.submit("25000")
        self.as_(self.cosigner)
        refused = self.client.post(f"/api/approvals/{approval.pk}/approve/", {}, format="json")
        self.assertEqual(refused.json()["code"], "sudo_required")
        self.as_(self.cosigner, sudo=True)
        self.assertEqual(self.client.post(f"/api/approvals/{approval.pk}/approve/", {}, format="json").status_code, 200)

    def test_rules_get_lists_kinds_and_the_empty_cosigner_slot(self):
        self.cosigner.delete()
        self.as_(self.boss)
        body = self.client.get("/api/approvals/rules/").json()
        self.assertEqual(body["settings"]["cosign_threshold"], "20000.00")
        self.assertFalse(body["cosigner_named"])
        kind = next(k for k in body["kinds"] if k["key"] == MONEY.key)
        self.assertEqual((kind["response_hours"], kind["overridden"], kind["has_amount"]), (24, False, True))

    def test_editing_needs_the_password_and_is_audited(self):
        self.as_(self.boss)
        refused = self.client.patch("/api/approvals/rules/", {"cosign_threshold": "30000"}, format="json")
        self.assertEqual(refused.json()["code"], "sudo_required")
        self.assertEqual(rules.get_settings().cosign_threshold, Decimal("20000.00"))
        self.as_(self.boss, sudo=True)
        ok = self.client.patch(
            "/api/approvals/rules/", {"cosign_threshold": "30,000.50", "remind_fraction": "0.5", "kinds": {MONEY.key: 6}}, format="json",
        )
        self.assertEqual(ok.status_code, 200)
        settings = ApprovalSettings.objects.get()
        self.assertEqual((settings.cosign_threshold, settings.remind_fraction, settings.updated_by), (Decimal("30000.50"), Decimal("0.50"), self.boss))
        self.assertEqual(rules.response_hours(MONEY.key), 6)
        event = ActivityEvent.objects.get(verb="approval.rules_changed")
        self.assertEqual(event.before["cosign_threshold"], "20000.00")
        self.assertEqual((event.after["cosign_threshold"], event.after["hours"]), ("30000.50", {MONEY.key: 6}))

    def test_invalid_values_are_refused_and_nothing_is_saved(self):
        self.as_(self.boss, sudo=True)
        for body in ({"cosign_threshold": "abc"}, {"cosign_threshold": "0"}, {"remind_fraction": "0.9"}, {"kinds": {MONEY.key: 0}}, {"kinds": {"nope": 4}}):
            with self.subTest(body=body):
                self.assertEqual(self.client.patch("/api/approvals/rules/", body, format="json").status_code, 400)
        self.assertEqual(ActivityEvent.objects.filter(verb="approval.rules_changed").count(), 0)

    def test_a_response_time_override_drives_the_due_time_and_reset_removes_it(self):
        self.as_(self.boss, sudo=True)
        self.client.patch("/api/approvals/rules/", {"kinds": {MONEY.key: 4}}, format="json")
        approval = self.submit("100")
        self.assertAlmostEqual((approval.due_at - approval.stage_started_at).total_seconds(), 4 * 3600, delta=5)
        self.client.patch("/api/approvals/rules/", {"kinds": {MONEY.key: None}}, format="json")
        self.assertFalse(ApprovalRule.objects.exists())

    def test_the_cosigner_role_holds_only_the_cosign_permission(self):
        role = Role.objects.get(name="cosigner")
        self.assertEqual(set(role.permissions.values_list("codename", flat=True)), {"approvals.cosign"})
        self.assertTrue(Role.objects.get(name="super_admin").permissions.filter(codename="approvals.manage_rules").exists())
        self.assertTrue(Permission.objects.filter(codename="approvals.cosign").exists())

    def test_a_super_admin_can_invite_a_cosigner(self):
        self.as_(self.boss, sudo=True)
        reply = self.client.post("/api/accounts/staff/invite/", {"full_name": "Nii Ext", "email": "nii@example.com", "role": "cosigner"}, format="json")
        self.assertIn(reply.status_code, (200, 201), reply.content)


class ConcurrentCosignTests(TransactionTestCase):
    serialized_rollback = True

    def test_two_cosigners_racing_fill_the_slot_once(self):
        counted = []
        kind = replace(MONEY, key="test.race_money", apply=lambda request: counted.append(request.pk))
        registry.register(kind)
        self.addCleanup(registry.unregister, kind.key)
        boss = make_staff("super_admin", "boss@example.com")
        c1, c2 = make_staff("cosigner", "c1@example.com"), make_staff("cosigner", "c2@example.com")
        maker, esi = make_staff("accountant", "acc@example.com"), make_staff("support", "esi@example.com")
        approval = services.submit(maker, kind.key, target=esi, title="Pay", payload={"full_name": "E", "amount": "50000"})
        services.approve(approval.pk, boss)
        results, barrier = [], threading.Barrier(2)

        def sign(staff):
            try:
                barrier.wait()
                services.approve(approval.pk, staff)
                results.append("approved")
            except (services.NotPending, services.NotYourDecision):
                results.append("refused")
            finally:
                connection.close()

        threads = [threading.Thread(target=sign, args=(s,)) for s in (c1, c2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)
            self.assertFalse(t.is_alive())
        self.assertEqual(sorted(results), ["approved", "refused"])
        self.assertEqual(counted, [approval.pk])
        self.assertEqual(ApprovalDecision.objects.filter(request=approval).count(), 2)
