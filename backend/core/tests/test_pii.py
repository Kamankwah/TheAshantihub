import datetime
from io import StringIO

from django.core.management import call_command
from django.db import IntegrityError, connection, transaction
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from accounts.serializers import card_number_taken
from core import pii
from portfolio.checks import exact_duplicates
from wallets.models import PayoutDestination

OLD_KEY = "VlY0b3NJd0xVbzR2UnJ2UkVLUnQwZkVYV0Q3dmRRQ2Q="  # a valid Fernet key (32 bytes, url-safe base64)


def make_owner(phone="+233201112233"):
    return BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone=phone, password_hash="x")


def raw(table, column, pk):
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT "{column}" FROM {table} WHERE id = %s', [pk])
        return cursor.fetchone()[0]


def set_raw(table, column, pk, value):
    with connection.cursor() as cursor:
        cursor.execute(f'UPDATE {table} SET "{column}" = %s WHERE id = %s', [value, pk])


class CryptoTests(TestCase):
    def test_round_trip_and_the_stored_form_is_not_the_value(self):
        token = pii.encrypt("GHA-123456789-0")
        self.assertTrue(token.startswith("enc1:"))
        self.assertNotIn("123456789", token)
        self.assertEqual(pii.decrypt(token), "GHA-123456789-0")

    def test_every_encryption_differs(self):
        self.assertNotEqual(pii.encrypt("x"), pii.encrypt("x"))

    def test_legacy_plaintext_reads_back_unchanged(self):
        self.assertEqual(pii.decrypt("GHA-123456789-0"), "GHA-123456789-0")

    def test_a_value_written_under_another_key_fails_loudly(self):
        token = pii.encrypt("secret")
        with override_settings(PII_ENCRYPTION_KEYS=[OLD_KEY]):
            with self.assertRaises(pii.PIIKeyError):
                pii.decrypt(token)

    def test_a_retired_key_still_reads_while_listed(self):
        with override_settings(PII_ENCRYPTION_KEYS=[OLD_KEY]):
            token = pii.encrypt("secret")
        from django.conf import settings

        with override_settings(PII_ENCRYPTION_KEYS=[settings.PII_ENCRYPTION_KEYS[0], OLD_KEY]):
            self.assertEqual(pii.decrypt(token), "secret")

    def test_blind_index_ignores_case_and_spacing_and_separates_purposes(self):
        self.assertEqual(pii.blind_index("ghana_card", "gha-123456789-0"), pii.blind_index("ghana_card", " GHA-123456789-0 "))
        self.assertNotEqual(pii.blind_index("ghana_card", "123456789"), pii.blind_index("account", "123456789"))
        self.assertIsNone(pii.blind_index("ghana_card", ""))
        self.assertIsNone(pii.blind_index("ghana_card", None))

    def test_a_phone_index_matches_however_the_number_was_written(self):
        self.assertEqual(pii.blind_index("momo", "0241234567"), pii.blind_index("momo", "+233 24 123 4567"))

    def test_the_index_depends_on_the_index_key(self):
        before = pii.blind_index("account", "0123456789")
        with override_settings(PII_INDEX_KEY="another-key"):
            self.assertNotEqual(before, pii.blind_index("account", "0123456789"))


class ProfileFieldTests(TestCase):
    def setUp(self):
        self.owner = make_owner()
        self.profile = BusinessOwnerProfile.objects.create(
            business_owner=self.owner, ghana_card_number="GHA-123456789-0", tin="C0012345678",
            payout_bank_account_number="1234567890123", payout_momo_number="0241234567",
        )

    def test_the_database_holds_ciphertext_and_the_application_sees_the_value(self):
        for column, value in (("ghana_card_number", "GHA-123456789-0"), ("tin", "C0012345678"),
                              ("payout_bank_account_number", "1234567890123"), ("payout_momo_number", "0241234567")):
            stored = raw("accounts_businessownerprofile", column, self.profile.pk)
            self.assertTrue(stored.startswith("enc1:"), column)
            self.assertNotIn(value, stored)
            self.assertEqual(getattr(BusinessOwnerProfile.objects.get(pk=self.profile.pk), column), value)

    def test_the_value_survives_values_and_refresh(self):
        self.assertEqual(BusinessOwnerProfile.objects.values_list("tin", flat=True).get(pk=self.profile.pk), "C0012345678")
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.ghana_card_number, "GHA-123456789-0")

    def test_blank_and_null_are_left_alone(self):
        other = BusinessOwnerProfile.objects.create(business_owner=make_owner("+233201112299"), tin=None, ghana_card_number=None)
        self.assertIsNone(raw("accounts_businessownerprofile", "tin", other.pk))
        self.assertIsNone(other.ghana_card_number_idx)

    def test_an_exact_search_on_an_encrypted_column_is_an_error_not_an_empty_answer(self):
        with self.assertRaises(TypeError):
            list(BusinessOwnerProfile.objects.filter(ghana_card_number="GHA-123456789-0"))
        with self.assertRaises(TypeError):
            list(BusinessOwnerProfile.objects.filter(tin__iexact="c0012345678"))

    def test_duplicate_card_checks_work_through_the_blind_index_in_any_case(self):
        self.assertTrue(card_number_taken("gha-123456789-0"))
        self.assertFalse(card_number_taken("gha-123456789-0", exclude=self.profile))
        self.assertFalse(card_number_taken("GHA-999999999-9"))
        self.assertEqual(exact_duplicates(ghana_card_number=" gha-123456789-0 "), ["ghana_card"])

    def test_duplicate_phone_check_sees_an_encrypted_momo_number(self):
        self.assertIn("phone", exact_duplicates(phone="+233 24 123 4567"))
        self.assertEqual(exact_duplicates(phone="+233 24 123 4567", exclude_owner_id=self.owner.pk), [])

    def test_one_ghana_card_per_business_is_enforced_by_the_database(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            BusinessOwnerProfile.objects.create(business_owner=make_owner("+233201112288"), ghana_card_number="gha-123456789-0")

    def test_a_save_limited_to_update_fields_keeps_the_index_in_step(self):
        self.profile.ghana_card_number = "GHA-555555555-5"
        self.profile.save(update_fields=["ghana_card_number"])
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.ghana_card_number_idx, pii.blind_index("ghana_card", "GHA-555555555-5"))

    def test_a_legacy_plaintext_row_reads_and_is_found(self):
        set_raw("accounts_businessownerprofile", "tin", self.profile.pk, "PLAIN-TIN")
        self.assertEqual(BusinessOwnerProfile.objects.get(pk=self.profile.pk).tin, "PLAIN-TIN")


