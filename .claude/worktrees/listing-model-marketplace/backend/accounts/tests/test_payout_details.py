from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile


class PayoutDetailUpdateTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Efua Seller", login_phone="+233206665544", password_hash="x",
            kyc_status=BusinessOwner.VERIFIED,
        )
        self.profile = BusinessOwnerProfile.objects.create(
            business_owner=self.owner,
            ghana_card_number="GHA-555444333-2",
            gps_address="AK-039-5031",
            business_contact_phone="+233206665544",
            is_formal=False,
            default_payout_method="momo",
            payout_momo_network="MTN",
            payout_momo_number="+233206665544",
            payout_momo_name="Efua Seller",
            payout_verification_status="verified",
        )
        self.token = issue_token(self.owner, "business_owner")

    def test_updating_payout_details_resets_verification_only(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/payout/",
            {"default_payout_method": "bank", "payout_bank_name": "GCB Bank",
             "payout_bank_account_number": "1234567890", "payout_bank_account_name": "Efua Seller"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)

        self.profile.refresh_from_db()
        self.owner.refresh_from_db()
        self.assertEqual(self.profile.payout_verification_status, "pending")
        self.assertEqual(self.profile.default_payout_method, "bank")
        self.assertEqual(self.owner.kyc_status, BusinessOwner.VERIFIED)

    def test_customer_cannot_access_business_owner_payout_endpoint(self):
        from accounts.models import Customer

        customer = Customer.objects.create(full_name="Ama", phone="+233200001111", password_hash="x")
        token = issue_token(customer, "customer")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = self.client.patch(
            "/api/accounts/business-owners/me/payout/", {"default_payout_method": "bank"}, format="json"
        )
        self.assertEqual(response.status_code, 403)
