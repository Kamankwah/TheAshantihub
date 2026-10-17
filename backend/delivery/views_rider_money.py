"""The rider's own pay and cash (permission ``delivery.dispatch``; always the caller's own rows).

Pay is what each delivered job recorded under the rate card in force when it was delivered: a record, not a
payment. A job with no recorded pay (no card, or a route that could not be measured) shows no pay, never zero.
Cash on delivery is not offered at checkout yet, so the cash screen says so and shows no figure."""
from datetime import timedelta
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone
from rest_framework.response import Response

from approvals.models import ApprovalRequest
from orders.models import DeliveryAssignment

from . import cash, config, employment
from .models import CashHandover, RateCard
from .views_rider import RiderView


def _period(request):
    now = timezone.now()
    today = timezone.localdate(now)
    period = request.query_params.get("period", "week")
    if period == "today":
        return "today", today
    return "week", today - timedelta(days=today.weekday())  # Monday


class EarningsView(RiderView):
    """GET rider/earnings/?period=today|week"""

    def get(self, request):
        period, start = _period(request)
        jobs = employment.payroll_jobs(DeliveryAssignment.objects.filter(dispatch=request.user, delivered_at__date__gte=start)).order_by("-delivered_at")
        failed = DeliveryAssignment.objects.filter(dispatch=request.user, failed_at__date__gte=start).count()
        rows = []
        for j in jobs:
            lines = (j.rider_pay_breakdown or {}).get("lines") or []
            rows.append({
                "assignment_id": j.pk, "order_id": j.order_id, "delivered_at": j.delivered_at, "pay": str(j.rider_pay) if j.rider_pay is not None else None,
                "km": (j.rider_pay_breakdown or {}).get("distance_km"), "lines": lines, "wait_pay_held": j.wait_pay_held,
            })
        total = jobs.filter(rider_pay__isnull=False).aggregate(t=Sum("rider_pay"))["t"]
        card = config.live(RateCard)
        pending = ApprovalRequest.objects.filter(kind=config.RATE_CARD, status=ApprovalRequest.PENDING).exists()
        return Response({
            "period": period, "since": start, "jobs": len(rows), "jobs_without_pay": sum(1 for r in rows if r["pay"] is None),
            "could_not_deliver": failed, "total": str(total) if total is not None else None, "results": rows,
            "rates": {"per_job": str(card.rider_per_job), "per_km": str(card.rider_per_km), "wait_after_min": card.wait_after_min, "wait_per_min": str(card.wait_per_min), "version": card.version} if card else None,
            "rate_change_pending": pending,
            "payouts": {"status": "not_connected", "note": "Payouts are prepared by Accounting. Payments are simulated until Hubtel is connected, so no money has moved."},
        })


class CashView(RiderView):
    """GET rider/cash/ — what the rider holds, the cap, today's cash jobs and their own hand-overs."""

    def get(self, request):
        rider = self.rider(request)
        offered = cash.cod_offered()
        rules = config.effective_rules()
        cap = Decimal(str(rules["cash_cap"]))
        today = timezone.localdate()
        handovers = [
            {"id": h.pk, "expected": str(h.expected), "counted": str(h.counted), "difference": str(h.difference), "at": h.at, "counted_by": h.counted_by.full_name if h.counted_by_id else None}
            for h in CashHandover.objects.filter(rider=rider).select_related("counted_by")[:10]
        ]
        if not offered:
            return Response({
                "cod": {"offered": False, "note": "Cash on delivery is not offered at checkout yet, so you collect no cash and have nothing to hand in."},
                "cap": str(cap), "holding": None, "room": None, "collected_today": None, "remitted_today": None, "lines": [], "handovers": handovers,
                "how": "To remit, bring the cash to the AshantiHub dispatch desk. Your manager counts it and confirms it on their screen; you cannot confirm your own.",
            })
        holding = cash.held(request.user.pk, rider.pk)
        collected = DeliveryAssignment.objects.filter(dispatch=request.user, cash_collected_at__date=today)
        remitted = CashHandover.objects.filter(rider=rider, at__date=today).aggregate(t=Sum("counted"))["t"] or Decimal("0")
        return Response({
            "cod": {"offered": True, "note": None}, "cap": str(cap), "holding": str(holding), "room": str(max(Decimal("0"), cap - holding)),
            "collected_today": str(collected.aggregate(t=Sum("cod_amount"))["t"] or Decimal("0")), "remitted_today": str(remitted),
            "lines": [{"order_id": a.order_id, "amount": str(a.cod_amount), "at": a.cash_collected_at} for a in collected.order_by("-cash_collected_at")],
            "handovers": handovers,
            "how": "To remit, bring the cash to the AshantiHub dispatch desk. Your manager counts it and confirms it on their screen; you cannot confirm your own.",
        })
