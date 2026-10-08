from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import get_random_string
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import SAFE_METHODS, AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from approvals.services import ApprovalError
from notifications.services import notify_business_owner, notify_customer, notify_staff_role

from activity.services import record as record_activity
from realtime.publish import force_disconnect_on_commit

from . import claims, kyc, sessions, two_factor
from .authentication import issue_token
from .emails import send_staff_invite_email, send_two_factor_changed_email, send_verification_code_email
from .models import (
    BusinessOwner,
    Customer,
    Permission,
    Role,
    RoleInviteRule,
    ScoutAssignment,
    StaffSession,
    StaffUser,
)
from .permissions import (
    HasAnyRolePermission,
    HasRolePermission,
    IsStaff,
    RequiresSudo,
    can_lead_team,
    can_manage_staff,
)
from .serializers import (
    INVITE_TOKEN_LIFETIME,
    BusinessOwnerKYCDetailSerializer,
    BusinessOwnerKYCSerializer,
    BusinessOwnerListSerializer,
    BusinessOwnerLoginSerializer,
    BusinessOwnerRegistrationSerializer,
    BusinessOwnerProfileUpdateSerializer,
    CustomerListSerializer,
    CustomerLoginSerializer,
    CustomerProfileSerializer,
    CustomerRegistrationSerializer,
    CustomerSecondaryEmailConfirmSerializer,
    CustomerSecondaryEmailRequestSerializer,
    CustomerSecondaryPhoneConfirmSerializer,
    CustomerSecondaryPhoneRequestSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PayoutDetailSerializer,
    ScoutAssignmentSerializer,
    StaffActivateSerializer,
    StaffBusinessOwnerDetailSerializer,
    StaffCustomerDetailSerializer,
    StaffInviteSerializer,
    StaffListSerializer,
    StaffLoginSerializer,
    StaffSessionSerializer,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    token = request.auth
    data = {
        "account_type": token["account_type"],
        "id": request.user.id,
        "full_name": request.user.full_name,
    }
    if isinstance(request.user, StaffUser):
        data["role"] = request.user.role.name
        # Effective set (role + per-staffer grants − revocations), NOT raw
        # role permissions — must match what HasRolePermission enforces, or
        # the UI gates on a different set than the server (punch-list item 9).
        data["permissions"] = sorted(request.user.effective_permission_codenames())
    if isinstance(request.user, BusinessOwner):
        data["kyc_status"] = request.user.kyc_status
        data["kyc_rejection_reason"] = request.user.kyc_rejection_reason
        data["registration_step"] = request.user.compute_registration_step()
    if isinstance(request.user, Customer):
        data["avatar"] = (
            request.build_absolute_uri(request.user.avatar.url) if request.user.avatar else None
        )
        data["email"] = request.user.email
        data["phone"] = request.user.phone
    return Response(data)


class CustomerRegisterView(generics.CreateAPIView):
    serializer_class = CustomerRegistrationSerializer
    permission_classes = [AllowAny]
    throttle_scope = "customer_register"

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        customer = Customer.objects.get(pk=response.data["id"])
        response.data["token"] = issue_token(customer, "customer")
        return response


class StaffInviteView(generics.CreateAPIView):
    serializer_class = StaffInviteSerializer

    def get_permissions(self):
        # Every invite (a team invite too) mints an account: password again.
        return [HasAnyRolePermission(*TEAM_OR_STAFF_MANAGE), RequiresSudo()]


class StaffActivateView(generics.GenericAPIView):
    serializer_class = StaffActivateSerializer
    permission_classes = [AllowAny]
    throttle_scope = "staff_activate"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        staff = serializer.save()
        # Same second-step rules as signing in: a Super Admin must not get a
        # session at activation without 2-step sign-in.
        stage = two_factor.challenge_for(staff)
        if stage == two_factor.VERIFY:
            return Response({"status": "activated", "two_factor_required": True,
                             "mfa_token": two_factor.make_challenge(staff, stage)})
        if stage == two_factor.ENROL:
            return Response({"status": "activated", "two_factor_setup_required": True,
                             "mfa_token": two_factor.make_challenge(staff, stage)})
        return Response({"status": "activated", "token": issue_token(staff, "staff", request=request)})


class BusinessOwnerRegisterView(generics.CreateAPIView):
    serializer_class = BusinessOwnerRegistrationSerializer
    permission_classes = [AllowAny]
    throttle_scope = "business_owner_register"

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        owner = BusinessOwner.objects.get(pk=response.data["id"])
        response.data["token"] = issue_token(owner, "business_owner")
        return response


class StaffResendInviteView(APIView):
    def get_permissions(self):
        return [HasAnyRolePermission(*TEAM_OR_STAFF_MANAGE)]

    def post(self, request, pk):
        staff = generics.get_object_or_404(StaffUser, pk=pk)
        scope = _guard_team_scope(request, staff)
        if scope:
            return scope
        if staff.invite_token is None:
            return Response(
                {"detail": "Cannot resend invite for an already-activated account."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        staff.invite_token = get_random_string(43)
        staff.invite_expires_at = timezone.now() + INVITE_TOKEN_LIFETIME
        staff.save(update_fields=["invite_token", "invite_expires_at"])
        send_staff_invite_email(
            staff, f"{settings.FRONTEND_BASE_URL}/staff/activate?token={staff.invite_token}"
        )
        return Response({"status": "invite resent"})


class CustomerLoginView(generics.GenericAPIView):
    serializer_class = CustomerLoginSerializer
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = serializer.account
        return Response({
            "token": issue_token(account, "customer"),
            "account_type": "customer",
            "id": account.id,
            "full_name": account.full_name,
        })


class BusinessOwnerLoginView(generics.GenericAPIView):
    serializer_class = BusinessOwnerLoginSerializer
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = serializer.account
        return Response({
            "token": issue_token(account, "business_owner"),
            "account_type": "business_owner",
            "id": account.id,
            "full_name": account.full_name,
        })


def _truthy(value):
    return value is True or (isinstance(value, str) and value.strip().lower() in ("true", "1", "on", "yes"))


class BusinessOwnerClaimView(APIView):
    """GET ?token= previews the business; POST sets the owner's own password
    (staff phase 2A, S2). Open to whoever holds a live token — a hand-over
    token also needs the staff session that started it (accounts/claims.py).
    Never returns a token or the password."""

    permission_classes = [AllowAny]
    throttle_scope = "owner_claim"
    # claims.claim() records business.claimed itself, with the owner as actor;
    # the hand-over's request carries the scout's token, so the middleware
    # must not log it as a staff action.
    activity_exempt = True

    def get(self, request):
        try:
            return Response(claims.preview(request.query_params.get("token", ""), request))
        except claims.ClaimError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.status_code)

    def post(self, request):
        body = _body(request)
        try:
            owner = claims.claim(
                body.get("token"),
                password=body.get("password"),
                password_confirm=body.get("password_confirm"),
                email=body.get("email"),
                accept_terms=_truthy(body.get("accept_terms")),
                request=request,
            )
        except claims.ClaimError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.status_code)
        return Response({"claimed": True, "login_phone": owner.login_phone, "business_name": owner.display_name})


def _staff_sign_in_response(account, request, *, two_factor_used=False):
    # Open the session first so a sign-in is never logged without one.
    token = issue_token(account, "staff", request=request, two_factor=two_factor_used)
    record_activity(
        account, "staff.signed_in", target=account, method="POST", request=request,
        summary="with 2-step sign-in" if two_factor_used else "",
    )
    return {
        "token": token,
        "account_type": "staff",
        "id": account.id,
        "full_name": account.full_name,
        "role": account.role.name,
        "permissions": sorted(account.effective_permission_codenames()),
    }


TIMED_OUT = "Your sign-in timed out. Enter your password again."
UNREADABLE = "Your 2-step sign-in can't be checked right now. Ask a Super Admin to reset it."
WRONG_CODE = "That code isn't right. Check your authenticator app and try again."


def _body(request):
    return request.data if isinstance(request.data, dict) else {}


def _text(value):
    """A request value as a string, or None if the client sent anything else."""
    return value if isinstance(value, str) else None


def _email_after_commit(staff, change):
    transaction.on_commit(lambda: send_two_factor_changed_email(staff, change), robust=True)


class StaffLoginView(generics.GenericAPIView):
    serializer_class = StaffLoginSerializer
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = serializer.account
        stage = two_factor.challenge_for(account)
        if stage == two_factor.VERIFY:
            return Response({"two_factor_required": True, "mfa_token": two_factor.make_challenge(account, stage)})
        if stage == two_factor.ENROL:
            return Response({"two_factor_setup_required": True, "mfa_token": two_factor.make_challenge(account, stage)})
        return Response(_staff_sign_in_response(account, request))


class StaffLogoutView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def post(self, request):
        session = sessions.current(request)
        if session is not None:
            sessions.revoke(session, StaffSession.SIGNED_OUT)
        record_activity(request.user, "staff.signed_out", target=request.user, method="POST", request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetRequestView(generics.GenericAPIView):
    serializer_class = PasswordResetRequestSerializer
    permission_classes = [AllowAny]
    throttle_scope = "password_reset_request"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # Always a generic response, whether or not the email matched an
        # account — see PasswordResetRequestSerializer.save().
        return Response(
            {"detail": "If an account with that email exists, a password reset link has been sent."}
        )


class PasswordResetConfirmView(generics.GenericAPIView):
    serializer_class = PasswordResetConfirmSerializer
    permission_classes = [AllowAny]
    throttle_scope = "password_reset_request"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"status": "password reset"})


