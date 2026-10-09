"""accounts.phones — one key for the same Ghana phone however it was typed
(Review Focus 1)."""
from django.test import SimpleTestCase, TestCase

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.phones import filter_by_phone, normalize_gh_phone, phone_key

HINT = "Enter a Ghana phone number, for example 024 123 4567."


def _owner(phone, name="Kwame Business"):
    return BusinessOwner.objects.create(full_name=name, login_phone=phone, password_hash="x")


class PhoneKeyTests(TestCase):
    def test_the_same_number_written_differently_has_one_key(self):
        for raw in (
            "0241234567", "+233241234567", "233241234567", "241234567",
            "+233 24 123 4567", "024-123-4567", "(024) 123 4567", " 024 123 4567 ",
        ):
            with self.subTest(raw=raw):
                self.assertEqual(phone_key(raw), "241234567")

    def test_a_different_number_has_a_different_key(self):
        self.assertNotEqual(phone_key("0241234567"), phone_key("0241234568"))

    def test_fewer_than_nine_digits_has_no_key(self):
        for raw in (None, "", "   ", "12345678", "+233", "no digits"):
            with self.subTest(raw=raw):
                self.assertEqual(phone_key(raw), "")

    def test_a_phone_typed_with_a_0_matches_a_row_stored_with_plus_233(self):
        stored = _owner("+233241234567")
        _owner("+233241234568", name="Someone Else")
        matches = filter_by_phone(BusinessOwner.objects.all(), "login_phone", "024 123 4567")
        self.assertEqual(list(matches), [stored])

    def test_a_plus_233_phone_matches_a_row_the_owner_typed_with_a_0(self):
        typed = _owner("0241234567")
        matches = filter_by_phone(BusinessOwner.objects.all(), "login_phone", "+233 24 123 4567")
        self.assertEqual(list(matches), [typed])

    def test_a_row_stored_with_spaces_and_dashes_still_matches(self):
        # Older rows hold whatever the owner typed; a plain __endswith on the
        # column would miss "024 123-4567".
        spaced = _owner("024 123-4567")
        _owner("(024) 123-4568", name="Someone Else")
        for raw in ("+233241234567", "0241234567", "024-123-4567"):
            with self.subTest(raw=raw):
                matches = filter_by_phone(BusinessOwner.objects.all(), "login_phone", raw)
                self.assertEqual(list(matches), [spaced])

    def test_a_different_number_matches_nothing_however_it_is_stored(self):
        _owner("024 123-4567")
        _owner("+233241234568", name="Someone Else")
        self.assertFalse(filter_by_phone(BusinessOwner.objects.all(), "login_phone", "0241234569").exists())

    def test_an_input_without_a_key_matches_nothing(self):
        _owner("+233241234567")
        for raw in ("", None, "4567"):
            with self.subTest(raw=raw):
                self.assertFalse(filter_by_phone(BusinessOwner.objects.all(), "login_phone", raw).exists())

    def test_the_result_is_a_queryset_that_keeps_its_filters(self):
        stored = _owner("+233241234567")
        _owner("0241234567", name="Old Duplicate")
        matches = filter_by_phone(BusinessOwner.objects.filter(full_name="Old Duplicate"), "login_phone", "024 123 4567")
        self.assertEqual([owner.full_name for owner in matches], ["Old Duplicate"])
        self.assertFalse(matches.filter(pk=stored.pk).exists())

    def test_matching_works_through_a_relation(self):
        owner = _owner("+233201112233")
        BusinessOwnerProfile.objects.create(business_owner=owner, payout_momo_number="024 123 4567")
        matches = filter_by_phone(BusinessOwner.objects.all(), "profile__payout_momo_number", "+233241234567")
        self.assertEqual(list(matches), [owner])
        both = filter_by_phone(matches, "login_phone", "020 111 2233")
        self.assertEqual(list(both), [owner])


class NormalizeGhPhoneTests(SimpleTestCase):
    def test_every_accepted_shape_becomes_plus_233_and_nine_digits(self):
        cases = {
            "0241234567": "+233241234567",
            "024 123 4567": "+233241234567",
            "+233 24 123 4567": "+233241234567",
            "233241234567": "+233241234567",
            "241234567": "+233241234567",
            "055-123-4567": "+233551234567",
            "+233501234567": "+233501234567",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(normalize_gh_phone(raw), expected)

    def test_anything_else_is_refused_with_one_plain_message(self):
        for raw in (
            None, "", "12345",
            "0341234567",       # a landline: the key starts with 3
            "233341234567",
            "02412345678",      # 11 digits
            "1241234567",       # 10 digits that don't start with 0
            "+44 7911 123456",  # 12 digits that don't start with 233
            "+233 0241234567",  # 13 digits
        ):
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError) as raised:
                    normalize_gh_phone(raw)
                self.assertEqual(str(raised.exception), HINT)
