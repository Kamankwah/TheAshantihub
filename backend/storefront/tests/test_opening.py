"""The governed opening time, the delay switch, the test-account allowlist and the buy gate."""
from datetime import datetime, timedelta, timezone as dt_timezone

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from storefront import opening
from storefront.models import OpeningTime, TestAccount

UTC = dt_timezone.utc
OPENING = datetime(2026, 11, 6, 6, 0, 0, tzinfo=UTC)
BEFORE = datetime(2026, 11, 6, 5, 59, 59, tzinfo=UTC)
GATE_ON = override_settings(MARKETPLACE_GATE_ENABLED=True)


def make_customer(phone="+233241234567"):
    return Customer.objects.create(full_name="Ama Owusu", phone=phone, password_hash="x")


class OpeningServiceTests(TestCase):
    def test_default_opening_is_6_nov_0600_accra(self):
        self.assertEqual(opening.opens_at().astimezone(UTC).isoformat(), "2026-11-06T06:00:00+00:00")

    @GATE_ON
    def test_is_open_flips_on_server_clock(self):
        self.assertFalse(opening.is_open(BEFORE))
        self.assertTrue(opening.is_open(OPENING))

    @GATE_ON
    def test_can_buy_customer_before_opening_false(self):
        self.assertFalse(opening.can_buy(make_customer(), BEFORE))
        self.assertTrue(opening.can_buy(make_customer("+233241234568"), OPENING))

    @GATE_ON
    def test_can_buy_business_owner_and_staff_true(self):
        owner = BusinessOwner.objects.create(full_name="Kwame", login_phone="+233201112233", password_hash="x")
        staff = make_staff("support", "esi@example.com")
        self.assertTrue(opening.can_buy(owner, BEFORE))
        self.assertTrue(opening.can_buy(staff, BEFORE))

    @GATE_ON
    def test_can_buy_allowlisted_customer_true(self):
        customer = make_customer()
        admin = make_staff("super_admin", "root@example.com")
        TestAccount.objects.create(customer=customer, added_by=admin)
        self.assertTrue(opening.can_buy(customer, BEFORE))

    @GATE_ON
    def test_anonymous_cannot_buy_before_opening(self):
        self.assertFalse(opening.can_buy(None, BEFORE))

    def test_gate_off_everyone_can_buy_and_it_is_open(self):
        self.assertTrue(opening.is_open(BEFORE))
        self.assertTrue(opening.can_buy(make_customer(), BEFORE))
        self.assertTrue(opening.snapshot(BEFORE)["is_open"])
        self.assertFalse(opening.snapshot(BEFORE)["gate_enabled"])

    @GATE_ON
    def test_snapshot_shape(self):
        snap = opening.snapshot(BEFORE)
        self.assertEqual(snap["server_now"], BEFORE.isoformat())
        self.assertEqual(snap["opens_at"], opening.opens_at().isoformat())
        self.assertTrue(snap["gate_enabled"])
        self.assertFalse(snap["is_open"])

    def test_opening_message_is_formatted_from_opens_at_in_accra(self):
        self.assertEqual(opening.opening_message(opening.opens_at()), "The marketplace opens on 6 Nov 2026 at 06:00.")
        late = datetime(2026, 11, 20, 17, 30, tzinfo=UTC)
        self.assertEqual(opening.opening_message(late), "The marketplace opens on 20 Nov 2026 at 17:30.")

    def test_delay_sets_later_time_and_records_staff(self):
        admin = make_staff("super_admin", "root@example.com")
        later = OPENING + timedelta(days=7)
        row = opening.delay(admin, later, "Stock not ready", now=BEFORE)
        self.assertEqual(row.set_by, admin)
        self.assertEqual(row.reason, "Stock not ready")
        self.assertEqual(opening.opens_at(), later)

    def test_delay_refuses_earlier_time(self):
        admin = make_staff("super_admin", "root@example.com")
        with self.assertRaises(opening.OpeningError):
            opening.delay(admin, OPENING - timedelta(hours=1), "x", now=BEFORE - timedelta(days=1))
        with self.assertRaises(opening.OpeningError):
            opening.delay(admin, OPENING, "x", now=BEFORE - timedelta(days=1))
        self.assertEqual(OpeningTime.objects.count(), 1)

    def test_delay_after_open_refused(self):
        admin = make_staff("super_admin", "root@example.com")
        with self.assertRaises(opening.OpeningError):
            opening.delay(admin, OPENING + timedelta(days=7), "x", now=OPENING + timedelta(minutes=1))

    def test_delay_is_judged_by_real_time_not_the_flag(self):
        admin = make_staff("super_admin", "root@example.com")  # gate off here, still before opening
        opening.delay(admin, OPENING + timedelta(days=1), "x", now=BEFORE)
        self.assertEqual(OpeningTime.objects.count(), 2)

    def test_delay_needs_a_reason(self):
        admin = make_staff("super_admin", "root@example.com")
        with self.assertRaises(opening.OpeningError):
            opening.delay(admin, OPENING + timedelta(days=1), "  ", now=BEFORE)


class OpeningApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.admin = make_staff("super_admin", "root@example.com")
        self.marketing = make_staff("marketing", "mk@example.com")

    def as_staff(self, staff, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def test_public_endpoint_returns_server_now_and_no_store(self):
        response = self.client.get("/api/storefront/opening/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response["Cache-Control"])
        body = response.json()
        self.assertEqual(set(body), {"opens_at", "server_now", "is_open", "gate_enabled"})

    def test_only_super_admin_can_delay_or_manage_allowlist(self):
        payload = {"opens_at": (datetime.now(UTC) + timedelta(days=400)).isoformat(), "reason": "x"}
        customer = make_customer()
        self.assertEqual(self.client.post("/api/storefront/opening/delay/", payload, format="json").status_code, 401)
        self.assertEqual(self.client.get("/api/storefront/test-accounts/").status_code, 401)
        self.as_staff(self.marketing, sudo=True)
        self.assertEqual(self.client.post("/api/storefront/opening/delay/", payload, format="json").status_code, 403)
        self.assertEqual(self.client.get("/api/storefront/test-accounts/").status_code, 403)
        self.assertEqual(self.client.post("/api/storefront/test-accounts/", {"customer": customer.pk}, format="json").status_code, 403)

    def test_delay_needs_sudo(self):
        self.as_staff(self.admin)
        payload = {"opens_at": "2027-01-01T06:00:00Z", "reason": "x"}
        response = self.client.post("/api/storefront/opening/delay/", payload, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "sudo_required")

    @override_settings(MARKETPLACE_GATE_ENABLED=True)
    def test_super_admin_delays_via_api(self):
        self.as_staff(self.admin, sudo=True)
        response = self.client.post(
            "/api/storefront/opening/delay/", {"opens_at": "2099-01-01T06:00:00Z", "reason": "Stock not ready"}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["opens_at"], "2099-01-01T06:00:00Z")
        self.assertFalse(self.client.get("/api/storefront/opening/").json()["is_open"])

    def test_delay_bad_input_is_400(self):
        self.as_staff(self.admin, sudo=True)
        response = self.client.post("/api/storefront/opening/delay/", {"opens_at": "nonsense", "reason": "x"}, format="json")
        self.assertEqual(response.status_code, 400)
        response = self.client.post("/api/storefront/opening/delay/", {"opens_at": "2000-01-01T00:00:00Z", "reason": "x"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_allowlist_add_remove_records_activity(self):
        customer = make_customer()
        self.as_staff(self.admin)
        added = self.client.post("/api/storefront/test-accounts/", {"customer": customer.pk}, format="json")
        self.assertEqual(added.status_code, 201, added.content)
        self.assertTrue(TestAccount.objects.filter(customer=customer).exists())
        listed = self.client.get("/api/storefront/test-accounts/").json()
        self.assertEqual([row["customer"] for row in listed], [customer.pk])
        self.assertEqual(listed[0]["customer_name"], "Ama Owusu")
        removed = self.client.delete("/api/storefront/test-accounts/", {"customer": customer.pk}, format="json")
        self.assertEqual(removed.status_code, 204)
        self.assertFalse(TestAccount.objects.filter(customer=customer).exists())
        self.assertEqual(ActivityEvent.objects.filter(actor_type="staff", method__in=["POST", "DELETE"]).count(), 2)

    def test_allowlist_unknown_customer_is_400_and_add_is_idempotent(self):
        customer = make_customer()
        self.as_staff(self.admin)
        self.assertEqual(self.client.post("/api/storefront/test-accounts/", {"customer": 99999}, format="json").status_code, 400)
        self.client.post("/api/storefront/test-accounts/", {"customer": customer.pk}, format="json")
        self.assertEqual(self.client.post("/api/storefront/test-accounts/", {"customer": customer.pk}, format="json").status_code, 200)
        self.assertEqual(TestAccount.objects.count(), 1)
