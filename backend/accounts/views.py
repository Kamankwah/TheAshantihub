from django.conf import settings
from django.utils import timezone
from django.utils.crypto import get_random_string
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from notifications.services import notify_business_owner, notify_customer, notify_staff_role

from .authentication import issue_token
from .emails import send_staff_invite_email, send_verification_code_email
from .models import BusinessOwner, Customer, Permission, StaffUser
from .permissions import HasRolePermission
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
    StaffActivateSerializer,
    StaffBusinessOwnerDetailSerializer,
    StaffCustomerDetailSerializer,
    StaffInviteSerializer,
    StaffListSerializer,
    StaffLoginSerializer,
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
        return [HasRolePermission("staff.manage")]


class StaffActivateView(generics.GenericAPIView):
    serializer_class = StaffActivateSerializer
    permission_classes = [AllowAny]
    throttle_scope = "staff_activate"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        staff = serializer.save()
        return Response({"status": "activated", "token": issue_token(staff, "staff")})


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
        return [HasRolePermission("staff.manage")]

    def post(self, request, pk):
        staff = generics.get_object_or_404(StaffUser, pk=pk)
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


class StaffLoginView(generics.GenericAPIView):
    serializer_class = StaffLoginSerializer
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = serializer.account
        return Response({
            "token": issue_token(account, "staff"),
            "account_type": "staff",
            "id": account.id,
            "full_name": account.full_name,
            "role": account.role.name,
            "permissions": sorted(account.effective_permission_codenames()),
        })


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
        queryset = BusinessOwner.objects.filter(kyc_status=kyc_status)
        # Pending: oldest-first (a work queue). Approved/Rejected: most-recently
        # actioned first (a history), falling back to created_at for legacy
        # rows actioned before reviewed_at existed.
        if kyc_status == BusinessOwner.PENDING:
            return queryset.order_by("created_at")
        return queryset.order_by("-reviewed_at", "-created_at")


class KYCDetailView(generics.RetrieveAPIView):
    queryset = BusinessOwner.objects.all()
    serializer_class = BusinessOwnerKYCDetailSerializer

    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]


class KYCApproveView(APIView):
    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]

    def post(self, request, pk):
        owner = generics.get_object_or_404(BusinessOwner, pk=pk)
        owner.kyc_status = BusinessOwner.VERIFIED
        owner.kyc_rejection_reason = None
        owner.reviewed_by = request.user
        owner.reviewed_at = timezone.now()
        owner.save(update_fields=["kyc_status", "kyc_rejection_reason", "reviewed_by", "reviewed_at"])
        notify_business_owner(
            owner, "kyc_approved", "Your business is verified!",
            body="Your KYC has been approved — you can now publish listings.",
            link="/business-dashboard", icon="✅",
        )
        return Response({"id": owner.id, "kyc_status": owner.kyc_status})


class KYCRejectView(APIView):
    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]

    def post(self, request, pk):
        reason = request.data.get("reason", "")
        owner = generics.get_object_or_404(BusinessOwner, pk=pk)
        owner.kyc_status = BusinessOwner.REJECTED
        owner.kyc_rejection_reason = reason
        owner.reviewed_by = request.user
        owner.reviewed_at = timezone.now()
        owner.save(update_fields=["kyc_status", "kyc_rejection_reason", "reviewed_by", "reviewed_at"])
        notify_business_owner(
            owner, "kyc_rejected", "Your KYC needs attention",
            body=reason or "Your KYC submission was rejected. Please review and resubmit.",
            link="/business-dashboard", icon="⚠️",
        )
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
    queryset = StaffUser.objects.all().order_by("-created_at")
    pagination_class = AccountsPagination

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]


# ── Staff user-management (staff user-management tools) ─────────────────────
# Detail/edit + suspend/unsuspend for one customer or business owner, all
# gated by the users.manage permission (seeded onto admin/super_admin). Edit
# is a RetrieveUpdateAPIView (GET the full record, PATCH the correctable
# identity fields); suspend/unsuspend are dedicated actions that flip
# is_suspended and notify the affected account.


class StaffCustomerDetailView(generics.RetrieveUpdateAPIView):
    queryset = Customer.objects.all()
    serializer_class = StaffCustomerDetailSerializer
    http_method_names = ["get", "patch"]

    def get_permissions(self):
        return [HasRolePermission("users.manage")]


class StaffBusinessOwnerDetailView(generics.RetrieveUpdateAPIView):
    queryset = BusinessOwner.objects.all()
    serializer_class = StaffBusinessOwnerDetailSerializer
    http_method_names = ["get", "patch"]

    def get_permissions(self):
        return [HasRolePermission("users.manage")]


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


class StaffSuspendView(APIView):
    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def post(self, request, pk):
        staff = generics.get_object_or_404(StaffUser, pk=pk)
        guard = _guard_self_action(request, staff)
        if guard:
            return guard
        staff.is_suspended = True
        staff.suspension_reason = request.data.get("reason", "") or ""
        staff.save(update_fields=["is_suspended", "suspension_reason"])
        return Response(StaffListSerializer(staff).data)


class StaffUnsuspendView(APIView):
    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def post(self, request, pk):
        staff = generics.get_object_or_404(StaffUser, pk=pk)
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
        return [HasRolePermission("staff.manage")]

    def post(self, request, pk):
        staff = generics.get_object_or_404(StaffUser, pk=pk)
        guard = _guard_self_action(request, staff)
        if guard:
            return guard
        staff.is_active = False
        staff.save(update_fields=["is_active"])
        return Response(StaffListSerializer(staff).data)


class StaffReactivateView(APIView):
    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def post(self, request, pk):
        staff = generics.get_object_or_404(StaffUser, pk=pk)
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
        return [HasRolePermission("staff.manage")]

    def post(self, request, pk):
        staff = generics.get_object_or_404(StaffUser, pk=pk)
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
