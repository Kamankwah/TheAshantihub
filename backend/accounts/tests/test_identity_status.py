import importlib

from django.apps import apps
from django.test import TestCase

from accounts.models import BusinessOwner, BusinessOwnerProfile


def _backfill():
    module = importlib.import_module("accounts.migrations.0062_identity_status")
    module.backfill_identity(apps, None)


class IdentityStatusTests(TestCase):
    _counter = 0

    def _owner(self, kyc_status=BusinessOwner.PENDING, with_profile=True, **profile_fields):
        type(self)._counter += 1
        n = type(self)._counter
        owner = BusinessOwner.objects.create(
            full_name=f"Owner {n}",
            login_phone=f"+2332000000{n:02d}",
            email=f"owner{n}@example.com",
            password_hash="x",
            kyc_status=kyc_status,
        )
        if with_profile:
            BusinessOwnerProfile.objects.create(business_owner=owner, **profile_fields)
        return owner

    def _full_card(self, number="GHA-100000001-1"):
        return dict(
            ghana_card_number=number,
            ghana_card_front_image="ghana_cards/front.jpg",
            ghana_card_back_image="ghana_cards/back.jpg",
        )

    def _profile(self, owner):
        return BusinessOwnerProfile.objects.get(business_owner=owner)

    def test_identity_verified_is_false_without_profile(self):
        owner = self._owner(with_profile=False)
        self.assertFalse(owner.identity_verified)

    def test_identity_verified_follows_profile_status(self):
        owner = self._owner()
        self.assertFalse(owner.identity_verified)
        profile = owner.profile
        profile.identity_status = BusinessOwnerProfile.IDENTITY_VERIFIED
        profile.save()
        owner = BusinessOwner.objects.get(pk=owner.pk)
        self.assertTrue(owner.identity_verified)

    def test_has_identity_documents_needs_number_and_both_photos(self):
        owner = self._owner(
            ghana_card_number="GHA-100000002-2",
            ghana_card_front_image="ghana_cards/front.jpg",
        )
        self.assertFalse(owner.profile.has_identity_documents())
        full = self._owner(**self._full_card("GHA-100000003-3"))
        self.assertTrue(full.profile.has_identity_documents())

    def test_backfill_verifies_every_kyc_verified_owner_even_without_a_card(self):
        owner = self._owner(kyc_status=BusinessOwner.VERIFIED)
        _backfill()
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, BusinessOwnerProfile.IDENTITY_VERIFIED)

    def test_backfill_marks_pending_owner_with_full_card_as_identity_pending(self):
        owner = self._owner(**self._full_card())
        _backfill()
        profile = self._profile(owner)
        self.assertEqual(profile.identity_status, BusinessOwnerProfile.IDENTITY_PENDING)
        self.assertIsNotNone(profile.identity_submitted_at)

    def test_backfill_leaves_pending_owner_without_back_photo_not_submitted(self):
        owner = self._owner(
            ghana_card_number="GHA-100000004-4",
            ghana_card_front_image="ghana_cards/front.jpg",
        )
        _backfill()
        self.assertEqual(
            self._profile(owner).identity_status, BusinessOwnerProfile.IDENTITY_NOT_SUBMITTED
        )

    def test_backfill_leaves_rejected_owner_not_submitted(self):
        owner = self._owner(kyc_status=BusinessOwner.REJECTED, **self._full_card())
        _backfill()
        self.assertEqual(
            self._profile(owner).identity_status, BusinessOwnerProfile.IDENTITY_NOT_SUBMITTED
        )

    def test_backfill_turns_blank_card_number_into_null(self):
        owner = self._owner(ghana_card_number="")
        _backfill()
        self.assertIsNone(self._profile(owner).ghana_card_number)
