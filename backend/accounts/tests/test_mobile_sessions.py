from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import mobile_sessions
from accounts.models import Customer, MobileSession

MOBILE = {"HTTP_X_CLIENT": "mobile"}


def make_customer(**kw):
    defaults = dict(
        full_name="Ama Owusu", phone="+233241234567", email="ama@example.com",
        password_hash=make_password("s3cret-pass"),
    )
    defaults.update(kw)
    return Customer.objects.create(**defaults)


class MobileSessionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.customer = make_customer()

    def _login(self, **extra):
        return self.client.post(
            "/api/accounts/customers/login/",
            {"identifier": "+233241234567", "password": "s3cret-pass"},
            format="json", **extra,
        )

    def test_login_with_mobile_header_returns_refresh_token(self):
        body = self._login(**MOBILE).json()
        self.assertTrue(body["token"])
        self.assertGreater(len(body["refresh_token"]), 40)
        self.assertEqual(MobileSession.objects.filter(account_id=self.customer.id).count(), 1)

    def test_login_without_header_has_no_refresh_token_key(self):
        body = self._login().json()
        self.assertNotIn("refresh_token", body)
        self.assertEqual(MobileSession.objects.count(), 0)

    def test_refresh_token_is_stored_only_as_a_hash(self):
        raw = self._login(**MOBILE).json()["refresh_token"]
        self.assertFalse(MobileSession.objects.filter(token_hash=raw).exists())

    def test_refresh_rotates_and_returns_new_access_token(self):
        first = self._login(**MOBILE).json()["refresh_token"]
        response = self.client.post("/api/accounts/session/refresh/", {"refresh_token": first}, format="json")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"token", "refresh_token", "account_type", "id", "full_name"})
        self.assertNotEqual(body["refresh_token"], first)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {body['token']}")
        self.assertEqual(self.client.get("/api/accounts/me/").status_code, 200)

    def test_reusing_rotated_token_revokes_session(self):
        first = self._login(**MOBILE).json()["refresh_token"]
        newer = self.client.post(
            "/api/accounts/session/refresh/", {"refresh_token": first}, format="json"
        ).json()["refresh_token"]
        # Past the short retry window, a rotated token coming back means it leaked.
        MobileSession.objects.filter(token_hash=mobile_sessions._hash(first)).update(
            rotated_at=timezone.now() - timedelta(minutes=2)
        )
        reuse = self.client.post("/api/accounts/session/refresh/", {"refresh_token": first}, format="json")
        self.assertEqual(reuse.status_code, 401)
        after = self.client.post("/api/accounts/session/refresh/", {"refresh_token": newer}, format="json")
        self.assertEqual(after.status_code, 401)

    def test_expired_refresh_token_is_401(self):
        raw = self._login(**MOBILE).json()["refresh_token"]
        MobileSession.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        response = self.client.post("/api/accounts/session/refresh/", {"refresh_token": raw}, format="json")
        self.assertEqual(response.status_code, 401)

    def test_logout_revokes_and_is_idempotent(self):
        raw = self._login(**MOBILE).json()["refresh_token"]
        for _ in range(2):
            response = self.client.post("/api/accounts/session/logout/", {"refresh_token": raw}, format="json")
            self.assertEqual(response.status_code, 204)
        refresh = self.client.post("/api/accounts/session/refresh/", {"refresh_token": raw}, format="json")
        self.assertEqual(refresh.status_code, 401)

    def test_refresh_for_suspended_customer_is_401(self):
        raw = self._login(**MOBILE).json()["refresh_token"]
        Customer.objects.filter(pk=self.customer.pk).update(is_suspended=True)
        response = self.client.post("/api/accounts/session/refresh/", {"refresh_token": raw}, format="json")
        self.assertEqual(response.status_code, 401)

    def test_register_with_mobile_header_returns_refresh_token(self):
        response = self.client.post(
            "/api/accounts/customers/register/",
            {"full_name": "Kofi Mensah", "phone": "+233241111111", "password": "s3cret-pass-2"},
            format="json", **MOBILE,
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertIn("refresh_token", response.json())

    def test_password_change_ends_refresh_sessions(self):
        raw = self._login(**MOBILE).json()["refresh_token"]
        Customer.objects.filter(pk=self.customer.pk).update(password_hash=make_password("a-new-password-1"))
        response = self.client.post("/api/accounts/session/refresh/", {"refresh_token": raw}, format="json")
        self.assertEqual(response.status_code, 401)

    def test_retry_inside_the_window_gets_a_fresh_token_and_keeps_the_chain(self):
        first = self._login(**MOBILE).json()["refresh_token"]
        newer = self.client.post(
            "/api/accounts/session/refresh/", {"refresh_token": first}, format="json"
        ).json()["refresh_token"]
        retry = self.client.post("/api/accounts/session/refresh/", {"refresh_token": first}, format="json")
        self.assertEqual(retry.status_code, 200)
        self.assertNotIn(retry.json()["refresh_token"], (first, newer))
        again = self.client.post(
            "/api/accounts/session/refresh/", {"refresh_token": retry.json()["refresh_token"]}, format="json"
        )
        self.assertEqual(again.status_code, 200)

    def test_other_devices_keep_their_sessions_when_one_chain_is_revoked(self):
        phone = self._login(**MOBILE).json()["refresh_token"]
        tablet = self._login(**MOBILE).json()["refresh_token"]
        MobileSession.objects.filter(token_hash=mobile_sessions._hash(phone)).update(
            rotated_at=timezone.now() - timedelta(minutes=2)
        )
        self.client.post("/api/accounts/session/refresh/", {"refresh_token": phone}, format="json")
        ok = self.client.post("/api/accounts/session/refresh/", {"refresh_token": tablet}, format="json")
        self.assertEqual(ok.status_code, 200)

    def test_non_string_refresh_token_is_401_not_500(self):
        for body in ({"refresh_token": 123}, [1, 2], {"refresh_token": ["x"]}):
            response = self.client.post("/api/accounts/session/refresh/", body, format="json")
            self.assertEqual(response.status_code, 401, body)
        self.assertEqual(
            self.client.post("/api/accounts/session/logout/", [1], format="json").status_code, 204
        )

    def test_refresh_token_is_in_the_sentry_denylist(self):
        from ashantihub import sentry

        for name in ("refresh_token", "raw_token", "new_raw"):
            self.assertIn(name, sentry.EXTRA_DENYLIST)
