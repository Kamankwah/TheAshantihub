from rest_framework import authentication, exceptions, status
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from .models import Customer, StaffUser
from .mixins import AnonymousUser

ACCOUNT_MODELS = {
    "customer": Customer,
    "staff": StaffUser,
}


def issue_token(account, account_type):
    if account_type not in ACCOUNT_MODELS:
        raise ValueError(f"Unknown account_type: {account_type}")
    token = AccessToken()
    token["sub"] = str(account.pk)
    token["account_type"] = account_type
    return str(token)


class MultiAccountJWTAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        header = request.headers.get("Authorization")
        if not header or not header.startswith(f"{self.keyword} "):
            return None

        raw_token = header[len(self.keyword) + 1 :]
        try:
            token = AccessToken(raw_token)
        except TokenError as exc:
            raise exceptions.AuthenticationFailed("Invalid or expired token") from exc

        account_type = token.get("account_type")
        model = ACCOUNT_MODELS.get(account_type)
        if model is None:
            raise exceptions.AuthenticationFailed("Unknown account type in token")

        try:
            account = model.objects.get(pk=token["sub"])
        except model.DoesNotExist as exc:
            raise exceptions.AuthenticationFailed("Account not found") from exc

        return (account, token)


def exception_handler(exc, context):
    """
    Custom exception handler that converts 403 PermissionDenied to 401 Unauthorized
    when the user is not authenticated (UNAUTHENTICATED_USER).
    """
    from rest_framework.views import exception_handler as drf_exception_handler

    response = drf_exception_handler(exc, context)

    if (
        response is not None
        and response.status_code == status.HTTP_403_FORBIDDEN
        and isinstance(context["request"].user, AnonymousUser)
    ):
        response.status_code = status.HTTP_401_UNAUTHORIZED
        response.data = {"detail": "Authentication credentials were not provided."}

    return response
