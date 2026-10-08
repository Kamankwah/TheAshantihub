import hashlib
import json
import re
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import claims
from accounts.models import BusinessOwner, BusinessOwnerProfile, OwnerClaimToken, OwnerConsent
from accounts.testing import make_staff, session_of, staff_token
from activity.models import ActivityEvent
from listings.models import Zone
from notifications.models import Notification

CLAIM_URL = "/api/accounts/business-owners/claim/"
LOGIN_URL = "/api/accounts/business-owners/login/"
PASSWORD = "Akwaaba-Asafo-2026"
PHONE_UA = "Mozilla/5.0 (Linux; Android 14; TECNO Spark 20) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36"
USED = (
    "This link has already been used or replaced. Sign in with your phone number and password, "
    "or ask your account manager for a new link."
)
EXPIRED = "This link has expired. Ask your account manager to send a new one."
WRONG_DEVICE = "Finish the hand-over on the phone that started it."


def scout_owner(scout, *, phone="+233241234567", email=None):
    owner = BusinessOwner.objects.create(
        full_name="Gifty Asantewaa", login_phone=phone, email=email, password_hash=make_password(None),
        kyc_status=BusinessOwner.PENDING, registration_channel=BusinessOwner.SCOUT,
        registered_by=scout, account_manager=scout,
    )
    BusinessOwnerProfile.objects.create(
        business_owner=owner, business_name="Asafo Hair & Beauty", business_kind="service",
        gps_address="AK-112-0384", business_contact_phone=phone, zone=Zone.objects.get_or_create(name="Asafo")[0],
    )
    return owner


