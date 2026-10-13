"""Auto-assign rules, delivery time limits and the rate card (permission ``delivery.rates`` to read and propose;
a Super Admin approves through the approvals inbox, or applies at once when proposing). Nothing is edited in
place: every change is a new version, the old one marked replaced."""
from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role
from accounts.permissions import HasAnyRolePermission, HasRolePermission
from approvals import services as approvals
from approvals.models import ApprovalRequest

from . import config, rates, services
from .models import AutoAssignRules, ConfigVersion, RateCard, TimeLimits, VEHICLE_TYPES

PERMISSION = "delivery.rates"


class RatesView(APIView):
    """Base: reading is for the proposer and for Super Admin (who holds every permission)."""

    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]


def history(model, shaper, limit=15):
    return [shaper(r) for r in model.objects.select_related("proposed_by", "approved_by").order_by("-version")[:limit]]


class _ConfigView(RatesView):
    kind = model = shape = cleaner = title = None

    def get(self, request):
        current = config.live(self.model)
        return Response({
            "current": self.shape(current), "pending": config.pending(self.kind), "history": history(self.model, self.shape),
            **self.extra(request, current),
        })

    def extra(self, request, current):
        return {}

    def post(self, request):
        """Propose new values. A Super Admin's own proposal applies at once (and is recorded)."""
        values = request.data.get("values") if isinstance(request.data.get("values"), dict) else request.data
        try:
            cleaned = self.cleaner(values)
        except config.ConfigError as exc:
            return Response({"detail": exc.message, "field": exc.field}, status=400)
        try:
            approval = config.propose(request.user, self.kind, cleaned, title=self.title, note=str(request.data.get("note", "")), request=request)
        except config.ConfigError as exc:
            return Response({"detail": exc.message}, status=409)
        except approvals.ApprovalError as exc:
            return Response({"detail": exc.message}, status=getattr(exc, "status_code", 400))
        return Response({"approval_id": approval.pk, "status": approval.status, "applied": approval.status == ApprovalRequest.APPROVED}, status=201)


class AutoAssignRulesView(_ConfigView):
    kind, model, shape, cleaner, title = config.AUTO_ASSIGN, AutoAssignRules, staticmethod(config.rules_dict), staticmethod(config.clean_rules), "Auto-assign rules"

    def extra(self, request, current):
        from .models import DeliverySettings

        row = DeliverySettings.get()
        return {"effective": {k: str(v) for k, v in config.effective_rules().items()}, "switch": {"on": row.auto_assign_on}, "defaults": config.RULE_DEFAULTS}


class TimeLimitsView(_ConfigView):
    kind, model, shape, cleaner, title = config.TIME_LIMITS, TimeLimits, staticmethod(config.limits_dict), staticmethod(config.clean_limits), "Delivery time limits"

    def extra(self, request, current):
        from datetime import datetime, timedelta

        from django.utils import timezone

        from orders.models import DeliveryAssignment

        since = timezone.now() - timedelta(days=30)
        done = DeliveryAssignment.objects.filter(delivered_at__gte=since, deadline_at__isnull=False)
        total = done.count()
        from django.db.models import F

        return {"met_30d": {"met": done.filter(delivered_at__lte=F("deadline_at")).count(), "of": total}, "defaults": config.LIMIT_DEFAULTS}


class RateCardView(_ConfigView):
    kind, model, shape, cleaner, title = config.RATE_CARD, RateCard, staticmethod(config.rate_dict), staticmethod(config.clean_rate_card), "Delivery rate card"

    def extra(self, request, current):
        return {
            "vehicle_types": [{"value": v, "label": l} for v, l in VEHICLE_TYPES],
            "fee_charging": {"enabled": bool(settings.DELIVERY_FEE_ENABLED), "note": "Customers are charged a delivery fee only when delivery fees are switched on. That is a separate decision."},
            "distance_basis": rates.BASIS,
        }


