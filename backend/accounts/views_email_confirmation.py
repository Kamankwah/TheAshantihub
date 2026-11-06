"""Email confirmation endpoints (self-serve phase 2, Task 1): the signed-in owner asks for a link, and the public page
the link opens confirms it. The service is `accounts.email_confirmation`; see it for the rules.

The public view is POST-only with the token in the body, so it never lands in an access log or a browser history, and
every answer (errors and throttling too) says `no-referrer` and `no-store`. It is `activity_exempt`: the middleware
would store the request body, which holds the token."""
from django.db import IntegrityError
from rest_framework.response import Response
from rest_framework.views import APIView

from . import email_confirmation
from .claims import ClaimError
from .serializers import EMAIL_TAKEN, OwnerEmailSerializer
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


class OwnerEmailView(APIView):
    """POST {email}: the signed-in owner adds or corrects their own email, then is mailed a confirmation link.

    Only while no email is on file or the one on file is NOT confirmed; a confirmed email is changed through the
    staff-verified path (403 `email_confirmed`). 200 {"email": <the normalised address just typed>, "sent": true}; the
    link itself goes only to the inbox. Refusals: 400 {"email": [...]} for an invalid or taken address, 429 `too_many_links`
    when five links went out today (the address is saved either way, and the older links are already revoked).

    `activity_exempt` and never logged: the body is an email address, and the mail must go out after the save commits."""

    permission_classes = [IsBusinessOwner]
    throttle_scope = "owner_email_change"
    activity_exempt = True

    def post(self, request):
        owner = request.user
        if email_confirmation.is_confirmed(owner):  # first, so a confirmed owner is told where to go whatever they typed
            return Response({"detail": email_confirmation.EMAIL_CONFIRMED, "code": "email_confirmed"}, status=403)
        serializer = OwnerEmailSerializer(data=request.data, context={"owner": owner})
        serializer.is_valid(raise_exception=True)
        try:
            owner = email_confirmation.set_email(owner, serializer.validated_data["email"])
        except IntegrityError:  # another owner took it between the check and the save
            return Response({"email": [EMAIL_TAKEN]}, status=400)
        except ClaimError as exc:
            if exc.code == "email_taken":
                return Response({"email": [EMAIL_TAKEN]}, status=400)
            return _refusal(exc)
        try:
            email_confirmation.send(owner)
        except ClaimError as exc:
            return _refusal(exc)
        return Response({"email": owner.email, "sent": True})


class ConfirmEmailView(_PublicLinkView):
    """POST {token}: confirm the owner's email. Single use. 200 {"email_confirmed": true}."""

    throttle_scope = "email_confirmation_confirm"

    def perform(self, request, body):
        email_confirmation.confirm(body.get("token"))
        return {"email_confirmed": True}
