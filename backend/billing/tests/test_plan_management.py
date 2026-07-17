from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser
from billing.models import SubscriptionPlan


class SubscriptionPlanManagementTests(TestCase):
    """Smoke coverage for the staff plan-management/approval endpoints — not
    exhaustive, just proof of wiring (happy path 200/201 + a 403 for the
    wrong role), mirroring listings/tests' HeroMediaSubmission approval
    smoke-test convention.
    """

    def setUp(self):
        self.accountant = StaffUser.objects.create(
            full_name="Efua Accountant", email="efua-plans@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self.super_admin = StaffUser.objects.create(
            full_name="Yaw SuperAdmin", email="yaw-plans@example.com", password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Kojo Marketing", email="kojo-plans@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )

    def _client_for(self, staff):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")
        return client

    def test_accountant_can_create_a_genuinely_new_plan_and_it_starts_pending(self):
        # SubscriptionPlan.tier is a free-form unique slug (validated by
        # TIER_SLUG_VALIDATOR), not restricted to the 3 seeded values — the
        # accountant role must be able to create plans beyond the platform's
        # 3 baseline tiers, so this exercises a brand-new tier slug rather
        # than reusing/recreating one of the existing 3.
        client = self._client_for(self.accountant)
        response = client.post(
            "/api/billing/plans/manage/",
            {
                "tier": "product_premium", "name": "Product Premium", "kind": "product",
                "monthly_price": "45.00", "status": "active",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        # status="active" was submitted but must be ignored/forced.
        self.assertEqual(data["status"], "pending_approval")
        plan = SubscriptionPlan.objects.get(tier="product_premium")
        self.assertEqual(plan.status, SubscriptionPlan.PENDING_APPROVAL)

    def test_invalid_tier_slug_is_rejected(self):
        client = self._client_for(self.accountant)
        response = client.post(
            "/api/billing/plans/manage/",
            {"tier": "Not A Valid Slug!", "name": "Bad Tier", "kind": "product", "monthly_price": "25.00"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_marketing_staff_cannot_create_plan(self):
        client = self._client_for(self.marketing)
        response = client.post(
            "/api/billing/plans/manage/",
            {"tier": "product_marketing_attempt", "name": "Nope", "kind": "product", "monthly_price": "25.00"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_editing_an_active_plan_resets_it_to_pending_approval(self):
        plan = SubscriptionPlan.objects.get(tier="product_basic")
        self.assertEqual(plan.status, SubscriptionPlan.ACTIVE_STATUS)
        client = self._client_for(self.accountant)
        response = client.patch(
            f"/api/billing/plans/manage/{plan.id}/", {"monthly_price": "12.00"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "pending_approval")
        plan.refresh_from_db()
        self.assertEqual(plan.status, SubscriptionPlan.PENDING_APPROVAL)

    def test_super_admin_can_approve_a_pending_plan(self):
        plan = SubscriptionPlan.objects.create(
            tier="product_pending", name="Product Pending", kind="product", monthly_price="18.00",
        )
        self.assertEqual(plan.status, SubscriptionPlan.PENDING_APPROVAL)
        client = self._client_for(self.super_admin)
        response = client.post(f"/api/billing/plans/{plan.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        plan.refresh_from_db()
        self.assertEqual(plan.status, SubscriptionPlan.ACTIVE_STATUS)

    def test_accountant_cannot_approve_a_pending_plan(self):
        plan = SubscriptionPlan.objects.create(
            tier="product_pending2", name="Product Pending 2", kind="product", monthly_price="18.00",
        )
        client = self._client_for(self.accountant)
        response = client.post(f"/api/billing/plans/{plan.id}/approve/")
        self.assertEqual(response.status_code, 403)

    def test_super_admin_can_reject_a_pending_plan_with_reason(self):
        plan = SubscriptionPlan.objects.create(
            tier="product_pending3", name="Product Pending 3", kind="product", monthly_price="18.00",
        )
        client = self._client_for(self.super_admin)
        response = client.post(
            f"/api/billing/plans/{plan.id}/reject/", {"reason": "Price too high for this tier."},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        plan.refresh_from_db()
        self.assertEqual(plan.status, SubscriptionPlan.REJECTED_STATUS)
        self.assertEqual(plan.rejection_reason, "Price too high for this tier.")

    def test_reject_without_reason_is_rejected(self):
        plan = SubscriptionPlan.objects.create(
            tier="product_pending4", name="Product Pending 4", kind="product", monthly_price="18.00",
        )
        client = self._client_for(self.super_admin)
        response = client.post(f"/api/billing/plans/{plan.id}/reject/", {}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_pending_queue_only_lists_pending_plans(self):
        SubscriptionPlan.objects.create(
            tier="product_pending5", name="Product Pending 5", kind="product", monthly_price="18.00",
        )
        client = self._client_for(self.super_admin)
        response = client.get("/api/billing/plans/pending/")
        self.assertEqual(response.status_code, 200, response.content)
        tiers = {plan["tier"] for plan in response.json()}
        self.assertIn("product_pending5", tiers)
        self.assertNotIn("product_basic", tiers)


class SubscriptionPlanApprovalQueueTests(SubscriptionPlanManagementTests):
    """Pending/Approved/Rejected tabs + re-review (punch-list item 6).
    Note "approved" maps to this model's `active` status — a plan that passes
    approval is live.
    """

    QUEUE_URL = "/api/billing/plans/pending/"

    def setUp(self):
        super().setUp()
        self.pending_plan = SubscriptionPlan.objects.create(
            tier="queue_pending", name="Queue Pending", kind="product",
            monthly_price="10.00", status=SubscriptionPlan.PENDING_APPROVAL,
        )
        self.rejected_plan = SubscriptionPlan.objects.create(
            tier="queue_rejected", name="Queue Rejected", kind="product",
            monthly_price="12.00", status=SubscriptionPlan.REJECTED_STATUS,
            rejection_reason="Too expensive",
        )

    def test_default_queue_is_pending(self):
        client = self._client_for(self.super_admin)
        response = client.get(self.QUEUE_URL)
        self.assertEqual(response.status_code, 200, response.content)
        ids = [p["id"] for p in response.json()]
        self.assertIn(self.pending_plan.id, ids)
        self.assertNotIn(self.rejected_plan.id, ids)

    def test_rejected_tab_lists_rejected_plans_with_reason(self):
        client = self._client_for(self.super_admin)
        response = client.get(f"{self.QUEUE_URL}?status=rejected")
        row = next(p for p in response.json() if p["id"] == self.rejected_plan.id)
        self.assertEqual(row["rejection_reason"], "Too expensive")

    def test_approved_tab_lists_active_plans(self):
        client = self._client_for(self.super_admin)
        client.post(f"/api/billing/plans/{self.pending_plan.id}/approve/")
        ids = [p["id"] for p in client.get(f"{self.QUEUE_URL}?status=approved").json()]
        self.assertIn(self.pending_plan.id, ids)

    def test_approve_records_reviewer_and_surfaces_the_name(self):
        client = self._client_for(self.super_admin)
        client.post(f"/api/billing/plans/{self.pending_plan.id}/approve/")
        self.pending_plan.refresh_from_db()
        self.assertEqual(self.pending_plan.reviewed_by, self.super_admin)
        self.assertIsNotNone(self.pending_plan.reviewed_at)

        row = next(
            p for p in client.get(f"{self.QUEUE_URL}?status=approved").json()
            if p["id"] == self.pending_plan.id
        )
        self.assertEqual(row["reviewed_by_name"], "Yaw SuperAdmin")

    def test_reject_records_reviewer(self):
        client = self._client_for(self.super_admin)
        client.post(
            f"/api/billing/plans/{self.pending_plan.id}/reject/",
            {"reason": "Not viable"}, format="json",
        )
        self.pending_plan.refresh_from_db()
        self.assertEqual(self.pending_plan.reviewed_by, self.super_admin)
        self.assertIsNotNone(self.pending_plan.reviewed_at)

    def test_re_review_moves_rejected_back_to_pending_and_clears_rejection(self):
        client = self._client_for(self.super_admin)
        response = client.post(f"/api/billing/plans/{self.rejected_plan.id}/re-review/")
        self.assertEqual(response.status_code, 200, response.content)
        self.rejected_plan.refresh_from_db()
        self.assertEqual(self.rejected_plan.status, SubscriptionPlan.PENDING_APPROVAL)
        self.assertIsNone(self.rejected_plan.rejection_reason)
        self.assertIsNone(self.rejected_plan.reviewed_by)
        self.assertIsNone(self.rejected_plan.reviewed_at)

    def test_re_review_rejects_a_non_rejected_plan(self):
        client = self._client_for(self.super_admin)
        response = client.post(f"/api/billing/plans/{self.pending_plan.id}/re-review/")
        self.assertEqual(response.status_code, 400)

    def test_re_review_requires_the_approve_permission(self):
        client = self._client_for(self.accountant)
        response = client.post(f"/api/billing/plans/{self.rejected_plan.id}/re-review/")
        self.assertEqual(response.status_code, 403)

    def test_new_plans_get_a_created_at(self):
        """This model had no timestamp at all before item 6 — the pending
        queue ordered by id as a stand-in for "oldest first".
        """
        self.assertIsNotNone(self.pending_plan.created_at)