# Staff moderation-queue restructuring — the canonical three-state queue
# convention shared by every moderated model (KYC here, Listing/Hero in
# listings/views.py): one ListAPIView serves Pending/Approved/Rejected via a
# `?status=` query param (default "pending"), mapping the tab key to the
# model's real status value(s). Kept on the existing `.../pending/` URL (the
# path name is historical) so no route churn and existing callers with no
# param keep getting the pending queue.
KYC_STATUS_MAP = {
    "pending": BusinessOwner.PENDING,
    "approved": BusinessOwner.VERIFIED,
    "rejected": BusinessOwner.REJECTED,
}


class KYCPendingQueueView(generics.ListAPIView):
    serializer_class = BusinessOwnerKYCSerializer

    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]

    def get_queryset(self):
        tab = self.request.query_params.get("status", "pending")
        kyc_status = KYC_STATUS_MAP.get(tab, BusinessOwner.PENDING)
        queryset = kyc.with_review_data(BusinessOwner.objects.filter(kyc_status=kyc_status))
        # Pending: oldest-first (a work queue). Approved/Rejected: most-recently
        # actioned first (a history), falling back to created_at for legacy
        # rows actioned before reviewed_at existed.
        if kyc_status == BusinessOwner.PENDING:
            return queryset.order_by("created_at")
        return queryset.order_by("-reviewed_at", "-created_at")


class KYCDetailView(generics.RetrieveAPIView):
    serializer_class = BusinessOwnerKYCDetailSerializer

    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]

    def get_queryset(self):
        return kyc.with_review_data(BusinessOwner.objects.all())


