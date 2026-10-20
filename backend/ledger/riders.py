"""Third-party riders' money in the ledger (spec §1 rows 4-5, §2.1, §2.2 steps 2(c) and 6, §3.3, §7; wallets Plan 5).

A third-party rider (delivery.employment) is paid the delivery fee of each order they deliver when the order's money is
released: Support's positive verification call (ledger.verification.record -> escrow.release_verified), never at the
doorstep and never on a timer. In the release's own transaction, after the release journal and the business's
free-delivery promo charge, one journal `order-rider-<order>` (kind rider_earning) moves what those two credited to
platform delivery income on to the rider:
    Dr platform delivery income   gross (the fee the customer paid, plus a fee the promo's funder covered)
    Cr rider balance              net = gross - reserve (withdrawable at once)
    Cr rider reserve              reserve = gross x rate, half up (AshantiHub's commission, held until the end of the day)
The rate is `rider_commission_bp` as it stood when the order was paid (spec §3.3), kept on the RiderEarning row, so the
end-of-day posting needs no true-up. AshantiHub's own riders, store pickups, failed deliveries and deliveries made before
the rider became third-party pay no rider: the fee stays platform delivery income. A rider's accounts are held by their
staff account (otp.identity.ref gives ("staff", pk)), so the Stage 3b withdrawal engine pays them out.

Once the rider has PICKED UP at least one stop of a door-to-door delivery (any collected PickupStop, else the assignment's
`picked_up_at`; pickup_made), the delivery fee belongs to the rider whether or not the delivery completed, and no refund of
goods ever returns it (delivery_kept). A whole refund before release settles it there and then, since the release will never
run (escrow.settle_delivery: the held fee moves to platform delivery income, then credit_delivery pays a third-party rider
exactly as a release does). A rider only assigned, with nothing collected, is paid nothing and the customer gets the fee
back; an AshantiHub rider's fee stays platform delivery income.

An order re-delivered at the customer's request (delivery.Redelivery, Plan 7F-E Task 7, Ruling R4) was delivered on the
first trip as far as its fee goes: the first rider reached the address and the customer was away. That rider keeps the
original fee (fee_rider, tested at Redelivery.first_leg_ended_at), whatever the second trip does, and no refund returns it
(delivery_earned). The second trip's own fee is the re-delivery fee (ledger.redelivery), never the original one.

Lock order (spec W7, extended; the canonical order is in orders/locks.py): the order row, its fee snapshots, the rider
row (release), the delivery assignment row then the rider row (a whole refund before release: rider_for_settle), then
every ledger account in one sorted pass (posting.lock). The end-of-day job locks the rider row first, then the day's
earning rows, then the accounts: its commit checks the foreign key to the rider, which waits for a FOR UPDATE holder, so
taking the accounts first would cycle with a release or a switch back (rider row, then reserve). Every
select_for_update that reaches the rider's rows takes `of=("self",)` so the staff row is not locked with it."""
import logging

from django.db import transaction
from django.db.models import Min, Q, Sum
from django.utils import timezone

from delivery import employment
from delivery.models import PickupStop, Rider, RiderCommissionPosting, RiderEarning
from orders.models import DeliveryAssignment, Order

from . import posting, settings_store
from .models import Account, Journal, JournalLine

logger = logging.getLogger(__name__)
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


def first_leg(order):
    """(staff id, when the leg ended) of the rider who completed the first trip of an order re-delivered at the customer's
    request (delivery.Redelivery, Plan 7F-E Task 7, Ruling R4), or None when the order was never re-delivered."""
    from delivery.models import Redelivery

    leg = Redelivery.objects.filter(order_id=order.pk).order_by("attempt").values_list("first_rider_id", "first_leg_ended_at").first()
    return leg


def fee_rider(order):
    """The payee of the order's ORIGINAL delivery fee (a StaffUser), or None: the rider who completed the first trip when
    the order was re-delivered at the customer's request (Redelivery.first_rider: they reached the address and the customer
    was away, so the fee is theirs, Ruling R4), else the rider on the assignment. Whether that rider is actually paid (a
    third-party rider, at release) or the fee stays platform income (an AshantiHub rider) is third_party_rider's call."""
    from accounts.models import StaffUser

    leg = first_leg(order)
    staff_id = leg[0] if leg is not None else DeliveryAssignment.objects.filter(order_id=order.pk).values_list("dispatch_id", flat=True).first()
    return StaffUser.objects.filter(pk=staff_id).first() if staff_id else None