class WithdrawView(RatesView):
    """POST rates/withdraw/ {approval_id} — the proposer takes a waiting change back."""

    def post(self, request):
        approval = get_object_or_404(ApprovalRequest, pk=request.data.get("approval_id"), maker=request.user, status=ApprovalRequest.PENDING,
                                     kind__in=[config.AUTO_ASSIGN, config.TIME_LIMITS, config.RATE_CARD])
        try:
            approvals.cancel(approval.pk, request.user, http_request=request)
        except approvals.ApprovalError as exc:
            return Response({"detail": exc.message}, status=400)
        return Response({"ok": True})


class QuoteView(RatesView):
    """POST rate-card/quote/ — "try a route": the fee and the rider's pay for a distance, under the live card or the
    values being proposed. A calculation only; nothing is stored."""

    def post(self, request):
        data = request.data
        try:
            km = float(data.get("km"))
            if not 0 < km <= 200:
                raise ValueError
        except (TypeError, ValueError):
            return Response({"detail": "Enter a distance in km between 0 and 200.", "field": "km"}, status=400)
        if isinstance(data.get("values"), dict):
            try:
                values = config.clean_rate_card(data["values"])
            except config.ConfigError as exc:
                return Response({"detail": exc.message, "field": exc.field}, status=400)
            card = RateCard(**{k: v for k, v in values.items()})
            source = "proposed"
        else:
            card = config.live(RateCard)
            source = "in force"
            if card is None:
                return Response({"detail": "There is no rate card in force yet. Enter values to try them.", "code": "no_card"}, status=409)
        vehicle = data.get("vehicle", "motorbike")
        if vehicle not in dict(VEHICLE_TYPES):
            return Response({"detail": "Unknown vehicle type."}, status=400)
        return Response({
            "source": source, "customer": rates.customer_fee(card, km, vehicle=vehicle, express=bool(data.get("express")), extra_pickups=int(data.get("extra_pickups") or 0)),
            "rider": rates.rider_pay(card, km, wait_minutes=int(data.get("wait_minutes") or 0)),
        })


class RiderEarnedView(APIView):
    """GET payouts/ — what riders earned, from the pay recorded on each delivered job. Read only: there is no payout run,
    approval or payment here, and bank and tax are not connected."""

    def get_permissions(self):
        return [HasAnyRolePermission("delivery.cash", "delivery.rates", "delivery.fleet")]

    def get(self, request):
        from datetime import timedelta

        from django.db.models import Count, Sum
        from django.utils import timezone

        from orders.models import DeliveryAssignment

        weeks = max(1, min(int(request.query_params.get("weeks", 2) or 2), 12))
        since = timezone.now() - timedelta(days=7 * weeks)
        rows = (
            DeliveryAssignment.objects.filter(delivered_at__gte=since, dispatch__isnull=False)
            .values("dispatch_id", "dispatch__full_name")
            .annotate(jobs=Count("id"), with_pay=Count("rider_pay"), earned=Sum("rider_pay"))
            .order_by("dispatch__full_name")
        )
        return Response({
            "since": since, "weeks": weeks, "card": config.rate_dict(config.live(RateCard)),
            "riders": [{"staff_id": r["dispatch_id"], "full_name": r["dispatch__full_name"], "jobs": r["jobs"], "jobs_with_pay": r["with_pay"], "earned": str(r["earned"]) if r["earned"] is not None else None} for r in rows],
            "payout": {"status": "not_connected", "note": "Payout runs, tax and bank matching arrive with the Accounting phase. This is a record of what each job earned, not a payment."},
        })


class RiderEarningsLinesView(APIView):
    """GET payouts/<staff_id>/ — the lines behind one rider's total."""

    def get_permissions(self):
        return [HasAnyRolePermission("delivery.cash", "delivery.rates", "delivery.fleet")]

    def get(self, request, staff_id):
        from datetime import timedelta

        from django.utils import timezone

        from orders.models import DeliveryAssignment

        since = timezone.now() - timedelta(days=14)
        jobs = DeliveryAssignment.objects.filter(dispatch_id=staff_id, delivered_at__gte=since).order_by("-delivered_at")
        return Response({"results": [{"assignment_id": j.pk, "order_id": j.order_id, "delivered_at": j.delivered_at, "pay": str(j.rider_pay) if j.rider_pay is not None else None, "breakdown": j.rider_pay_breakdown, "wait_pay_held": j.wait_pay_held} for j in jobs]})
