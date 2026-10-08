from rest_framework import authentication, exceptions, status
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from . import sessions
from .models import BusinessOwner, Customer, StaffUser
from .mixins import AnonymousUser

ACCOUNT_MODELS = {
    "customer": Customer,
    "staff": StaffUser,
    "business_owner": BusinessOwner,
}


def issue_token(account, account_type, *, request=None, two_factor=False):
    """A signed access token. A staff token also opens a StaffSession named by
    the token's jti (foundations F9); `request` supplies its device, IP and
    user agent, and `two_factor` records that the sign-in passed 2-step."""
    if account_type not in ACCOUNT_MODELS:
        raise ValueError(f"Unknown account_type: {account_type}")
    token = AccessToken()
    token["sub"] = str(account.pk)
    token["account_type"] = account_type
    if account_type == "staff":
        sessions.start(account, token["jti"], request, two_factor=two_factor)
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

        # A staffer suspended or deactivated mid-session still holds a valid,
        # unexpired token — refuse it here so the block takes effect
        # immediately rather than only at their next login (punch-list item
        # 10). Customers/BusinessOwners are only blocked at login today; this
        # is deliberately staff-only, since a staffer's live token grants
        # access to moderation/finance surfaces where an immediate cut matters.
        if isinstance(account, StaffUser) and (account.is_suspended or not account.is_active):
            raise exceptions.AuthenticationFailed("This staff account is no longer active")

        if isinstance(account, StaffUser):
            # Server-side session (F9): revoked, idle-over-30-minutes and
            # older-than-12-hours sessions are refused here.
            session = sessions.validate(account, token)
            sessions.touch(session)
            token.staff_session = session

        return (account, token)


def exception_handler(exc, context):
    """
    Custom exception handler that converts 403 PermissionDenied to 401 Unauthorized
    when the user is not authenticated (UNAUTHENTICATED_USER). A refused
    credential (AuthenticationFailed: an ended session, a suspended account, a
    bad token) is also 401 but keeps its own message, so the client can tell
    "your session ended" from "you sent no credentials".
    """
    from rest_framework.views import exception_handler as drf_exception_handler

    response = drf_exception_handler(exc, context)

    if (
        response is not None
        and response.status_code == status.HTTP_403_FORBIDDEN
        and isinstance(context["request"].user, AnonymousUser)
    ):
        response.status_code = status.HTTP_401_UNAUTHORIZED
        if not isinstance(exc, exceptions.AuthenticationFailed):
            response.data = {"detail": "Authentication credentials were not provided."}

    return response
