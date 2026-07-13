from django.db import IntegrityError
from django.test import TestCase

from accounts.models import BusinessOwner, BusinessOwnerProfile


class BusinessOwnerModelTests(TestCase):
    def _make_owner(self, **overrides):
        defaults = dict(
            full_name="Kojo Trader",
            login_phone="+233209998877",
            email="kojo@example.com",
            password_hash="x",
        )
        defaults.update(overrides)
        return BusinessOwner.objects.create(**defaults)

    def test_kyc_status_defaults_to_pending(self):
        owner = self._make_owner()
        self.assertEqual(owner.kyc_status, "pending")

    def test_ghana_card_number_is_unique_across_profiles(self):
        owner_one = self._make_owner()
        BusinessOwnerProfile.objects.create(
            business_owner=owner_one,
            ghana_card_number="GHA-000000001-0",
            gps_address="AK-039-5028",
            business_contact_phone="+233201234567",
            is_formal=False,
            default_payout_method="momo",
            payout_momo_network="MTN",
            payout_momo_number="+233201234567",
            payout_momo_name="Kojo Trader",
        )
        owner_two = self._make_owner(login_phone="+233209998878", email="kojo2@example.com")
        with self.assertRaises(IntegrityError):
            BusinessOwnerProfile.objects.create(
                business_owner=owner_two,
                ghana_card_number="GHA-000000001-0",
                gps_address="AK-039-5029",
                business_contact_phone="+233201234568",
                is_formal=False,
                default_payout_method="momo",
                payout_momo_network="MTN",
                payout_momo_number="+233201234568",
                payout_momo_name="Kojo Trader",
            )

    def test_profile_can_be_created_with_no_kyc_or_payout_data(self):
        owner = self._make_owner(login_phone="+233209998879", email="kojo3@example.com")
        profile = BusinessOwnerProfile.objects.create(business_owner=owner)
        self.assertIsNone(profile.ghana_card_number)
        self.assertIsNone(profile.default_payout_method)
        self.assertIsNone(profile.terms_accepted_at)
