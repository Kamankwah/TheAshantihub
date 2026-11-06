"""Email confirmation endpoints (self-serve phase 2, Task 1): the signed-in owner asks for a link, and the public page
the link opens confirms it. The service is `accounts.email_confirmation`; see it for the rules.

The public view is POST-only with the token in the body, so it never lands in an access log or a browser history, and
every answer (errors and throttling too) says `no-referrer` and `no-store`. It is `activity_exempt`: the middleware
would store the request body, which holds the token."""
from rest_framework.response import Response
from rest_framework.views import APIView

from . import email_confirmation
from .claims import ClaimError
from .views import IsBusinessOwner
from .views_location import _PublicLinkView, _refusal


class SendEmailConfirmationView(APIView):
    """POST: mail the signed-in owner a fresh confirmation link. 204 with no body (the link goes only to the inbox)."""

    permission_classes = [IsBusinessOwner]
    throttle_scope = "email_confirmation_send"

    def post(self, request):
        try:
            email_confirmation.send(request.user)
        except ClaimError as exc:
            return _refusal(exc)
        return Response(status=204)


class ConfirmEmailView(_PublicLinkView):
    """POST {token}: confirm the owner's email. Single use. 200 {"email_confirmed": true}."""

    throttle_scope = "email_confirmation_confirm"

    def perform(self, request, body):
        email_confirmation.confirm(body.get("token"))
        return {"email_confirmed": True}
