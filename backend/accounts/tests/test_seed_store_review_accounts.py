from django.core.management import call_command
from django.test import TestCase

from accounts.models import BusinessOwner, Customer
from listings.models import Listing


class SeedStoreReviewAccountsTests(TestCase):
    def _run(self):
        call_command(
            "seed_store_review_accounts",
            "--customer-phone", "+233240000001", "--customer-password", "Review-pass-1",
            "--owner-phone", "+233240000002", "--owner-password", "Review-pass-2",
        )

    def test_command_creates_both_accounts_and_is_idempotent(self):
        self._run()
        self._run()
        self.assertEqual(Customer.objects.filter(phone="+233240000001").count(), 1)
        owner = BusinessOwner.objects.get(login_phone="+233240000002")
        self.assertEqual(owner.kyc_status, BusinessOwner.VERIFIED)
        self.assertEqual(owner.compute_registration_step(), "complete")
        self.assertEqual(Listing.objects.filter(business_owner=owner, status=Listing.PUBLISHED).count(), 2)

    def test_second_run_resets_passwords(self):
        self._run()
        owner = BusinessOwner.objects.get(login_phone="+233240000002")
        BusinessOwner.objects.filter(pk=owner.pk).update(password_hash="changed")
        self._run()
        owner.refresh_from_db()
        self.assertNotEqual(owner.password_hash, "changed")