def third_party_rider(order, *, lock=False):
    """The third-party Rider who earned this order's delivery fee, or None: not door to door, no delivery made (none,
    failed, never marked delivered), AshantiHub's own rider, or delivered before the rider became third-party. For an
    order re-delivered at the customer's request the payee is the first rider (fee_rider), tested at the end of their leg:
    their trip was completed, whatever the second trip does. `lock` takes the rider row's lock (that row only), so a switch
    back to AshantiHub's own (delivery.employment.apply) waits for the caller."""
    if order.delivery_method != Order.DOOR_TO_DOOR:
        return None
    leg = first_leg(order)
    if leg is not None:
        staff_id, at = leg
    else:
        assignment = DeliveryAssignment.objects.filter(order_id=order.pk).first()
        if (
            assignment is None or assignment.status == DeliveryAssignment.FAILED or assignment.delivered_at is None
            or assignment.dispatch_id is None
        ):
            return None
        staff_id, at = assignment.dispatch_id, assignment.delivered_at
    rider = Rider.objects.select_related("staff").filter(staff_id=staff_id).first() if staff_id else None
    # History reads the employment periods (delivery.RiderEmploymentPeriod), never the current flag, so a later switch
    # back or forward cannot re-label this delivery.
    if rider is None or not employment.third_party_at(rider, at):
        return None
    if lock:
        # Only a third-party rider's row is locked, so an AshantiHub rider's release never queues behind a fleet edit. The
        # period that covers the delivery can only be closed later than the delivery, so it still covers it under the lock.
        rider = Rider.objects.select_related("staff").select_for_update(of=("self",)).get(pk=rider.pk)
    return rider


