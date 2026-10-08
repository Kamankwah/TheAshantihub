from django.db import transaction
from django.db.models import Count
from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasAnyRolePermission, HasRolePermission

from . import services
from .models import FraudFlag
from .serializers import FraudFlagCreateSerializer, FraudFlagSerializer

MANAGE = "fraud.manage"
FLAG = "fraud.flag"
STATUSES = (FraudFlag.OPEN, FraudFlag.CONFIRMED, FraudFlag.DISMISSED)


def visible_flags(user):
    """Every case for a fraud.manage holder (Operations, Super Admin); only the
    cases they raised for someone who can only flag (Support)."""
    flags = FraudFlag.objects.select_related(
        "business_owner__profile", "business_owner__account_manager", "related_business_owner__profile",
        "staff_subject", "raised_by", "resolved_by",
    )
    if MANAGE in user.effective_permission_codenames():
        return flags
    return flags.filter(raised_by=user)


def _text(value):
    return str(value or "").strip()


def _truthy(value):
    return value is True or str(value).strip().lower() in ("true", "1", "yes", "on")


class FraudPagination(PageNumberPagination):
    page_size = 25


class FraudFlagListCreateView(generics.ListCreateAPIView):
    serializer_class = FraudFlagSerializer
    pagination_class = FraudPagination

    def get_permissions(self):
        return [HasAnyRolePermission(MANAGE, FLAG)]

    def get_queryset(self):
        params = self.request.query_params
        wanted = params.get("status", FraudFlag.OPEN)
        if wanted not in STATUSES:  # the moderated-queue convention: unknown falls back to open
            wanted = FraudFlag.OPEN
        flags = visible_flags(self.request.user).filter(status=wanted)
        if params.get("kind"):
            flags = flags.filter(kind=params["kind"])
        return flags

    def create(self, request, *args, **kwargs):
        serializer = FraudFlagCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            flag = services.raise_flag(
                data["kind"], title=data["title"], detail=data["detail"], business_owner=data["business_owner"],
                raised_by=request.user, source=FraudFlag.STAFF, record_event=False,
            )
            services.record_raised(flag, request=request)
        flag = visible_flags(request.user).get(pk=flag.pk)
        return Response(FraudFlagSerializer(flag, context=self.get_serializer_context()).data, status=201)


class FraudFlagCountsView(APIView):
    def get_permissions(self):
        return [HasAnyRolePermission(MANAGE, FLAG)]

    def get(self, request):
        by_status = dict(
            visible_flags(request.user).order_by().values_list("status").annotate(total=Count("id"))
        )
        return Response({status: by_status.get(status, 0) for status in STATUSES})


class _DecisionView(APIView):
    def get_permissions(self):
        return [HasRolePermission(MANAGE)]

    def decide(self, pk, request, data):
        raise NotImplementedError

    def post(self, request, pk):
        data = request.data if hasattr(request.data, "get") else {}
        generics.get_object_or_404(FraudFlag, pk=pk)
        try:
            flag = self.decide(pk, request, data)
        except services.FraudError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        flag = visible_flags(request.user).get(pk=flag.pk)
        return Response(FraudFlagSerializer(flag, context={"request": request}).data)


class FraudFlagConfirmView(_DecisionView):
    def decide(self, pk, request, data):
        return services.confirm(
            pk, request.user, note=_text(data.get("note")), suspend=_truthy(data.get("suspend")), http_request=request,
        )


class FraudFlagDismissView(_DecisionView):
    def decide(self, pk, request, data):
        return services.dismiss(pk, request.user, note=_text(data.get("note")), http_request=request)
