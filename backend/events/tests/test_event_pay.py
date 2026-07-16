from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from billing.models import Transaction
from listings.models import Category, Zone

from events.models import Event


class EventPayTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200773311", password_hash="x",
        )
        self.other_customer = Customer.objects.create(
            full_name="Yaw Buyer", phone="+233200773322", password_hash="x",
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kofi Trader", login_phone="+233207773311", password_hash="x",
        )
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")

    def _make_event(self, **overrides):
        kwargs = dict(
            category=self.category, zone=self.zone, submitted_by_customer=self.customer,
            name="Akwasidae Festival", description="Royal durbar.", address="Manhyia Palace",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
            status=Event.APPROVED,
        )
        kwargs.update(overrides)
        return Event.objects.create(**kwargs)

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_customer_can_pay_for_approved_event(self):
        event = self._make_event()
        self._auth(issue_token(self.customer, "customer"))
        before = timezone.now()
        response = self.client.post(f"/api/events/{event.id}/pay/")
        self.assertEqual(response.status_code, 200, response.content)
        event.refresh_from_db()
        self.assertIsNotNone(event.paid_at)
        self.assertEqual(event.expires_at, event.paid_at + timezone.timedelta(days=14))
        self.assertGreaterEqual(event.paid_at, before)

    def test_pay_creates_transaction_on_customer_side(self):
        event = self._make_event()
        self._auth(issue_token(self.customer, "customer"))
        self.client.post(f"/api/events/{event.id}/pay/")
        transaction = Transaction.objects.get(customer=self.customer)
        self.assertIsNone(transaction.business_owner)
        self.assertEqual(transaction.status, Transaction.SUCCESS)
        self.assertGreater(transaction.amount, 0)

    def test_pay_creates_transaction_on_business_owner_side(self):
        event = self._make_event(submitted_by_customer=None, submitted_by_business=self.owner)
        self._auth(issue_token(self.owner, "business_owner"))
        self.client.post(f"/api/events/{event.id}/pay/")
        transaction = Transaction.objects.get(business_owner=self.owner)
        self.assertIsNone(transaction.customer)

    def test_cannot_pay_for_pending_event(self):
        event = self._make_event(status=Event.PENDING)
        self._auth(issue_token(self.customer, "customer"))
        response = self.client.post(f"/api/events/{event.id}/pay/")
        self.assertEqual(response.status_code, 400)

    def test_cannot_pay_twice(self):
        event = self._make_event()
        self._auth(issue_token(self.customer, "customer"))
        self.client.post(f"/api/events/{event.id}/pay/")
        response = self.client.post(f"/api/events/{event.id}/pay/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Transaction.objects.filter(customer=self.customer).count(), 1)

    def test_non_owner_cannot_pay(self):
        event = self._make_event()
        self._auth(issue_token(self.other_customer, "customer"))
        response = self.client.post(f"/api/events/{event.id}/pay/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_cannot_pay(self):
        event = self._make_event()
        response = self.client.post(f"/api/events/{event.id}/pay/")
        self.assertEqual(response.status_code, 401)

    def test_paid_event_appears_in_public_list(self):
        """End-to-end regression for the approve -> pay -> publicly-listed
        flow in simulated mode (punch-list item 12): an approved event must
        be absent from GET /api/events/ before payment, and present —
        with paid_at/expires_at echoed back to the payer — immediately after
        POST /api/events/{id}/pay/ returns.
        """
        event = self._make_event()

        # Approved but unpaid — not yet publicly listed.
        response = self.client.get("/api/events/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 0)

        self._auth(issue_token(self.customer, "customer"))
        response = self.client.post(f"/api/events/{event.id}/pay/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertIsNotNone(body["paid_at"])
        self.assertIsNotNone(body["expires_at"])

        # Now live on the public, unauthenticated list.
        self.client.credentials()
        response = self.client.get("/api/events/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(event.id, [row["id"] for row in response.json()["results"]])
