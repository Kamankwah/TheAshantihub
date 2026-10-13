"""Menu badge counts for the Delivery Manager (GET /api/notifications/staff-badges/). Each is counted from a
live queue and gated by the permission that opens its screen, like every other badge."""
from decimal import Decimal


def counts(held):
    out = {"delivery_queue": 0, "delivery_cases": 0, "delivery_documents": 0, "delivery_cash": 0}
    if "delivery.manage" in held:
        from . import board

        out["delivery_queue"] = board.waiting_orders().count()
    if held & {"delivery.manage", "delivery.disputes"}:
        from .views_cases import OPEN, delivery_cases

        out["delivery_cases"] = delivery_cases().filter(status__in=OPEN).count()
    if "delivery.fleet" in held:
        from .models import RiderDocument

        out["delivery_documents"] = RiderDocument.objects.filter(status=RiderDocument.UPLOADED).count()
    if "delivery.cash" in held:
        from . import cash, config
        from .models import Rider

        if cash.cod_offered():
            cap = Decimal(str(config.effective_rules()["cash_cap"]))
            out["delivery_cash"] = sum(1 for r in Rider.objects.filter(staff__is_active=True) if cash.held(r.staff_id, r.pk) > cap)
    return out
