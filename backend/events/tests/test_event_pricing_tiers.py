from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Customer, Role, StaffUser
from billing.models import Transaction
from listings.models import Category, Zone

from events.models import Event, EventPricingTier


class EventPricingTierPublicListTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_public_list_returns_five_seeded_tiers(self):
        response = self.client.get("/api/events/pricing-tiers/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(len(data), 5)
        by_days = {row["duration_days"]: row["live_price"] for row in data}
        self.assertEqual(by_days[7], "20.00")
        self.assertEqual(by_days[15], "30.00")
        self.assertEqual(by_days[30], "50.00")
        self.assertEqual(by_days[60], "90.00")
        self.assertEqual(by_days[90], "120.00")

    def test_public_list_never_exposes_pending_price(self):
        tier = EventPricingTier.objects.get(duration_days=7)
        tier.pending_price = Decimal("25.00")
        tier.save(update_fields=["pending_price"])
        response = self.client.get("/api/events/pricing-tiers/")
        row = next(r for r in response.json() if r["duration_days"] == 7)
        self.assertNotIn("pending_price", row)


class EventPricingTierManageTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.accountant = StaffUser.objects.create(
            full_name="Accountant Person", email="acc-pricing@example.com", password_hash="x",
            role=Role.objects.get(name="accountant"),
        )
        self.super_admin = StaffUser.objects.create(
            full_name="Super Admin Person", email="sa-pricing@example.com", password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )
        self.marketing = StaffUser.objects.create(
            full_name="Marketing Person", email="mk-pricing@example.com", password_hash="x",
            role=Role.objects.get(name="marketing"),
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200779911", password_hash="x",
        )
        self.tier = EventPricingTier.objects.get(duration_days=7)

    def _auth(self, user):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(user, 'staff')}")

    # --- manage list visibility ---

    def test_accountant_can_view_manage_list(self):
        self._auth(self.accountant)
        response = self.client.get("/api/events/pricing-tiers/manage/")
        self.assertEqual(response.status_code, 200, response.content)

    def test_super_admin_can_view_manage_list(self):
        self._auth(self.super_admin)
        response = self.client.get("/api/events/pricing-tiers/manage/")
        self.assertEqual(response.status_code, 200, response.content)

    def test_marketing_cannot_view_manage_list(self):
        self._auth(self.marketing)
        response = self.client.get("/api/events/pricing-tiers/manage/")
        self.assertEqual(response.status_code, 403)

    # --- propose ---

    def test_accountant_can_propose_price(self):
        self._auth(self.accountant)
        response = self.client.post(
            f"/api/events/pricing-tiers/{self.tier.id}/propose/", {"price": "25.00"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.tier.refresh_from_db()
        self.assertEqual(self.tier.pending_price, Decimal("25.00"))
        self.assertEqual(self.tier.proposed_by, self.accountant)
        self.assertIsNotNone(self.tier.proposed_at)
        # Live price is untouched until approved.
        self.assertEqual(self.tier.live_price, Decimal("20.00"))

    def test_marketing_cannot_propose_price(self):
        # marketing holds neither event_pricing.manage nor .approve —
        # confirms the propose action is genuinely gated, not open to any
        # staffer.
        self._auth(self.marketing)
        response = self.client.post(
            f"/api/events/pricing-tiers/{self.tier.id}/propose/", {"price": "25.00"}, format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_super_admin_can_propose_price(self):
        # super_admin holds both event_pricing.manage and .approve (the
        # seed migration's "super_admin gets everything" convention), so it
        # can propose too — accountant is the only manage-only role.
        self._auth(self.super_admin)
        response = self.client.post(
            f"/api/events/pricing-tiers/{self.tier.id}/propose/", {"price": "25.00"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_propose_rejects_non_positive_price(self):
        self._auth(self.accountant)
        response = self.client.post(
            f"/api/events/pricing-tiers/{self.tier.id}/propose/", {"price": "0"}, format="json",
        )
        self.assertEqual(response.status_code, 400)

    # --- approve ---

    def test_super_admin_can_approve_pending_proposal(self):
        self._auth(self.accountant)
        self.client.post(
            f"/api/events/pricing-tiers/{self.tier.id}/propose/", {"price": "25.00"}, format="json",
        )
        self._auth(self.super_admin)
        response = self.client.post(f"/api/events/pricing-tiers/{self.tier.id}/approve/")
        self.assertEqual(response.status_code, 200, response.content)
        self.tier.refresh_from_db()
        self.assertEqual(self.tier.live_price, Decimal("25.00"))
        self.assertIsNone(self.tier.pending_price)
        self.assertIsNone(self.tier.proposed_by)

    def test_accountant_cannot_approve(self):
        self._auth(self.accountant)
        self.client.post(
            f"/api/events/pricing-tiers/{self.tier.id}/propose/", {"price": "25.00"}, format="json",
        )
        response = self.client.post(f"/api/events/pricing-tiers/{self.tier.id}/approve/")
        self.assertEqual(response.status_code, 403)

    def test_approve_without_pending_proposal_is_rejected(self):
        self._auth(self.super_admin)
        response = self.client.post(f"/api/events/pricing-tiers/{self.tier.id}/approve/")
        self.assertEqual(response.status_code, 400)

    # --- reject ---

    def test_super_admin_can_reject_pending_proposal(self):
        self._auth(self.accountant)
        self.client.post(
            f"/api/events/pricing-tiers/{self.tier.id}/propose/", {"price": "25.00"}, format="json",
        )
        self._auth(self.super_admin)
        response = self.client.post(f"/api/events/pricing-tiers/{self.tier.id}/reject/")
        self.assertEqual(response.status_code, 200, response.content)
        self.tier.refresh_from_db()
        self.assertEqual(self.tier.live_price, Decimal("20.00"))
        self.assertIsNone(self.tier.pending_price)

    def test_accountant_cannot_reject(self):
        self._auth(self.accountant)
        self.client.post(
            f"/api/events/pricing-tiers/{self.tier.id}/propose/", {"price": "25.00"}, format="json",
        )
        response = self.client.post(f"/api/events/pricing-tiers/{self.tier.id}/reject/")
        self.assertEqual(response.status_code, 403)


class EventPayUsesTierPriceTests(TestCase):
    """Confirms EventPayView charges the tier's flat live_price, not
    live_price * visibility_days."""

    def setUp(self):
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200779922", password_hash="x",
        )
        self.category = Category.objects.get(slug="festivals")
        self.zone = Zone.objects.get(name="Manhyia")

    def _auth(self, user, kind):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(user, kind)}")

    def _make_event(self, visibility_days):
        return Event.objects.create(
            category=self.category, zone=self.zone, submitted_by_customer=self.customer,
            name="Akwasidae Festival", description="Royal durbar.", address="Manhyia Palace",
            event_date=timezone.now() + timezone.timedelta(days=30),
            visibility_days=visibility_days, status=Event.APPROVED,
        )

    def test_pay_charges_flat_tier_price_not_multiplied_by_days(self):
        event = self._make_event(visibility_days=30)
        self._auth(self.customer, "customer")
        response = self.client.post(f"/api/events/{event.id}/pay/")
        self.assertEqual(response.status_code, 200, response.content)
        transaction = Transaction.objects.get(customer=self.customer)
        self.assertEqual(transaction.amount, Decimal("50.00"))

    def test_pay_uses_legacy_daily_rate_for_non_tier_visibility_days(self):
        # visibility_days=14 predates this feature and matches no configured
        # tier — must still be payable via the legacy per-day fallback rather
        # than becoming permanently unpayable.
        event = self._make_event(visibility_days=14)
        self._auth(self.customer, "customer")
        response = self.client.post(f"/api/events/{event.id}/pay/")
        self.assertEqual(response.status_code, 200, response.content)
        transaction = Transaction.objects.get(customer=self.customer)
        self.assertEqual(transaction.amount, Decimal("28.00"))
