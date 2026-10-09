from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from approvals import services as approvals
from approvals.models import ApprovalRequest
from commission.models import CommissionAccrual, CommissionPolicy
from fraud import services as fraud
from fraud.models import FraudFlag

from .base import CommissionBase


class MyStatementTests(CommissionBase):
    def setUp(self):
        super().setUp()
        self.policy()
        self.policy(CommissionPolicy.BONUS, "100.00")
        for registrar in (self.scout, self.scout, self.other):
            self.approve(self.pending_owner(registrar=registrar))
        self.dup = CommissionAccrual.objects.filter(staff=self.scout).first()

    def test_a_scout_sees_only_their_own_lines_and_totals(self):
        self.as_staff(self.scout)
        body = self.client.get("/api/commission/me/").json()
        self.assertEqual(body["count"], 2)
        self.assertEqual(len(body["results"]), 2)
        self.assertEqual(body["totals"]["on_hold"], {"amount": "100.00", "count": 2, "registrations": 2, "bonuses": 0})
        self.assertEqual(body["totals"]["paid"]["amount"], "0.00")
        self.assertEqual(body["policy"]["registration"]["amount"], "50.00")
        self.assertEqual(body["policy"]["three_paid_months_bonus"]["amount"], "100.00")
        self.assertNotIn("Efua", str(body))

    def test_lines_page_four_at_a_time_and_all_on_request(self):
        for _ in range(4):
            self.approve(self.pending_owner(registrar=self.scout))
        self.as_staff(self.scout)
        body = self.client.get("/api/commission/me/").json()
        self.assertEqual((body["count"], len(body["results"])), (6, 4))
        self.assertEqual(len(self.client.get("/api/commission/me/?page_size=20").json()["results"]), 6)

    def test_a_reversed_line_carries_its_reason_and_the_total_counts_it_separately(self):
        flag = fraud.raise_flag(FraudFlag.DUPLICATE, title="Case", business_owner=self.dup.business_owner)
        fraud.confirm(flag.pk, self.boss, note="Duplicate")
        self.as_staff(self.scout)
        body = self.client.get("/api/commission/me/").json()
        self.assertEqual(body["totals"]["reversed"]["amount"], "50.00")
        self.assertEqual(body["totals"]["reversed"]["reasons"], {"duplicate business": 1})
        reversed_line = next(r for r in body["results"] if r["status"] == "reversed")
        self.assertEqual(reversed_line["reversed_label"], "duplicate business")

    def test_bonus_progress_for_managed_businesses(self):
        from billing.models import Subscription, SubscriptionPlan

        owner = self.dup.business_owner
        now = timezone.now()
        Subscription.objects.create(
            business_owner=owner, plan=SubscriptionPlan.objects.get(tier="product_basic"),
            current_period_start=now, current_period_end=now + timedelta(days=10),
        )
        self.pay(owner, 1)
        self.pay(owner, 1)
        self.as_staff(self.scout)
        rows = self.client.get("/api/commission/me/").json()["bonus"]
        row = next(r for r in rows if r["business_id"] == owner.pk)
        self.assertEqual((row["paid_months"], row["state"]["kind"]), (2, "next_renewal"))
        Subscription.objects.filter(business_owner=owner).update(overdue_since=now - timedelta(days=3))
        row = next(r for r in self.client.get("/api/commission/me/").json()["bonus"] if r["business_id"] == owner.pk)
        self.assertEqual(row["state"], {"kind": "overdue", "day": 4})
        self.pay(owner, 1)  # the third month: earned, so it leaves the progress list
        ids = [r["business_id"] for r in self.client.get("/api/commission/me/").json()["bonus"]]
        self.assertNotIn(owner.pk, ids)

    def test_permissions(self):
        self.client.credentials()
        self.assertEqual(self.client.get("/api/commission/me/").status_code, 401)
        self.as_staff(self.accountant)
        self.assertEqual(self.client.get("/api/commission/me/").status_code, 403)
        self.as_staff(self.lead)
        self.assertEqual(self.client.get("/api/commission/me/").status_code, 403)