class KYCApproveView(APIView):
    """Approve from the KYC queue. accounts.kyc.approve_owner settles a pending
    business.kyc request too, refuses a business already decided, the request's
    own maker, and an open self-dealing case; it records kyc-approve itself."""

    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]

    def post(self, request, pk):
        try:
            owner = kyc.approve_owner(pk, request.user, http_request=request)
        except (kyc.KycError, ApprovalError) as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response({"id": owner.id, "kyc_status": owner.kyc_status})


class KYCRejectView(APIView):
    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]

    def post(self, request, pk):
        data = request.data if hasattr(request.data, "get") else {}
        try:
            owner = kyc.reject_owner(pk, request.user, str(data.get("reason") or ""), http_request=request)
        except (kyc.KycError, ApprovalError) as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response({"id": owner.id, "kyc_status": owner.kyc_status})


class KYCReReviewView(APIView):
    """POST /api/accounts/kyc/{id}/re-review/ — the canonical re-review action
    (staff moderation-queue restructuring): move a REJECTED submission back to
    PENDING, clearing the rejection reason and approver attribution, and
    re-notify staff who can approve KYC. Gated by the same kyc.approve
    permission. Only a rejected submission can be re-opened.
    """

    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]

    def post(self, request, pk):
        owner = generics.get_object_or_404(BusinessOwner, pk=pk)
        if owner.kyc_status != BusinessOwner.REJECTED:
            return Response(
                {"detail": "Only a rejected KYC submission can be sent back for re-review."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        owner.kyc_status = BusinessOwner.PENDING
        owner.kyc_rejection_reason = None
        owner.reviewed_by = None
        owner.reviewed_at = None
        owner.save(update_fields=["kyc_status", "kyc_rejection_reason", "reviewed_by", "reviewed_at"])
        notify_staff_role(
            "kyc.approve", "kyc_needs_approval", "KYC re-opened for review",
            body=f"{owner.full_name}'s KYC has been re-opened and needs review again.",
            link="kyc", icon="🪪",
        )
        return Response({"id": owner.id, "kyc_status": owner.kyc_status})


class KYCAddressVerifyView(APIView):
    """POST /api/accounts/kyc/{id}/address-verify/ {verified: bool} — records a
    staff decision on the business's Ghana Post digital address (punch-list
    item 8), with attribution. Setting either true or false marks a decision as
    having been made (address_verified_at), which is what unblocks the KYC
    Approve/Reject buttons on the frontend. Gated by kyc.approve.
    """

    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]

    def post(self, request, pk):
        owner = generics.get_object_or_404(BusinessOwner, pk=pk)
        verified = bool(request.data.get("verified", False))
        profile = owner.profile
        profile.address_verified = verified
        profile.address_verified_by = request.user
        profile.address_verified_at = timezone.now()
        profile.save(update_fields=["address_verified", "address_verified_by", "address_verified_at"])
        return Response({
            "id": owner.id,
            "address_verified": profile.address_verified,
            "address_verified_by_name": request.user.full_name,
            "address_verified_at": profile.address_verified_at,
        })


class AccountsPagination(PageNumberPagination):
    page_size = 20


class CustomerListView(generics.ListAPIView):
    serializer_class = CustomerListSerializer
    queryset = Customer.objects.all().order_by("-created_at")
    pagination_class = AccountsPagination

    def get_permissions(self):
        return [HasRolePermission("users.view")]


class BusinessOwnerListView(generics.ListAPIView):
    serializer_class = BusinessOwnerListSerializer
    queryset = BusinessOwner.objects.all().order_by("-created_at")
    pagination_class = AccountsPagination

    def get_permissions(self):
        return [HasRolePermission("users.view")]


class StaffListView(generics.ListAPIView):
    serializer_class = StaffListSerializer
    queryset = sessions.with_last_sign_in(StaffUser.objects.all()).order_by("-created_at")
    pagination_class = AccountsPagination

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]


class StaffTeamListView(generics.ListAPIView):
    serializer_class = StaffListSerializer
    pagination_class = None

    def get_permissions(self):
        return [HasAnyRolePermission(*TEAM_OR_STAFF_MANAGE)]

    def get_queryset(self):
        return (
            sessions.with_last_sign_in(StaffUser.objects.filter(manager=self.request.user))
            .select_related("role", "manager")
            .order_by("full_name")
        )


class InvitableRolesView(APIView):
    def get_permissions(self):
        return [HasAnyRolePermission(*TEAM_OR_STAFF_MANAGE)]

    def get(self, request):
        user = request.user
        if can_manage_staff(user):
            roles = Role.objects.all()
            if user.role.name != Role.SUPER_ADMIN:
                roles = roles.exclude(name=Role.SUPER_ADMIN)
            names = roles.values_list("name", flat=True)
        else:
            names = RoleInviteRule.objects.filter(inviter_role=user.role).values_list(
                "invitee_role__name", flat=True
            )
        return Response(sorted(names))


class StaffManagerView(APIView):
    def get_permissions(self):
        return [HasRolePermission("staff.manage"), RequiresSudo()]

    def post(self, request, pk):
        staff = generics.get_object_or_404(sessions.with_last_sign_in(StaffUser.objects.all()), pk=pk)
        manager_id = request.data.get("manager")
        if manager_id in (None, ""):
            staff.manager = None
        else:
            manager = generics.get_object_or_404(StaffUser, pk=manager_id, is_active=True)
            if not can_lead_team(manager):
                return Response({"detail": "Choose a manager who can lead a team."}, status=400)
            node = manager
            while node is not None:
                if node.pk == staff.pk:
                    return Response({"detail": "That would make someone their own manager."}, status=400)
                node = node.manager
            staff.manager = manager
        staff.save(update_fields=["manager"])
        # Their socket's permission and team groups are now wrong: reconnect.
        force_disconnect_on_commit(f"staff.{staff.pk}")
        return Response(StaffListSerializer(staff).data)


