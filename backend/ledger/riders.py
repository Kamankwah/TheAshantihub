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
then every ledger account in one sorted pass (posting.lock). The end-of-day job locks the rider row first, then the day's
earning rows, then the accounts: its commit checks the foreign key to the rider, which waits for a FOR UPDATE holder, so
taking the accounts first would cycle with a release or a switch back (rider row, then reserve). A refund locks the
earning row and so must never insert a row with a foreign key to the rider or to their StaffUser (a notice keyed on the
staff account, say) afterwards inside that transaction: the rider's notices are sent on commit, and every other
select_for_update that reaches the rider's rows takes `of=("self",)` so the staff row is not locked with it."""
import logging

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from delivery import employment
from delivery.models import Rider, RiderCommissionPosting, RiderEarning
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
    rider = Rider.objects.select_related("staff").filter(staff_id=assignment.dispatch_id).first()
    # History reads the employment periods (delivery.RiderEmploymentPeriod), never the current flag, so a later switch
    # back or forward cannot re-label this delivery.
    if rider is None or not employment.third_party_at(rider, assignment.delivered_at):
        return None
    if lock:
        # Only a third-party rider's row is locked, so an AshantiHub rider's release never queues behind a fleet edit. The
        # period that covers the delivery can only be closed later than the delivery, so it still covers it under the lock.
        rider = Rider.objects.select_related("staff").select_for_update(of=("self",)).get(pk=rider.pk)
    return rider


def rider_for_release(order):
    """The third-party rider to pay at this order's release, their row locked, or None. Only when there is something to
    pay them: a delivery fee still held in the order's Delivery payable, or a free-delivery promo charge the business owes
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


# --- a refund before release (Plan 7D: a trip made is paid even when the order is refunded) -----------------------------

def refund_key(order):
    return f"rider-refund-{order.pk}"


def rider_picked_up(order):
    """True once a door-to-door order's delivery job shows the rider collected the goods and did not fail the delivery
    (`picked_up_at` is stamped when they confirm pickup at the business). Assigned, accepted or at-pickup is not a trip."""
    if order.delivery_method != Order.DOOR_TO_DOOR:
        return False
    assignment = DeliveryAssignment.objects.filter(order_id=order.pk).first()
    return (
        assignment is not None and assignment.dispatch_id is not None and assignment.picked_up_at is not None
        and assignment.status != DeliveryAssignment.FAILED
    )


def refund_trip(order, delivery_pesewas):
    """(rider, net, reserve, bp) to pay for a trip made before this whole refund of `order`'s `delivery_pesewas` of delivery
    fee, the rider's row locked, or None: nothing to pay, not picked up, AshantiHub's own rider (or one who was not
    third-party when they picked up), or already paid. The rider's share is what they would net from that fee under the
    commission rate in force when the order was paid (`split`); the commission part goes back to the customer with the
    rest of the fee. Call inside the refund's transaction after the order row and its fee snapshots."""
    from . import escrow

    if delivery_pesewas <= 0 or not rider_picked_up(order):
        return None
    if Journal.objects.filter(key=refund_key(order)).exists() or RiderEarning.objects.filter(order_id=order.pk).exists():
        return None
    assignment = DeliveryAssignment.objects.get(order_id=order.pk)
    rider = Rider.objects.select_related("staff").filter(staff_id=assignment.dispatch_id).first()
    if rider is None or not employment.third_party_at(rider, assignment.picked_up_at):
        return None
    rider = Rider.objects.select_related("staff").select_for_update(of=("self",)).get(pk=rider.pk)
    paid_at = Journal.objects.get(key=escrow.pay_key(order)).created_at
    bp = settings_store.current(COMMISSION_SETTING, paid_at)
    reserve, net = split(delivery_pesewas, bp)
    return (rider, net, reserve, bp) if net > 0 else None


def refund_accounts(trip, order):
    """The accounts credit_on_refund posts to (for the refund's up-front lock); () without a trip."""
    return (accounts_of(trip[0])[0], posting.account_for(Account.DELIVERY_PAYABLE, order)) if trip is not None else ()


def credit_on_refund(order, now=None, *, trip=None, delivery_pesewas=None):
    """Pay the third-party rider the share of the delivery fee a whole refund before release owes them for a trip made
    (Dr the order's Delivery payable, Cr rider balance, journal `rider-refund-<order>`, and a RiderEarning with no
    reserve: AshantiHub's commission goes back to the customer). Returns the pesewas paid; 0 when there is no trip to pay
    or it was already paid. Idempotent. Call from refund_order's transaction with `trip` (refund_trip) already locked."""
    from . import escrow

    if not escrow.enabled():
        return 0
    if trip is None:
        if delivery_pesewas is None:
            from .money import to_pesewas

            delivery_pesewas = to_pesewas(order.delivery_fee or 0)
        trip = refund_trip(order, delivery_pesewas)
    if trip is None:
        return 0
    rider, net, _reserve, bp = trip
    now = now or timezone.now()
    journal = posting.post(
        key=refund_key(order), kind="rider_earning",
        lines=[posting.debit(posting.account_for(Account.DELIVERY_PAYABLE, order), net), posting.credit(accounts_of(rider)[0], net)],
        reference_type="orders.order", reference_id=str(order.pk),
        memo=f"Order #{order.pk} refunded after the rider picked it up: the rider is paid for the trip",
    )
    RiderEarning.objects.create(
        order=order, rider=rider, gross_pesewas=net, commission_bp=bp, reserve_pesewas=0, net_pesewas=net,
        earned_at=now, earned_on=timezone.localdate(now), journal=journal,
    )
    return net


