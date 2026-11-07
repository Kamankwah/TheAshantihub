from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts import mobile_sessions
from accounts.authentication import issue_token
from accounts.models import MobileSession

from .test_mobile_sessions import make_customer

WEB = {"HTTP_X_CLIENT": "web"}
MOBILE = {"HTTP_X_CLIENT": "mobile"}
LOGIN = "/api/accounts/customers/login/"
REFRESH = "/api/accounts/session/refresh/"
CREDS = {"identifier": "+233241234567", "password": "s3cret-pass"}


class WebRefreshCookieTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.customer = make_customer()

    def _login(self, **extra):
        return self.client.post(LOGIN, CREDS, format="json", **extra)

    def test_web_sign_in_sets_an_httponly_cookie_and_keeps_the_refresh_token_out_of_the_body(self):
        response = self._login(**WEB)
        self.assertNotIn("refresh_token", response.json())
        self.assertTrue(response.json()["token"])
        cookie = response.cookies[mobile_sessions.WEB_COOKIE]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")
        self.assertEqual(cookie["path"], mobile_sessions.WEB_COOKIE_PATH)
        self.assertEqual(MobileSession.objects.get().device_name, "web browser")

    def test_a_sign_in_that_does_not_say_it_is_web_gets_no_cookie_and_no_session(self):
        response = self._login()
        self.assertNotIn(mobile_sessions.WEB_COOKIE, response.cookies)
        self.assertEqual(MobileSession.objects.count(), 0)

    def test_the_app_still_gets_its_token_in_the_body_and_no_cookie(self):
        response = self._login(**MOBILE)
        self.assertGreater(len(response.json()["refresh_token"]), 40)
        self.assertNotIn(mobile_sessions.WEB_COOKIE, response.cookies)

    def test_refresh_by_cookie_rotates_it_and_returns_a_working_access_token(self):
        first = self._login(**WEB).cookies[mobile_sessions.WEB_COOKIE].value
        response = self.client.post(REFRESH, {}, format="json", **WEB)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("refresh_token", response.json())
        newer = response.cookies[mobile_sessions.WEB_COOKIE].value
        self.assertNotEqual(newer, first)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.json()['token']}")
        self.assertEqual(self.client.get("/api/accounts/me/").status_code, 200)

    def test_the_cookie_alone_is_not_enough_without_the_web_header(self):
        # What stops a cross-site request that merely carries the browser's cookies.
        self._login(**WEB)
        self.assertEqual(self.client.post(REFRESH, {}, format="json").status_code, 401)

    def test_a_dead_cookie_answers_401_and_is_cleared(self):
        self._login(**WEB)
        MobileSession.objects.update(revoked_at=mobile_sessions.timezone.now())
        response = self.client.post(REFRESH, {}, format="json", **WEB)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.cookies[mobile_sessions.WEB_COOKIE].value, "")

    def test_sign_out_revokes_the_session_and_clears_the_cookie(self):
        self._login(**WEB)
        response = self.client.post("/api/accounts/session/logout/", {}, format="json", **WEB)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.cookies[mobile_sessions.WEB_COOKIE].value, "")
        self.assertIsNotNone(MobileSession.objects.get().revoked_at)
        self.assertEqual(self.client.post(REFRESH, {}, format="json", **WEB).status_code, 401)

    def test_a_password_change_ends_the_browsers_session(self):
        self._login(**WEB)
        self.customer.password_hash = "changed"
        self.customer.save()
        self.assertEqual(self.client.post(REFRESH, {}, format="json", **WEB).status_code, 401)

    def test_sign_out_everywhere_ends_browser_sessions_too(self):
        token = self._login(**WEB).json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(self.client.post("/api/accounts/sign-out-everywhere/", {}, format="json").status_code, 200)
        self.client.credentials()
        self.assertEqual(self.client.post(REFRESH, {}, format="json", **WEB).status_code, 401)

    def test_the_cookie_is_not_secure_in_debug_and_is_secure_otherwise(self):
        with override_settings(DEBUG=True):
            self.assertFalse(self._login(**WEB).cookies[mobile_sessions.WEB_COOKIE]["secure"])
        with override_settings(DEBUG=False):
            self.assertTrue(self._login(**WEB).cookies[mobile_sessions.WEB_COOKIE]["secure"])


class AccessTokenLifetimeTests(TestCase):
    def _lifetime(self, token):
        decoded = AccessToken(token)
        return timedelta(seconds=decoded["exp"] - decoded["iat"])

    def test_a_customer_token_is_short_lived(self):
        self.assertEqual(self._lifetime(issue_token(make_customer(), "customer")), timedelta(minutes=30))

    @override_settings(CUSTOMER_ACCESS_TOKEN_MINUTES=5)
    def test_the_lifetime_is_a_setting(self):
        self.assertEqual(self._lifetime(issue_token(make_customer(), "customer")), timedelta(minutes=5))

    def test_a_staff_token_keeps_the_long_lifetime(self):
        from accounts.testing import make_staff

        staff = make_staff("support", "s@example.com")
        self.assertEqual(self._lifetime(issue_token(staff, "staff")), timedelta(hours=12))
