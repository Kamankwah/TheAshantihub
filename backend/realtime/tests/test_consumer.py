from asgiref.sync import async_to_sync, sync_to_async
from channels.layers import get_channel_layer
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.core.cache import caches
from django.test import TransactionTestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts.authentication import issue_token
from accounts.models import Permission, Role, StaffSession, StaffUser
from accounts.testing import make_staff, staff_token
from realtime import tickets
from realtime.routing import build_websocket_app, websocket_urlpatterns

APP = URLRouter(websocket_urlpatterns)


def invalidation(keys):
    return {"type": "staff.event", "payload": {"type": "invalidate", "invalidate": keys, "at": "now"}}


class ConsumerTests(TransactionTestCase):
    # The consumer reads the database from another thread, so the data must
    # be committed; serialized_rollback restores the seeded roles afterwards.
    serialized_rollback = True

    def setUp(self):
        caches["realtime"].clear()
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.boss = make_staff("super_admin", "boss@example.com")
        self.token = issue_token(self.scout, "staff")
        self.session = StaffSession.objects.get(jti=AccessToken(self.token)["jti"])

    def ticket(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        return client.post("/api/realtime/ticket/", {}, format="json").json()["ticket"]

    def socket(self, ticket, app=APP, origin=None):
        headers = [(b"origin", origin.encode())] if origin else []
        return WebsocketCommunicator(app, f"/ws/staff/?ticket={ticket}", headers=headers)

    def test_the_asgi_application_routes_websockets(self):
        from ashantihub.asgi import application

        self.assertIn("websocket", application.application_mapping)

    def test_a_ticket_connects_once(self):
        ticket = self.ticket()

        async def run():
            first = self.socket(ticket)
            connected, _ = await first.connect()
            self.assertTrue(connected)
            second = self.socket(ticket)
            connected_again, code = await second.connect()
            self.assertEqual((connected_again, code), (False, 4401))
            await first.disconnect()

        async_to_sync(run)()

    def test_a_ticket_lapses_after_thirty_seconds(self):
        ticket = tickets.issue_ticket(self.scout, self.session)
        claims = caches["realtime"].get(tickets.PREFIX + ticket)
        self.assertIsNone(tickets.redeem_ticket(ticket, now=claims["issued_at"] + 31))

    def test_garbage_tickets_are_refused(self):
        async def run():
            connected, _ = await self.socket("not-a-ticket").connect()
            self.assertFalse(connected)

        async_to_sync(run)()

    def test_groups_follow_effective_permissions(self):
        self.scout.extra_permissions.add(Permission.objects.get(codename="kyc.approve"))
        self.scout.revoked_permissions.add(Permission.objects.get(codename="calls.log"))
        ticket = self.ticket()

        async def run():
            socket = self.socket(ticket)
            await socket.connect()
            layer = get_channel_layer()
            groups = ["perm.kyc.approve", f"team.{self.lead.id}", "role.scout", f"staff.{self.scout.id}", f"session.{self.session.id}"]
            for group in groups:
                await layer.group_send(group, invalidation([group]))
                self.assertEqual((await socket.receive_json_from(timeout=1))["invalidate"], [group])
            await layer.group_send("perm.calls.log", invalidation(["call-logs"]))
            self.assertTrue(await socket.receive_nothing(timeout=0.1))
            await socket.disconnect()

        async_to_sync(run)()

    def test_suspension_forces_a_disconnect_and_blocks_reconnecting(self):
        ticket = self.ticket()
        boss = APIClient()
        boss.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss, sudo=True)}")

        async def run():
            socket = self.socket(ticket)
            await socket.connect()
            await sync_to_async(boss.post)(f"/api/accounts/staff/{self.scout.id}/suspend/", {"reason": "x"}, format="json")
            self.assertEqual(await socket.receive_json_from(timeout=2), {"type": "force_disconnect"})
            closed = await socket.receive_output(timeout=2)
            self.assertEqual((closed["type"], closed["code"]), ("websocket.close", 4000))

        async_to_sync(run)()
        fresh = tickets.issue_ticket(self.scout, self.session)

        async def again():
            connected, _ = await self.socket(fresh).connect()
            self.assertFalse(connected)

        async_to_sync(again)()

    def test_a_foreign_origin_is_refused(self):
        app = build_websocket_app(origins=["https://theashantihub.com"])
        ticket = self.ticket()

        async def run():
            refused, _ = await self.socket(ticket, app, origin="https://evil.example").connect()
            self.assertFalse(refused)
            allowed = self.socket(ticket, app, origin="https://theashantihub.com")
            connected, _ = await allowed.connect()
            self.assertTrue(connected)
            await allowed.disconnect()

        async_to_sync(run)()
