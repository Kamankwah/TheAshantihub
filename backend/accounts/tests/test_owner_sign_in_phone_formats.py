"""Owner sign-in accepts the same phone written either way (Review Focus 1):
a scout stores +233…, the owner types 0… — or an owner who typed 0… at
sign-up later uses +233…."""
from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import BusinessOwner
from accounts.serializers import SUSPENDED_LOGIN_MESSAGE

PASSWORD = "correct-horse-battery-staple"
LOGIN_URL = "/api/accounts/business-owners/login/"
INVALID = {"non_field_errors": ["Invalid credentials"]}


def _owner(login_phone, *, name="Akosua Mensah", **extra):
    return BusinessOwner.objects.create(
        full_name=name, login_phone=login_phone, password_hash=make_password(PASSWORD), **extra,
    )


class OwnerSignInPhoneFormatTests(TestCase):
    def setUp(self):
        cache.clear()  # the "login" throttle allows 5 a minute
        self.client = APIClient()

    def sign_in(self, identifier, password=PASSWORD):
        return self.client.post(LOGIN_URL, {"identifier": identifier, "password": password}, format="json")

    def test_a_0_number_signs_in_to_a_phone_a_scout_stored_as_plus_233(self):
        owner = _owner("+233241234567")
        response = self.sign_in("0241234567")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["id"], owner.id)
        self.assertTrue(response.json()["token"])

    def test_a_plus_233_number_signs_in_to_a_phone_the_owner_typed_with_a_0(self):
        owner = _owner("0241234567")
        response = self.sign_in("+233241234567")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["id"], owner.id)

    def test_a_phone_stored_with_spaces_and_dashes_still_signs_in(self):
        owner = _owner("024 123-4567")
        for identifier in ("+233241234567", "0241234567"):
            with self.subTest(identifier=identifier):
                response = self.sign_in(identifier)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()["id"], owner.id)

    def test_spaces_and_dashes_do_not_matter(self):
        owner = _owner("+233241234567")
        for identifier in ("024 123 4567", "+233-24-123-4567"):
            with self.subTest(identifier=identifier):
                response = self.sign_in(identifier)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()["id"], owner.id)

    def test_the_exact_phone_and_the_email_still_work(self):
        owner = _owner("+233241234567", email="akosua@example.com")
        for identifier in ("+233241234567", "akosua@example.com"):
            with self.subTest(identifier=identifier):
                response = self.sign_in(identifier)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()["id"], owner.id)

    def test_a_wrong_password_in_the_other_format_is_refused(self):
        _owner("+233241234567")
        response = self.sign_in("0241234567", password="wrong-password")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), INVALID)

    def test_two_owners_sharing_the_last_nine_digits_sign_in_only_by_their_exact_phone(self):
        first = _owner("0241234567", name="First Owner")
        _owner("+233241234567", name="Second Owner")
        ambiguous = self.sign_in("024 123 4567")
        self.assertEqual(ambiguous.status_code, 400)
        self.assertEqual(ambiguous.json(), INVALID)
        exact = self.sign_in("0241234567")
        self.assertEqual(exact.status_code, 200, exact.content)
        self.assertEqual(exact.json()["id"], first.id)

    def test_a_suspended_owner_is_told_so_whichever_way_the_phone_is_written(self):
        _owner("+233241234567", is_suspended=True, suspension_reason="Confirmed fraud case")
        response = self.sign_in("0241234567")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"non_field_errors": [SUSPENDED_LOGIN_MESSAGE]})

    def test_too_few_digits_never_match_a_phone(self):
        _owner("+233241234567")
        response = self.sign_in("4567")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), INVALID)

    def test_an_unknown_email_is_not_retried_as_a_phone(self):
        _owner("+233241234567")
        response = self.sign_in("0241234567@example.com")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), INVALID)
