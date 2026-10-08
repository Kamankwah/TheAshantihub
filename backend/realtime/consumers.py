import time
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from . import tickets

RECHECK_SECONDS = 60
# 4401 / 4403 are sent before accept(), so over a real connection the server
# answers the handshake with HTTP 403 and a browser reports close code 1006:
# only in-process tests (WebsocketCommunicator) see these codes. The client
# relies on the ticket endpoint's 401/403 to learn why it has no access.
# 4401: bad/used/expired ticket at connect, or the session found ended on the
# periodic re-check after accept. 4403: connect refused because the staffer is
# inactive or suspended or the session is ended/missing. 4000 (after accept,
# so a browser does see it): reconnect.
CLOSE_UNAUTHORISED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_RECONNECT = 4000


def _groups_for(claims):
    """The groups a ticket's staffer joins, from their EFFECTIVE permissions,
    or None if they may not connect."""
    from accounts import sessions
    from accounts.models import StaffSession, StaffUser

    staff = (
        StaffUser.objects.select_related("role")
        .filter(pk=claims["staff_id"], is_active=True, is_suspended=False)
        .first()
    )
    session = StaffSession.objects.filter(pk=claims["session_id"], staff_id=claims["staff_id"]).first()
    if staff is None or session is None or sessions.end_reason_if_invalid(session):
        return None
    groups = [f"staff.{staff.pk}", f"session.{session.pk}", f"role.{staff.role.name}"]
    groups += [f"perm.{codename}" for codename in sorted(staff.effective_permission_codenames())]
    if staff.manager_id:
        groups.append(f"team.{staff.manager_id}")
    return groups


def _session_still_valid(session_id):
    from accounts import sessions
    from accounts.models import StaffSession

    session = StaffSession.objects.select_related("staff").filter(pk=session_id).first()
    return bool(
        session
        and sessions.end_reason_if_invalid(session) is None
        and session.staff.is_active
        and not session.staff.is_suspended
    )


class StaffConsumer(AsyncJsonWebsocketConsumer):
    """Server-to-client only. Messages arrive from the channel layer as
    "staff.event" (forwarded as-is) or "force.disconnect" (permission change,
    suspension, ended session — the client reconnects and gets a new group
    set, or is refused).

    A connection refused at connect (bad ticket 4401; inactive, suspended or
    ended-session staffer 4403) is closed before accept(), which a browser sees
    as an HTTP 403 / close code 1006, not those codes."""

    async def connect(self):
        self.joined = []
        query = parse_qs(self.scope.get("query_string", b"").decode())
        claims = await database_sync_to_async(tickets.redeem_ticket)(query.get("ticket", [""])[0])
        if claims is None:
            await self.close(code=CLOSE_UNAUTHORISED)
            return
        groups = await database_sync_to_async(_groups_for)(claims)
        if groups is None:
            await self.close(code=CLOSE_FORBIDDEN)
            return
        self.session_id = claims["session_id"]
        self.checked_at = time.monotonic()
        for group in groups:
            await self.channel_layer.group_add(group, self.channel_name)
        self.joined = groups
        await self.accept()

    async def disconnect(self, code):
        for group in getattr(self, "joined", []):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        return  # the browser never needs to send anything

    async def staff_event(self, event):
        # A session can end without a revoke (idle, 12 h); re-check it at most
        # once a minute before forwarding anything.
        if time.monotonic() - self.checked_at > RECHECK_SECONDS:
            self.checked_at = time.monotonic()
            if not await database_sync_to_async(_session_still_valid)(self.session_id):
                await self.close(code=CLOSE_UNAUTHORISED)
                return
        await self.send_json(event["payload"])

    async def force_disconnect(self, event):
        await self.send_json({"type": "force_disconnect"})
        await self.close(code=CLOSE_RECONNECT)
