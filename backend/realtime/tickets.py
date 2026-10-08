"""Single-use, 30-second tickets for the staff WebSocket (F2). A browser
can't set headers on a WebSocket, and a JWT in a URL would land in access
logs, so the client trades its token for a ticket first."""
import secrets
import time

from django.core.cache import caches

TICKET_TTL = 30
PREFIX = "realtime:ticket:"


def _cache():
    return caches["realtime"]


def issue_ticket(staff, session):
    ticket = secrets.token_urlsafe(32)
    _cache().set(
        PREFIX + ticket,
        {"staff_id": staff.pk, "session_id": session.pk, "issued_at": time.time()},
        timeout=TICKET_TTL,
    )
    return ticket


def redeem_ticket(ticket, now=None):
    """The ticket's claims, exactly once and within 30 seconds; else None."""
    if not ticket or len(ticket) > 100:
        return None
    key = PREFIX + ticket
    cache = _cache()
    claims = cache.get(key)
    # get-then-delete: delete() returns true for one caller only (Redis DEL
    # count; locmem pop), so two racing redemptions can't both win. A loser
    # that read the claims but lost the delete gets None. Residual race: none
    # that grants a second connection; a cache outage raises, which the
    # consumer turns into a refused connection.
    if claims is None or not cache.delete(key):
        return None
    if (now if now is not None else time.time()) - claims["issued_at"] > TICKET_TTL:
        return None
    return claims
