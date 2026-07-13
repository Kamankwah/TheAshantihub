from django.db import IntegrityError
from django.test import TestCase
from django.utils import timezone

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


class ComputeRegistrationStepTests(TestCase):
    def _make_owner_with_profile(self, kyc_status=BusinessOwner.PENDING, **profile_overrides):
        owner = BusinessOwner.objects.create(
            full_name="Step Trader", login_phone="+233209990001", password_hash="x",
            kyc_status=kyc_status,
        )
        BusinessOwnerProfile.objects.create(business_owner=owner, **profile_overrides)
        return owner

    def test_fresh_profile_needs_business_info(self):
        owner = self._make_owner_with_profile()
        self.assertEqual(owner.compute_registration_step(), "business_info")

    def test_formal_business_without_documents_still_needs_business_info(self):
        owner = self._make_owner_with_profile(
            ghana_card_number="GHA-1", gps_address="AK-1", business_contact_phone="+233201111111",
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg", is_formal=True,
        )
        self.assertEqual(owner.compute_registration_step(), "business_info")

    def test_business_info_complete_needs_payment_info(self):
        owner = self._make_owner_with_profile(
            ghana_card_number="GHA-2", gps_address="AK-2", business_contact_phone="+233201111112",
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg", is_formal=False,
        )
        self.assertEqual(owner.compute_registration_step(), "payment_info")

    def test_momo_selected_without_number_still_needs_payment_info(self):
        owner = self._make_owner_with_profile(
            ghana_card_number="GHA-3", gps_address="AK-3", business_contact_phone="+233201111113",
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg", is_formal=False,
            default_payout_method="momo",
        )
        self.assertEqual(owner.compute_registration_step(), "payment_info")

    def test_payment_info_complete_needs_terms(self):
        owner = self._make_owner_with_profile(
            ghana_card_number="GHA-4", gps_address="AK-4", business_contact_phone="+233201111114",
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg", is_formal=False,
            default_payout_method="momo", payout_momo_number="+233201111114",
        )
        self.assertEqual(owner.compute_registration_step(), "terms")

    def test_terms_accepted_is_complete(self):
        owner = self._make_owner_with_profile(
            ghana_card_number="GHA-5", gps_address="AK-5", business_contact_phone="+233201111115",
            ghana_card_front_image="front.jpg", ghana_card_back_image="back.jpg", is_formal=False,
            default_payout_method="momo", payout_momo_number="+233201111115",
            terms_accepted_at=timezone.now(),
        )
        self.assertEqual(owner.compute_registration_step(), "complete")

    def test_verified_owner_is_complete_regardless_of_profile_state(self):
        owner = self._make_owner_with_profile(kyc_status=BusinessOwner.VERIFIED)
        self.assertEqual(owner.compute_registration_step(), "complete")

    def test_rejected_owner_is_complete_regardless_of_profile_state(self):
        owner = self._make_owner_with_profile(kyc_status=BusinessOwner.REJECTED)
        self.assertEqual(owner.compute_registration_step(), "complete")

    def test_owner_with_no_profile_needs_business_info(self):
        owner = BusinessOwner.objects.create(
            full_name="No Profile Trader", login_phone="+233209990009", password_hash="x",
        )
        self.assertEqual(owner.compute_registration_step(), "business_info")