class CustomerBirthDateTests(TestCase):
    def test_a_date_of_birth_is_a_date_for_the_app_and_ciphertext_in_the_database(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233241234567", password_hash="x", date_of_birth=datetime.date(1990, 5, 17))
        self.assertTrue(raw("accounts_customer", "date_of_birth", customer.pk).startswith("enc1:"))
        customer.refresh_from_db()
        self.assertEqual(customer.date_of_birth, datetime.date(1990, 5, 17))

    def test_a_legacy_date_column_value_reads_as_a_date(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233241234567", password_hash="x")
        set_raw("accounts_customer", "date_of_birth", customer.pk, "1985-01-02")
        customer.refresh_from_db()
        self.assertEqual(customer.date_of_birth, datetime.date(1985, 1, 2))

    def test_none_stays_none(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233241234567", password_hash="x")
        customer.refresh_from_db()
        self.assertIsNone(customer.date_of_birth)


class PayoutDestinationTests(TestCase):
    def make(self, number="0241234567", **kw):
        return PayoutDestination.objects.create(
            holder_type="business_owner", holder_id=1, rail="momo", institution="MTN", account_number=number,
            account_name="Kwame Mensah", matched_name="Kwame Mensah", name_source="simulated", usable_from=timezone.now(), **kw,
        )

    def test_encrypted_in_the_database_with_a_duplicate_guard_on_the_index(self):
        destination = self.make()
        self.assertTrue(raw("wallets_payoutdestination", "account_number", destination.pk).startswith("enc1:"))
        destination.refresh_from_db()
        self.assertEqual(destination.account_number, "0241234567")
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.make(" 0241234567 ")

    def test_a_removed_destination_does_not_block_adding_the_number_again(self):
        self.make().__class__.objects.update(removed_at=timezone.now())
        self.make()


class EncryptCommandTests(TestCase):
    def run_command(self, *args):
        out = StringIO()
        call_command("encrypt_pii", *args, stdout=out)
        return out.getvalue()

    def setUp(self):
        self.profile = BusinessOwnerProfile.objects.create(business_owner=make_owner(), tin="C0012345678", ghana_card_number="GHA-123456789-0")
        for column, value in (("tin", "C0012345678"), ("ghana_card_number", "GHA-123456789-0")):  # as the table was before this change
            set_raw("accounts_businessownerprofile", column, self.profile.pk, value)
        BusinessOwnerProfile.objects.filter(pk=self.profile.pk).update(ghana_card_number_idx=None)

    def test_dry_run_counts_and_changes_nothing(self):
        self.assertIn("2 value(s) to encrypt", self.run_command("--dry-run"))
        self.assertEqual(raw("accounts_businessownerprofile", "tin", self.profile.pk), "C0012345678")

    def test_it_encrypts_legacy_rows_fills_the_index_and_is_idempotent(self):
        self.run_command()
        self.assertTrue(raw("accounts_businessownerprofile", "tin", self.profile.pk).startswith("enc1:"))
        self.profile.refresh_from_db()
        self.assertEqual((self.profile.tin, self.profile.ghana_card_number), ("C0012345678", "GHA-123456789-0"))
        self.assertEqual(self.profile.ghana_card_number_idx, pii.blind_index("ghana_card", "GHA-123456789-0"))
        self.assertIn("0 value(s) encrypted", self.run_command())

    def test_reencrypt_moves_every_value_to_the_newest_key(self):
        from django.conf import settings

        self.run_command()
        old = raw("accounts_businessownerprofile", "tin", self.profile.pk)
        with override_settings(PII_ENCRYPTION_KEYS=[OLD_KEY, settings.PII_ENCRYPTION_KEYS[0]]):
            self.run_command("--reencrypt")
            new = raw("accounts_businessownerprofile", "tin", self.profile.pk)
            self.assertNotEqual(old, new)
            self.assertEqual(BusinessOwnerProfile.objects.get(pk=self.profile.pk).tin, "C0012345678")
        with override_settings(PII_ENCRYPTION_KEYS=[OLD_KEY]):  # readable with only the new key: the old one can be retired
            self.assertEqual(BusinessOwnerProfile.objects.get(pk=self.profile.pk).tin, "C0012345678")
