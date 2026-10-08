import json
from unittest import mock

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Customer, Role, StaffUser
from accounts.testing import staff_token
from activity import services
from activity.models import ActivityEvent


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


class StaffActivityMiddlewareTests(TestCase):
    def setUp(self):
        cache.clear()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.support = make_staff("support", "esi@example.com")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss, sudo=True)}")
        self.suspend_url = f"/api/accounts/staff/{self.support.id}/suspend/"

    def test_successful_staff_write_records_one_event(self):
        response = self.client.post(self.suspend_url, {"reason": "investigation"}, format="json")
        self.assertEqual(response.status_code, 200)
        event = ActivityEvent.objects.get()
        self.assertEqual((event.verb, event.method, event.actor_id), ("staff-suspend", "POST", self.boss.id))
        self.assertEqual(event.target_id, str(self.support.id))
        self.assertEqual(event.after, {"request": {"reason": "investigation"}, "status": 200})

    def test_code_in_a_request_body_is_redacted(self):
        self.client.post(self.suspend_url, {"code": "123456", "reason": "x"}, format="json")
        self.assertEqual(ActivityEvent.objects.get().after["request"], {"code": "[redacted]", "reason": "x"})

    def test_a_nul_in_the_body_is_stripped_and_the_write_still_succeeds(self):
        # Postgres text/jsonb cannot hold NUL; request bodies are untrusted.
        body = {"reason": "investigation", "note": "a\x00b", "k\x00ey": ["c\x00d"]}
        response = self.client.post(self.suspend_url, body, format="json")
        self.assertEqual(response.status_code, 200)
        event = ActivityEvent.objects.get()
        self.assertEqual(
            event.after["request"], {"reason": "investigation", "note": "ab", "key": ["cd"]}
        )
        self.assertNotIn("\\u0000", json.dumps(event.after))
        self.assertEqual(services.verify_chain(), (True, None))

    def test_rejected_staff_write_records_nothing(self):
        response = self.client.post(f"/api/accounts/staff/{self.boss.id}/suspend/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ActivityEvent.objects.exists())

    def test_multipart_body_is_recorded_and_the_view_still_works(self):
        response = self.client.post(self.suspend_url, {"reason": "form post"}, format="multipart")
        self.assertEqual(response.status_code, 200)
        self.support.refresh_from_db()
        self.assertEqual(self.support.suspension_reason, "form post")
        self.assertEqual(ActivityEvent.objects.get().after["request"], {"reason": "form post"})

    def test_malformed_json_reaches_the_view_and_records_nothing(self):
        response = self.client.generic("POST", self.suspend_url, "{not json", content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ActivityEvent.objects.exists())

    def test_reads_are_not_recorded(self):
        self.client.get("/api/accounts/staff/")
        self.assertFalse(ActivityEvent.objects.exists())

    def test_bad_tokens_pass_through(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer not-a-token")
        self.assertEqual(self.client.post(self.suspend_url, {}, format="json").status_code, 401)
        self.assertFalse(ActivityEvent.objects.exists())

    def test_customer_writes_are_not_recorded(self):
        customer = Customer.objects.create(full_name="Yaw Mensah", phone="0240000001", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        self.client.patch("/api/accounts/customers/me/profile/", {"full_name": "Yaw M."}, format="json")
        self.assertFalse(ActivityEvent.objects.exists())

    def test_recording_failure_rolls_the_action_back(self):
        with mock.patch("activity.middleware.services.record", side_effect=RuntimeError("db down")):
            with self.assertRaises(RuntimeError):
                self.client.post(self.suspend_url, {"reason": "x"}, format="json")
        self.support.refresh_from_db()
        self.assertFalse(self.support.is_suspended)

    def test_logout_records_once(self):
        self.assertEqual(self.client.post("/api/accounts/staff/logout/", {}, format="json").status_code, 204)
        self.assertEqual(list(ActivityEvent.objects.values_list("verb", flat=True)), ["staff.signed_out"])

    def test_login_is_recorded(self):
        self.support.password_hash = make_password("correct-horse-1")
        self.support.save(update_fields=["password_hash"])
        anonymous = APIClient()
        response = anonymous.post(
            "/api/accounts/staff/login/", {"identifier": "esi@example.com", "password": "correct-horse-1"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        event = ActivityEvent.objects.get()
        self.assertEqual((event.verb, event.actor_id), ("staff.signed_in", self.support.id))
