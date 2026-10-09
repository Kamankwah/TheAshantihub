from datetime import date, timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import kyc
from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from commission.models import CommissionPolicy


class CommissionBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.other = make_staff("scout", "efua@example.com", manager=self.lead)
        self.accountant = make_staff("accountant", "kofi@example.com")
        self.n = 0

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def policy(self, kind=CommissionPolicy.REGISTRATION, amount="50.00", effective_from=None):
        return CommissionPolicy.objects.create(
            kind=kind, amount=Decimal(amount), effective_from=effective_from or date(2020, 1, 1),
            proposed_by=self.accountant, approved_by=self.boss,
        )

    def pending_owner(self, registrar=None, manager=None, name="Adwoa Fabrics"):
        self.n += 1
        registrar = registrar or self.scout
        owner = BusinessOwner.objects.create(
            full_name=f"Owner {self.n}", login_phone=f"+2332441231{self.n:02d}", password_hash="x",
            registration_channel=BusinessOwner.SCOUT, registered_by=registrar, account_manager=manager or registrar,
        )
        BusinessOwnerProfile.objects.create(
            business_owner=owner, business_name=f"{name} {self.n}", gps_address=f"AK-039-50{self.n:02d}",
            business_contact_phone=owner.login_phone, address_verified=True, address_verified_by=self.lead,
            address_verified_at=timezone.now(),
        )
        return owner

    def approve(self, owner):
        return kyc.approve_owner(owner.pk, self.lead)

    def pay(self, owner, months=1):
        from payments.models import CheckoutSession
        from payments.services import process_payment

        return process_payment(
            kind=CheckoutSession.SUBSCRIPTION, amount=Decimal("100.00"), purpose="Subscription", business_owner=owner,
            metadata={"plan": "product_basic", "cycle_months": months},
        )
