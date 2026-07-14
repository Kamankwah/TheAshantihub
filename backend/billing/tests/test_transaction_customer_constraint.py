from django.db import IntegrityError, transaction as db_transaction
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from billing.models import Transaction


class TransactionCustomerOrBusinessOwnerConstraintTests(TestCase):
    def setUp(self):
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207663001", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200663001", password_hash="x",
        )

    def test_business_owner_only_transaction_is_valid(self):
        transaction = Transaction.objects.create(
            business_owner=self.owner, amount="10.00", purpose="Sub", reference="AH-C-1",
        )
        self.assertIsNone(transaction.customer)

    def test_customer_only_transaction_is_valid(self):
        transaction = Transaction.objects.create(
            customer=self.customer, amount="10.00", purpose="Order", reference="AH-C-2",
        )
        self.assertIsNone(transaction.business_owner)

    def test_neither_set_violates_constraint(self):
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Transaction.objects.create(amount="10.00", purpose="Bad", reference="AH-C-3")

    def test_both_set_violates_constraint(self):
        with self.assertRaises(IntegrityError):
            with db_transaction.atomic():
                Transaction.objects.create(
                    business_owner=self.owner, customer=self.customer,
                    amount="10.00", purpose="Bad", reference="AH-C-4",
                )


class TransactionReportSerializerCustomerTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207663002", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200663002", password_hash="x",
        )
        Transaction.objects.create(
            business_owner=self.owner, amount="20.00", purpose="Basic Plan", reference="AH-REPORT-BO",
        )
        Transaction.objects.create(
            customer=self.customer, amount="30.00", purpose="Order #1", reference="AH-REPORT-CUST",
        )

    def test_report_includes_both_transaction_kinds_with_correct_names(self):
        accountant = StaffUser.objects.create(
            full_name="Efua Accountant", email="efua-c@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(accountant, 'staff')}")
        response = self.client.get("/api/billing/transactions/")
        self.assertEqual(response.status_code, 200, response.content)
        by_ref = {t["reference"]: t for t in response.json()["results"]}

        bo_row = by_ref["AH-REPORT-BO"]
        self.assertEqual(bo_row["business_owner_name"], "Kofi Trader")
        self.assertIsNone(bo_row["customer_name"])

        cust_row = by_ref["AH-REPORT-CUST"]
        self.assertEqual(cust_row["customer_name"], "Ama Buyer")
        self.assertIsNone(cust_row["business_owner_name"])
