from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import mobile_sessions
from .authentication import issue_token


class MobileSessionRefreshView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "mobile_refresh"

    def post(self, request):
        try:
            account, account_type, refresh_token = mobile_sessions.rotate(request.data.get("refresh_token", ""))
        except mobile_sessions.InvalidRefresh:
            return Response({"detail": "Your session has ended. Please sign in again."}, status=status.HTTP_401_UNAUTHORIZED)
        return Response({
            "token": issue_token(account, account_type),
            "refresh_token": refresh_token,
            "account_type": account_type,
            "id": account.id,
            "full_name": account.full_name,
        })


class MobileSessionLogoutView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "mobile_refresh"

    def post(self, request):
        mobile_sessions.revoke(request.data.get("refresh_token", ""))
        return Response(status=status.HTTP_204_NO_CONTENT)
