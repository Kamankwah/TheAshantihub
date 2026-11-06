"""Self-serve add or correct email (follow-up to self-serve phase 2): `POST business-owners/me/email/`. An owner with no
email on file, or whose current email is not yet confirmed, sets or corrects it themselves and is mailed a fresh
confirmation link. An owner whose email is confirmed must use the staff-verified change path instead."""
import re
from decimal import Decimal

from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import email_confirmation, golive
from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer, EmailConfirmationToken
from accounts.testing import make_staff, staff_token
from otp.models import EMAIL, VerifiedContact

URL = "/api/accounts/business-owners/me/email/"
CONFIRM = "/api/accounts/email-confirmation/confirm/"
TOKEN = re.compile(r"/confirm-email#token=([\w-]+)")


class OwnerEmailChangeTests(TestCase):
    _n = 0

    def setUp(self):
        cache.clear()
        mail.outbox.clear()
        self.client = APIClient()

    def owner(self, email=None, *, confirmed=False, **extra):
        type(self)._n += 1
        owner = BusinessOwner.objects.create(
            full_name=f"Owner {self._n}", login_phone=f"+23324430{self._n:04d}", password_hash="x", email=email, **extra,
        )
        BusinessOwnerProfile.objects.create(
            business_owner=owner, business_contact_phone=owner.login_phone, business_kind="product",
            lat=Decimal("6.69"), lng=Decimal("-1.62"), terms_accepted_at=timezone.now(),
        )
        if confirmed:
            VerifiedContact.objects.create(
                account_type="business_owner", account_id=owner.pk, channel=EMAIL, destination=email.lower(),
            )
        return BusinessOwner.objects.get(pk=owner.pk)

    def post(self, owner, email, *, token=None):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token or issue_token(owner, 'business_owner')}")
        return self.client.post(URL, {"email": email}, format="json")

    # ---- allowed ---------------------------------------------------------------------------------------
    def test_an_owner_with_no_email_can_set_one_and_is_mailed_a_link(self):
        owner = self.owner()
        response = self.post(owner, "  Ama@Example.COM ")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"email": "ama@example.com", "sent": True})
        owner.refresh_from_db()
        self.assertEqual(owner.email, "ama@example.com")
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["ama@example.com"])
        self.assertTrue(TOKEN.search(mail.outbox[0].body))

    def test_no_token_is_in_the_response(self):
        owner = self.owner()
        response = self.post(owner, "ama@example.com")
        raw = TOKEN.search(mail.outbox[0].body).group(1)
        self.assertNotIn(raw, response.content.decode())

    def test_an_owner_with_an_unconfirmed_email_can_correct_a_typo(self):
        owner = self.owner("amaa@exmaple.com")
        response = self.post(owner, "ama@example.com")
        self.assertEqual(response.status_code, 200)
        owner.refresh_from_db()
        self.assertEqual(owner.email, "ama@example.com")
        self.assertEqual(mail.outbox[0].to, ["ama@example.com"])

    def test_resending_the_same_unconfirmed_address_is_allowed(self):
        owner = self.owner("ama@example.com")
        self.assertEqual(self.post(owner, "AMA@example.com").status_code, 200)

    def test_the_old_link_no_longer_works_after_a_correction(self):
        owner = self.owner("amaa@exmaple.com")
        email_confirmation.send(owner)
        old = TOKEN.search(mail.outbox[-1].body).group(1)
        self.assertEqual(self.post(owner, "ama@example.com").status_code, 200)
        new = TOKEN.search(mail.outbox[-1].body).group(1)
        self.client.credentials()
        response = self.client.post(CONFIRM, {"token": old}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (410, "revoked"))
        self.assertEqual(self.client.post(CONFIRM, {"token": new}, format="json").status_code, 200)
        owner.refresh_from_db()
        self.assertTrue(email_confirmation.is_confirmed(owner))

    def test_the_old_links_are_revoked_even_when_the_new_one_cannot_be_sent(self):
        owner = self.owner("amaa@exmaple.com")
        email_confirmation.send(owner)
        old = TOKEN.search(mail.outbox[-1].body).group(1)
        for index in range(email_confirmation.DAILY_LINKS - 1):
            EmailConfirmationToken.objects.create(
                business_owner=owner, email="x@example.com", token_hash=f"h{index}", expires_at=timezone.now(),
                revoked_at=timezone.now(),
            )
        response = self.post(owner, "ama@example.com")
        self.assertEqual((response.status_code, response.json()["code"]), (429, "too_many_links"))
        self.client.credentials()
        self.assertEqual(self.client.post(CONFIRM, {"token": old}, format="json").json()["code"], "revoked")

    def test_the_go_live_blocker_moves_from_missing_to_unconfirmed(self):
        owner = self.owner()
        self.assertEqual(golive.blockers(owner), ["email_missing"])
        self.post(owner, "ama@example.com")
        owner.refresh_from_db()
        self.assertEqual(golive.blockers(owner), ["email_unconfirmed"])
        raw = TOKEN.search(mail.outbox[0].body).group(1)
        self.client.credentials()
        self.client.post(CONFIRM, {"token": raw}, format="json")
        owner.refresh_from_db()
        self.assertEqual(golive.blockers(owner), [])

    # ---- refused ---------------------------------------------------------------------------------------
    def test_a_confirmed_email_cannot_be_changed_here(self):
        owner = self.owner("ama@example.com", confirmed=True)
        response = self.post(owner, "other@example.com")
        self.assertEqual(response.status_code, 403)
        body = response.json()
        self.assertEqual(body["code"], "email_confirmed")
        self.assertIn("Profile & Settings", body["detail"])
        self.assertIn("Request a change", body["detail"])
        owner.refresh_from_db()
        self.assertEqual(owner.email, "ama@example.com")
        self.assertEqual(mail.outbox, [])

    def test_the_confirmed_check_runs_before_the_address_is_validated(self):
        owner = self.owner("ama@example.com", confirmed=True)
        self.assertEqual(self.post(owner, "not an email").status_code, 403)

    def test_an_address_used_by_another_owner_is_refused_case_insensitively(self):
        self.owner("taken@example.com")
        owner = self.owner()
        response = self.post(owner, "TAKEN@Example.com")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"email": ["A business owner with this email already exists."]})
        owner.refresh_from_db()
        self.assertIsNone(owner.email)
        self.assertEqual(mail.outbox, [])

    def test_an_invalid_address_is_refused(self):
        owner = self.owner()
        for bad in ("nope", "a@", "", None, "x" * 250 + "@example.com"):
            with self.subTest(bad=bad):
                response = self.post(owner, bad)
                self.assertEqual(response.status_code, 400)
                self.assertIn("email", response.json())
        owner.refresh_from_db()
        self.assertIsNone(owner.email)
        self.assertEqual(mail.outbox, [])

    def test_a_missing_field_is_a_400(self):
        owner = self.owner()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")
        self.assertEqual(self.client.post(URL, {}, format="json").status_code, 400)

    def test_it_is_throttled_to_five_an_hour_per_owner(self):
        owner = self.owner()
        for index in range(5):
            self.assertEqual(self.post(owner, f"try{index}@example.com").status_code, 200)
        self.assertEqual(self.post(owner, "later@example.com").status_code, 429)
        other = self.owner()
        self.assertEqual(self.post(other, "someone@example.com").status_code, 200)

    def test_the_scope_is_declared(self):
        from accounts import views_email_confirmation

        self.assertEqual(views_email_confirmation.OwnerEmailView.throttle_scope, "owner_email_change")
        self.assertTrue(views_email_confirmation.OwnerEmailView.activity_exempt)

    def test_it_needs_a_login(self):
        self.client.credentials()
        self.assertEqual(self.client.post(URL, {"email": "a@example.com"}, format="json").status_code, 401)

    def test_a_customer_or_staff_token_is_refused(self):
        customer = Customer.objects.create(full_name="Cust", phone="+233241119999", password_hash="x")
        response = self.post(None, "a@example.com", token=issue_token(customer, "customer"))
        self.assertIn(response.status_code, (401, 403))
        staff = make_staff("operations", "email-change-staff@example.com")
        response = self.post(None, "a@example.com", token=staff_token(staff))
        self.assertIn(response.status_code, (401, 403))
        self.assertEqual(mail.outbox, [])
