"""Third-party riders' money in the ledger (spec §1 rows 4-5, §2.1, §2.2 steps 2(c) and 6, §3.3, §7; wallets Plan 5).

A third-party rider (delivery.employment) is paid the delivery fee of each order they deliver when the order's money is
released: Support's positive verification call (ledger.verification.record -> escrow.release_verified), never at the
doorstep and never on a timer. In the release's own transaction, after the release journal and the business's
free-delivery promo charge, one journal `order-rider-<order>` (kind rider_earning) moves what those two credited to
platform delivery income on to the rider:
    Dr platform delivery income   gross (the fee the customer paid, plus a fee the business covered with its promo)
    Cr rider balance              net = gross - reserve (withdrawable at once)
    Cr rider reserve              reserve = gross x rate, half up (AshantiHub's commission, held until the end of the day)
The rate is `rider_commission_bp` as it stood when the order was paid (spec §3.3), kept on the RiderEarning row, so the
end-of-day posting needs no true-up. AshantiHub's own riders, store pickups, failed deliveries and deliveries made before
the rider became third-party pay no rider: the fee stays platform delivery income. A rider's accounts are held by their
staff account (otp.identity.ref gives ("staff", pk)), so the Stage 3b withdrawal engine pays them out.

Lock order (spec W7, extended): the order row, its fee snapshots, the rider row (release) or the earning row (refund),
then every ledger account in one sorted pass (posting.lock). The end-of-day job locks the day's earning rows, then the
accounts."""
from django.db.models import Sum
from django.utils import timezone

from delivery import employment
from delivery.models import Rider, RiderEarning
from orders.models import DeliveryAssignment, Order

from . import posting, settings_store
from .models import Account, Journal, JournalLine

COMMISSION_SETTING = "rider_commission_bp"


def earning_key(order):
    return f"order-rider-{order.pk}"


def split(gross, bp):
    """(reserve, net) of `gross` pesewas at `bp` basis points: the reserve rounded half up, the net what is left."""
    reserve = (gross * bp + 5000) // 10000
    return reserve, gross - reserve


def accounts_of(rider):
    """(Rider balance, Rider commission reserve) of this rider, held by their staff account (opened on first use)."""
    return posting.account_for(Account.RIDER_BALANCE, rider.staff), posting.account_for(Account.RIDER_RESERVE, rider.staff)


def third_party_rider(order, *, lock=False):
    """The third-party Rider who delivered this order, or None: not door to door, no delivery made (none, failed, never
    marked delivered), AshantiHub's own rider, or delivered before the rider became third-party. `lock` takes the rider
    row's lock (that row only), so a switch back to AshantiHub's own (delivery.employment.apply) waits for the caller."""
    if order.delivery_method != Order.DOOR_TO_DOOR:
        return None
    assignment = DeliveryAssignment.objects.filter(order_id=order.pk).first()
    if (
        assignment is None or assignment.status == DeliveryAssignment.FAILED or assignment.delivered_at is None
        or assignment.dispatch_id is None
    ):
        return None
    rows = Rider.objects.select_related("staff").filter(staff_id=assignment.dispatch_id)
    if lock:
        rows = rows.select_for_update(of=("self",))
    rider = rows.first()
    if rider is None:
        return None
    # History reads the employment periods (delivery.RiderEmploymentPeriod), never the current flag, so a later switch
    # back or forward cannot re-label this delivery.
    return rider if employment.third_party_at(rider, assignment.delivered_at) else None


def rider_for_release(order):
    """The third-party rider to pay at this order's release, their row locked, or None. Only when there is something to
    pay them: a delivery fee still held in the order's Delivery payable, or a free-delivery promo charge the business owes
    (so no empty rider account is ever opened). Call inside the release's transaction, after the order row and its fee
    snapshots (the caller holds the order row, so the payable cannot change meanwhile)."""
    from marketing.models_waivers import WaivedFeeCharge

    held = Account.objects.filter(
        kind=Account.DELIVERY_PAYABLE, owner_type=Order._meta.label_lower, owner_id=str(order.pk), net_credit__gt=0,
    ).exists()
    owed = WaivedFeeCharge.objects.filter(order_id=order.pk, status=WaivedFeeCharge.OWED, amount__gt=0).exists()
    return third_party_rider(order, lock=True) if held or owed else None


def release_accounts(rider):
    """The accounts credit_delivery posts to besides platform delivery income (already in the release's lock); none
    without a rider."""
    return accounts_of(rider) if rider is not None else ()


def _taken_as_delivery_income(order):
    """What this order's release and its free-delivery promo charge credited to platform delivery income."""
    from . import escrow

    total = JournalLine.objects.filter(
        journal__key__in=(escrow.release_key(order), escrow.waiver_key(order)), side=JournalLine.CREDIT,
        account__kind=Account.PLATFORM_DELIVERY_INCOME,
    ).aggregate(total=Sum("amount"))["total"]
    return total or 0


def credit_delivery(order, rider, now=None):
    """Pay `rider` the delivery fee AshantiHub took at this order's release (see the module text) and record the
    RiderEarning. Call last in escrow.release_verified's transaction, with the rider's accounts in its up-front lock.
    Returns the earning, or None (no rider, already paid, or nothing was taken for delivery)."""
    from . import escrow

    if rider is None or RiderEarning.objects.filter(order_id=order.pk).exists():
        return None
    gross = _taken_as_delivery_income(order)
    if gross <= 0:
        return None
    now = now or timezone.now()
    paid_at = Journal.objects.get(key=escrow.pay_key(order)).created_at
    bp = settings_store.current(COMMISSION_SETTING, paid_at)
    reserve, net = split(gross, bp)
    balance, held = accounts_of(rider)
    credits = []
    if net:
        credits.append(posting.credit(balance, net))
    if reserve:
        credits.append(posting.credit(held, reserve))
    journal = posting.post(
        key=earning_key(order), kind="rider_earning",
        lines=[posting.debit(posting.account_for(Account.PLATFORM_DELIVERY_INCOME), gross), *credits],
        reference_type="orders.order", reference_id=str(order.pk), memo=f"Delivery of order #{order.pk}, paid to the rider",
    )
    return RiderEarning.objects.create(
        order=order, rider=rider, gross_pesewas=gross, commission_bp=bp, reserve_pesewas=reserve, net_pesewas=net,
        earned_at=now, earned_on=timezone.localdate(now), journal=journal,
    )