# --- end of day (spec §2.2 step 6) ------------------------------------------------------------------------------------

def commission_key(rider, day, first_earning_pk):
    return f"rider-commission-{rider.staff_id}-{day:%Y-%m-%d}-{first_earning_pk}"


def post_day(rider_id, day, now=None):
    """Post one rider's commission held for `day`: the reserve of every earning of that day not yet posted or reversed goes
    to platform commission income (Dr rider reserve, Cr platform commission income; no journal when it is 0), and the
    day's deliveries, gross, commission and net are recorded on a RiderCommissionPosting. The earning rows are locked
    first and filtered again under the lock, so a second run (or a refund reversing one) never posts a reserve twice.
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


# --- refunds (spec §2.2 step 6: "A reversed delivery reverses its share of the reserve") --------------------------------

def reversal_key(order):
    return f"order-rider-reversal-{order.pk}"


def earning_to_reverse(order):
    """The order's rider earning not yet reversed, its row locked (after the order row and its fee snapshots, before any
    account), or None."""
    return (
        RiderEarning.objects.select_for_update(of=("self",)).select_related("rider__staff", "order")
        .filter(order_id=order.pk, reversed_at__isnull=True).first()
    )


def reversal_accounts(earning):
    """(rider balance, where the reserve is taken from, platform delivery income) for reverse_earning, for the caller's
    up-front lock; () without an earning. The reserve comes back from the rider's reserve, or from platform commission
    income once the day's commission was posted."""
    if earning is None:
        return ()
    balance, held = accounts_of(earning.rider)
    taker = posting.account_for(Account.PLATFORM_COMMISSION_INCOME) if earning.commission_posting_id else held
    return balance, taker, posting.account_for(Account.PLATFORM_DELIVERY_INCOME)


def reverse_earning(earning, now=None):
    """The whole order is refunded after release, delivery fee included, so the rider's pay for it comes back first:
    Dr rider balance (the net; it may go below zero, recovered from later deliveries, and blocks withdrawals meanwhile),
    Dr the reserve (or platform commission income once posted: AshantiHub gives its commission back), Cr platform
    delivery income, from which the refund then returns the fee. Call with the earning locked (earning_to_reverse) and
    reversal_accounts(earning) in the caller's one up-front lock. Idempotent on its key."""
    now = now or timezone.now()
    balance, taker, delivery_income = reversal_accounts(earning)
    debits = []
    if earning.net_pesewas:
        debits.append(posting.debit(balance, earning.net_pesewas))
    if earning.reserve_pesewas:
        debits.append(posting.debit(taker, earning.reserve_pesewas))
    journal = posting.post(
        key=reversal_key(earning.order), kind="rider_earning_reversal",
        lines=[*debits, posting.credit(delivery_income, earning.gross_pesewas)],
        reference_type="orders.order", reference_id=str(earning.order_id),
        memo=f"Order #{earning.order_id} refunded in full: its delivery fee taken back from the rider",
        allow_negative={Account.RIDER_BALANCE},
    )
    earning.reversed_at, earning.reversal_journal = now, journal
    earning.save(update_fields=["reversed_at", "reversal_journal"])
    # Tell the rider: money left their balance (possibly below zero, which blocks withdrawals). This runs inside the refund's
    # transaction; notify only creates a row. The day's RiderCommissionPosting row is never edited (records are append-only);
    # the rider's days and the Accountant's commission report show the commission given back from the reversed earnings.
    from notifications.services import notify_staff_on_commit

    notify_staff_on_commit(
        earning.rider.staff, REVERSAL_NOTICE_KIND, "A delivery was taken back",
        body=_reversal_text(earning, posting.balance_of(Account.RIDER_BALANCE, earning.rider.staff)),
        link="/staff", icon="↩️",
    )
    return journal


REVERSAL_NOTICE_KIND = "rider_earning_reversed"


def _reversal_text(earning, balance):
    """What the rider is told: what came out of their balance (nothing to say when the rate was 100%) and, when the
    balance is now below zero, that withdrawals wait until later deliveries bring it back."""
    from .money import from_pesewas

    if earning.net_pesewas:
        text = f"Order #{earning.order_id} was refunded in full, so GH₵ {from_pesewas(earning.net_pesewas)} came back out of your balance."
    else:
        text = f"Order #{earning.order_id} was refunded in full, so its delivery fee was taken back (it had left nothing in your balance)."
    if balance < 0:
        text += (
            f" Your balance is now GH₵ -{from_pesewas(-balance)}, below zero. You cannot withdraw until your later "
            "deliveries bring it back to zero or more."
        )
    return text


def check_reversal(earning, delivery_returned):
    """Raise RefundError (409) unless the earning being taken back equals what the refund then returns out of platform delivery
    income: the delivery fee it gives back plus the free-delivery promo charge it returns to the business. Otherwise
    platform delivery income would be left over or short."""
    from . import escrow

    promo = JournalLine.objects.filter(journal__key=escrow.waiver_key(earning.order), side=JournalLine.DEBIT).aggregate(
        total=Sum("amount"))["total"] or 0
    if earning.gross_pesewas != delivery_returned + promo:
        from .refunds import RefundError

        raise RefundError(
            f"Order #{earning.order_id}: the rider was paid {earning.gross_pesewas} pesewas, but this refund returns "
            f"{delivery_returned} of delivery fee and {promo} of promo charge. Ask a developer to check the order.", 409,
        )
