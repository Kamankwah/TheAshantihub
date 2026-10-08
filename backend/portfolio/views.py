"""Portfolio endpoints (staff phase 2A). A "business" is a BusinessOwner and
its profile. Writes record their own activity events (record() last), so the
activity middleware adds nothing on top."""
import math

from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, StaffUser
from accounts.permissions import HasAnyRolePermission, HasRolePermission

from . import checks
from .registration import RegistrationError, register_business, resubmit_kyc
from .serializers import flag_brief
from .services import approver_name


def get_managed_business(request, pk, *, allow_portfolio_manage=True):
    """The business at `pk` when the caller is its account manager — or, if
    allowed, holds portfolio.manage. Anything else is a 404, so a scout can't
    learn which other businesses exist."""
    owner = get_object_or_404(BusinessOwner.objects.select_related("profile", "account_manager"), pk=pk)
    user = request.user
    if not isinstance(user, StaffUser):
        raise Http404
    if owner.account_manager_id == user.pk:
        return owner
    if allow_portfolio_manage and "portfolio.manage" in user.effective_permission_codenames():
        return owner
    raise Http404


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def _number(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _refused(exc):
    body = {"detail": exc.message, "code": exc.code}
    if exc.code == "duplicate":
        body["matched"] = exc.matched
    return Response(body, status=exc.status_code)


class RegisterCheckView(APIView):
    """POST register/check/ — the Review step's checks. Reads only."""

    activity_exempt = True

    def get_permissions(self):
        return [HasRolePermission("businesses.register")]

    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        return Response(checks.registration_checks(
            owner_phone=_text(body.get("owner_phone")),
            business_name=_text(body.get("business_name")),
            gps_address=_text(body.get("gps_address")),
            lat=_number(body.get("lat")),
            lng=_number(body.get("lng")),
            ghana_card_number=_text(body.get("ghana_card_number")),
        ))


class RegisterBusinessView(APIView):
    """POST register/ (multipart) — a scout registers a business for KYC."""

    def get_permissions(self):
        return [HasRolePermission("businesses.register")]

    def post(self, request):
        try:
            result = register_business(request.user, request.data, request.FILES, http_request=request)
        except RegistrationError as exc:
            return _refused(exc)
        owner, approval = result["business_owner"], result["approval"]
        return Response({
            "id": owner.pk,
            "business_name": owner.profile.business_name,
            "approval_id": approval.pk if approval else None,
            "approver_name": approver_name(approval),
            "flags": [flag_brief(flag) for flag in result["flags"]],
            "needs_claim": owner.needs_claim,
        }, status=status.HTTP_201_CREATED)


class KycResubmitView(APIView):
    """POST businesses/<pk>/kyc/ (account manager only) — a fresh
    business.kyc request after the last one was returned."""

    def get_permissions(self):
        return [HasAnyRolePermission("businesses.manage_portfolio", "businesses.register")]

    def post(self, request, pk):
        owner = get_managed_business(request, pk, allow_portfolio_manage=False)
        try:
            approval = resubmit_kyc(owner, request.user, request.data, request.FILES, http_request=request)
        except RegistrationError as exc:
            return _refused(exc)
        return Response(
            {"approval_id": approval.pk if approval else None, "approver_name": approver_name(approval)},
            status=status.HTTP_201_CREATED,
        )
