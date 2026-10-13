"""Payouts & payroll (Super Admin, money screen 02): the only payout-like records
that exist today. There are no payout runs, payroll, rider pay or seller
settlements, so none are returned; the page says they arrive with Accounting."""
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.utils import timezone

from commission import services as commission_services
from commission.models import CommissionAccrual
from commission.views import totals as commission_totals
from events.models import Ticket

ZERO = Decimal("0.00")


def _money(value):
    return str((value or ZERO).quantize(Decimal("0.01")))


def payouts_overview():
    from django.conf import settings

    month_start = timezone.localtime().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    tickets = Ticket.objects.aggregate(
        held=Sum("price", filter=Q(refunded_at__isnull=True, escrow_status=Ticket.HELD)),
        held_n=Count("id", filter=Q(refunded_at__isnull=True, escrow_status=Ticket.HELD)),
        released=Sum("price", filter=Q(refunded_at__isnull=True, escrow_status=Ticket.RELEASED)),
        released_n=Count("id", filter=Q(refunded_at__isnull=True, escrow_status=Ticket.RELEASED)),
        released_month=Sum("price", filter=Q(refunded_at__isnull=True, escrow_status=Ticket.RELEASED, escrow_released_at__gte=month_start)),
        refunded=Sum("price", filter=Q(refunded_at__isnull=False)),
        refunded_n=Count("id", filter=Q(refunded_at__isnull=False)),
    )
    accruals = commission_totals(CommissionAccrual.objects.all())
    return {
        "simulated": settings.PAYMENTS_PROVIDER == "simulated",
        "commission": {key: accruals[key] for key in ("on_hold", "payable", "in_batch", "paid")},
        "tickets": {
            "held": _money(tickets["held"]), "held_count": tickets["held_n"],
            "released": _money(tickets["released"]), "released_count": tickets["released_n"],
            "released_this_month": _money(tickets["released_month"]),
            "refunded": _money(tickets["refunded"]), "refunded_count": tickets["refunded_n"],
        },
        "payout_blocker": commission_services.payout_blocker(),
        "not_recorded": [
            {"name": "Payroll runs", "why": "No payroll is prepared or paid in AshantiHub yet. It arrives with the Accounting phase."},
            {"name": "Seller settlements", "why": "Sellers are not paid through AshantiHub yet, so there is nothing to settle."},
            {"name": "Rider pay", "why": "There is no delivery fee or rider pay record yet. It arrives with the Delivery phase."},
            {"name": "Payout batches", "why": "No batch has ever been formed, so no commission is in a batch or recorded as paid."},
        ],
    }
