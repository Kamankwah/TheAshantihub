"""A third-party rider's money as they (and wallets.view staff) see it (spec §2.1, §2.2 step 6, §7; wallets Plan 5): the
balance (90% of each delivery fee, withdrawable; below zero after a refund that took a delivery back), the commission
reserve held until the end of the day (read-only), what each delivery earned, each day's posted commission, and the
statement of their ledger lines. Over the ledger and the RiderEarning / RiderCommissionPosting rows ledger.riders writes.
Integer pesewas inside, GH₵ strings at the edge; reading never opens an account."""
from django.db.models import Sum

from accounts.models import StaffUser
from delivery import employment
from delivery.models import RiderCommissionPosting, RiderEarning
from ledger import posting, settings_store
from ledger.models import Account, JournalLine

from .services import money

LABELS = {
    "rider_earning": "Delivery paid to you",
    "rider_earning_reversal": "Delivery taken back (order refunded)",
    "rider_commission": "AshantiHub's commission",
    "withdrawal_hold": "Withdrawal",
    "withdrawal_reversed": "Withdrawal returned",
}
ACCOUNT_NAMES = {Account.RIDER_BALANCE: "balance", Account.RIDER_RESERVE: "reserve"}
STATUS_LABELS = {
    "reserve_held": "Paid to you. AshantiHub's commission is held until the end of the day.",
    "commission_taken": "Paid to you. AshantiHub's commission was taken.",
    "refunded": "Taken back: the order was refunded in full.",
}


def summary(rider):
    staff = rider.staff
    return {
        "kind": "rider",
        "balance": money(posting.balance_of(Account.RIDER_BALANCE, staff)),
        "reserve": money(posting.balance_of(Account.RIDER_RESERVE, staff)),
        "reserve_note": "AshantiHub's commission, held until it is taken after midnight. It cannot be withdrawn.",
        "commission_bp": settings_store.current("rider_commission_bp"),
        "company_name": rider.company_name,
        "awaiting_release": employment.unreleased_deliveries(rider).count(),
    }


def earnings(rider, day=None):
    rows = RiderEarning.objects.filter(rider=rider).select_related("order__delivery_assignment")
    if day is not None:
        rows = rows.filter(earned_on=day)
    return rows.order_by("-earned_at", "-id")


def status_of(earning):
    if earning.reversed_at is not None:
        return "refunded"
    return "commission_taken" if earning.commission_posting_id else "reserve_held"


def earning_row(earning):
    assignment = getattr(earning.order, "delivery_assignment", None)
    status = status_of(earning)
    return {
        "id": earning.pk, "order": earning.order_id, "delivered_at": assignment.delivered_at if assignment else None,
        "earned_at": earning.earned_at, "earned_on": earning.earned_on, "gross": money(earning.gross_pesewas),
        "commission_bp": earning.commission_bp, "commission": money(earning.reserve_pesewas),
        "you_got": money(earning.net_pesewas), "status": status, "status_label": STATUS_LABELS[status],
        "reversed_at": earning.reversed_at,
    }


def given_back(day_filter):
    """{day: pesewas of commission AshantiHub gave back} for deliveries taken back (a whole refund) after their day's
    commission was posted. A RiderCommissionPosting row is never edited, so the views add this beside it. `day_filter` is
    a RiderEarning filter (a rider, or every rider) already narrowed to the days shown."""
    return dict(
        RiderEarning.objects.filter(reversed_at__isnull=False, commission_posting__isnull=False, **day_filter)
        .values("commission_posting__day").annotate(total=Sum("reserve_pesewas")).values_list("commission_posting__day", "total")
    )


def days(rider, limit=30):
    """Each posted day, newest first: deliveries, gross, AshantiHub's commission and net (several postings of one day add
    up), and `given_back`: the part of that commission given back because a delivery of the day was refunded in full."""
    rows = list(
        RiderCommissionPosting.objects.filter(rider=rider).values("day")
        .annotate(deliveries=Sum("deliveries"), gross=Sum("gross_pesewas"), commission=Sum("commission_pesewas"), net=Sum("net_pesewas"))
        .order_by("-day")[:limit]
    )
    back = given_back({"rider": rider, "commission_posting__day__in": [row["day"] for row in rows]})
    return [
        {"day": row["day"], "deliveries": row["deliveries"], "gross": money(row["gross"]), "commission": money(row["commission"]),
         "net": money(row["net"]), "given_back": money(back.get(row["day"], 0))}
        for row in rows
    ]


def statement_lines(rider):
    """Every journal line on the rider's own balance and reserve, newest first."""
    return (
        JournalLine.objects.filter(
            account__kind__in=tuple(ACCOUNT_NAMES), account__owner_type=StaffUser._meta.label_lower,
            account__owner_id=str(rider.staff_id),
        )
        .select_related("journal", "account").order_by("-journal__created_at", "-id")
    )


def line_row(line):
    journal = line.journal
    is_order = journal.reference_type == "orders.order" and journal.reference_id.isdigit()
    return {
        "id": line.pk, "at": journal.created_at, "account": ACCOUNT_NAMES[line.account.kind], "kind": journal.kind,
        "label": LABELS.get(journal.kind, "Other"),
        # Both rider accounts grow with credits, so a credit is money in.
        "direction": "in" if line.side == JournalLine.CREDIT else "out",
        "amount": money(line.amount), "order": int(journal.reference_id) if is_order else None,
        "reference": journal.reference_id if journal.reference_type == "wallets.withdrawal" else "",
    }