# ── Staff user-management (staff user-management tools) ─────────────────────
# Detail/edit + suspend/unsuspend for one customer or business owner. Reading
# the detail (GET) needs only users.view — the same permission as the lists,
# so a read-only role (support, scout) can open the View panel; every write
# (PATCH, suspend, unsuspend) stays on users.manage (admin/super_admin). Edit
# is a RetrieveUpdateAPIView (GET the full record, PATCH the correctable
# identity fields); suspend/unsuspend are dedicated actions that flip
# is_suspended and notify the affected account.


def _users_detail_permissions(request):
    if request.method in SAFE_METHODS:
        return [HasRolePermission("users.view")]
    return [HasRolePermission("users.manage")]


class StaffCustomerDetailView(generics.RetrieveUpdateAPIView):
    queryset = Customer.objects.all()
    serializer_class = StaffCustomerDetailSerializer
    http_method_names = ["get", "patch"]

    def get_permissions(self):
        return _users_detail_permissions(self.request)


class StaffBusinessOwnerDetailView(generics.RetrieveUpdateAPIView):
    queryset = BusinessOwner.objects.all()
    serializer_class = StaffBusinessOwnerDetailSerializer
    http_method_names = ["get", "patch"]

    def get_permissions(self):
        return _users_detail_permissions(self.request)

    def get_serializer_context(self):
        # Payout + TIN are users.manage-only, read off the same effective
        # permission set HasRolePermission enforces.
        context = super().get_serializer_context()
        context["can_see_payout"] = (
            "users.manage" in self.request.user.effective_permission_codenames()
        )
        return context


class StaffCustomerSuspendView(APIView):
    def get_permissions(self):
        return [HasRolePermission("users.manage")]

    def post(self, request, pk):
        customer = generics.get_object_or_404(Customer, pk=pk)
        customer.is_suspended = True
        customer.suspension_reason = request.data.get("reason", "") or ""
        customer.save(update_fields=["is_suspended", "suspension_reason"])
        notify_customer(
            customer, "account_suspended", "Your account has been suspended",
            body=customer.suspension_reason
            or "Your account has been suspended. Please contact AshantiHub support.",
            icon="🚫",
        )
        return Response({
            "id": customer.id,
            "is_suspended": customer.is_suspended,
            "suspension_reason": customer.suspension_reason,
        })


class StaffCustomerUnsuspendView(APIView):
    def get_permissions(self):
        return [HasRolePermission("users.manage")]

    def post(self, request, pk):
        customer = generics.get_object_or_404(Customer, pk=pk)
        customer.is_suspended = False
        customer.suspension_reason = ""
        customer.save(update_fields=["is_suspended", "suspension_reason"])
        notify_customer(
            customer, "account_reinstated", "Your account has been reinstated",
            body="Your account is active again — welcome back.",
            icon="✅",
        )
        return Response({"id": customer.id, "is_suspended": customer.is_suspended})


class StaffBusinessOwnerSuspendView(APIView):
    def get_permissions(self):
        return [HasRolePermission("users.manage")]

    def post(self, request, pk):
        owner = generics.get_object_or_404(BusinessOwner, pk=pk)
        owner.is_suspended = True
        owner.suspension_reason = request.data.get("reason", "") or ""
        owner.save(update_fields=["is_suspended", "suspension_reason"])
        notify_business_owner(
            owner, "account_suspended", "Your account has been suspended",
            body=owner.suspension_reason
            or "Your account has been suspended. Your listings and events are hidden. "
            "Please contact AshantiHub support.",
            icon="🚫",
        )
        return Response({
            "id": owner.id,
            "is_suspended": owner.is_suspended,
            "suspension_reason": owner.suspension_reason,
        })


class StaffBusinessOwnerUnsuspendView(APIView):
    def get_permissions(self):
        return [HasRolePermission("users.manage")]

    def post(self, request, pk):
        owner = generics.get_object_or_404(BusinessOwner, pk=pk)
        owner.is_suspended = False
        owner.suspension_reason = ""
        owner.save(update_fields=["is_suspended", "suspension_reason"])
        notify_business_owner(
            owner, "account_reinstated", "Your account has been reinstated",
            body="Your account is active again — your listings and events are visible.",
            icon="✅",
        )
        return Response({"id": owner.id, "is_suspended": owner.is_suspended})


# ── Staff account management (punch-list item 10) ──────────────────────────
# Suspend/reactivate and deactivate/reactivate one staffer, plus a per-staffer
# permission editor (item 9). All gated by staff.manage, the permission whose
# own description already promised "deactivate or reassign" with no backend
# behind it until now.


def _guard_self_action(request, staff):
    """A staffer must not be able to suspend, deactivate, or strip the
    permissions of their own account — that would either lock them out
    mid-request or, worse, let them climb out of a restriction. Returns a
    Response to short-circuit with, or None to proceed.
    """
    if request.user.id == staff.id:
        return Response(
            {"detail": "You cannot apply this action to your own account."}, status=400
        )
    return None


TEAM_OR_STAFF_MANAGE = ("staff.manage", "staff.invite_team")