class AllRecordsTests(CommissionBase):
    def setUp(self):
        super().setUp()
        self.policy()
        self.approve(self.pending_owner(registrar=self.scout, name="=Evil"))
        self.approve(self.pending_owner(registrar=self.other))

    def test_accounting_sees_every_staff_member(self):
        self.as_staff(self.accountant)
        body = self.client.get("/api/commission/accruals/").json()
        self.assertEqual(body["count"], 2)
        self.assertEqual({r["staff"] for r in body["results"]}, {self.scout.full_name, self.other.full_name})
        one = self.client.get(f"/api/commission/accruals/?staff={self.other.pk}").json()
        self.assertEqual(one["count"], 1)

    def test_a_scout_cannot(self):
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/commission/accruals/").status_code, 403)

    def test_csv_export_is_escaped_and_recorded(self):
        self.as_staff(self.accountant)
        response = self.client.get("/api/commission/accruals/?format=csv")
        self.assertEqual(response.status_code, 200)
        text = b"".join(response.streaming_content).decode("utf-8-sig")
        self.assertIn("Staff,Business,Kind", text)
        self.assertIn("50.00", text)
        self.assertEqual(len(text.strip().splitlines()), 3)
        from activity.models import ActivityEvent

        self.assertTrue(ActivityEvent.objects.filter(verb="commission.exported").exists())


class PolicyTests(CommissionBase):
    def propose(self, **overrides):
        body = {"kind": "registration", "amount": "55.00", "effective_from": timezone.localdate().isoformat(), "note": "Raise"}
        return self.client.post("/api/commission/policies/", {**body, **overrides}, format="json")

    def test_accounting_proposes_and_nothing_changes_until_a_super_admin_approves(self):
        self.as_staff(self.accountant)
        response = self.propose()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["status"], "pending")
        self.assertFalse(CommissionPolicy.objects.exists())
        listing = self.client.get("/api/commission/policies/").json()
        self.assertEqual(listing["current"]["registration"], None)
        self.assertEqual(listing["pending"][0]["amount"], "55.00")
        self.as_staff(self.boss)
        approvals.approve(response.json()["approval_id"], self.boss, "OK")
        policy = CommissionPolicy.objects.get()
        self.assertEqual((policy.kind, policy.amount, policy.proposed_by, policy.approved_by), ("registration", Decimal("55.00"), self.accountant, self.boss))

    def test_an_approved_policy_is_never_retroactive(self):
        owner = self.pending_owner()
        self.approve(owner)
        self.as_staff(self.accountant)
        past = (timezone.localdate() - timedelta(days=60)).isoformat()
        approval_id = self.propose(effective_from=past).json()["approval_id"]
        approvals.approve(approval_id, self.boss, "OK")
        self.assertEqual(CommissionPolicy.objects.get().effective_from, timezone.localdate())
        self.assertFalse(CommissionAccrual.objects.exists())

    def test_the_maker_cannot_approve_their_own_proposal(self):
        self.as_staff(self.accountant)
        approval_id = self.propose().json()["approval_id"]
        with self.assertRaises(approvals.MakerCannotDecide):
            approvals.approve(approval_id, self.accountant, "me")

    def test_a_super_admins_own_change_applies_at_once(self):
        self.as_staff(self.boss)
        self.assertEqual(self.propose(kind="three_paid_months_bonus", amount="120.00").status_code, 201)
        self.assertEqual(CommissionPolicy.objects.get().amount, Decimal("120.00"))

    def test_bad_input_is_refused(self):
        self.as_staff(self.accountant)
        for bad in ({"amount": "0"}, {"amount": "-5"}, {"amount": "abc"}, {"amount": "12.345"}, {"amount": "1e9"}, {"amount": "NaN"},
                    {"kind": "salary"}, {"effective_from": "soon"}):
            self.assertEqual(self.propose(**bad).status_code, 400, bad)
        self.assertFalse(ApprovalRequest.objects.exists())

    def test_one_open_proposal_per_kind(self):
        self.as_staff(self.accountant)
        self.assertEqual(self.propose().status_code, 201)
        self.assertEqual(self.propose(amount="60.00").status_code, 409)
        self.assertEqual(self.propose(kind="three_paid_months_bonus").status_code, 201)

    def test_only_the_policy_permission_proposes_and_scouts_cannot_read(self):
        self.as_staff(self.scout)
        self.assertEqual(self.client.get("/api/commission/policies/").status_code, 403)
        self.assertEqual(self.propose().status_code, 403)
        self.as_staff(self.lead)
        self.assertEqual(self.propose().status_code, 403)
