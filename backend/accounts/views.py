from django.utils import timezone
from django.utils.crypto import get_random_string
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import issue_token
from .models import BusinessOwner, Customer, StaffUser
from .permissions import HasRolePermission
from .serializers import (
    INVITE_TOKEN_LIFETIME,
    BusinessOwnerKYCDetailSerializer,
    BusinessOwnerKYCSerializer,
    BusinessOwnerLoginSerializer,
    BusinessOwnerRegistrationSerializer,
    BusinessOwnerProfileUpdateSerializer,
    CustomerLoginSerializer,
    CustomerRegistrationSerializer,
    PayoutDetailSerializer,
    StaffActivateSerializer,
    StaffInviteSerializer,
    StaffLoginSerializer,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    token = request.auth
    return Response({
        "account_type": token["account_type"],
        "id": request.user.id,
        "full_name": request.user.full_name,
    })


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
    parser_classes = [MultiPartParser, FormParser]
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
        })


class KYCPendingQueueView(generics.ListAPIView):
    serializer_class = BusinessOwnerKYCSerializer
    queryset = BusinessOwner.objects.filter(kyc_status=BusinessOwner.PENDING).order_by("created_at")

    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]


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
        owner.save(update_fields=["kyc_status", "kyc_rejection_reason"])
        return Response({"id": owner.id, "kyc_status": owner.kyc_status})


class KYCRejectView(APIView):
    def get_permissions(self):
        return [HasRolePermission("kyc.approve")]

    def post(self, request, pk):
        reason = request.data.get("reason", "")
        owner = generics.get_object_or_404(BusinessOwner, pk=pk)
        owner.kyc_status = BusinessOwner.REJECTED
        owner.kyc_rejection_reason = reason
        owner.save(update_fields=["kyc_status", "kyc_rejection_reason"])
        return Response({"id": owner.id, "kyc_status": owner.kyc_status})


class IsBusinessOwner(BasePermission):
    def has_permission(self, request, view):
        return isinstance(request.user, BusinessOwner)


class PayoutDetailUpdateView(generics.UpdateAPIView):
    serializer_class = PayoutDetailSerializer
    permission_classes = [IsBusinessOwner]
    http_method_names = ["patch"]

    def get_object(self):
        return self.request.user.profile


class BusinessOwnerProfileUpdateView(generics.UpdateAPIView):
    serializer_class = BusinessOwnerProfileUpdateSerializer
    permission_classes = [IsBusinessOwner]
    http_method_names = ["patch"]

    def get_object(self):
        return self.request.user.profile