def _guard_team_scope(request, staff):
    """A team manager may act only on their own direct reports."""
    if can_manage_staff(request.user):
        return None
    if (
        staff.manager_id == request.user.id
        and RoleInviteRule.objects.filter(inviter_role=request.user.role, invitee_role=staff.role).exists()
        and not can_manage_staff(staff)
    ):
        return None
    return Response({"detail": "You can only manage your own team."}, status=403)


class StaffSuspendView(APIView):
    def get_permissions(self):
        return [HasAnyRolePermission(*TEAM_OR_STAFF_MANAGE), RequiresSudo()]

    def post(self, request, pk):
        staff = generics.get_object_or_404(sessions.with_last_sign_in(StaffUser.objects.all()), pk=pk)
        guard = _guard_self_action(request, staff)
        if guard:
            return guard
        scope = _guard_team_scope(request, staff)
        if scope:
            return scope
        staff.is_suspended = True
        staff.suspension_reason = request.data.get("reason", "") or ""
        staff.save(update_fields=["is_suspended", "suspension_reason"])
        sessions.revoke_all(staff, StaffSession.SUSPENDED)
        return Response(StaffListSerializer(staff).data)


class StaffUnsuspendView(APIView):
    def get_permissions(self):
        return [HasAnyRolePermission(*TEAM_OR_STAFF_MANAGE)]

    def post(self, request, pk):
        staff = generics.get_object_or_404(sessions.with_last_sign_in(StaffUser.objects.all()), pk=pk)
        scope = _guard_team_scope(request, staff)
        if scope:
            return scope
        staff.is_suspended = False
        staff.suspension_reason = ""
        staff.save(update_fields=["is_suspended", "suspension_reason"])
        return Response(StaffListSerializer(staff).data)


class StaffDeactivateView(APIView):
    """Marks a staffer as no longer with the company. Distinct from suspend:
    no reason field, and it's the state used when someone leaves for good.
    Reversible via StaffReactivateView.
    """

    def get_permissions(self):
        return [HasRolePermission("staff.manage"), RequiresSudo()]

    def post(self, request, pk):
        staff = generics.get_object_or_404(sessions.with_last_sign_in(StaffUser.objects.all()), pk=pk)
        guard = _guard_self_action(request, staff)
        if guard:
            return guard
        active_reports = staff.direct_reports.filter(is_active=True).count()
        if active_reports:
            return Response(
                {"detail": f"Reassign {staff.full_name}'s {active_reports} direct report(s) first."},
                status=400,
            )
        # Spec §3: a scout's portfolio is reassigned before they leave.
        # Rejected businesses appear in no portfolio list, so they can't be reassigned.
        managed = staff.managed_businesses.exclude(kyc_status=BusinessOwner.REJECTED).count()
        if managed:
            noun = "business" if managed == 1 else "businesses"
            return Response({"detail": f"Reassign {staff.full_name}'s {managed} {noun} first."}, status=400)
        staff.is_active = False
        staff.save(update_fields=["is_active"])
        sessions.revoke_all(staff, StaffSession.DEACTIVATED)
        return Response(StaffListSerializer(staff).data)


class StaffReactivateView(APIView):
    def get_permissions(self):
        return [HasRolePermission("staff.manage"), RequiresSudo()]

    def post(self, request, pk):
        staff = generics.get_object_or_404(sessions.with_last_sign_in(StaffUser.objects.all()), pk=pk)
        staff.is_active = True
        staff.save(update_fields=["is_active"])
        return Response(StaffListSerializer(staff).data)


class StaffPermissionsView(APIView):
    """POST /api/accounts/staff/{id}/permissions/ — set a staffer's per-user
    permission overrides (item 9). Body: {"grant": [codename, ...],
    "revoke": [codename, ...]} — the full desired override sets, not deltas,
    so an empty list clears that side. Unknown codenames 400 rather than being
    silently dropped, so a typo in the editor surfaces.
    """

    def get_permissions(self):
        return [HasRolePermission("staff.manage"), RequiresSudo()]

    def post(self, request, pk):
        staff = generics.get_object_or_404(sessions.with_last_sign_in(StaffUser.objects.all()), pk=pk)
        guard = _guard_self_action(request, staff)
        if guard:
            return guard

        grant_codes = request.data.get("grant", []) or []
        revoke_codes = request.data.get("revoke", []) or []
        overlap = set(grant_codes) & set(revoke_codes)
        if overlap:
            return Response(
                {"detail": f"A permission cannot be both granted and revoked: {', '.join(sorted(overlap))}."},
                status=400,
            )

        grant_perms = list(Permission.objects.filter(codename__in=grant_codes))
        revoke_perms = list(Permission.objects.filter(codename__in=revoke_codes))
        missing = (set(grant_codes) | set(revoke_codes)) - {
            p.codename for p in grant_perms + revoke_perms
        }
        if missing:
            return Response(
                {"detail": f"Unknown permission(s): {', '.join(sorted(missing))}."}, status=400
            )

        staff.extra_permissions.set(grant_perms)
        staff.revoked_permissions.set(revoke_perms)
        # Their socket's permission and team groups are now wrong: reconnect.
        force_disconnect_on_commit(f"staff.{staff.pk}")
        return Response(StaffListSerializer(staff).data)


class PermissionCatalogView(APIView):
    """GET /api/accounts/permissions/ — every assignable permission with its
    description, so the per-staffer editor can render the full checklist. Also
    reports which codenames the staffer's role already grants, so the UI can
    show role-granted vs individually-granted vs revoked without recomputing.
    Gated by staff.manage (same as the editor that consumes it).
    """

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def get(self, request):
        permissions = Permission.objects.all().order_by("codename")
        return Response(
            [{"codename": p.codename, "description": p.description} for p in permissions]
        )


