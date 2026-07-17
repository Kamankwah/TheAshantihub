from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Role, StaffUser
from credit.models import CreditScore, LendingPartner, LoanApplication


class CreditManagementTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.accountant = StaffUser.objects.create(
            full_name="Efua Accountant", email="efua-credit@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self.support = StaffUser.objects.create(
            full_name="Sam Support", email="sam-credit@example.com", password_hash="x",
            role=Role.objects.get(name="support"),
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Trader", login_phone="+233207990011", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED,
        )

    def _staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def _owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")


class LendingPartnerSeedTests(TestCase):
    def test_six_partners_seeded(self):
        """The migration moved the six hardcoded frontend partners into the DB."""
        self.assertEqual(LendingPartner.objects.count(), 6)
        self.assertTrue(LendingPartner.objects.filter(name="Fidelity Bank Ghana").exists())


class LendingPartnerApiTests(CreditManagementTestsBase):
    def test_business_owner_sees_only_active_partners(self):
        LendingPartner.objects.filter(name="Absa Ghana SME").update(is_active=False)
        self._owner()
        response = self.client.get("/api/credit/partners/")
        self.assertEqual(response.status_code, 200, response.content)
        names = [p["name"] for p in response.json()]
        self.assertNotIn("Absa Ghana SME", names)
        self.assertIn("Fidelity Bank Ghana", names)

    def test_staff_with_credit_manage_sees_inactive_partners_too(self):
        LendingPartner.objects.filter(name="Absa Ghana SME").update(is_active=False)
        self._staff(self.accountant)
        names = [p["name"] for p in self.client.get("/api/credit/partners/").json()]
        self.assertIn("Absa Ghana SME", names)

    def test_create_partner_requires_credit_manage(self):
        self._staff(self.support)
        response = self.client.post("/api/credit/partners/", {"name": "New Bank", "min_score": 500}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_create_partner(self):
        self._staff(self.accountant)
        response = self.client.post(
            "/api/credit/partners/",
            {"name": "Kumasi Credit Union", "partner_type": "microfinance", "logo": "🏦",
             "min_score": 450, "max_loan": "GHS 8,000", "interest_rate": "22% p.a.",
             "turnaround": "2 days", "focus": "Market traders", "contact": "0322 000 111"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(LendingPartner.objects.filter(name="Kumasi Credit Union").exists())

    def test_deactivate_partner_via_patch(self):
        partner = LendingPartner.objects.get(name="Fidelity Bank Ghana")
        self._staff(self.accountant)
        response = self.client.patch(f"/api/credit/partners/{partner.id}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        partner.refresh_from_db()
        self.assertFalse(partner.is_active)


class CreditScoreAdjustmentTests(CreditManagementTestsBase):
    def test_staff_list_requires_analytics_or_credit_manage(self):
        self._staff(self.support)
        self.assertEqual(self.client.get("/api/credit/scores/").status_code, 403)

    def test_accountant_can_view_scores(self):
        self._staff(self.accountant)
        response = self.client.get("/api/credit/scores/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(any(r["business_owner"] == self.owner.id for r in response.json()))

    def test_adjustment_shifts_the_effective_score_but_not_the_base(self):
        self._staff(self.accountant)
        before = next(r for r in self.client.get("/api/credit/scores/").json() if r["business_owner"] == self.owner.id)
        base = before["base_score"]

        response = self.client.post(
            f"/api/credit/scores/{self.owner.id}/adjust/",
            {"adjustment": 40, "reason": "Long-standing offline relationship"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["base_score"], base)  # base unchanged
        self.assertEqual(body["manual_adjustment"], 40)
        self.assertEqual(body["score"], base + 40)  # effective moved
        self.assertEqual(body["adjusted_by_name"], "Efua Accountant")

    def test_adjustment_survives_a_recompute(self):
        self._staff(self.accountant)
        self.client.post(
            f"/api/credit/scores/{self.owner.id}/adjust/",
            {"adjustment": -30, "reason": "Late repayment reported"}, format="json",
        )
        # The owner's own compute-on-read must preserve the staff adjustment.
        self._owner()
        me = self.client.get("/api/credit/scores/me/").json()
        self.assertEqual(me["manual_adjustment"], -30)

    def test_adjustment_requires_a_reason(self):
        self._staff(self.accountant)
        response = self.client.post(
            f"/api/credit/scores/{self.owner.id}/adjust/", {"adjustment": 40}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_adjustment_requires_credit_manage(self):
        self._staff(self.support)
        response = self.client.post(
            f"/api/credit/scores/{self.owner.id}/adjust/",
            {"adjustment": 40, "reason": "x"}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_effective_score_is_clamped_to_the_ceiling(self):
        self._staff(self.accountant)
        body = self.client.post(
            f"/api/credit/scores/{self.owner.id}/adjust/",
            {"adjustment": 5000, "reason": "over the top"}, format="json",
        ).json()
        self.assertEqual(body["score"], 1000)


class LoanApplicationTests(CreditManagementTestsBase):
    def _submit(self):
        partner = LendingPartner.objects.get(name="Fidelity Bank Ghana")
        self._owner()
        return self.client.post(
            "/api/credit/loans/submit/",
            {"lending_partner": partner.id, "amount": "5000.00", "purpose": "Restock inventory"},
            format="json",
        )

    def test_owner_submits_a_real_application_and_it_persists(self):
        response = self._submit()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(LoanApplication.objects.count(), 1)
        app = LoanApplication.objects.first()
        self.assertEqual(app.business_owner, self.owner)
        self.assertEqual(app.amount, Decimal("5000.00"))
        self.assertEqual(app.status, LoanApplication.SUBMITTED)

    def test_score_at_application_is_snapshotted_server_side(self):
        # Even if the borrower tries to submit a score, the server uses its own.
        partner = LendingPartner.objects.get(name="Fidelity Bank Ghana")
        self._owner()
        response = self.client.post(
            "/api/credit/loans/submit/",
            {"lending_partner": partner.id, "amount": "5000.00", "purpose": "x", "score_at_application": 999},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        app = LoanApplication.objects.first()
        self.assertNotEqual(app.score_at_application, 999)

    def test_rejects_a_non_positive_amount(self):
        partner = LendingPartner.objects.get(name="Fidelity Bank Ghana")
        self._owner()
        response = self.client.post(
            "/api/credit/loans/submit/",
            {"lending_partner": partner.id, "amount": "0", "purpose": "x"}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_owner_sees_only_their_own_applications(self):
        self._submit()
        other = BusinessOwner.objects.create(
            full_name="Other Owner", login_phone="+233207990099", password_hash="x",
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(other, 'business_owner')}")
        self.assertEqual(len(self.client.get("/api/credit/loans/mine/").json()), 0)

    def test_staff_queue_requires_credit_manage(self):
        self._submit()
        self._staff(self.support)
        self.assertEqual(self.client.get("/api/credit/loans/").status_code, 403)

    def test_staff_reviews_and_approves_an_application(self):
        self._submit()
        app = LoanApplication.objects.first()
        self._staff(self.accountant)
        response = self.client.post(
            f"/api/credit/loans/{app.id}/review/",
            {"outcome": "approved", "notes": "Approved for GHS 5000"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        app.refresh_from_db()
        self.assertEqual(app.status, LoanApplication.APPROVED)
        self.assertEqual(app.reviewed_by, self.accountant)
        self.assertIsNotNone(app.reviewed_at)

    def test_a_decided_application_cannot_be_re_reviewed(self):
        self._submit()
        app = LoanApplication.objects.first()
        app.status = LoanApplication.DECLINED
        app.save()
        self._staff(self.accountant)
        response = self.client.post(
            f"/api/credit/loans/{app.id}/review/", {"outcome": "approved"}, format="json",
        )
        self.assertEqual(response.status_code, 400)
