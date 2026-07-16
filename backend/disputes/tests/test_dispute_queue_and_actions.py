from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Customer, Role, StaffUser

from disputes.models import Dispute

LIST_URL = "/api/disputes/"


class DisputeTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.buyer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200664001", password_hash="x",
        )
        self.dispute = Dispute.objects.create(
            raised_by=self.buyer, reason=Dispute.DELIVERY_ISSUE,
            description="Order never arrived.", status=Dispute.OPEN,
        )
        self.support = StaffUser.objects.create(
            full_name="Support Person", email="support-disputes@example.com", password_hash="x",
            role=Role.objects.get(name="support"),
        )
        self.accountant = StaffUser.objects.create(
            full_name="Accountant Person", email="accountant-disputes@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Marketing Person", email="marketing-disputes@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )

    def _auth_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def _flag_url(self, pk=None):
        return f"/api/disputes/{pk or self.dispute.id}/flag/"

    def _resolve_url(self, pk=None):
        return f"/api/disputes/{pk or self.dispute.id}/resolve/"


class DisputeListTests(DisputeTestsBase):
    def test_unauthenticated_is_401(self):
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 401)

    def test_role_with_neither_permission_is_403(self):
        self._auth_staff(self.marketing)
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 403)

    def test_support_role_disputes_flag_can_view_queue(self):
        self._auth_staff(self.support)
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertIn("results", data)
        ids = [d["id"] for d in data["results"]]
        self.assertIn(self.dispute.id, ids)

    def test_accountant_role_disputes_resolve_financial_can_view_queue(self):
        self._auth_staff(self.accountant)
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 200, response.content)


class DisputeFlagTests(DisputeTestsBase):
    def test_unauthenticated_is_401(self):
        response = self.client.post(self._flag_url())
        self.assertEqual(response.status_code, 401)

    def test_without_disputes_flag_permission_is_403(self):
        self._auth_staff(self.accountant)  # has resolve_financial, not flag
        response = self.client.post(self._flag_url())
        self.assertEqual(response.status_code, 403)

    def test_flag_moves_open_to_investigating(self):
        self._auth_staff(self.support)
        response = self.client.post(self._flag_url())
        self.assertEqual(response.status_code, 200, response.content)
        self.dispute.refresh_from_db()
        self.assertEqual(self.dispute.status, Dispute.INVESTIGATING)
        self.assertEqual(self.dispute.flagged_by, self.support)

    def test_cannot_flag_a_resolved_dispute(self):
        self.dispute.status = Dispute.RESOLVED
        self.dispute.save(update_fields=["status"])
        self._auth_staff(self.support)
        response = self.client.post(self._flag_url())
        self.assertEqual(response.status_code, 400, response.content)
        self.dispute.refresh_from_db()
        self.assertIsNone(self.dispute.flagged_by)

    def test_cannot_flag_a_rejected_dispute(self):
        self.dispute.status = Dispute.REJECTED
        self.dispute.save(update_fields=["status"])
        self._auth_staff(self.support)
        response = self.client.post(self._flag_url())
        self.assertEqual(response.status_code, 400, response.content)


class DisputeResolveTests(DisputeTestsBase):
    def setUp(self):
        super().setUp()
        self.dispute.status = Dispute.INVESTIGATING
        self.dispute.flagged_by = self.support
        self.dispute.save(update_fields=["status", "flagged_by"])

    def test_unauthenticated_is_401(self):
        response = self.client.post(self._resolve_url())
        self.assertEqual(response.status_code, 401)

    def test_without_resolve_financial_permission_is_403(self):
        self._auth_staff(self.support)  # has flag, not resolve_financial
        response = self.client.post(self._resolve_url())
        self.assertEqual(response.status_code, 403)

    def test_resolve_with_refund_sets_resolved_status(self):
        self._auth_staff(self.accountant)
        response = self.client.post(
            self._resolve_url(),
            {"refund_amount": "50.00", "resolution_notes": "Refunded half."},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.dispute.refresh_from_db()
        self.assertEqual(self.dispute.status, Dispute.RESOLVED)
        self.assertEqual(str(self.dispute.refund_amount), "50.00")
        self.assertEqual(self.dispute.resolution_notes, "Refunded half.")
        self.assertEqual(self.dispute.resolved_by, self.accountant)

    def test_resolve_with_no_body_defaults_to_resolved_with_no_refund(self):
        self._auth_staff(self.accountant)
        response = self.client.post(self._resolve_url())
        self.assertEqual(response.status_code, 200, response.content)
        self.dispute.refresh_from_db()
        self.assertEqual(self.dispute.status, Dispute.RESOLVED)
        self.assertIsNone(self.dispute.refund_amount)

    def test_resolve_with_outcome_rejected(self):
        self._auth_staff(self.accountant)
        response = self.client.post(
            self._resolve_url(), {"outcome": "rejected", "resolution_notes": "No evidence of an issue."},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.dispute.refresh_from_db()
        self.assertEqual(self.dispute.status, Dispute.REJECTED)

    def test_cannot_resolve_an_already_resolved_dispute(self):
        self._auth_staff(self.accountant)
        first = self.client.post(self._resolve_url())
        self.assertEqual(first.status_code, 200, first.content)
        second = self.client.post(self._resolve_url(), {"refund_amount": "99.00"}, format="json")
        self.assertEqual(second.status_code, 400, second.content)
        self.dispute.refresh_from_db()
        self.assertIsNone(self.dispute.refund_amount)

    def test_can_resolve_directly_from_open_without_flagging_first(self):
        self.dispute.status = Dispute.OPEN
        self.dispute.flagged_by = None
        self.dispute.save(update_fields=["status", "flagged_by"])
        self._auth_staff(self.accountant)
        response = self.client.post(self._resolve_url())
        self.assertEqual(response.status_code, 200, response.content)
        self.dispute.refresh_from_db()
        self.assertEqual(self.dispute.status, Dispute.RESOLVED)
