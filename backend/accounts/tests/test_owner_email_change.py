"""Self-serve add or correct email (follow-up to self-serve phase 2): `POST business-owners/me/email/`. An owner with no
email on file, or whose current email is not yet confirmed, sets or corrects it themselves and is mailed a fresh
confirmation link. An owner whose email is confirmed must use the staff-verified change path instead."""
import re
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth.hashers import make_password
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import email_confirmation, golive
from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer, EmailConfirmationToken, MobileSession
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from notifications.models import Notification
from otp import step_up
from otp.models import EMAIL, TrustedDevice, VerifiedContact
from wallets.models import PayoutDestination

URL = "/api/accounts/business-owners/me/email/"
CONFIRM = "/api/accounts/email-confirmation/confirm/"
PASSWORD = "correct-horse-battery"
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
            full_name=f"Owner {self._n}", login_phone=f"+23324430{self._n:04d}", password_hash=make_password(PASSWORD), email=email, **extra,
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

    def post(self, owner, email, *, token=None, password=PASSWORD, **headers):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token or issue_token(owner, 'business_owner')}", **headers)
        body = {"email": email}
        if password is not None:
            body["password"] = password
        return self.client.post(URL, body, format="json")

    # ---- allowed ---------------------------------------------------------------------------------------
    def test_an_owner_with_no_email_can_set_one_and_is_mailed_a_link(self):
        owner = self.owner()
        response = self.post(owner, "  Ama@Example.COM ")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["email"], "ama@example.com")
        self.assertIs(response.json()["sent"], True)
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
        # The change is committed even though no link could go out, so the answer says what happened to the owner.
        self.assertEqual(set(response.json()["side_effects"]), {"signed_out_phone", "payout_cooling"})
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
        self.assertEqual(self.client.post(URL, {"password": PASSWORD}, format="json").status_code, 400)

    def test_it_is_throttled_to_five_an_hour_per_owner(self):
        owner = self.owner()
        for index in range(5):
            self.assertEqual(self.post(owner, f"try{index}@example.com").status_code, 200)
        # Five links went out today, so the daily cap is also at its limit; this must still be the DRF throttle's
        # answer (no `too_many_links` code) and must change nothing.
        before = BusinessOwner.objects.get(pk=owner.pk).email
        response = self.post(owner, "later@example.com")
        self.assertEqual(response.status_code, 429)
        self.assertNotEqual(response.json().get("code"), "too_many_links")
        self.assertEqual(BusinessOwner.objects.get(pk=owner.pk).email, before)
        other = self.owner()
        self.assertEqual(self.post(other, "someone@example.com").status_code, 200)

    def test_wrong_password_attempts_count_toward_the_throttle(self):
        owner = self.owner()
        for _ in range(5):
            self.assertEqual(self.post(owner, "a@example.com", password="nope").status_code, 400)
        self.assertEqual(self.post(owner, "a@example.com").status_code, 429)

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

    # ---- the current password ------------------------------------------------------------------------------
    def test_a_wrong_or_missing_password_is_refused_the_same_way_and_changes_nothing(self):
        owner = self.owner("old@example.com")
        self.owner("taken@example.com")
        answers = []
        for password in ("wrong-password", None, ""):
            for address in ("new@example.com", "taken@example.com", "not an email"):
                with self.subTest(password=password, address=address):
                    cache.clear()  # the throttle is tested on its own below
                    response = self.post(owner, address, password=password)
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response.json()["code"], "wrong_password")
                    self.assertIn("password", response.json())
                    answers.append(response.json())
        self.assertTrue(all(answer == answers[0] for answer in answers), "the answer must not depend on the address")
        owner.refresh_from_db()
        self.assertEqual(owner.email, "old@example.com")
        self.assertEqual(mail.outbox, [])
        self.assertFalse(EmailConfirmationToken.objects.exists())

    def test_the_password_is_checked_before_the_confirmed_state_is_revealed(self):
        owner = self.owner("ama@example.com", confirmed=True)
        self.assertEqual(self.post(owner, "x@example.com", password="wrong").json()["code"], "wrong_password")
        self.assertEqual(self.post(owner, "x@example.com").json()["code"], "email_confirmed")

    # ---- step-up -------------------------------------------------------------------------------------------
    def step_up_header(self, owner, token):
        raw = step_up.issue(owner, step_up.CONTACT_CHANGE, self._request_for(token))
        return {"HTTP_X_STEP_UP_TOKEN": raw}

    def _request_for(self, token):
        from rest_framework_simplejwt.tokens import AccessToken

        class Fake:
            auth = AccessToken(token)
            META = {}

        return Fake()

    @override_settings(LEDGER_ENABLED=True, OTP_STEP_UP_ENFORCED=False)
    def test_a_step_up_code_is_asked_for_while_the_ledger_is_on(self):
        owner = self.owner("old@example.com")
        response = self.post(owner, "new@example.com")
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()["code"], "step_up_required")
        self.assertEqual(response.json()["action"], step_up.CONTACT_CHANGE)
        owner.refresh_from_db()
        self.assertEqual(owner.email, "old@example.com")
        self.assertEqual(mail.outbox, [])

    @override_settings(LEDGER_ENABLED=True, OTP_STEP_UP_ENFORCED=False)
    def test_a_valid_step_up_token_is_accepted_once(self):
        owner = self.owner("old@example.com")
        token = issue_token(owner, "business_owner")
        headers = self.step_up_header(owner, token)
        response = self.post(owner, "new@example.com", token=token, **headers)
        self.assertEqual(response.status_code, 200, response.content)
        again = self.post(owner, "newer@example.com", token=token, **headers)
        self.assertEqual((again.status_code, again.json()["code"]), (403, "step_up_required"))

    @override_settings(LEDGER_ENABLED=True, OTP_STEP_UP_ENFORCED=False)
    def test_a_refused_address_leaves_the_step_up_token_usable(self):
        owner = self.owner("old@example.com")
        self.owner("taken@example.com")
        token = issue_token(owner, "business_owner")
        headers = self.step_up_header(owner, token)
        self.assertEqual(self.post(owner, "taken@example.com", token=token, **headers).status_code, 400)
        self.assertEqual(self.post(owner, "new@example.com", token=token, **headers).status_code, 200)

    @override_settings(LEDGER_ENABLED=False, OTP_STEP_UP_ENFORCED=True)
    def test_the_enforced_switch_also_asks_for_a_code(self):
        owner = self.owner()
        self.assertEqual(self.post(owner, "new@example.com").json()["code"], "step_up_required")

    @override_settings(LEDGER_ENABLED=True)
    def test_a_confirmed_owner_is_refused_before_any_step_up_is_asked(self):
        owner = self.owner("ama@example.com", confirmed=True)
        self.assertEqual(self.post(owner, "x@example.com").json()["code"], "email_confirmed")

    # ---- contact-change side effects -----------------------------------------------------------------------
    def with_assets(self, owner):
        now = timezone.now()
        destination = PayoutDestination.objects.create(
            holder_type="business_owner", holder_id=owner.pk, rail="momo", institution="MTN", account_number="0241234567",
            account_name="Ama", matched_name="Ama", name_source="simulated", usable_from=now - timedelta(days=3),
        )
        TrustedDevice.objects.create(
            account_type="business_owner", account_id=owner.pk, token_hash="d" * 64, password_fingerprint="x",
        )
        MobileSession.objects.create(
            account_type="business_owner", account_id=owner.pk, family="f" * 32, token_hash="h" * 64,
            expires_at=now + timedelta(days=1),
        )
        return destination

    def test_a_changed_address_restarts_cooling_ends_devices_and_phone_sessions_and_warns_the_old_contact(self):
        owner = self.owner("old@example.com")
        destination = self.with_assets(owner)
        mail.outbox.clear()
        with mock.patch("otp.notices.senders.deliver") as deliver, self.captureOnCommitCallbacks(execute=True):
            deliver.return_value = mock.Mock(ok=True, provider="test")
            response = self.post(owner, "new@example.com")
        self.assertEqual(response.status_code, 200, response.content)
        destination.refresh_from_db()
        self.assertGreater(destination.usable_from, timezone.now())
        self.assertFalse(TrustedDevice.objects.filter(revoked_at__isnull=True).exists())
        self.assertFalse(MobileSession.objects.filter(revoked_at__isnull=True).exists())
        # The sign-in phone is ALWAYS told (the old email was never proven to reach the owner), and so is the old email;
        # the new one gets the confirmation link.
        told = {(call.args[0], call.args[1]): call.args[3] for call in deliver.call_args_list}
        self.assertEqual(set(told), {("sms", owner.login_phone), ("email", "old@example.com")})
        self.assertTrue(all("changed" in text for text in told.values()))
        self.assertEqual([m.to for m in mail.outbox], [["new@example.com"]])

    def test_a_failing_notice_never_undoes_the_change(self):
        owner = self.owner("old@example.com")
        with mock.patch("otp.notices.senders.deliver", side_effect=RuntimeError("down")), \
                self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.post(owner, "new@example.com").status_code, 200)
        owner.refresh_from_db()
        self.assertEqual(owner.email, "new@example.com")

    def test_adding_a_first_email_tells_the_sign_in_phone(self):
        owner = self.owner()
        with mock.patch("otp.notices.senders.deliver") as deliver, self.captureOnCommitCallbacks(execute=True):
            deliver.return_value = mock.Mock(ok=True, provider="test")
            self.assertEqual(self.post(owner, "new@example.com").status_code, 200)
        self.assertEqual([(c.args[0], c.args[1]) for c in deliver.call_args_list], [("sms", owner.login_phone)])
        self.assertIn("email", deliver.call_args_list[0].args[3].lower())

    def test_the_activity_event_is_masked(self):
        owner = self.owner("old.person@example.com")
        self.post(owner, "new.person@example.com")
        event = ActivityEvent.objects.get(verb="business.email_changed")
        self.assertEqual(event.target_id, str(owner.pk))
        text = str((event.summary, event.before, event.after, event.target_label))
        for full in ("old.person@example.com", "new.person@example.com", "old.person", "new.person"):
            self.assertNotIn(full, text)
        self.assertTrue(event.before["email"] and event.after["email"])

    def test_the_activity_event_is_the_last_write(self):
        owner = self.owner("old@example.com")
        self.post(owner, "new@example.com")
        self.assertEqual(ActivityEvent.objects.latest("id").verb, "business.email_changed")

    def test_resending_the_same_address_does_none_of_it(self):
        owner = self.owner("same@example.com")
        destination = self.with_assets(owner)
        before = destination.usable_from
        with mock.patch("otp.notices.senders.deliver") as deliver, self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.post(owner, "SAME@example.com").status_code, 200)
        destination.refresh_from_db()
        self.assertEqual(destination.usable_from, before)
        self.assertTrue(TrustedDevice.objects.filter(revoked_at__isnull=True).exists())
        self.assertTrue(MobileSession.objects.filter(revoked_at__isnull=True).exists())
        deliver.assert_not_called()
        self.assertFalse(ActivityEvent.objects.filter(verb="business.email_changed").exists())
        self.assertEqual(len(mail.outbox), 1)  # the link

    # ---- addresses that belong to someone else ---------------------------------------------------------------
    def test_a_staff_email_or_a_customers_verified_recovery_email_is_refused_with_the_same_words(self):
        make_staff("operations", "ops-person@example.com")
        Customer.objects.create(
            full_name="C", phone="+233241119998", password_hash="x", secondary_email="recovery@example.com",
            secondary_email_verified=True,
        )
        owner = self.owner()
        for address in ("OPS-person@example.com", "recovery@example.com"):
            with self.subTest(address=address):
                response = self.post(owner, address)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {"email": ["A business owner with this email already exists."]})
        owner.refresh_from_db()
        self.assertIsNone(owner.email)

    def test_an_unverified_customer_secondary_email_does_not_block(self):
        Customer.objects.create(
            full_name="C", phone="+233241119997", password_hash="x", secondary_email="maybe@example.com",
            secondary_email_verified=False,
        )
        self.assertEqual(self.post(self.owner(), "maybe@example.com").status_code, 200)

    # ---- password is trimmed like sign-in ------------------------------------------------------------------
    def test_the_password_is_trimmed_before_it_is_checked(self):
        owner = self.owner()
        self.assertEqual(self.post(owner, "new@example.com", password=PASSWORD + " ").status_code, 200)
        cache.clear()
        self.assertEqual(self.post(owner, "newer@example.com", password="  " + PASSWORD).status_code, 200)
        cache.clear()
        self.assertEqual(self.post(owner, "x@example.com", password="   ").status_code, 400)

    # ---- the response tells the client what happened -----------------------------------------------------------
    def test_the_response_reports_the_side_effects_honestly(self):
        owner = self.owner("old@example.com")
        self.with_assets(owner)
        body = self.post(owner, "new@example.com").json()
        self.assertEqual(body, {
            "email": "new@example.com", "sent": True,
            "side_effects": {"signed_out_phone": True, "payout_cooling": True},
        })

    def test_no_phone_session_and_no_payout_destination_means_false_and_no_cooling_notice(self):
        owner = self.owner()  # a legacy phone-only owner with no payout details
        body = self.post(owner, "new@example.com").json()
        self.assertEqual(body["side_effects"], {"signed_out_phone": False, "payout_cooling": False})
        self.assertFalse(Notification.objects.filter(business_owner=owner).exists())

    def test_a_same_address_resend_reports_false_for_both(self):
        owner = self.owner("same@example.com")
        self.with_assets(owner)
        body = self.post(owner, "same@example.com").json()
        self.assertEqual(body["side_effects"], {"signed_out_phone": False, "payout_cooling": False})

    def test_the_owner_is_told_in_the_app_when_payout_cooling_restarts(self):
        owner = self.owner("old@example.com")
        self.with_assets(owner)
        self.post(owner, "new@example.com")
        note = Notification.objects.get(business_owner=owner)
        self.assertIn("wait the cooling period again", note.body)
        self.assertNotIn("new@example.com", note.title + note.body)

    # ---- the real step-up flow, ledger on, every OTP switch off ---------------------------------------------------
    @override_settings(LEDGER_ENABLED=True, OTP_STEP_UP_ENFORCED=False, OTP_SIGNIN_ENFORCED=False)
    def test_the_whole_step_up_flow_works_through_the_real_endpoints(self):
        from otp.tests.helpers import last_sms_code

        owner = self.owner()
        token = issue_token(owner, "business_owner")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        body = {"email": "ama@example.com", "password": PASSWORD}
        first = self.client.post(URL, body, format="json")
        self.assertEqual((first.status_code, first.json()["code"]), (403, "step_up_required"))
        sent = self.client.post("/api/otp/step-up/send/", {"action": "contact_change", "channel": "sms"}, format="json")
        self.assertEqual(sent.status_code, 200, sent.content)
        verified = self.client.post(
            "/api/otp/step-up/verify/", {"action": "contact_change", "code": last_sms_code()}, format="json",
        )
        self.assertEqual(verified.status_code, 200, verified.content)
        done = self.client.post(URL, body, format="json", HTTP_X_STEP_UP_TOKEN=verified.json()["step_up_token"])
        self.assertEqual(done.status_code, 200, done.content)
        self.assertEqual(done.json()["email"], "ama@example.com")
        owner.refresh_from_db()
        self.assertEqual(owner.email, "ama@example.com")