# ── Sessions & devices, password re-entry (staff foundations F9) ────────────


def _session_context(request):
    return {"current_session": sessions.current(request)}


class StaffReauthView(APIView):
    """Re-enter your password ("sudo"): unlocks sensitive actions on this
    session for 10 minutes."""

    throttle_scope = "login"

    def get_permissions(self):
        return [IsStaff()]

    def post(self, request):
        if not check_password(request.data.get("password") or "", request.user.password_hash):
            return Response({"password": ["That password isn't right."]}, status=400)
        return Response({"sudo_until": sessions.grant_sudo(sessions.current(request))})


class StaffSessionListView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        staff = request.user
        other = request.query_params.get("staff")
        if other:
            if not can_manage_staff(request.user):
                return Response({"detail": "You need the staff management permission to see other people's sessions."}, status=403)
            if not (other.isdecimal() and other.isascii()):
                return Response({"staff": "Use a staff id."}, status=400)
            staff = generics.get_object_or_404(StaffUser, pk=other)
        rows = StaffSession.objects.filter(staff=staff).select_related("staff__role")[:50]
        return Response(StaffSessionSerializer(rows, many=True, context=_session_context(request)).data)


class StaffActiveSessionsView(APIView):
    """Everyone signed in now (Super Admin's Sessions & devices)."""

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def get(self, request):
        rows = (
            sessions.live(StaffSession.objects.filter(staff__is_active=True, staff__is_suspended=False))
            .select_related("staff__role")
            .order_by("staff__full_name", "-last_seen_at")
        )
        return Response(StaffSessionSerializer(rows, many=True, context=_session_context(request)).data)


class StaffSessionEndView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def post(self, request, pk):
        scope = StaffSession.objects.all() if can_manage_staff(request.user) else StaffSession.objects.filter(staff=request.user)
        session = generics.get_object_or_404(scope.select_related("staff__role"), pk=pk)
        sessions.revoke(session, StaffSession.ENDED)
        session.refresh_from_db()
        return Response(StaffSessionSerializer(session, context=_session_context(request)).data)


class StaffEndOtherSessionsView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def post(self, request):
        ended = sessions.revoke_all(request.user, StaffSession.ENDED, except_session=sessions.current(request))
        return Response({"ended": ended})


class StaffSignOutEverywhereView(APIView):
    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def post(self, request, pk):
        staff = generics.get_object_or_404(StaffUser, pk=pk)
        guard = _guard_self_action(request, staff)
        if guard:
            return guard
        return Response({"ended": sessions.revoke_all(staff, StaffSession.SIGNED_OUT_EVERYWHERE)})


# ── Scout field verification (punch-list item 11) ──────────────────────────
class ScoutAssignmentListCreateView(generics.ListCreateAPIView):
    """GET/POST /api/accounts/scout-assignments/ — an admin (scouts.assign)
    lists every assignment and assigns a scout to a business. POST body:
    {business_owner, scout}.
    """

    serializer_class = ScoutAssignmentSerializer

    def get_permissions(self):
        return [HasRolePermission("scouts.assign")]

    def get_queryset(self):
        return ScoutAssignment.objects.select_related(
            "business_owner", "business_owner__profile", "scout", "assigned_by"
        )

    def post(self, request):
        business_owner_id = request.data.get("business_owner")
        scout_id = request.data.get("scout")
        owner = generics.get_object_or_404(BusinessOwner, pk=business_owner_id)
        scout = generics.get_object_or_404(StaffUser, pk=scout_id)
        if scout.role.name != "scout":
            return Response({"scout": "That staff member is not a scout."}, status=400)
        assignment, created = ScoutAssignment.objects.get_or_create(
            business_owner=owner, scout=scout,
            defaults={"assigned_by": request.user},
        )
        if not created:
            return Response({"detail": "That scout is already assigned to this business."}, status=400)
        return Response(ScoutAssignmentSerializer(assignment).data, status=201)


class ScoutListView(generics.ListAPIView):
    """GET /api/accounts/scouts/ — active scout staff, so the assign UI can
    pick one. Gated by scouts.assign (only the assigner needs it).
    """

    serializer_class = StaffListSerializer

    def get_permissions(self):
        return [HasRolePermission("scouts.assign")]

    def get_queryset(self):
        return sessions.with_last_sign_in(
            StaffUser.objects.filter(role__name="scout", is_active=True, is_suspended=False)
        ).order_by("full_name")


class MyScoutAssignmentsView(generics.ListAPIView):
    """GET /api/accounts/scout-assignments/mine/ — the scout's own queue."""

    serializer_class = ScoutAssignmentSerializer

    def get_permissions(self):
        return [HasRolePermission("scouts.verify")]

    def get_queryset(self):
        return ScoutAssignment.objects.filter(scout=self.request.user).select_related(
            "business_owner", "business_owner__profile", "assigned_by"
        )


