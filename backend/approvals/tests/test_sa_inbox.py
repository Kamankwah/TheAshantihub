"""Super Admin approvals home (SA-2): amount, filters, the Everything counts,
and the password re-entry a money kind needs before it can be approved."""
from dataclasses import replace
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from approvals import registry, services
from approvals.models import ApprovalRequest
from approvals.tests.kinds import RENAME_STAFF

MONEY = replace(
    RENAME_STAFF, key="test.money", label="Money (test only)", requires_sudo=True,
    amount_of=lambda request: Decimal(str(request.payload.get("amount", "0"))),
)


class SuperAdminInboxTests(TestCase):
    def setUp(self):
        for kind in (RENAME_STAFF, MONEY):
            registry.register(kind)
            self.addCleanup(registry.unregister, kind.key)
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.accountant = make_staff("accountant", "kwabena@example.com")
        self.scout = make_staff("scout", "kwame@example.com")
        self.esi = make_staff("support", "esi@example.com")

    def as_(self, staff, **kw):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, **kw)}")

    def submit(self, maker, kind=RENAME_STAFF, **payload):
        return services.submit(
            maker, kind.key, target=self.esi, title=f"{kind.label} by {maker.full_name}",
            payload={"full_name": "Esi Nyarko", **payload},
        )

    def ids(self, query):
        return {row["id"] for row in self.client.get(f"/api/approvals/?{query}").json()["results"]}

    def test_amount_is_stored_only_for_kinds_that_carry_one(self):
        plain = self.submit(self.scout)
        money = self.submit(self.accountant, MONEY, amount="25000.50")
        self.assertIsNone(plain.amount)
        self.assertEqual(money.amount, Decimal("25000.50"))
        self.as_(self.boss)
        rows = {r["id"]: r for r in self.client.get("/api/approvals/?box=all").json()["results"]}
        self.assertIsNone(rows[plain.id]["amount"])
        self.assertEqual(rows[money.id]["amount"], "25000.50")
        self.assertTrue(rows[money.id]["requires_sudo"])
        self.assertFalse(rows[plain.id]["requires_sudo"])

    def test_team_level_and_amount_filters(self):
        plain = self.submit(self.scout)
        small = self.submit(self.accountant, MONEY, amount="500")
        big = self.submit(self.accountant, MONEY, amount="25000")
        ApprovalRequest.objects.filter(pk=big.pk).update(escalation_level=1)
        self.as_(self.boss)
        self.assertEqual(self.ids("box=all&team=accountant"), {small.id, big.id})
        self.assertEqual(self.ids("box=all&team=scout"), {plain.id})
        self.assertEqual(self.ids("box=all&level=1"), {big.id})
        self.assertEqual(self.ids("box=all&amount_min=1000"), {big.id})
        self.assertEqual(self.ids("box=all&amount_max=1000"), {small.id})
        self.assertEqual(self.client.get("/api/approvals/?box=all&amount_min=x").status_code, 400)
        self.assertEqual(self.client.get("/api/approvals/?box=all&level=x").status_code, 400)

    def test_status_takes_a_list_for_the_closed_tab(self):
        a, b, c = self.submit(self.scout), self.submit(self.scout), self.submit(self.scout)
        ApprovalRequest.objects.filter(pk=a.pk).update(status=ApprovalRequest.CANCELLED)
        ApprovalRequest.objects.filter(pk=b.pk).update(status=ApprovalRequest.EXPIRED)
        self.as_(self.boss)
        self.assertEqual(self.ids("box=all&status=cancelled,expired"), {a.id, b.id})
        self.assertEqual(self.ids("box=all&status=pending"), {c.id})

    def test_counts_give_open_total_teams_and_levels_to_view_all_only(self):
        self.submit(self.scout)
        self.submit(self.accountant, MONEY, amount="10")
        self.as_(self.boss)
        counts = self.client.get("/api/approvals/counts/").json()
        self.assertEqual(counts["all_open"], 2)
        self.assertEqual(counts["teams"], ["accountant", "scout"])
        self.assertEqual(counts["levels"], [0])
        self.as_(self.scout)
        counts = self.client.get("/api/approvals/counts/").json()
        self.assertIsNone(counts["all_open"])
        self.assertEqual(counts["teams"], [])

    def test_approving_a_money_kind_needs_the_password_again(self):
        money = self.submit(self.accountant, MONEY, amount="25000")
        self.as_(self.boss)
        refused = self.client.post(f"/api/approvals/{money.id}/approve/", {}, format="json")
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.json()["code"], "sudo_required")
        money.refresh_from_db()
        self.assertEqual(money.status, ApprovalRequest.PENDING)
        self.as_(self.boss, sudo=True)
        self.assertEqual(self.client.post(f"/api/approvals/{money.id}/approve/", {}, format="json").status_code, 200)

    def test_returning_a_money_kind_and_approving_a_plain_kind_need_no_password(self):
        money = self.submit(self.accountant, MONEY, amount="25000")
        plain = self.submit(self.scout)
        self.as_(self.boss)
        self.assertEqual(self.client.post(f"/api/approvals/{plain.id}/approve/", {}, format="json").status_code, 200)
        returned = self.client.post(f"/api/approvals/{money.id}/reject/", {"note": "Check the lines"}, format="json")
        self.assertEqual(returned.status_code, 200)
