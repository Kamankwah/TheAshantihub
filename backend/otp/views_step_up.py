"""Step-up codes for signed-in people (otp plan Task 8).

POST step-up/send/   {action, channel} -> {"channel", "hint", "expires_in", "resend_in"}
POST step-up/verify/ {action, code}    -> {"step_up_token", "action", "expires_in"}
The token goes once in the X-Step-Up-Token header of the change it was asked for (otp.step_up.require). The code
is bound to the access token's jti, like the token it buys."""
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import service, step_up
from .models import STEP_UP
from .service import OtpError
from .views import _body, _refused, _sent

UNKNOWN_ACTION = "Choose what you are confirming."


def _action(body):
    action = body.get("action")
    return action if isinstance(action, str) and action in step_up.ACTIONS else None


class StepUpSendView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "otp_send"
    activity_exempt = True

    def post(self, request):
        body = _body(request)
        action = _action(body)
        if action is None:
            return Response({"action": [UNKNOWN_ACTION]}, status=400)
        try:
            challenge = service.send(
                request.user, STEP_UP, body.get("channel"), action=action, ticket=step_up.session_key(request), request=request,
            )
        except OtpError as exc:
            return _refused(exc)
        return Response(_sent(challenge))


class StepUpVerifyView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "otp_verify"
    activity_exempt = True

    def post(self, request):
        body = _body(request)
        action = _action(body)
        if action is None:
            return Response({"action": [UNKNOWN_ACTION]}, status=400)
        try:
            service.verify(request.user, STEP_UP, body.get("code"), action=action, ticket=step_up.session_key(request), request=request)
        except OtpError as exc:
            return _refused(exc)
        return Response({
            "step_up_token": step_up.issue(request.user, action, request),
            "action": action,
            "expires_in": int(step_up.TOKEN_TTL.total_seconds()),
        })
