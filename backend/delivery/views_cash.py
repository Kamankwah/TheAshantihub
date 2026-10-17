"""Cash on delivery screen (permission ``delivery.cash``). Cash on delivery is not offered at checkout, so there is
no cash to count: the screen shows the cap, the (empty) lists and says why. The handover form works the day a job
carries cash and refuses a handover for a rider who holds none."""
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission, RequiresSudo
from notifications.services import notify_staff

from . import cash, config
from .models import CashHandover, Rider

PERMISSION = "delivery.cash"


class CashView(APIView):
    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission(PERMISSION), RequiresSudo()]
        return [HasRolePermission(PERMISSION)]

    def get(self, request):
        rules = config.effective_rules()
        cap = Decimal(str(rules["cash_cap"]))
        riders = []
        for rider in Rider.objects.select_related("staff").filter(staff__is_active=True, staff__invite_token__isnull=True):
            holding = cash.held(rider.staff_id, rider.pk)
            riders.append({"id": rider.pk, "full_name": rider.staff.full_name, "holding": str(holding), "over_cap": holding > cap, "cap": str(cap)})
        recent = CashHandover.objects.select_related("rider__staff", "counted_by")[:30]
        offered = cash.cod_offered()
        return Response({
            "cod": {"offered": offered, "note": None if offered else "Cash on delivery is not offered at checkout yet, so riders hold no cash from deliveries."},
            "cap": {"amount": str(cap), "source": rules["source"], "version": rules["version"]},
            "riders": riders, "over_cap": sum(1 for r in riders if r["over_cap"]),
            "handovers": [
                {"id": h.pk, "rider": h.rider.staff.full_name, "expected": str(h.expected), "counted": str(h.counted), "difference": str(h.difference),
                 "counted_by": h.counted_by.full_name if h.counted_by_id else None, "at": h.at, "note": h.note}
                for h in recent
            ],
            "shortfalls": [h.pk for h in recent if h.difference < 0],
            "bank_matching": "not_connected",
        })

    def post(self, request):
        """Count and confirm a handover: {"rider", "counted", "note"}. A shortfall must carry a note and tells the
        rider's manager and every Super Admin."""
        rider = get_object_or_404(Rider.objects.select_related("staff"), pk=request.data.get("rider"))
        try:
            counted = Decimal(str(request.data.get("counted"))).quantize(Decimal("0.01"))
        except (InvalidOperation, ValueError, TypeError):
            return Response({"detail": "Enter the amount counted in GH₵.", "field": "counted"}, status=400)
        if counted < 0 or counted > Decimal("100000"):
            return Response({"detail": "Enter an amount from 0 to 100000.", "field": "counted"}, status=400)
        note = str(request.data.get("note", "")).strip()[:300]
        with transaction.atomic():
            rider = Rider.objects.select_for_update(of=("self",)).select_related("staff").get(pk=rider.pk)
            expected = cash.held(rider.staff_id, rider.pk)
            if expected == 0:
                return Response({"detail": "This rider holds no cash from deliveries, so there is nothing to hand in.", "code": "nothing_owed"}, status=409)
            difference = counted - expected
            if difference < 0 and not note:
                return Response({"detail": "Say what is missing: a shortfall needs a note.", "field": "note"}, status=400)
            handover = CashHandover.objects.create(rider=rider, expected=expected, counted=counted, difference=difference, counted_by=request.user, note=note)
        if difference < 0:
            from accounts.models import Role, StaffUser

            for person in [rider.staff.manager, *StaffUser.objects.filter(role__name=Role.SUPER_ADMIN, is_active=True)]:
                if person is not None and person.pk != request.user.pk:
                    notify_staff(person, "delivery_alert", f"Cash shortfall: {rider.staff.full_name} GH₵ {abs(difference)}", body=note, link="/staff/cash-on-delivery", icon="💷")
        return Response({"id": handover.pk, "expected": str(expected), "counted": str(counted), "difference": str(difference)}, status=201)
