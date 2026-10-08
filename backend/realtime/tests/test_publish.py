import asyncio

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import sessions
from accounts.authentication import issue_token
from accounts.models import Customer, StaffSession
from accounts.testing import make_staff, session_of, staff_token
from activity import services as activity
from activity.models import ActivityEvent
from activity.services import on_recorded
from approvals import registry
from approvals import services as approvals
from approvals.tests.kinds import RENAME_STAFF
from realtime.publish import publish_activity

FEED_FIELDS = {"type", "verb", "target", "actor", "at", "invalidate"}


class PublishTests(TestCase):
    def setUp(self):
        self.layer = get_channel_layer()
        async_to_sync(self.layer.flush)()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.esi = make_staff("support", "esi@example.com")

    def listen(self, group):
        channel = async_to_sync(self.layer.new_channel)()
        async_to_sync(self.layer.group_add)(group, channel)
        return channel

    def message(self, channel):
        return async_to_sync(self.layer.receive)(channel)

    def silent(self, channel):
        async def check():
            try:
                await asyncio.wait_for(self.layer.receive(channel), timeout=0.05)
            except asyncio.TimeoutError:
                return True
            return False

        return async_to_sync(check)()

    def record(self, actor, verb, **fields):
        with self.captureOnCommitCallbacks(execute=True):
            return activity.record(actor, verb, **fields)

    def test_the_publisher_is_attached_once(self):
        self.assertEqual(on_recorded.count(publish_activity), 1)

    def test_a_feed_event_reaches_the_actor_their_manager_and_super_admins_only(self):
        mine = self.listen(f"staff.{self.scout.id}")
        manager = self.listen(f"staff.{self.lead.id}")
        boss = self.listen(f"staff.{self.boss.id}")
        outsider = self.listen(f"staff.{self.esi.id}")
        self.record(self.scout, "call-list", method="POST", target_type="calls.calllog", target_id="7", target_label="Adwoa Fabrics")
        payload = self.message(mine)["payload"]
        self.assertEqual(set(payload), FEED_FIELDS)
        self.assertEqual(payload["target"], {"type": "calls.calllog", "id": "7", "label": "Adwoa Fabrics"})
        self.assertEqual(payload["actor"], {"id": self.scout.id, "name": "Kwame", "role": "scout"})
        self.assertEqual(payload["invalidate"], ["activity", "call-logs"])
        self.assertEqual(self.message(manager)["payload"]["verb"], "call-list")
        self.assertEqual(self.message(boss)["payload"]["verb"], "call-list")
        self.assertTrue(self.silent(outsider))

    def test_queue_changes_tell_permission_groups_only_what_to_refetch(self):
        queue = self.listen("perm.kyc.approve")
        self.record(self.lead, "kyc-approve", method="POST", target_type="accounts.businessowner", target_id="3", target_label="Adwoa Fabrics")
        payload = self.message(queue)["payload"]
        self.assertEqual(set(payload), {"type", "invalidate", "at"})
        self.assertEqual(payload["invalidate"], ["kyc-queue", "kyc-detail", "staff-badges"])

    def test_system_events_reach_only_super_admins(self):
        boss = self.listen(f"staff.{self.boss.id}")
        lead = self.listen(f"staff.{self.lead.id}")
        self.record(None, "approval.escalated")
        self.assertEqual(self.message(boss)["payload"]["verb"], "approval.escalated")
        self.assertTrue(self.silent(lead))

    def test_approval_events_refresh_the_maker_and_the_approver(self):
        registry.register(RENAME_STAFF)
        self.addCleanup(registry.unregister, RENAME_STAFF.key)
        maker = self.listen(f"staff.{self.scout.id}")
        approver = self.listen(f"staff.{self.lead.id}")
        with self.captureOnCommitCallbacks(execute=True):
            approvals.submit(self.scout, RENAME_STAFF.key, target=self.esi, title="Rename Esi", payload={"full_name": "Esi Nyarko"})
        for channel in (maker, approver):
            payloads = [self.message(channel)["payload"] for _ in range(2)]
            invalidation = next(p for p in payloads if p["type"] == "invalidate")
            self.assertIn("approvals", invalidation["invalidate"])

    def test_a_permission_change_makes_that_staffer_reconnect(self):
        channel = self.listen(f"staff.{self.esi.id}")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss, sudo=True)}")
        with self.captureOnCommitCallbacks(execute=True):
            client.post(f"/api/accounts/staff/{self.esi.id}/permissions/", {"grant": ["kyc.approve"], "revoke": []}, format="json")
        self.assertEqual(self.message(channel), {"type": "force.disconnect"})

    def test_ending_a_session_disconnects_that_device_only(self):
        session = session_of(issue_token(self.esi, "staff"))
        other = session_of(issue_token(self.esi, "staff"))
        this_device = self.listen(f"session.{session.pk}")
        other_device = self.listen(f"session.{other.pk}")
        with self.captureOnCommitCallbacks(execute=True):
            sessions.revoke(session, StaffSession.ENDED)
        self.assertEqual(self.message(this_device), {"type": "force.disconnect"})
        self.assertTrue(self.silent(other_device))

    def test_tickets_are_staff_only_and_not_activity(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.esi)}")
        response = client.post("/api/realtime/ticket/", {}, format="json")
        self.assertEqual(response.json()["expires_in"], 30)
        self.assertFalse(ActivityEvent.objects.filter(verb="realtime-ticket").exists())
        customer = Customer.objects.create(full_name="Yaw Mensah", phone="0240000001", password_hash="x")
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        self.assertEqual(client.post("/api/realtime/ticket/", {}, format="json").status_code, 403)


class BoundedPublishingTests(TestCase):
    def setUp(self):
        self.boss = make_staff("super_admin", "boss@example.com")
        self.esi = make_staff("support", "esi@example.com")
        self.calls = 0

    def hang(self):
        async def slow(group, message):
            self.calls += 1
            await asyncio.sleep(1)

        return slow

    def test_a_hung_layer_costs_one_bounded_send_per_event(self):
        import time
        from unittest import mock

        from realtime import publish

        event = ActivityEvent(occurred_at=timezone.now(),
            actor_type=ActivityEvent.STAFF, actor_id=self.esi.id, actor_label="Esi", actor_role="support",
            verb="call-list", method="POST", target_type="calls.calllog", target_id="7", target_label="x",
        )
        layer = get_channel_layer()
        with mock.patch.object(publish, "SEND_TIMEOUT", 0.05), mock.patch.object(layer, "group_send", self.hang()):
            started = time.monotonic()
            with self.assertLogs("realtime.publish", level="WARNING"):
                publish.publish_activity(event)
            elapsed = time.monotonic() - started
        self.assertEqual(self.calls, 1)
        self.assertLess(elapsed, 0.8)

    def test_force_disconnect_swallows_a_hung_layer(self):
        from unittest import mock

        from realtime import publish

        layer = get_channel_layer()
        with mock.patch.object(publish, "SEND_TIMEOUT", 0.05), mock.patch.object(layer, "group_send", self.hang()):
            with self.assertLogs("realtime.publish", level="WARNING"):
                publish.force_disconnect("staff.1")
        self.assertEqual(self.calls, 1)

