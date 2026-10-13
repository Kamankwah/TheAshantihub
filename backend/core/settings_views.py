"""Super Admin Settings screens that only read: Integrations, System health and
the prices that are fixed in code."""
from decimal import Decimal

from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission

from . import integrations, later_phase, system_health

VIEW = "system.view"


class IntegrationsView(APIView):
    """GET /api/integrations/ — status only, never a key."""

    def get_permissions(self):
        return [HasRolePermission(VIEW)]

    def get(self, request):
        return Response({"items": integrations.statuses()})


class SystemHealthView(APIView):
    """GET /api/system-health/ — measured checks, job heartbeats, and what is not reported."""

    def get_permissions(self):
        return [HasRolePermission(VIEW)]

    def get(self, request):
        return Response(system_health.report())


class PromotionPricesView(APIView):
    """GET /api/promotion-prices/ — the per-day listing promotion prices, read
    from the code constants that charge them (there is no price record to edit)."""

    def get_permissions(self):
        return [HasRolePermission(VIEW)]

    def get(self, request):
        from listings.models import Promotion
        from listings.views import PROMOTION_DAILY_RATES

        labels = {Promotion.FEATURED: "Featured", Promotion.BOOST: "Boost"}
        return Response({
            "set_in_code": True,
            "items": [{"kind": kind, "label": labels.get(kind, kind), "per_day": str(Decimal(rate).quantize(Decimal("0.01")))} for kind, rate in PROMOTION_DAILY_RATES.items()],
        })


class PayoutsOverviewView(APIView):
    """GET /api/payouts-overview/ — the few payout-like records that exist (commission
    lines by status, ticket money held/released/refunded). Nothing else is invented."""

    def get_permissions(self):
        return [HasRolePermission("commission.view_all")]

    def get(self, request):
        return Response(later_phase.payouts_overview())
