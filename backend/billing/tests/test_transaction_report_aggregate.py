from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from billing.models import Transaction

REPORT_URL = "/api/billing/transactions/report/"
LIST_URL = "/api/billing/transactions/"


class TransactionReportAggregateTestsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207665001", password_hash="x",
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200665001", password_hash="x",
        )
        self.accountant = StaffUser.objects.create(
            full_name="Efua Accountant", email="efua-report@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Kojo Marketing", email="kojo-report@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )

        now = timezone.now()
        this_month = now.replace(day=1, hour=12, minute=0, second=0, microsecond=0)
        last_month = (this_month - timezone.timedelta(days=1)).replace(day=1, hour=12, minute=0, second=0, microsecond=0)

        self.txn_this_month_success = Transaction.objects.create(
            business_owner=self.owner, amount="100.00", purpose="Plan", reference="AH-RPT-1",
            status=Transaction.SUCCESS,
        )
        Transaction.objects.filter(pk=self.txn_this_month_success.pk).update(created_at=this_month)

        self.txn_this_month_refunded = Transaction.objects.create(
            customer=self.customer, amount="30.00", purpose="Ticket refund", reference="AH-RPT-2",
            status=Transaction.REFUNDED,
        )
        Transaction.objects.filter(pk=self.txn_this_month_refunded.pk).update(created_at=this_month)

        self.txn_last_month = Transaction.objects.create(
            customer=self.customer, amount="70.00", purpose="Order", reference="AH-RPT-3",
            status=Transaction.SUCCESS,
        )
        Transaction.objects.filter(pk=self.txn_last_month.pk).update(created_at=last_month)

        self.this_month_key = this_month.strftime("%Y-%m")
        self.last_month_key = last_month.strftime("%Y-%m")

    def _auth_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")


class TransactionReportPermissionTests(TransactionReportAggregateTestsBase):
    def test_unauthenticated_is_401(self):
        response = self.client.get(REPORT_URL)
        self.assertEqual(response.status_code, 401)

    def test_marketing_role_is_403(self):
        self._auth_staff(self.marketing)
        response = self.client.get(REPORT_URL)
        self.assertEqual(response.status_code, 403)

    def test_business_owner_is_403(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        response = self.client.get(REPORT_URL)
        self.assertEqual(response.status_code, 403)


class TransactionReportShapeTests(TransactionReportAggregateTestsBase):
    def test_summary_totals_all_three_transactions(self):
        self._auth_staff(self.accountant)
        response = self.client.get(REPORT_URL)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["summary"]["count"], 3)
        self.assertEqual(data["summary"]["total_amount"], "200.00")

    def test_status_breakdown_separates_success_and_refunded(self):
        self._auth_staff(self.accountant)
        response = self.client.get(REPORT_URL)
        data = response.json()
        self.assertEqual(data["status_breakdown"]["success"]["count"], 2)
        self.assertEqual(data["status_breakdown"]["success"]["amount"], "170.00")
        self.assertEqual(data["status_breakdown"]["refunded"]["count"], 1)
        self.assertEqual(data["status_breakdown"]["refunded"]["amount"], "30.00")

    def test_series_is_bucketed_by_month(self):
        self._auth_staff(self.accountant)
        response = self.client.get(REPORT_URL)
        data = response.json()
        series_by_month = {row["month"]: row["amount"] for row in data["series"]}
        self.assertEqual(series_by_month[self.this_month_key], "130.00")
        self.assertEqual(series_by_month[self.last_month_key], "70.00")

    def test_series_is_ordered_oldest_first(self):
        self._auth_staff(self.accountant)
        response = self.client.get(REPORT_URL)
        months = [row["month"] for row in response.json()["series"]]
        self.assertEqual(months, sorted(months))

    def test_date_from_filters_out_earlier_months(self):
        self._auth_staff(self.accountant)
        response = self.client.get(REPORT_URL, {"date_from": timezone.now().replace(day=1).date().isoformat()})
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["summary"]["count"], 2)
        months = [row["month"] for row in data["series"]]
        self.assertNotIn(self.last_month_key, months)

    def test_invalid_date_from_is_400(self):
        self._auth_staff(self.accountant)
        response = self.client.get(REPORT_URL, {"date_from": "not-a-date"})
        self.assertEqual(response.status_code, 400)

    def test_no_transactions_in_range_returns_zeroed_summary(self):
        self._auth_staff(self.accountant)
        response = self.client.get(REPORT_URL, {"date_from": "2099-01-01"})
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["summary"], {"count": 0, "total_amount": "0.00"})
        self.assertEqual(data["series"], [])
        self.assertEqual(data["status_breakdown"], {})


class TransactionReportListDateFilterTests(TransactionReportAggregateTestsBase):
    def test_list_accepts_same_date_filters(self):
        self._auth_staff(self.accountant)
        response = self.client.get(LIST_URL, {"date_from": timezone.now().replace(day=1).date().isoformat()})
        self.assertEqual(response.status_code, 200, response.content)
        refs = {t["reference"] for t in response.json()["results"]}
        self.assertIn("AH-RPT-1", refs)
        self.assertIn("AH-RPT-2", refs)
        self.assertNotIn("AH-RPT-3", refs)

    def test_list_invalid_date_to_is_400(self):
        self._auth_staff(self.accountant)
        response = self.client.get(LIST_URL, {"date_to": "not-a-date"})
        self.assertEqual(response.status_code, 400)
