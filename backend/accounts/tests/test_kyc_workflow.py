from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Role, StaffUser


class KYCWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin@example.com", password_hash="x",
            role=Role.objects.get(name="admin"),
        )
        self.admin_token = issue_token(self.admin, "staff")

        self.owner = BusinessOwner.objects.create(
            full_name="Yaa Trader", login_phone="+233207778899", password_hash="x"
        )
        BusinessOwnerProfile.objects.create(
            business_owner=self.owner,
            ghana_card_number="GHA-999888777-6",
            gps_address="AK-039-5030",
            business_contact_phone="+233207778899",
            is_formal=False,
            default_payout_method="momo",
            payout_momo_network="MTN",
            payout_momo_number="+233207778899",
            payout_momo_name="Yaa Trader",
        )

    def test_pending_queue_lists_the_owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.get("/api/accounts/kyc/pending/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([o["id"] for o in response.json()], [self.owner.id])

    def test_admin_can_approve(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.post(f"/api/accounts/kyc/{self.owner.id}/approve/")
        self.assertEqual(response.status_code, 200)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.kyc_status, "verified")

    def test_admin_can_reject_with_reason(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        response = self.client.post(
            f"/api/accounts/kyc/{self.owner.id}/reject/", {"reason": "Ghana Card image is blurry"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.kyc_status, "rejected")
        self.assertEqual(self.owner.kyc_rejection_reason, "Ghana Card image is blurry")

    def test_accountant_cannot_approve_kyc(self):
        accountant = StaffUser.objects.create(
            full_name="Accountant Person", email="acc@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        token = issue_token(accountant, "staff")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.post(f"/api/accounts/kyc/{self.owner.id}/approve/")
        self.assertEqual(response.status_code, 403)
