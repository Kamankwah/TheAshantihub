"""Email confirmation for business owners (self-serve phase 2, Task 1): a bearer-token link mailed to the owner.
Covers the house rules (hashed, fragment URL, single use, 48 hours, revoked by a newer link, five a day, POST-only
public endpoint with no-referrer / no-store, no response carries the token) and that confirming records a
`VerifiedContact` that stops counting when the owner's email changes."""
import hashlib
import re
from datetime import timedelta

from django.conf import settings
from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import email_confirmation
from accounts.authentication import issue_token
from accounts.models import BusinessOwner, EmailConfirmationToken
from activity.models import ActivityEvent
from otp.models import VerifiedContact

SEND = "/api/accounts/business-owners/me/email-confirmation/"
CONFIRM = "/api/accounts/email-confirmation/confirm/"
REGISTER = "/api/accounts/business-owners/register/"
TOKEN = re.compile(r"/confirm-email#token=([\w-]+)")


def sha(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


class Base(TestCase):
    _n = 0

    def setUp(self):
        cache.clear()
        mail.outbox.clear()
        self.owner = self.make_owner()
        self.client = APIClient()

    def make_owner(self, email="Kofi@Example.com"):
        type(self)._n += 1
        return BusinessOwner.objects.create(
            full_name=f"Owner {self._n}", login_phone=f"+23324420{self._n:04d}", password_hash="x", email=email,
        )

    def as_owner(self, owner=None):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner or self.owner, 'business_owner')}")

    def send(self, owner=None):
        """The owner asks for a link; returns (response, raw token or None)."""
        self.as_owner(owner)
        before = len(mail.outbox)
        response = self.client.post(SEND, {}, format="json")
        raw = None
        if len(mail.outbox) > before:
            raw = TOKEN.search(mail.outbox[-1].body).group(1)
        return response, raw

    def confirm(self, raw):
        self.client.credentials()
        return self.client.post(CONFIRM, {"token": raw}, format="json")


class SendTests(Base):
    def test_send_stores_only_hash_and_mails_fragment_link(self):
        response, raw = self.send()
        self.assertEqual(response.status_code, 204)
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ["Kofi@Example.com"])
        self.assertEqual(message.from_email, "no-reply@theashantihub.com")
        self.assertIn(f"{settings.FRONTEND_BASE_URL}/confirm-email#token={raw}", message.body)
        self.assertIn("48 hours", message.body)
        self.assertIn("ignore", message.body.lower())
        self.assertGreaterEqual(len(raw), 43)  # secrets.token_urlsafe(32)
        row = EmailConfirmationToken.objects.get()
        self.assertEqual(row.token_hash, sha(raw))
        self.assertEqual(row.email, "kofi@example.com")  # the normalised address it went to
        self.assertEqual(row.business_owner, self.owner)
        self.assertAlmostEqual((row.expires_at - row.created_at).total_seconds(), 48 * 3600, delta=5)
        stored = [str(value) for value in EmailConfirmationToken.objects.values().get().values()]
        self.assertNotIn(raw, stored)

    def test_owner_without_email_gets_400_no_email(self):
        owner = self.make_owner(email=None)
        response, _ = self.send(owner)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "no_email")
        self.assertEqual(mail.outbox, [])
        self.assertFalse(EmailConfirmationToken.objects.exists())

    def test_send_needs_an_owner_login(self):
        self.client.credentials()
        self.assertEqual(self.client.post(SEND, {}, format="json").status_code, 401)

    def test_sixth_send_in_an_accra_day_is_429(self):
        for _ in range(5):
            response, _ = self.send()
            self.assertEqual(response.status_code, 204)
        response, raw = self.send()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["code"], "too_many_links")
        self.assertIsNone(raw)
        self.assertEqual(EmailConfirmationToken.objects.count(), 5)

    def test_links_from_an_earlier_day_do_not_count(self):
        for _ in range(5):
            self.send()
        EmailConfirmationToken.objects.update(created_at=timezone.now() - timedelta(days=2))
        response, _ = self.send()
        self.assertEqual(response.status_code, 204)

    def test_the_limit_is_per_business(self):
        for _ in range(5):
            self.send()
        response, _ = self.send(self.make_owner(email="other@example.com"))
        self.assertEqual(response.status_code, 204)

    def test_newer_link_revokes_older_410_revoked(self):
        _, first = self.send()
        _, second = self.send()
        response = self.confirm(first)
        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json()["code"], "revoked")
        self.assertEqual(self.confirm(second).status_code, 200)


