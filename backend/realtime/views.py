from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import sessions
from accounts.permissions import IsStaff

from . import tickets


class RealtimeTicketView(APIView):
    """POST /api/realtime/ticket/ — a single-use, 30-second ticket for
    wss://<api>/ws/staff/?ticket=… Staff only."""

    # Fetching a ticket changes nothing; recording each reconnect would flood
    # the activity log.
    activity_exempt = True

    def get_permissions(self):
        return [IsStaff()]

    def post(self, request):
        ticket = tickets.issue_ticket(request.user, sessions.current(request))
        return Response({"ticket": ticket, "expires_in": tickets.TICKET_TTL})
