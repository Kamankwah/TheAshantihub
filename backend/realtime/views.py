import logging

from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import sessions
from accounts.permissions import IsStaff

from . import tickets

logger = logging.getLogger(__name__)

UNAVAILABLE = "Live updates are unavailable right now."


class RealtimeTicketView(APIView):
    """POST /api/realtime/ticket/ — a single-use, 30-second ticket for
    wss://<api>/ws/staff/?ticket=… Staff only."""

    # Fetching a ticket changes nothing; recording each reconnect would flood
    # the activity log.
    activity_exempt = True

    def get_permissions(self):
        return [IsStaff()]

    def post(self, request):
        try:
            ticket = tickets.issue_ticket(request.user, sessions.current(request))
        except Exception:
            # Redis down or hung: the shell keeps polling and retries later.
            logger.exception("Could not issue a realtime ticket")
            return Response({"detail": UNAVAILABLE}, status=503)
        return Response({"ticket": ticket, "expires_in": tickets.TICKET_TTL})