def rider_for_release(order):
    """The third-party rider to pay at this order's release, their row locked, or None. Only when there is something to
    pay them: a delivery fee still held in the order's Delivery payable, or a free-delivery promo charge its funder owes
    (so an order with neither opens no rider account). One exception: a release that then finds nothing at all to post
    (an owed promo charge on an order with no item and no fee left to release) returns before posting, having opened the
    rider's two accounts empty; they hold nothing and nothing reads them as money. Call inside the release's transaction, after the order row and its fee
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
    """What this order's release (or early settlement) and its free-delivery promo charge credited to platform delivery income."""
    from . import escrow

    total = JournalLine.objects.filter(
        journal__key__in=(escrow.release_key(order), escrow.settle_key(order), escrow.waiver_key(order)), side=JournalLine.CREDIT,
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


# --- the delivery fee belongs to the rider once a pickup is done (Plan 7F-D) ----------------------------------------------

def pickup_made(order):
    """When the rider on the CURRENT leg first collected goods for this door-to-door order, or None: the earliest
    `collected_at` of its COLLECTED pickup stops, else the assignment's `picked_up_at`, counting only a pickup made by the
    rider on the assignment now (`collected_by` / `picked_up_by` is `assignment.dispatch_id`, or null on a row written before
    those stamps existed). A re-assignment ends the previous leg (Plan 7F-E Task 6, Ruling R3): the first rider's pickup
    then counts for no one, so a refund before the new rider's own pickup returns the fee, and the settle test reads the new
    rider's own pickup time. Does not look at the assignment's status: a delivery that failed after a pickup still counts."""
    if order.delivery_method != Order.DOOR_TO_DOOR:
        return None
    assignment = DeliveryAssignment.objects.filter(order_id=order.pk).first()
    if assignment is None:
        return None
    current = assignment.dispatch_id
    first = (
        PickupStop.objects.filter(assignment_id=assignment.pk, status=PickupStop.COLLECTED, collected_at__isnull=False)
        .filter(Q(collected_by__isnull=True) | Q(collected_by_id=current))
        .aggregate(first=Min("collected_at"))["first"]
    )
    if first is not None:
        return first
    if assignment.picked_up_by_id is None or assignment.picked_up_by_id == current:
        return assignment.picked_up_at
    return None


def delivery_earned(order):
    """True once the delivery fee has been earned: a pickup was made, a rider was already paid for the order, the first
    trip was completed and the customer was away (a re-delivery was asked for, Plan 7F-E Task 7: the first rider keeps the
    fee, so no refund returns it), or the order was released with a delivered assignment. Once true it stays true."""
    from . import escrow

    if pickup_made(order) is not None or RiderEarning.objects.filter(order_id=order.pk).exists() or first_leg(order) is not None:
        return True
    if not Journal.objects.filter(key=escrow.release_key(order)).exists():
        return False
    return DeliveryAssignment.objects.filter(order_id=order.pk, delivered_at__isnull=False).exists()


def delivery_kept(order):
    """Pesewas of the order's delivery fee that a refund can never return: all of it once the delivery is earned."""
    from .money import to_pesewas

    return to_pesewas(order.delivery_fee or 0) if delivery_earned(order) else 0


def rider_for_settle(order):
    """The third-party rider to pay when a whole refund settles this order's delivery before release, or None (no
    pickup, AshantiHub's own rider, or one who was not third-party when they picked up). For an order re-delivered at the
    customer's request it is the first rider (fee_rider), tested at the end of their leg. Otherwise the rider is the one on the
    assignment now and the pickup is that rider's own (pickup_made counts the current leg only, Plan 7F-E Task 6), so a
    re-assigned rider is never tested against the first rider's pickup time. The delivery assignment row is
    locked first (refunds.refund_order already holds it from before it decided whether the fee was earned, so a pickup
    confirmed meanwhile either finished before that decision or waits for the refund), then the rider's row; call inside the
    refund's transaction after the order row and its fee snapshots."""
    from orders import locks

    if order.delivery_method != Order.DOOR_TO_DOOR:
        return None
    assignment = locks.lock_assignment(order)       # `order` is the refund's locked row (orders.locks.lock_order)
    leg = first_leg(order)
    if leg is not None:                             # re-delivered at the customer's request: the first rider's fee (fee_rider)
        staff_id, at = leg
    else:
        at = pickup_made(order)
        staff_id = assignment.dispatch_id if assignment is not None else None
        if at is None:
            return None
    rider = Rider.objects.select_related("staff").filter(staff_id=staff_id).first() if staff_id else None
    if rider is None or not employment.third_party_at(rider, at):
        return None
    return Rider.objects.select_related("staff").select_for_update(of=("self",)).get(pk=rider.pk)


# --- end of day (spec §2.2 step 6) ------------------------------------------------------------------------------------

def commission_key(rider, day, first_earning_pk):
    return f"rider-commission-{rider.staff_id}-{day:%Y-%m-%d}-{first_earning_pk}"


def post_day(rider_id, day, now=None):
    """Post one rider's commission held for `day`: the reserve of every earning of that day not yet posted goes
    to platform commission income (Dr rider reserve, Cr platform commission income; no journal when it is 0), and the
    day's deliveries, gross, commission and net are recorded on a RiderCommissionPosting. The earning rows are locked
    first and filtered again under the lock, so a second run never posts a reserve twice.
    Returns the posting, or None when nothing is left to post."""
    now = now or timezone.now()
    if day >= timezone.localdate(now):
        raise ValueError(f"The day {day:%Y-%m-%d} is not over yet; only earlier days are posted")
    with transaction.atomic():
        # The rider row first (rider row -> earning rows -> accounts): the commit-time foreign key check from the posting
        # row waits for a FOR UPDATE holder, who may already hold the reserve (a release) and want it next.
        rider = Rider.objects.select_related("staff").select_for_update(of=("self",)).get(pk=rider_id)
        earnings = list(
            RiderEarning.objects.select_for_update(of=("self",))
            .filter(rider_id=rider_id, earned_on=day, commission_posting__isnull=True, reversed_at__isnull=True)
            .order_by("pk")
        )
        if not earnings:
            return None
        gross = sum(earning.gross_pesewas for earning in earnings)
        commission = sum(earning.reserve_pesewas for earning in earnings)
        journal = None
        if commission:
            journal = posting.post(
                key=commission_key(rider, day, earnings[0].pk), kind="rider_commission",
                lines=[
                    posting.debit(accounts_of(rider)[1], commission),
                    posting.credit(posting.account_for(Account.PLATFORM_COMMISSION_INCOME), commission),
                ],
                reference_type="accounts.staffuser", reference_id=str(rider.staff_id),
                memo=f"Commission on {len(earnings)} {'delivery' if len(earnings) == 1 else 'deliveries'} of {day:%Y-%m-%d}",
            )
        row = RiderCommissionPosting.objects.create(
            rider=rider, day=day, deliveries=len(earnings), gross_pesewas=gross, commission_pesewas=commission,
            net_pesewas=gross - commission, journal=journal, posted_at=now,
        )
        RiderEarning.objects.filter(pk__in=[earning.pk for earning in earnings]).update(commission_posting=row)
        return row


def post_commission(today=None, now=None):
    """The end-of-day job: post every rider's held commission of each day before `today` (Accra), oldest first, so a
    missed night is caught up by the next run. A no-op while the ledger is off. One rider-day that fails is logged and
    skipped, so it never stops the others, and then fails the job with a summary so its health shows DOWN. Returns how many
    postings were made."""
    from . import escrow

    if not escrow.enabled():
        return 0
    now = now or timezone.now()
    today = today or timezone.localdate(now)
    groups = list(
        RiderEarning.objects.filter(commission_posting__isnull=True, reversed_at__isnull=True, earned_on__lt=today)
        .order_by("earned_on", "rider_id").values_list("rider_id", "earned_on").distinct()
    )
    done, failed = 0, 0
    for rider_id, day in groups:
        try:
            if post_day(rider_id, day, now) is not None:
                done += 1
        except Exception:  # one rider-day the ledger refuses must not stop every other rider's posting
            logger.exception("Rider commission posting failed for rider %s on %s", rider_id, day)
            failed += 1
    if failed:      # after every other rider-day was posted: the job shows DOWN until the failures are looked at
        raise RuntimeError(f"Rider commission posting failed for {failed} rider-day(s); {done} posted")
    return done