class ScoutVerifyView(APIView):
    """POST /api/accounts/scout-assignments/{id}/verify/ — the scout submits
    their field report (scouts.verify). Body: {address_confirmed,
    corrected_address, business_legitimate, details_correct, notes}.

    Recording the report writes the business's Ghana Post verification onto
    BusinessOwnerProfile (address_verified/_by/_at) — the exact fields the KYC
    Approve/Reject gate reads — so a scout's field visit satisfies that gate
    just like a desk staffer's own toggle does ("either can verify", item 8).
    If the scout marks the stated address wrong and supplies a correction, the
    profile's gps_address is updated to the corrected value.
    """

    def get_permissions(self):
        return [HasRolePermission("scouts.verify")]

    def post(self, request, pk):
        assignment = generics.get_object_or_404(
            ScoutAssignment, pk=pk, scout=request.user
        )
        address_confirmed = request.data.get("address_confirmed")
        if address_confirmed is None:
            return Response(
                {"address_confirmed": "Say whether the Ghana Post address was correct."},
                status=400,
            )
        corrected = (request.data.get("corrected_address") or "").strip()

        now = timezone.now()
        assignment.status = ScoutAssignment.VISITED
        assignment.address_confirmed = bool(address_confirmed)
        assignment.corrected_address = corrected
        assignment.business_legitimate = request.data.get("business_legitimate")
        assignment.details_correct = request.data.get("details_correct")
        assignment.notes = (request.data.get("notes") or "").strip()
        assignment.visited_at = now
        assignment.save()

        # Write the KYC-gate fields onto the profile (auto-created at
        # registration, so it exists for any real business).
        profile = getattr(assignment.business_owner, "profile", None)
        if profile is not None:
            profile.address_verified = bool(address_confirmed)
            profile.address_verified_by = request.user
            profile.address_verified_at = now
            update_fields = ["address_verified", "address_verified_by", "address_verified_at"]
            if not address_confirmed and corrected:
                profile.gps_address = corrected
                update_fields.append("gps_address")
            profile.save(update_fields=update_fields)

        return Response(ScoutAssignmentSerializer(assignment).data)


class IsBusinessOwner(BasePermission):
    def has_permission(self, request, view):
        return isinstance(request.user, BusinessOwner)


class IsCustomer(BasePermission):
    def has_permission(self, request, view):
        return isinstance(request.user, Customer)


class PayoutDetailUpdateView(generics.UpdateAPIView):
    serializer_class = PayoutDetailSerializer
    permission_classes = [IsBusinessOwner]
    http_method_names = ["patch"]

    def get_object(self):
        return self.request.user.profile


class BusinessOwnerProfileUpdateView(generics.RetrieveUpdateAPIView):
    serializer_class = BusinessOwnerProfileUpdateSerializer
    permission_classes = [IsBusinessOwner]
    http_method_names = ["get", "patch"]

    def get_object(self):
        return self.request.user.profile


class CustomerProfileUpdateView(generics.RetrieveUpdateAPIView):
    serializer_class = CustomerProfileSerializer
    permission_classes = [IsCustomer]
    http_method_names = ["get", "patch"]

    def get_object(self):
        return self.request.user


# Secondary email/phone verification (user_account_dashboard work) — each is
# a two-step request/confirm pair mirroring StaffActivateSerializer's
# invite-token shape above, just with a 6-digit code instead of a long random
# token. Real email transport now exists (accounts/emails.py) — the email
# variant below sends the code via send_verification_code_email rather than
# returning it in the response. No SMS transport exists (see CLAUDE.md's
# notes on Hubtel payments/AI messaging both being simulated), so the phone
# variant still returns the code directly in its response — clearly labeled
# `demo_code` — rather than silently pretending to deliver it.
class CustomerSecondaryEmailRequestView(generics.GenericAPIView):
    serializer_class = CustomerSecondaryEmailRequestSerializer
    permission_classes = [IsCustomer]

    def post(self, request):
        serializer = self.get_serializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        customer = serializer.save()
        send_verification_code_email(customer.secondary_email, customer.secondary_email_verify_code)
        return Response({
            "secondary_email": customer.secondary_email,
            "expires_in_minutes": 10,
        })


class CustomerSecondaryEmailConfirmView(generics.GenericAPIView):
    serializer_class = CustomerSecondaryEmailConfirmSerializer
    permission_classes = [IsCustomer]

    def post(self, request):
        serializer = self.get_serializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        customer = serializer.save()
        return Response({"secondary_email": customer.secondary_email, "secondary_email_verified": True})


class CustomerSecondaryPhoneRequestView(generics.GenericAPIView):
    serializer_class = CustomerSecondaryPhoneRequestSerializer
    permission_classes = [IsCustomer]

    def post(self, request):
        serializer = self.get_serializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        customer = serializer.save()
        return Response({
            "secondary_phone": customer.secondary_phone,
            "demo_code": customer.secondary_phone_verify_code,
            "expires_in_minutes": 10,
        })


class CustomerSecondaryPhoneConfirmView(generics.GenericAPIView):
    serializer_class = CustomerSecondaryPhoneConfirmSerializer
    permission_classes = [IsCustomer]

    def post(self, request):
        serializer = self.get_serializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        customer = serializer.save()
        return Response({"secondary_phone": customer.secondary_phone, "secondary_phone_verified": True})


class TermsAcceptView(APIView):
    permission_classes = [IsBusinessOwner]

    def post(self, request):
        owner = request.user
        if owner.compute_registration_step() != "terms":
            return Response(
                {"registration_step": "Business and payment information must be complete before accepting terms."},
                status=400,
            )
        profile = owner.profile
        profile.terms_accepted_at = timezone.now()
        profile.save(update_fields=["terms_accepted_at"])
        # Registration is now complete — the owner enters the KYC review queue.
        notify_staff_role(
            "kyc.approve", "kyc_needs_approval", "New KYC submission",
            body=f"{owner.full_name} has completed registration and needs KYC review.",
            link="kyc", icon="🪪",
        )
        return Response({"registration_step": owner.compute_registration_step()})


# ── 2-step sign-in (staff foundations F9) ───────────────────────────────────


