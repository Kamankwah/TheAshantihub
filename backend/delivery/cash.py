"""Cash a rider holds from cash-on-delivery jobs. Cash on delivery is NOT offered at checkout yet, so no job carries
``cod_amount`` and every figure here is zero; the screens say so. This is an operational count (collected against
handed in), never a ledger."""
from decimal import Decimal

from django.db.models import Sum

from orders.models import DeliveryAssignment

from .models import CashHandover


def held(staff_id, rider_id):
    collected = DeliveryAssignment.objects.filter(dispatch_id=staff_id, cash_collected_at__isnull=False).aggregate(t=Sum("cod_amount"))["t"] or Decimal("0")
    handed = CashHandover.objects.filter(rider_id=rider_id).aggregate(t=Sum("counted"))["t"] or Decimal("0")
    return max(Decimal("0"), collected - handed)


def cod_offered():
    return DeliveryAssignment.objects.filter(cod_amount__isnull=False).exists()
