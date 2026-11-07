from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import mobile_sessions
from .authentication import issue_token


class MobileSessionRefreshView(APIView):
    """Trade a refresh token (request body for the app, cookie for the web app) for a new access token and a rotated
    refresh token. The web app's new refresh token goes back in the cookie, never in the body."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "mobile_refresh"

    def post(self, request):
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
        mobile_sessions.revoke(mobile_sessions.token_from(request))
        response = Response(status=status.HTTP_204_NO_CONTENT)
        if mobile_sessions.client_kind(request) == "web":
            mobile_sessions.clear_cookie(response)
        return response
