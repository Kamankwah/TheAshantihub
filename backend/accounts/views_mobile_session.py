from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from django.conf import settings

from . import mobile_sessions
from .authentication import issue_token


def _foreign_origin(request):
    """A cookie-based call (the web app) from a page whose origin is not on the CORS allow-list. The cookie is SameSite=Lax
    and the call needs a custom header, but the origin is checked here as well (defence in depth; skipped only while the
    dev default allows every origin, which the core system checks refuse outside DEBUG)."""
    if mobile_sessions.client_kind(request) != "web" or settings.CORS_ALLOW_ALL_ORIGINS:
        return None
    origin = request.headers.get("Origin")
    if origin and origin not in settings.CORS_ALLOWED_ORIGINS:
        return Response({"detail": "This site may not renew a session."}, status=status.HTTP_403_FORBIDDEN)
    return None


class MobileSessionRefreshView(APIView):
    """Trade a refresh token (request body for the app, cookie for the web app) for a new access token and a rotated
    refresh token. The web app's new refresh token goes back in the cookie, never in the body."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "mobile_refresh"

    def post(self, request):
        refused = _foreign_origin(request)
        if refused is not None:
            return refused
        try:
            account, account_type, refresh_token = mobile_sessions.rotate(mobile_sessions.token_from(request))
        except mobile_sessions.InvalidRefresh:
            response = Response({"detail": "Your session has ended. Please sign in again."}, status=status.HTTP_401_UNAUTHORIZED)
            if mobile_sessions.client_kind(request) == "web":
                mobile_sessions.clear_cookie(response)
            return response
        response = Response({
            "token": issue_token(account, account_type),
            "refresh_token": refresh_token,
            "account_type": account_type,
            "id": account.id,
            "full_name": account.full_name,
        })
        return mobile_sessions.deliver(request, response)


class MobileSessionLogoutView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "mobile_refresh"

    def post(self, request):
        refused = _foreign_origin(request)
        if refused is not None:
            return refused
        mobile_sessions.revoke(mobile_sessions.token_from(request))
        response = Response(status=status.HTTP_204_NO_CONTENT)
        if mobile_sessions.client_kind(request) == "web":
            mobile_sessions.clear_cookie(response)
        return response
