from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Role, StaffUser


class KYCDetailViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-detail@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.admin_token = issue_token(self.admin, "staff")

        self.owner = BusinessOwner.objects.create(
            full_name="Kwabena Trader", login_phone="+233207001122", password_hash="x",
        )
        self.profile = BusinessOwnerProfile.objects.create(
            business_owner=self.owner,
            ghana_card_number="GHA-123123123-1",
            gps_address="AK-039-5040",
            business_contact_phone="+233207001122",
            is_formal=False,
            default_payout_method="momo",
            payout_momo_network="MTN",
            payout_momo_number="+233207001122",
            payout_momo_name="Kwabena Trader",
        )

    def test_admin_can_view_kyc_detail(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.get(f"/api/accounts/kyc/{self.owner.id}/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["id"], self.owner.id)
        self.assertEqual(body["profile"]["ghana_card_number"], "GHA-123123123-1")
        self.assertEqual(body["profile"]["gps_address"], "AK-039-5040")
        self.assertFalse(body["profile"]["is_formal"])
        self.assertIsNone(body["profile"]["business_reg_certificate"])
        self.assertNotIn("password_hash", body)
        self.assertNotIn("payout_bank_account_number", body["profile"])

    def test_accountant_cannot_view_kyc_detail(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant Detail", email="acc-detail@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        token = issue_token(accountant, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.get(f"/api/accounts/kyc/{self.owner.id}/")
        self.assertEqual(response.status_code, 403)

    def test_detail_reflects_rejection_reason_after_reject(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        self.client.post(
            f"/api/accounts/kyc/{self.owner.id}/reject/",
            {"reason": "Ghana Card image is blurry"},
            format="json",
        )
        response = self.client.get(f"/api/accounts/kyc/{self.owner.id}/")
        self.assertEqual(response.json()["kyc_rejection_reason"], "Ghana Card image is blurry")