class ClaimTokenTests(TestCase):
    def setUp(self):
        cache.clear()
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.owner = scout_owner(self.scout, email="gifty.a@example.com")
        self.scout_token = staff_token(self.scout)
        self.scout_phone = self.client_for(self.scout_token)

    def client_for(self, token=None):
        client = APIClient()
        if token:
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return client

    def hand_over(self):
        return claims.start_handover(self.owner, self.scout, session_of(self.scout_token))

    def send_link(self):
        with self.captureOnCommitCallbacks(execute=True):
            token = claims.send_claim_link(self.owner, self.scout)
        raw = re.search(r"/business/claim\?token=([A-Za-z0-9_-]+)", mail.outbox[-1].body).group(1)
        return raw, token

    def claim(self, client, raw, **overrides):
        body = {"token": raw, "password": PASSWORD, "password_confirm": PASSWORD, "email": "", "accept_terms": True}
        body.update(overrides)
        return client.post(CLAIM_URL, body, format="json", HTTP_USER_AGENT=PHONE_UA, HTTP_X_REAL_IP="196.61.1.20")

    def assertRefused(self, response, status_code, code, detail):
        self.assertEqual(response.status_code, status_code, response.content)
        self.assertEqual(response.json(), {"detail": detail, "code": code})

    def test_hand_over_sets_the_password_records_consent_and_the_owner_signs_in(self):
        raw, token = self.hand_over()
        preview = self.scout_phone.get(f"{CLAIM_URL}?token={raw}")
        self.assertEqual(preview.status_code, 200, preview.content)
        shown = preview.json()
        self.assertEqual(
            {key: shown[key] for key in (
                "business_name", "owner_name", "area", "gps_address", "registered_by_name", "terms_version", "channel",
            )},
            {
                "business_name": "Asafo Hair & Beauty", "owner_name": "Gifty Asantewaa", "area": "Asafo",
                "gps_address": "AK-112-0384", "registered_by_name": "Kwame", "terms_version": "September 2026",
                "channel": "handover",
            },
        )
        self.assertTrue(shown["login_phone"].endswith("567"))
        self.assertNotIn("241234", shown["login_phone"])
        self.assertIn("expires_at", shown)
        self.assertIn("registered_at", shown)

        response = self.claim(self.scout_phone, raw, email="gifty.new@example.com")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {
            "claimed": True, "login_phone": "+233241234567", "business_name": "Asafo Hair & Beauty",
        })
        self.assertNotIn(PASSWORD, response.content.decode())
        self.assertNotIn(raw, response.content.decode())

        self.owner.refresh_from_db()
        self.assertIsNotNone(self.owner.claimed_at)
        self.assertFalse(self.owner.needs_claim)
        self.assertTrue(check_password(PASSWORD, self.owner.password_hash))
        self.assertEqual(self.owner.email, "gifty.new@example.com")
        self.assertIsNotNone(BusinessOwnerProfile.objects.get(business_owner=self.owner).terms_accepted_at)
        token.refresh_from_db()
        self.assertIsNotNone(token.used_at)

        consent = OwnerConsent.objects.get(business_owner=self.owner)
        self.assertEqual(
            (consent.terms_version, consent.channel, consent.staff, consent.user_agent, consent.ip),
            ("September 2026", "handover", self.scout, PHONE_UA, "196.61.1.20"),
        )
        self.assertIsNotNone(consent.accepted_at)

        event = ActivityEvent.objects.get(verb="business.claimed")
        self.assertEqual(
            (event.actor_type, event.actor_id, event.target_id, event.after),
            ("business_owner", self.owner.pk, str(self.owner.pk), {"channel": "handover"}),
        )
        self.assertFalse(ActivityEvent.objects.filter(verb="business-owner-claim").exists())
        logged = json.dumps(list(ActivityEvent.objects.values("summary", "before", "after")), default=str)
        noticed = json.dumps(list(Notification.objects.values("title", "body")))
        for secret in (PASSWORD, raw):
            self.assertNotIn(secret, logged)
            self.assertNotIn(secret, noticed)

        login = self.client_for().post(LOGIN_URL, {"identifier": "+233241234567", "password": PASSWORD}, format="json")
        self.assertEqual(login.status_code, 200, login.content)
        self.assertEqual(login.json()["account_type"], "business_owner")

    def test_hand_over_is_refused_from_any_other_session_or_device(self):
        raw, _ = self.hand_over()
        other_scout_session = self.client_for(staff_token(self.scout))
        another_staff_member = self.client_for(staff_token(self.lead))
        nobody_signed_in = self.client_for()
        for client in (other_scout_session, another_staff_member, nobody_signed_in):
            with self.subTest(client=client):
                self.assertRefused(client.get(f"{CLAIM_URL}?token={raw}"), 403, "wrong_device", WRONG_DEVICE)
                self.assertRefused(self.claim(client, raw), 403, "wrong_device", WRONG_DEVICE)
        self.owner.refresh_from_db()
        self.assertTrue(self.owner.needs_claim)
        self.assertEqual(self.claim(self.scout_phone, raw).status_code, 200)

    def test_hand_over_expires_after_30_minutes(self):
        raw, token = self.hand_over()
        self.assertEqual(claims.HANDOVER_TTL, timedelta(minutes=30))
        self.assertAlmostEqual((token.expires_at - timezone.now()).total_seconds(), 30 * 60, delta=5)
        OwnerClaimToken.objects.filter(pk=token.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertRefused(self.claim(self.scout_phone, raw), 400, "expired", EXPIRED)

    def test_a_token_works_once(self):
        raw, _ = self.hand_over()
        self.assertEqual(self.claim(self.scout_phone, raw).status_code, 200)
        self.assertRefused(self.claim(self.scout_phone, raw), 400, "used", USED)

    def test_claim_link_works_without_signing_in_for_7_days(self):
        raw, token = self.send_link()
        self.assertEqual(mail.outbox[0].to, ["gifty.a@example.com"])
        self.assertIn(f"{settings.FRONTEND_BASE_URL}/business/claim?token={raw}", mail.outbox[0].body)
        self.assertNotIn("241234567", mail.outbox[0].body)
        self.assertEqual((token.channel, token.sent_to, token.staff_session), ("link", "gifty.a@example.com", None))
        self.assertEqual(claims.LINK_TTL, timedelta(days=7))
        self.assertAlmostEqual((token.expires_at - timezone.now()).total_seconds(), 7 * 24 * 3600, delta=5)

        anyone = self.client_for()
        preview = anyone.get(f"{CLAIM_URL}?token={raw}")
        self.assertEqual((preview.status_code, preview.json()["channel"]), (200, "link"))
        self.assertEqual(self.claim(anyone, raw).status_code, 200)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.email, "gifty.a@example.com")  # a blank email keeps the one on file
        consent = OwnerConsent.objects.get(business_owner=self.owner)
        self.assertEqual((consent.channel, consent.staff), ("link", self.scout))
        self.assertEqual(ActivityEvent.objects.get(verb="business.claimed").after, {"channel": "link"})
        self.assertEqual(Notification.objects.filter(staff=self.scout, kind="business_claimed").count(), 1)

    def test_a_newer_link_replaces_the_old_one(self):
        first, _ = self.send_link()
        second, _ = self.send_link()
        self.assertRefused(self.claim(self.client_for(), first), 400, "used", USED)
        self.assertEqual(self.claim(self.client_for(), second).status_code, 200)

    def test_an_expired_link_is_refused(self):
        raw, token = self.send_link()
        OwnerClaimToken.objects.filter(pk=token.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertRefused(self.client_for().get(f"{CLAIM_URL}?token={raw}"), 400, "expired", EXPIRED)
        self.assertRefused(self.claim(self.client_for(), raw), 400, "expired", EXPIRED)

    def test_claiming_closes_every_other_open_token(self):
        link_raw, _ = self.send_link()
        raw, _ = self.hand_over()
        self.assertEqual(self.claim(self.scout_phone, raw).status_code, 200)
        self.assertRefused(self.claim(self.client_for(), link_raw), 400, "used", USED)

    def test_the_form_is_checked_before_anything_changes(self):
        BusinessOwner.objects.create(
            full_name="Ama Serwaa", login_phone="+233209990000", email="taken@example.com", password_hash="x",
        )
        raw, token = self.hand_over()
        cases = [
            ({"accept_terms": False}, {"accept_terms": ["Accept the Business Agreement to continue."]}),
            ({"password": "short", "password_confirm": "short"}, {"password": ["Use at least 8 characters."]}),
            ({"password_confirm": "Something-else-1"}, {"password_confirm": ["The two passwords don't match."]}),
            ({"email": "TAKEN@example.com"}, {"email": ["That email already belongs to another account."]}),
        ]
        for overrides, errors in cases:
            with self.subTest(overrides=overrides):
                response = self.claim(self.scout_phone, raw, **overrides)
                self.assertEqual((response.status_code, response.json()), (400, errors))
        token.refresh_from_db()
        self.assertIsNone(token.used_at)
        self.owner.refresh_from_db()
        self.assertTrue(self.owner.needs_claim)
        self.assertFalse(OwnerConsent.objects.exists())

    def test_no_token_for_an_owner_who_already_has_a_login(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(claimed_at=timezone.now())
        self.owner.refresh_from_db()
        with self.assertRaisesMessage(claims.ClaimError, "This owner already has a login."):
            self.hand_over()
        with self.assertRaisesMessage(claims.ClaimError, "This owner already has a login."):
            claims.send_claim_link(self.owner, self.scout)
        online = BusinessOwner.objects.create(full_name="Yaa Online", login_phone="+233209990001", password_hash="x")
        with self.assertRaisesMessage(claims.ClaimError, "This owner already has a login."):
            claims.start_handover(online, self.scout, session_of(self.scout_token))
        self.assertFalse(OwnerClaimToken.objects.exists())

    def test_a_link_needs_the_owners_email(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(email=None)
        self.owner.refresh_from_db()
        with self.assertRaisesMessage(
            claims.ClaimError, "Add the owner's email first — text messages (SMS) aren't connected yet.",
        ):
            claims.send_claim_link(self.owner, self.scout)

    def test_only_a_hash_is_stored_and_an_unknown_token_is_refused(self):
        raw, token = self.hand_over()
        self.assertGreaterEqual(len(raw), 40)
        self.assertEqual(token.token_hash, hashlib.sha256(raw.encode("utf-8")).hexdigest())
        self.assertFalse(OwnerClaimToken.objects.filter(token_hash=raw).exists())
        self.assertRefused(
            self.client_for().get(f"{CLAIM_URL}?token=not-a-real-token"), 400, "invalid",
            "This link isn't valid. Check you opened the whole link, or ask your account manager for a new one.",
        )

    def test_edge_spaces_are_trimmed_so_the_owner_can_sign_in(self):
        raw, _ = self.hand_over()
        padded = PASSWORD + " "
        response = self.claim(self.scout_phone, raw, password=padded, password_confirm=padded)
        self.assertEqual(response.status_code, 200, response.content)
        for attempt in (PASSWORD, padded):
            login = self.client_for().post(LOGIN_URL, {"identifier": "+233241234567", "password": attempt}, format="json")
            self.assertEqual(login.status_code, 200, login.content)

    def test_a_password_of_only_spaces_is_refused(self):
        raw, _ = self.hand_over()
        blanks = " " * 10
        response = self.claim(self.scout_phone, raw, password=blanks, password_confirm=blanks)
        self.assertEqual((response.status_code, response.json()), (400, {"password": ["Use at least 8 characters."]}))

    def test_password_reset_skips_an_unclaimed_scout_registered_owner(self):
        from accounts.models import PasswordResetToken
        url = "/api/accounts/password-reset/request/"
        unknown = self.client_for().post(url, {"email": "nobody@example.com"}, format="json")
        response = self.client_for().post(url, {"email": "gifty.a@example.com"}, format="json")
        self.assertEqual((response.status_code, response.json()), (unknown.status_code, unknown.json()))
        self.assertEqual(len(mail.outbox), 0)
        self.assertFalse(PasswordResetToken.objects.exists())

        # Once claimed, the owner can reset like anyone else.
        BusinessOwner.objects.filter(pk=self.owner.pk).update(claimed_at=timezone.now())
        self.client_for().post(url, {"email": "gifty.a@example.com"}, format="json")
        self.assertEqual(len(mail.outbox), 1)
        self.assertTrue(PasswordResetToken.objects.filter(account_id=self.owner.pk).exists())