class StaffLoginTwoFactorView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "two_factor"

    def post(self, request):
        body = _body(request)
        account = two_factor.read_challenge(body.get("mfa_token"), two_factor.VERIFY)
        if account is None:
            return Response({"detail": TIMED_OUT, "code": "challenge_expired"}, status=400)
        if two_factor.too_many_failures(account):
            minutes = int(two_factor.FAILURE_WINDOW.total_seconds() // 60)
            return Response(
                {"detail": f"Too many wrong codes. Wait {minutes} minutes, then sign in again."}, status=400
            )
        recovery_code = body.get("recovery_code")
        code = body.get("code")
        try:
            if recovery_code:
                ok = _text(recovery_code) is not None and two_factor.use_recovery_code(account, recovery_code)
            else:
                ok = _text(code) is not None and two_factor.verify(account, code)
        except two_factor.SecretUnreadable:
            return Response({"detail": UNREADABLE}, status=400)
        if not ok:
            record_activity(account, two_factor.FAILED_VERB, target=account, method="POST", request=request)
            return Response({"detail": WRONG_CODE}, status=400)
        if recovery_code:
            left = two_factor.status(account)["recovery_codes_left"]
            _email_after_commit(account, f"A recovery code was used to sign in. {left} recovery codes are left.")
        return Response(_staff_sign_in_response(account, request, two_factor_used=True))


class StaffTwoFactorEnrolStartView(APIView):
    """Set-up during sign-in, for a Super Admin without 2-step yet."""

    permission_classes = [AllowAny]
    throttle_scope = "two_factor"

    def post(self, request):
        account = two_factor.read_challenge(_body(request).get("mfa_token"), two_factor.ENROL)
        if account is None:
            return Response({"detail": TIMED_OUT, "code": "challenge_expired"}, status=400)
        secret, uri = two_factor.begin_enrolment(account)
        return Response({"secret": secret, "otpauth_uri": uri})


class StaffTwoFactorEnrolConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "two_factor"

    def post(self, request):
        account = two_factor.read_challenge(_body(request).get("mfa_token"), two_factor.ENROL)
        if account is None:
            return Response({"detail": TIMED_OUT, "code": "challenge_expired"}, status=400)
        try:
            codes = two_factor.confirm_enrolment(account, _text(_body(request).get("code")))
        except two_factor.SecretUnreadable:
            return Response({"detail": UNREADABLE}, status=400)
        if codes is None:
            return Response({"detail": "That code isn't right. Check the app shows AshantiHub and try again."}, status=400)
        _email_after_commit(account, "2-step sign-in was turned on for your account.")
        record_activity(account, "staff.two_factor_enabled", target=account, method="POST", request=request)
        return Response({**_staff_sign_in_response(account, request, two_factor_used=True), "recovery_codes": codes})


class StaffTwoFactorStatusView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        return Response(two_factor.status(request.user))


class StaffTwoFactorSetupView(APIView):
    throttle_scope = "two_factor"

    def get_permissions(self):
        return [IsStaff(), RequiresSudo()]

    def post(self, request):
        secret, uri = two_factor.begin_enrolment(request.user)
        return Response({"secret": secret, "otpauth_uri": uri})


class StaffTwoFactorSetupConfirmView(APIView):
    throttle_scope = "two_factor"

    def get_permissions(self):
        return [IsStaff()]

    def post(self, request):
        try:
            codes = two_factor.confirm_enrolment(request.user, _text(_body(request).get("code")))
        except two_factor.SecretUnreadable:
            return Response({"detail": UNREADABLE}, status=400)
        if codes is None:
            return Response({"detail": "That code isn't right. Check the app shows AshantiHub and try again."}, status=400)
        record_activity(request.user, "staff.two_factor_enabled", target=request.user, method="POST", request=request)
        _email_after_commit(request.user, "2-step sign-in was set up on a phone for your account.")
        return Response({"recovery_codes": codes})


class StaffRecoveryCodesView(APIView):
    throttle_scope = "two_factor"

    def get_permissions(self):
        return [IsStaff(), RequiresSudo()]

    def post(self, request):
        codes = two_factor.regenerate_recovery_codes(request.user)
        if codes is None:
            return Response({"detail": "Turn on 2-step sign-in first."}, status=400)
        record_activity(request.user, "staff.recovery_codes_renewed", target=request.user, method="POST", request=request)
        return Response({"recovery_codes": codes})


class StaffTwoFactorDisableView(APIView):
    throttle_scope = "two_factor"

    def get_permissions(self):
        return [IsStaff(), RequiresSudo()]

    def post(self, request):
        if two_factor.is_required(request.user):
            return Response({"detail": "2-step sign-in can't be turned off for a Super Admin."}, status=400)
        two_factor.disable(request.user)
        record_activity(request.user, "staff.two_factor_disabled", target=request.user, method="POST", request=request)
        _email_after_commit(request.user, "2-step sign-in was turned off for your account.")
        return Response(status=status.HTTP_204_NO_CONTENT)


class StaffTwoFactorResetView(APIView):
    """A Super Admin resets someone who lost their phone and codes."""

    throttle_scope = "two_factor"

    def get_permissions(self):
        return [HasRolePermission("staff.manage"), RequiresSudo()]

    def post(self, request, pk):
        staff = generics.get_object_or_404(StaffUser, pk=pk)
        guard = _guard_self_action(request, staff)
        if guard:
            return guard
        two_factor.disable(staff)
        record_activity(request.user, "staff.two_factor_reset", target=staff, method="POST", request=request)
        _email_after_commit(staff, f"{request.user.full_name} reset your 2-step sign-in.")
        return Response(status=status.HTTP_204_NO_CONTENT)
