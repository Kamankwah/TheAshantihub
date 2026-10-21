"""Staff registration for a client (plan M3, Task 5): Operations and Super Admin register a business like a scout does,
and every staff registration (R3) creates its registration-scope owner confirmation in the same transaction."""
from unittest import mock

from django.test import override_settings

from accounts.models import BusinessOwner
from accounts.testing import make_staff
from otp import senders
from portfolio.models import OwnerConfirmation
from portfolio.tests.test_registration import REGISTER_URL, TEST_MEDIA_ROOT, RegistrationBase


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class RegisterByStaffTests(RegistrationBase):
    def setUp(self):
        super().setUp()
        senders.sms_outbox.clear()

    def register_committing(self, staff, **overrides):
        with self.captureOnCommitCallbacks(execute=True):
            return self.register(staff, **overrides)

    def test_operations_can_register_business_and_owner_text_is_sent(self):
        response = self.register_committing(self.lead)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(len(senders.sms_outbox), 1)
        self.assertEqual(senders.sms_outbox[0].to, "+233241234567")
        body = response.json()
        self.assertNotIn("token", repr(body).lower())
        self.assertNotIn("/business/confirm", repr(body))
        self.assertEqual(
            set(body["confirmation"]), {"state", "sent_to_masked", "expires_at", "send_note"},
        )
        self.assertEqual(body["confirmation"]["state"], "awaiting_owner")
        self.assertEqual(body["confirmation"]["sent_to_masked"], "024 *** 4567")
        self.assertNotIn("0241234567", repr(body))
        owner = BusinessOwner.objects.get(pk=body["id"])
        self.assertEqual(owner.registered_by, self.lead)
        self.assertEqual(owner.profile.location_set_by, "operations")

    def test_super_admin_can_register_business(self):
        admin = make_staff("super_admin", "root@example.com")
        response = self.register_committing(admin)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["confirmation"]["state"], "awaiting_owner")

    def test_support_and_general_manager_cannot(self):
        for role in ("support", "general_manager"):
            staff = make_staff(role, f"{role}@example.com")
            self.assertEqual(self.register(staff).status_code, 403, role)
        self.assertFalse(BusinessOwner.objects.filter(registration_channel="scout").exists())

    def test_every_staff_registration_has_exactly_one_registration_confirmation(self):
        admin = make_staff("super_admin", "root@example.com")
        for index, staff in enumerate((self.scout, self.lead, admin)):
            response = self.register_committing(
                staff, owner_phone=f"02411234{index}0", owner_email=f"owner{index}@example.com", gps_address=f"AK-11{index}-0384", ghana_card_number=f"GHA-12345678{index}-0",
            )
            self.assertEqual(response.status_code, 201, response.content)
            owner = BusinessOwner.objects.get(pk=response.json()["id"])
            rows = OwnerConfirmation.objects.filter(business_owner=owner)
            self.assertEqual(rows.count(), 1)
            self.assertEqual(rows.get().scope, OwnerConfirmation.REGISTRATION)
            self.assertEqual(rows.get().created_by, staff)

    def test_a_refused_registration_leaves_no_confirmation(self):
        self.register_committing(self.lead)
        before = OwnerConfirmation.objects.count()
        response = self.register_committing(self.lead)  # same phone, address and card: a duplicate
        self.assertEqual(response.status_code, 400)
        self.assertEqual(OwnerConfirmation.objects.count(), before)

    def test_a_confirmation_refusal_answers_409_and_registers_nothing(self):
        from accounts.claims import ClaimError

        error = ClaimError("Nothing to do.", code="nothing_new")
        with mock.patch("portfolio.registration.confirmations.request_confirmation", side_effect=error):
            response = self.register_committing(self.lead)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": "Nothing to do.", "code": "nothing_new"})
        self.assertFalse(BusinessOwner.objects.filter(registration_channel="scout").exists())