class ConfirmTests(Base):
    def test_confirm_creates_verified_contact(self):
        _, raw = self.send()
        self.assertFalse(email_confirmation.is_confirmed(self.owner))
        response = self.confirm(raw)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"email_confirmed": True})
        contact = VerifiedContact.objects.get()
        self.assertEqual(
            (contact.account_type, contact.account_id, contact.channel, contact.destination),
            ("business_owner", self.owner.pk, "email", "kofi@example.com"),
        )
        self.assertTrue(email_confirmation.is_confirmed(self.owner))
        self.assertIsNotNone(EmailConfirmationToken.objects.get().used_at)

    def test_confirm_twice_is_410_used(self):
        _, raw = self.send()
        self.assertEqual(self.confirm(raw).status_code, 200)
        response = self.confirm(raw)
        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json()["code"], "used")

    def test_expired_is_410(self):
        _, raw = self.send()
        EmailConfirmationToken.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        response = self.confirm(raw)
        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json()["code"], "expired")
        self.assertFalse(VerifiedContact.objects.exists())

    def test_garbage_token_is_400_invalid(self):
        for body in ({"token": "nonsense"}, {"token": ""}, {}, {"token": 5}, {"token": None}):
            self.client.credentials()
            response = self.client.post(CONFIRM, body, format="json")
            self.assertEqual(response.status_code, 400, body)
            self.assertEqual(response.json()["code"], "invalid")

    def test_changed_email_unconfirms(self):
        _, raw = self.send()
        self.confirm(raw)
        self.assertTrue(email_confirmation.is_confirmed(self.owner))
        self.owner.email = "new@example.com"
        self.owner.save()
        self.assertFalse(email_confirmation.is_confirmed(self.owner))

    def test_is_confirmed_is_false_without_an_email_and_matches_case_insensitively(self):
        owner = self.make_owner(email=None)
        self.assertFalse(email_confirmation.is_confirmed(owner))
        _, raw = self.send()
        self.confirm(raw)
        self.owner.email = "KOFI@example.com"
        self.assertTrue(email_confirmation.is_confirmed(self.owner))

    def test_a_link_for_an_old_email_confirms_only_that_email(self):
        _, raw = self.send()
        self.owner.email = "new@example.com"
        self.owner.save()
        self.assertEqual(self.confirm(raw).status_code, 200)
        self.assertFalse(email_confirmation.is_confirmed(BusinessOwner.objects.get(pk=self.owner.pk)))

    def test_responses_never_carry_token_or_hash(self):
        send_response, raw = self.send()
        self.assertEqual(send_response.content, b"")
        bodies = [send_response.content.decode()]
        bad = self.confirm("nonsense")
        bodies.append(bad.content.decode())
        good = self.confirm(raw)
        bodies.append(good.content.decode())
        again = self.confirm(raw)
        bodies.append(again.content.decode())
        for body in bodies:
            self.assertNotIn(raw, body)
            self.assertNotIn(sha(raw), body)
            self.assertNotIn("token=", body)
        for event in ActivityEvent.objects.all():
            self.assertNotIn(raw, str(event.__dict__))
            self.assertNotIn(sha(raw), str(event.__dict__))

    def test_confirm_endpoint_sets_no_store_and_no_referrer_headers(self):
        _, raw = self.send()
        for response in (self.confirm("nonsense"), self.confirm(raw), self.confirm(raw)):
            self.assertEqual(response["Referrer-Policy"], "no-referrer")
            self.assertEqual(response["Cache-Control"], "no-store")

    def test_confirm_is_post_only(self):
        _, raw = self.send()
        self.client.credentials()
        response = self.client.get(f"{CONFIRM}?token={raw}")
        self.assertEqual(response.status_code, 405)
        self.assertFalse(VerifiedContact.objects.exists())

    def test_a_stale_authorization_header_changes_nothing(self):
        _, raw = self.send()
        self.client.credentials(HTTP_AUTHORIZATION="Bearer garbage")
        self.assertEqual(self.client.post(CONFIRM, {"token": raw}, format="json").status_code, 200)


class RegistrationTests(Base):
    def register(self, **extra):
        self.client.credentials()
        body = {"full_name": "Ama Mensah", "login_phone": "+233244990001", "password": "longenough1", **extra}
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(REGISTER, body, format="json")

    def test_registration_with_email_sends_one_confirmation(self):
        response = self.register(email="ama@example.com")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["ama@example.com"])
        self.assertIn("/confirm-email#token=", mail.outbox[0].body)
        self.assertNotIn("token=", response.content.decode())

    def test_registration_without_email_is_refused_and_sends_nothing(self):
        response = self.register()
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["email"], ["Enter your email so we can send you a confirmation link."])
        self.assertFalse(BusinessOwner.objects.filter(login_phone="+233244990001").exists())
        self.assertEqual(mail.outbox, [])
        self.assertFalse(EmailConfirmationToken.objects.exists())

    def test_a_send_failure_never_fails_registration(self):
        from unittest import mock

        with mock.patch("accounts.email_confirmation.send", side_effect=RuntimeError("smtp down")), \
                self.assertLogs("django.test", "ERROR"):
            response = self.register(email="ama@example.com")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(BusinessOwner.objects.filter(email="ama@example.com").exists())
