from accounts.testing import make_staff
from disputes.models import Dispute

from .base import MarketplaceTestCase, make_customer, make_order


class DisputeOversightTests(MarketplaceTestCase):
    def setUp(self):
        super().setUp()
        self.customer = make_customer("Yaa Boatemaa")
        self.order = make_order(self.customer, self.listing, total="45.00")
        self.open = Dispute.objects.create(order=self.order, raised_by=self.customer, reason=Dispute.DELIVERY_ISSUE, description="Never came")
        self.investigating = Dispute.objects.create(
            order=make_order(self.customer, self.listing, total="100.00"), raised_by=self.customer, reason=Dispute.QUALITY_ISSUE,
            description="Damaged", status=Dispute.INVESTIGATING, flagged_by=self.support,
        )
        self.closed = Dispute.objects.create(
            order=make_order(self.customer, self.listing, total="12.00"), raised_by=self.customer, reason=Dispute.OTHER,
            description="Resolved already", status=Dispute.RESOLVED, resolved_by=self.boss, refund_amount="12.00",
        )
        self.sign_in()

    def rows(self, query=""):
        response = self.client.get(f"/api/marketplace/disputes/{query}")
        self.assertEqual(response.status_code, 200, response.content)
        return {row["id"]: row for row in response.json()["results"]}

    def test_the_team_and_stage_follow_the_dispute_status_only(self):
        rows = self.rows()
        self.assertEqual(set(rows), {self.open.pk, self.investigating.pk})
        self.assertEqual((rows[self.open.pk]["team"], rows[self.open.pk]["stage"]), ("support", "Intake"))
        self.assertEqual((rows[self.investigating.pk]["team"], rows[self.investigating.pk]["stage"]), ("accounting", "Decision"))
        self.assertEqual(rows[self.investigating.pk]["flagged_by_name"], self.support.full_name)
        self.assertEqual(rows[self.open.pk]["businesses"], ["Akosua Ntoma Kente"])
        # No fabricated timers or owners.
        for key in rows[self.open.pk]:
            self.assertNotIn("due", key)

    def test_scopes_and_filters(self):
        self.assertEqual(set(self.rows("?scope=closed")), {self.closed.pk})
        self.assertEqual(len(self.rows("?scope=all")), 3)
        self.assertEqual(set(self.rows("?team=accounting")), {self.investigating.pk})
        self.assertEqual(set(self.rows("?reason=delivery_issue")), {self.open.pk})
        self.assertEqual(set(self.rows(f"?business={self.business.pk}")), {self.open.pk, self.investigating.pk})
        self.assertEqual(set(self.rows(f"?q=%23{self.open.pk}")), {self.open.pk})

    def test_counts_and_money_at_stake(self):
        body = self.client.get("/api/marketplace/disputes/counts/").json()
        self.assertEqual((body["open"], body["with_support"], body["with_accounting"], body["closed_this_month"]), (2, 1, 1, 1))
        self.assertEqual(body["order_value_at_stake"], "145.00")

    def test_a_closed_case_has_no_amount_at_stake(self):
        self.assertIsNone(self.rows("?scope=closed")[self.closed.pk]["at_stake"])

    def test_export_has_no_customer_names(self):
        text = b"".join(self.client.get("/api/marketplace/disputes/export/?scope=all").streaming_content).decode("utf-8-sig")
        self.assertNotIn("Yaa", text)
        self.assertIn("Delivery Issue", text)

    def test_needs_a_dispute_permission(self):
        self.sign_in(self.support)  # Support flags disputes: allowed
        self.assertEqual(self.client.get("/api/marketplace/disputes/").status_code, 200)
        self.sign_in(make_staff("scout", "scout@example.com"))
        self.assertEqual(self.client.get("/api/marketplace/disputes/").status_code, 403)
