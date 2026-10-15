"""Who a code goes to (otp.identity), the audit writer and the verified-contact row."""
from django.contrib.auth.hashers import make_password
from django.db import IntegrityError, transaction
from django.test import TestCase

from otp import audit, identity
from otp.models import EMAIL, SMS, OtpEvent, VerifiedContact

from .helpers import make_customer, make_owner, make_support


class ContactsTests(TestCase):
    def test_a_customer_gets_their_phone_and_email_normalised(self):
        customer = make_customer(phone="024 123 4567", email="Ama@Example.com")
        self.assertEqual(identity.contacts(customer), {SMS: "+233241234567", EMAIL: "ama@example.com"})

    def test_a_customer_without_an_email_falls_back_to_a_verified_secondary_only(self):
        customer = make_customer(email=None, secondary_email="backup@example.com", secondary_email_verified=False)
        self.assertEqual(identity.contacts(customer), {SMS: "+233241234567"})
        customer.secondary_email_verified = True
        self.assertEqual(identity.contacts(customer), {SMS: "+233241234567", EMAIL: "backup@example.com"})

    def test_a_phone_that_is_not_a_ghana_mobile_is_not_a_channel(self):
        self.assertEqual(identity.contacts(make_customer(phone="12345")), {EMAIL: "ama@example.com"})

    def test_an_owner_uses_the_login_phone_and_staff_their_email(self):
        self.assertEqual(identity.contacts(make_owner(login_phone="0201112233", email=None)), {SMS: "+233201112233"})
        self.assertEqual(identity.contacts(make_support()), {EMAIL: "esi@example.com"})

    def test_hints_never_show_the_whole_contact(self):
        self.assertEqual(identity.channel_list(make_customer()), [
            {"channel": "sms", "hint": "024 *** 4567"}, {"channel": "email", "hint": "am•••@example.com"},
        ])


class AccountRefTests(TestCase):
    def test_types_ids_and_loading(self):
        customer, owner, staff = make_customer(), make_owner(), make_support()
        self.assertEqual(identity.ref(customer), ("customer", customer.pk))
        self.assertEqual(identity.ref(owner), ("business_owner", owner.pk))
        self.assertEqual(identity.ref(staff), ("staff", staff.pk))
        self.assertEqual(identity.load("business_owner", owner.pk), owner)
        self.assertIsNone(identity.load("nobody", 1))
        self.assertIsNone(identity.load("customer", 999999))

    def test_suspended_or_deactivated_accounts_cannot_finish_signing_in(self):
        customer, staff = make_customer(), make_support()
        self.assertTrue(identity.can_sign_in(customer))
        customer.is_suspended = True
        self.assertFalse(identity.can_sign_in(customer))
        staff.is_active = False
        self.assertFalse(identity.can_sign_in(staff))
        self.assertFalse(identity.can_sign_in(None))

    def test_the_fingerprint_changes_with_the_password(self):
        customer = make_customer()
        before = identity.fingerprint(customer)
        customer.password_hash = make_password("another-password-9")
        self.assertNotEqual(identity.fingerprint(customer), before)


class AuditAndContactRowTests(TestCase):
    def test_an_event_names_the_account(self):
        customer = make_customer()
        event = audit.log(OtpEvent.SENT, account=customer, purpose="sign_in", channel=SMS, destination="+233241234567", provider="locmem")
        self.assertEqual((event.account_type, event.account_id, event.kind, event.provider), ("customer", customer.pk, "sent", "locmem"))
        self.assertIsNone(event.ip)

    def test_an_event_without_an_account(self):
        event = audit.log(OtpEvent.SMS_ALERT, channel=SMS, note="500 texts")
        self.assertEqual((event.account_type, event.account_id), ("", None))

    def test_one_row_per_verified_contact(self):
        customer = make_customer()
        VerifiedContact.objects.create(account_type="customer", account_id=customer.pk, channel=SMS, destination="+233241234567")
        with self.assertRaises(IntegrityError), transaction.atomic():
            VerifiedContact.objects.create(account_type="customer", account_id=customer.pk, channel=SMS, destination="+233241234567")
