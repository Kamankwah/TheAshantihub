"""Review finding BE-02: the sign-in throttle must not be bypassable by a forged header, and a distributed guess
against one account must lock it."""
from unittest import mock

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts import lockout
from accounts.models import Customer
from core.throttling import ClusterScopedRateThrottle

LOGIN = "/api/accounts/customers/login/"
PASSWORD = "correct horse battery"


class LoginHardeningTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama", email="ama@example.com", phone="+233241234567",
            password_hash=make_password(PASSWORD), address="Adum",
        )

    def post(self, password, ident="ama@example.com", proxy_hops="203.0.113.7"):
        return self.client.post(
            LOGIN, {"identifier": ident, "password": password}, format="json", HTTP_X_FORWARDED_FOR=proxy_hops,
        )

    def test_forged_forwarded_for_prefix_does_not_open_a_new_throttle_bucket(self):
        # nginx appends the real address last; everything before it is client-controlled.
        for i in range(5):
            self.assertEqual(self.post("wrong", ident=f"nobody{i}@example.com", proxy_hops=f"10.9.9.{i}, 198.51.100.4").status_code, 400)
        blocked = self.post("wrong", ident="nobody9@example.com", proxy_hops="10.9.9.99, 198.51.100.4")
        self.assertEqual(blocked.status_code, 429)

    def test_a_different_real_address_has_its_own_bucket(self):
        for i in range(5):
            self.post("wrong", ident=f"nobody{i}@example.com", proxy_hops="198.51.100.4")
        other = self.post("wrong", ident="nobody@example.com", proxy_hops="198.51.100.5")
        self.assertEqual(other.status_code, 400)

    def test_account_locks_after_repeated_failures_even_from_many_addresses(self):
        for i in range(lockout.MAX_FAILURES):
            self.assertEqual(self.post("wrong", proxy_hops=f"192.0.2.{i + 1}").status_code, 400)
        locked = self.post(PASSWORD, proxy_hops="192.0.2.200")  # the right password is refused while locked
        self.assertEqual(locked.status_code, 429)
        self.assertNotIn("token", locked.json())

    def test_lockout_is_per_account(self):
        for i in range(lockout.MAX_FAILURES):
            self.post("wrong", proxy_hops=f"192.0.2.{i + 1}")
        Customer.objects.create(
            full_name="Kofi", email="kofi@example.com", phone="+233201111111",
            password_hash=make_password(PASSWORD), address="Adum",
        )
        ok = self.post(PASSWORD, ident="kofi@example.com", proxy_hops="192.0.2.210")
        self.assertEqual(ok.status_code, 200)

    def test_a_good_sign_in_clears_the_count(self):
        for i in range(lockout.MAX_FAILURES - 1):
            self.post("wrong", proxy_hops=f"192.0.2.{i + 1}")
        self.assertEqual(self.post(PASSWORD, proxy_hops="192.0.2.100").status_code, 200)
        for i in range(lockout.MAX_FAILURES - 1):
            self.assertEqual(self.post("wrong", proxy_hops=f"192.0.2.{120 + i}").status_code, 400)

    def test_identifier_case_and_spaces_do_not_dodge_the_lock(self):
        for i in range(lockout.MAX_FAILURES):
            self.post("wrong", ident="  AMA@example.com ", proxy_hops=f"192.0.2.{i + 1}")
        self.assertEqual(self.post(PASSWORD, proxy_hops="192.0.2.250").status_code, 429)

    def test_a_dead_throttle_cache_fails_open_instead_of_breaking_sign_in(self):
        broken = mock.MagicMock()
        broken.get.side_effect = ConnectionError("redis down")
        broken.add.side_effect = ConnectionError("redis down")
        broken.incr.side_effect = ConnectionError("redis down")
        broken.delete.side_effect = ConnectionError("redis down")
        with mock.patch.object(ClusterScopedRateThrottle, "cache", broken), \
                mock.patch("accounts.lockout.caches", {"throttle": broken}):
            self.assertEqual(self.post(PASSWORD).status_code, 200)
            self.assertEqual(self.post("wrong", proxy_hops="192.0.2.50").status_code, 400)
