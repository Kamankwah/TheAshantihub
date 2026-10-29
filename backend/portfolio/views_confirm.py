"""The owner's side of a texted confirmation link (plan M3, Task 6). Public: whoever holds a live token may answer.

All three are POST, with the token in the body, so it never lands in an access log or a browser history (Review Focus 2:
never in a log line). None returns the token, the link or a phone number, and every response says `no-referrer` and
`no-store`. The service records the activity events itself, with the owner as actor, so the views are
`activity_exempt`."""
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.claims import ClaimError

from . import confirmations

STATUS_BY_CODE = {"invalid": 400, "used": 409, "expired": 410}


def _body(request):
    return request.data if hasattr(request.data, "get") else {}


class _OwnerAnswerView(APIView):
    authentication_classes = []  # a stale or foreign Authorization header must change nothing
    permission_classes = [AllowAny]
    throttle_scope = "owner_confirm"
    activity_exempt = True

    def perform(self, request, body):
        raise NotImplementedError

    def post(self, request):
        try:
            response = Response(self.perform(request, _body(request)))
        except ClaimError as exc:
            response = Response(
                {"detail": exc.message, "code": exc.code}, status=STATUS_BY_CODE.get(exc.code, exc.status_code),
            )
        response["Referrer-Policy"] = "no-referrer"
        response["Cache-Control"] = "no-store"
        return response

    def handle_exception(self, exc):  # a throttled or malformed request gets the same headers
        response = super().handle_exception(exc)
        response["Referrer-Policy"] = "no-referrer"
        response["Cache-Control"] = "no-store"
        return response


class ConfirmPreviewView(_OwnerAnswerView):
    """POST {token}: what the owner is asked to confirm. Does not use the link up."""

    def perform(self, request, body):
        return confirmations.owner_view(body.get("token"))


class ConfirmView(_OwnerAnswerView):
    """POST {token}: confirm. Single use."""

    def perform(self, request, body):
        confirmations.confirm(body.get("token"), request=request)
        return {"confirmed": True}


class ConfirmDeclineView(_OwnerAnswerView):
    """POST {token, reason?}: decline. The reason goes to the staff who asked, not to the activity chain."""

    def perform(self, request, body):
        confirmations.decline(body.get("token"), body.get("reason"), request=request)
        return {"declined": True}
