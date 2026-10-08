from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from portfolio.services import assign_account_manager


class DeactivateScoutWithPortfolioTests(TestCase):
    """Spec §3: a scout who leaves keeps their businesses until Operations
    reassigns them — deactivation is refused until then."""

    PHONES = iter(f"+23324999{n:04d}" for n in range(1, 50))

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.kwame = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.efua = make_staff("scout", "efua@example.com", manager=self.lead)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss, sudo=True)}")

    def business(self, name, scout):
        owner = BusinessOwner.objects.create(full_name=f"{name} Owner", login_phone=next(self.PHONES), password_hash="x")
        BusinessOwnerProfile.objects.create(business_owner=owner, business_name=name)
        assign_account_manager(owner, scout, by=self.lead, reason="Registered")
        return owner

    def deactivate(self, staff):
        return self.client.post(f"/api/accounts/staff/{staff.pk}/deactivate/")

    def test_a_scout_who_still_manages_businesses_is_refused(self):
        self.business("Adwoa Fabrics", self.kwame)
        self.business("Asafo Hair Studio", self.kwame)
        response = self.deactivate(self.kwame)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Reassign Kwame's 2 businesses first."})
        self.kwame.refresh_from_db()
        self.assertTrue(self.kwame.is_active)

    def test_one_business_reads_in_the_singular(self):
        self.business("Adwoa Fabrics", self.kwame)
        self.assertEqual(self.deactivate(self.kwame).json(), {"detail": "Reassign Kwame's 1 business first."})

    def test_once_the_businesses_are_reassigned_the_scout_can_leave(self):
        for name in ("Adwoa Fabrics", "Asafo Hair Studio"):
            owner = self.business(name, self.kwame)
            assign_account_manager(owner, self.efua, by=self.lead, reason="Kwame is leaving")
        response = self.deactivate(self.kwame)
        self.assertEqual(response.status_code, 200, response.content)
        self.kwame.refresh_from_db()
        self.assertFalse(self.kwame.is_active)

    def test_a_scout_without_businesses_is_deactivated_as_before(self):
        self.assertEqual(self.deactivate(self.efua).status_code, 200)

    def test_rejected_businesses_do_not_block_deactivation(self):
        owner = self.business("Gone Shop", self.kwame)
        BusinessOwner.objects.filter(pk=owner.pk).update(kyc_status=BusinessOwner.REJECTED)
        response = self.deactivate(self.kwame)
        self.assertEqual(response.status_code, 200, response.content)

    def test_only_non_rejected_businesses_are_counted(self):
        gone = self.business("Gone Shop", self.kwame)
        BusinessOwner.objects.filter(pk=gone.pk).update(kyc_status=BusinessOwner.REJECTED)
        pending = self.business("Asafo Hair Studio", self.kwame)
        BusinessOwner.objects.filter(pk=pending.pk).update(kyc_status=BusinessOwner.PENDING)
        self.business("Adwoa Fabrics", self.kwame)
        response = self.deactivate(self.kwame)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Reassign Kwame's 2 businesses first."})
