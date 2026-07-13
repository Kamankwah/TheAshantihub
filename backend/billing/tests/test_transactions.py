from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from billing.models import Transaction


class TransactionMineTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207441001", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Ama Seller", login_phone="+233207441002", password_hash="x",
        )

    def _auth(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def test_create_transaction_records_success(self):
        self._auth(self.owner)
        response = self.client.post(
            "/api/billing/transactions/mine/",
            {"amount": "100.00", "purpose": "AshantiHub Standard Plan — Monthly", "reference": "AH12345678"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        transaction = Transaction.objects.get(reference="AH12345678")
        self.assertEqual(transaction.business_owner, self.owner)
        self.assertEqual(transaction.status, Transaction.SUCCESS)

    def test_list_returns_only_own_transactions(self):
        Transaction.objects.create(
            business_owner=self.owner, amount="20.00", purpose="Basic Plan", reference="AH-MINE",
        )
        Transaction.objects.create(
            business_owner=self.other_owner, amount="20.00", purpose="Basic Plan", reference="AH-NOTMINE",
        )
        self._auth(self.owner)
        response = self.client.get("/api/billing/transactions/mine/")
        refs = [t["reference"] for t in response.json()]
        self.assertEqual(refs, ["AH-MINE"])

    def test_customer_cannot_access_transactions_endpoint(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200005678", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        response = self.client.get("/api/billing/transactions/mine/")
        self.assertEqual(response.status_code, 403)


class TransactionReportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207442001", password_hash="x",
        )
        Transaction.objects.create(
            business_owner=self.owner, amount="20.00", purpose="Basic Plan", reference="AH-REPORT-1",
        )

    def test_accountant_can_view_all_transactions(self):
        accountant = StaffUser.objects.create(
            full_name="Efua Accountant", email="efua@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(accountant, 'staff')}")
        response = self.client.get("/api/billing/transactions/")
        self.assertEqual(response.status_code, 200, response.content)
        refs = [t["reference"] for t in response.json()["results"]]
        self.assertIn("AH-REPORT-1", refs)

    def test_marketing_staff_cannot_view_transactions_report(self):
        marketing = StaffUser.objects.create(
            full_name="Kojo Marketing", email="kojo@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(marketing, 'staff')}")
        response = self.client.get("/api/billing/transactions/")
        self.assertEqual(response.status_code, 403)

    def test_business_owner_cannot_view_transactions_report(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        response = self.client.get("/api/billing/transactions/")
        self.assertEqual(response.status_code, 403)
