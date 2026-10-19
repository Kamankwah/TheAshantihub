"""Texts to a business about its money (spec §6; vendor plan 4): an outbox, so a text can never stop the payment or
release that asked for it ("SMS failure never blocks payment (queued, retried)").

* `queue` writes one VendorText (idempotent on its key) inside the caller's transaction, in a savepoint, and never
  raises; the send waits for the commit (`transaction.on_commit`, robust), so a rolled-back payment texts nobody. The
  hand-off is a lambda (Django's robust handler logs `func.__qualname__`, which a `functools.partial` lacks) and
  catches and logs its own errors, so a broker that is down never breaks the commit.
* `deliver` sends one due text through otp.senders (the one door for texts: simulated / locmem / Hubtel), outside any
  transaction. It claims the row first with one conditional UPDATE that also pushes `next_attempt_at` out by LEASE, so
  two workers never send it at once; a worker that dies mid-send leaves it to be tried again after the lease (a text may
  then go twice: at least once, never lost). A failure is retried after 5 minutes, 15 minutes, 1 hour and 4 hours, then
  given up (FAILED; five tries in all); a business whose login phone is not a confirmed Ghana mobile (an otp.VerifiedContact: a stricter
  rule than lock notices) gets none (NO_PHONE). Every status change after the claim is conditional on the text
  still being queued with the claim's `attempts` value (a fencing token), so a worker that finishes after its lease ran out cannot undo what another did (it returns None). The in-app copy stays
  either way.
* A sent text is counted by the SMS-spend alert (otp.spend, spec §9) with the code texts. It is never an OtpEvent: those
  rows are what the code send limits count, and a busy shop's order texts must never use up its own sign-in codes.
* Bodies are plain GSM-7 characters ("GHS", never "GH₵", which would make every text cost about three times as much), at
  most two text parts (306 characters), and hold no customer's name, phone or address. Never logged."""
import logging
import string
import time
from dataclasses import dataclass
from datetime import timedelta

from django.core.cache import cache
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from accounts.models import BusinessOwner
from accounts.phones import mask_phone
from ledger import escrow, posting, settings_store
from ledger.models import Account, Journal, JournalLine, OrderFeeSnapshot
from ledger.money import to_pesewas
from marketing.models_waivers import DeliveryWaiver, WaivedFeeCharge
from notifications.services import notify_business_owner
from otp import senders, spend
from otp.identity import contacts, ref
from otp.models import SMS, VerifiedContact

from . import vendor
from .models import VendorPreference, VendorText
from .services import money

logger = logging.getLogger(__name__)

LEASE = timedelta(minutes=10)
BACKOFF = (timedelta(minutes=5), timedelta(minutes=15), timedelta(hours=1), timedelta(hours=4))
MAX_ATTEMPTS = len(BACKOFF) + 1
SEND_BUDGET = timedelta(seconds=75)                         # send_due stops well inside its 280 s beat expiry and the lease
MAX_CONSECUTIVE_FAILURES = 3                                # ...or when the provider looks down
BREAKER_KEY = "vendor-texts-provider-down"                   # set (cache, shared by every worker) while the provider looks down
BREAKER_COUNT_KEY = "vendor-texts-provider-failures"
BREAKER_TTL = 120                                           # seconds the breaker stays open, and the window failures are counted in
MAX_LENGTH = 306                                            # two GSM-7 parts of 153 characters
PLAIN = frozenset(string.ascii_letters + string.digits + " .,:;#'()-/!?&%+")
STATUS_LABELS = {
    VendorText.QUEUED: "Waiting to send", VendorText.SENT: "Sent", VendorText.FAILED: "Could not be sent",
    VendorText.NO_PHONE: "Not sent: no confirmed Ghana mobile number on your account",
}
SIMULATED_LABEL = "Not sent: texts are simulated"
NO_PHONE_NOTE = (
    "Money texts go only to a Ghana mobile number you have confirmed with a code. Yours is not confirmed, so your money "
    "notices stay in the app."
)


def fits(body):
    """True for a body that is plain GSM-7 characters and at most two text parts."""
    return bool(body) and len(body) <= MAX_LENGTH and all(char in PLAIN for char in body)


def confirmed_phone(owner):
    """The Ghana mobile number a business's money texts go to: its login phone, and only when it is a confirmed contact
    (otp.VerifiedContact: a code sent to it was accepted - registration neither normalises nor verifies phones, and a
    mistyped or recycled number must never receive a shop's order amounts; a stricter rule than lock notices). None
    otherwise."""
    phone = contacts(owner).get(SMS)
    account_type, account_id = ref(owner)
    if phone and VerifiedContact.objects.filter(
        account_type=account_type, account_id=account_id, channel=SMS, destination=phone,
    ).exists():
        return phone
    return None


def queue(owner, kind, key, body, *, order=None, day=None, notification=None, now=None):
    """Queue one text to the business (once per `key`) and send it once the caller's transaction commits. Returns the
    VendorText, or None when it could not be queued (logged by type only). Never raises."""
    now = now or timezone.now()
    try:
        if not fits(body):
            raise ValueError("A business text must be plain characters, two parts at most")
        with transaction.atomic():  # a savepoint: a failure here must not break the caller's transaction
            text, created = VendorText.objects.get_or_create(key=key, defaults={
                "business_owner": owner, "kind": kind, "order": order, "day": day, "body": body,
                "next_attempt_at": now, "notification": notification,
            })
        if created:
            transaction.on_commit(lambda pk=text.pk: _send_soon(pk), robust=True)
    except Exception as exc:  # noqa: BLE001 - spec §6: a text never blocks the money movement that asked for it
        logger.error("Business text %s not queued: %s", kind, type(exc).__name__)
        return None
    return text


def _send_soon(pk):
    """After commit: hand the text to a worker. A broker that cannot be reached is fine (send_due_vendor_texts picks
    the text up within 5 minutes). Never raises: a text never stops the payment or release that queued it."""
    try:
        from .tasks import send_vendor_text

        send_vendor_text.delay(pk)
    except Exception as exc:  # noqa: BLE001
        logger.error("Business text %s not handed to a worker: %s", pk, type(exc).__name__)


def breaker_open():
    """True while the provider looks down (MAX_CONSECUTIVE_FAILURES failures in a row, across processes): texts stay queued
    for a later run instead of calling it."""
    return bool(cache.get(BREAKER_KEY))


def _provider_failed():
    cache.add(BREAKER_COUNT_KEY, 0, BREAKER_TTL)
    try:
        count = cache.incr(BREAKER_COUNT_KEY)
    except ValueError:  # expired between the two calls
        count = 1
    if count >= MAX_CONSECUTIVE_FAILURES:
        cache.set(BREAKER_KEY, 1, BREAKER_TTL)


def _provider_worked():
    cache.delete(BREAKER_COUNT_KEY)


def deliver(pk, now=None):
    """Send text `pk` if it is queued and due. Returns its new status, or None when it was not due or another sender
    holds it. Call outside any transaction: a real provider's call is a network round trip. The claim is one conditional
    UPDATE (still queued and due), and every later status change is conditional on the text still being queued, so a
    worker that finishes after its lease ran out cannot undo what another worker did."""
    now = now or timezone.now()
    if breaker_open():
        return None  # left queued; a later run tries it
    # attempts below MAX_ATTEMPTS + 2: a text whose worker keeps dying mid-send is not claimed for ever
    claimed = VendorText.objects.filter(
        pk=pk, status=VendorText.QUEUED, next_attempt_at__lte=now, attempts__lt=MAX_ATTEMPTS + 2,
    ).update(
        attempts=F("attempts") + 1, last_attempt_at=now, next_attempt_at=now + LEASE,
    )
    if not claimed:
        return None
    text = VendorText.objects.select_related("business_owner").get(pk=pk)
    # The claim bumped `attempts`; that value is this worker's fencing token. If the lease runs out and another worker
    # re-claims the text, `attempts` moves on and every write below matches nothing: a late worker changes nothing.
    mine = VendorText.objects.filter(pk=pk, status=VendorText.QUEUED, attempts=text.attempts)
    if text.business_owner.is_suspended:  # suspended since it was queued: never sent, and not left to go out when lifted
        return VendorText.FAILED if mine.update(status=VendorText.FAILED) else None
    phone = confirmed_phone(text.business_owner)
    if not phone:
        return VendorText.NO_PHONE if mine.update(status=VendorText.NO_PHONE) else None
    try:
        delivery = senders.deliver(SMS, phone, "", text.body)
    except Exception:
        if text.attempts >= MAX_ATTEMPTS:  # a text that keeps raising is given up, not retried for ever
            mine.update(status=VendorText.FAILED)
        raise
    hint, provider = mask_phone(phone), (delivery.provider or "")[:20]
    if delivery.ok:
        _provider_worked()
        if not mine.update(
            status=VendorText.SENT, sent_at=now, provider=provider, provider_ref=(delivery.ref or "")[:64], to_hint=hint,
        ):
            return None
        spend.check_quietly(now)
        return VendorText.SENT
    _provider_failed()
    if text.attempts >= MAX_ATTEMPTS:
        return VendorText.FAILED if mine.update(status=VendorText.FAILED, provider=provider, to_hint=hint) else None
    if not mine.update(next_attempt_at=now + BACKOFF[text.attempts - 1], provider=provider, to_hint=hint):
        return None
    return VendorText.QUEUED


def send_due(now=None, limit=200):
    """Send the texts that are due, oldest first: first tries whose send after commit was lost, and retries. One text
    that raises is logged and skipped. Returns how many were sent. `now` only decides what is due: each text is claimed and
    stamped at its own time (a run of 200 against a slow provider can outlast the lease, and a claim made late in it must
    get a lease that starts then, or an overlapping run would claim the same text and send it twice)."""
    now = now or timezone.now()
    due = list(
        VendorText.objects.filter(status=VendorText.QUEUED, next_attempt_at__lte=now)
        .order_by("next_attempt_at", "pk").values_list("pk", flat=True)[:limit]
    )
    sent = 0
    started = time.monotonic()
    for pk in due:
        if time.monotonic() - started >= SEND_BUDGET.total_seconds() or breaker_open():
            break  # the rest wait for the next run; a slow or down provider must not hold the worker past its lease
        try:
            status = deliver(pk)  # claimed and stamped at its own time
        except Exception as exc:  # noqa: BLE001 - one bad row never stops the rest
            logger.error("Business text %s not sent: %s", pk, type(exc).__name__)
            continue
        if status == VendorText.SENT:
            sent += 1
    return sent


def row(text):
    """A text as its business sees it. A text the simulated provider "sent" says it was not sent."""
    simulated = text.status == VendorText.SENT and text.provider == "simulated"
    return {
        "id": text.pk, "kind": text.kind, "order": text.order_id, "day": text.day, "body": text.body,
        "status": text.status, "status_label": SIMULATED_LABEL if simulated else STATUS_LABELS[text.status],
        "to": text.to_hint, "created_at": text.created_at,
        "simulated": simulated, "sent_at": None if simulated else text.sent_at,  # a simulated text was never sent
    }


# --- texts on a paid order and on release (Task 6) -----------------------------------------------------------------

VENDOR_MONEY = "vendor_money"  # the in-app kind of a release or digest text's copy (Notification kinds are free slugs)
OWNER_TYPE = BusinessOwner._meta.label_lower
OWNER_KEY = "business_owner"  # otp.identity.ref / Withdrawal.holder_type of a business


@dataclass(frozen=True)
class Amounts:
    """One business's share of a paid order, in pesewas: its item subtotal, the platform fee snapshotted on it, and the
    free-delivery promo it owes for the order (taken from its Available at release)."""

    subtotal: int
    fee: int
    promo: int

    @property
    def due(self):
        return self.subtotal - self.fee - self.promo


def paid_key(order, owner):
    return f"paid-{order.pk}-{owner.pk}"


def released_key(order, owner):
    return f"released-{order.pk}-{owner.pk}"


def paid_amounts(order):
    """{business owner pk: Amounts} for an order whose payment the ledger has just recorded (its fee snapshots); {} when
    it was not (ledger off, a GH₵ 0.00 order, one paid before the ledger was on). A business whose lines are worth
    nothing is left out. Never raises: it runs inside the payment."""
    if not escrow.enabled():
        return {}  # ledger off: nothing new runs, not even a savepoint
    try:
        with transaction.atomic():
            if not Journal.objects.filter(key=escrow.pay_key(order)).exists():
                return {}
            totals = {}
            for snap in OrderFeeSnapshot.objects.filter(order=order).order_by("pk"):
                base, fee = totals.get(snap.business_owner_id, (0, 0))
                totals[snap.business_owner_id] = (base + snap.base_pesewas, fee + snap.charged_pesewas)
            promos = {
                charge.business_owner_id: to_pesewas(charge.amount)
                for charge in WaivedFeeCharge.objects.filter(
                    order=order, funded_by=DeliveryWaiver.FUNDER_BUSINESS, status=WaivedFeeCharge.OWED)
            }
    except Exception as exc:  # noqa: BLE001 - a text never stops a payment
        logger.error("Paid-order texts not worked out: %s", type(exc).__name__)
        return {}
    return {pk: Amounts(base, fee, promos.get(pk, 0)) for pk, (base, fee) in totals.items() if base > 0}


def _promo_part(promo):
    return f", free-delivery promo GHS {money(promo)}" if promo else ""


def paid_text(order, amounts):
    """Spec §6: reference, item subtotal, platform fee, amount due."""
    head = (
        f"AshantiHub: order #{order.pk} paid. Items GHS {money(amounts.subtotal)}, platform fee GHS {money(amounts.fee)}"
        f"{_promo_part(amounts.promo)}"
    )
    if amounts.due < 0:  # the free-delivery promo costs more than the sale earns: say so, never a negative "due to you"
        return (
            f"{head}. GHS {money(-amounts.due)} will come off your balance after hand-over: free-delivery cost exceeds "
            "this sale."
        )
    return f"{head}, due to you GHS {money(amounts.due)} after hand-over and Support's check."


def paid_line(amounts):
    """The money line added to the in-app "New order" notice (the paid text's in-app copy)."""
    if amounts.due < 0:
        return (
            f"Platform fee GHS {money(amounts.fee)}{_promo_part(amounts.promo)}; GHS {money(-amounts.due)} will come off "
            "your balance after hand-over: free-delivery cost exceeds this sale."
        )
    return (
        f"Platform fee GHS {money(amounts.fee)}{_promo_part(amounts.promo)}; due to you GHS {money(amounts.due)} once the "
        "order is handed over and Support has checked it."
    )


def released_text(order, released, fee, promo):
    """Spec §6 "second SMS on release": what reached Available, the fee taken, and a promo taken after."""
    then = f" GHS {money(promo)} free-delivery promo was then taken from it." if promo else ""
    return (
        f"AshantiHub: order #{order.pk} released. GHS {money(released)} added to your Available balance after the "
        f"GHS {money(fee)} platform fee.{then}"
    )


def promo_only_text(order, promo):
    """A business whose free-delivery promo is taken at this release but whose own share of the order is nothing."""
    return f"AshantiHub: order #{order.pk} released. GHS {money(promo)} free-delivery promo was taken from your Available balance."


def order_released(order, journal):
    """The release text and its in-app copy for each business the release paid, worked out from the journal just
    written (`journal`, the release's): its Pending debit (the subtotal released), its Available credit (that less the fee) and a free-delivery
    promo charged right after (ledger.escrow.charge_waiver). Called inside the release's transaction after every posting;
    takes no new row lock beyond foreign-key key-share locks, and never raises. Returns how many texts were queued."""
    try:
        with transaction.atomic():
            shares = {}
            lines = JournalLine.objects.filter(
                journal=journal, account__owner_type=OWNER_TYPE,
                account__kind__in=(Account.VENDOR_PENDING, Account.VENDOR_AVAILABLE),
            ).select_related("account")
            for line in lines:
                share = shares.setdefault(int(line.account.owner_id), {"base": 0, "released": 0, "promo": 0})
                if line.account.kind == Account.VENDOR_PENDING and line.side == JournalLine.DEBIT:
                    share["base"] += line.amount
                elif line.account.kind == Account.VENDOR_AVAILABLE and line.side == JournalLine.CREDIT:
                    share["released"] += line.amount
            promo_lines = JournalLine.objects.filter(
                journal__key=escrow.waiver_key(order), side=JournalLine.DEBIT, account__owner_type=OWNER_TYPE,
            ).select_related("account")
            for line in promo_lines:  # a business can owe a promo without a Pending debit on this release
                share = shares.setdefault(int(line.account.owner_id), {"base": 0, "released": 0, "promo": 0})
                share["promo"] += line.amount
            owners = BusinessOwner.objects.in_bulk(list(shares))
    except Exception as exc:  # noqa: BLE001 - spec §6: a text never stops a release
        logger.error("Release texts not worked out: %s", type(exc).__name__)
        return 0
    queued = 0
    for pk in sorted(shares):
        share, owner = shares[pk], owners.get(pk)
        if owner is None or (share["base"] <= 0 and share["promo"] <= 0):
            continue
        if VendorText.objects.filter(key=released_key(order, owner)).exists():
            continue  # already texted (and noticed): a re-run adds neither
        # A suspended business keeps its in-app notice but gets no text, now or later: nothing is queued, so lifting the
        # suspension backfills nothing.
        if share["base"] <= 0:
            body = promo_only_text(order, share["promo"])
        else:
            body = released_text(order, share["released"], share["base"] - share["released"], share["promo"])
        try:
            with transaction.atomic():  # a savepoint: a database error here must not poison the release's transaction
                notice = notify_business_owner(
                    owner, VENDOR_MONEY, f"Order #{order.pk} released", body=body, link="/business-dashboard", icon="💰",
                )
                if owner.is_suspended:
                    continue
                if queue(owner, VendorText.ORDER_RELEASED, released_key(order, owner), body, order=order, notification=notice) is not None:
                    queued += 1
        except Exception as exc:  # noqa: BLE001 - a text never stops a release
            logger.error("Release text not queued: %s", type(exc).__name__)
    return queued


# --- refunds, withdrawals and balance warnings (wallet rulings 7D, Task 3) --------------------------------------------
# Every builder returns at once for a suspended business: no money text, no row (so nothing is waiting to be sent if the
# suspension is lifted). A builder never raises: it runs inside the money transaction. No payout number is ever in a body.

def refund_key(order, owner):
    return f"refund-{order.pk}-{owner.pk}"


def refund_text(order, owner, amount, where=""):
    """The business's share of a refund on a paid order (`amount` pesewas, the fee given back already taken off), with its
    in-app copy (kept for a suspended business). One per order and business."""
    try:
        with transaction.atomic():  # a savepoint: a database error here must not poison the refund's transaction
            if amount <= 0 or VendorText.objects.filter(key=refund_key(order, owner)).exists():
                return None
            body = f"AshantiHub: order #{order.pk} was refunded to the customer. GHS {money(amount)} came off your {where or 'balance'}."
            notice = notify_business_owner(
                owner, VENDOR_MONEY, f"Order #{order.pk} refunded", body=body, link="/business-dashboard", icon="💰",
            )
            if owner.is_suspended:
                return None
            return queue(owner, VendorText.REFUND, refund_key(order, owner), body, order=order, notification=notice)
    except Exception as exc:  # noqa: BLE001 - a text never stops a refund
        logger.error("Refund text not queued: %s", type(exc).__name__)
        return None


WITHDRAWAL_STATES = ("requested", "paid", "failed")


def withdrawal_text(withdrawal, state):
    """A withdrawal's step ("requested", "paid", "failed") texted to the business that holds it, once per step. The in-app
    notice is the payouts module's own. The body names no destination."""
    try:
        if state not in WITHDRAWAL_STATES or withdrawal.holder_type != OWNER_KEY:
            return None
        with transaction.atomic():  # a savepoint: a database error here must not poison the payout's transaction
            owner = BusinessOwner.objects.filter(pk=withdrawal.holder_id).first()
            if owner is None or owner.is_suspended:
                return None
            if state == "requested":
                body = f"AshantiHub: withdrawal of GHS {money(withdrawal.amount_pesewas)} requested. We will text you when it is paid."
            elif state == "paid":
                body = f"AshantiHub: withdrawal paid. GHS {money(withdrawal.net_pesewas)} was sent to your payout account."
            else:
                body = f"AshantiHub: withdrawal of GHS {money(withdrawal.amount_pesewas)} did not go through. The money is back in your balance."
            return queue(owner, VendorText.WITHDRAWAL, f"withdrawal-{withdrawal.pk}-{state}", body)
    except Exception as exc:  # noqa: BLE001 - a text never stops a payout
        logger.error("Withdrawal text not queued: %s", type(exc).__name__)
        return None


def balance_text(owner, available, kind):
    """Warn a business its Available balance (`available` pesewas) is below zero (kind "negative") or at or under the low
    setting (kind "low"). At most one per kind per Accra day (the key holds the day). Text only: the balance is on screen."""
    try:
        if kind not in ("negative", "low") or owner.is_suspended:
            return None
        with transaction.atomic():  # a savepoint: a database error here must not poison the posting's transaction
            if kind == "negative":
                body = (
                    f"AshantiHub: your Available balance is below zero (GHS {money(available)}). Withdrawals are paused; "
                    "your next sales will clear it."
                )
            else:
                body = f"AshantiHub: your Available balance is low: GHS {money(available)}."
            return queue(
                owner, VendorText.BALANCE_NEGATIVE if kind == "negative" else VendorText.BALANCE_LOW,
                f"balance-{owner.pk}-{kind}-{timezone.localdate()}", body, day=timezone.localdate(),
            )
    except Exception as exc:  # noqa: BLE001 - a text never stops a posting
        logger.error("Balance text not queued: %s", type(exc).__name__)
        return None


def after_posting(accounts, before):
    """Called by ledger.posting.post with the accounts it just changed and their balances before: texts a business whose
    Available balance has just crossed below zero, or down to the low setting from above it. A balance already there is
    not texted again by every later debit. Never raises."""
    try:
        with transaction.atomic():  # a savepoint: nothing here can break the posting's transaction
            _warn_balances(accounts, before)
    except Exception as exc:  # noqa: BLE001 - a text never stops a posting
        logger.error("Balance texts not worked out: %s", type(exc).__name__)


def _warn_balances(accounts, before):
    threshold = None
    for account in accounts:
        if account.kind != Account.VENDOR_AVAILABLE or account.owner_type != OWNER_TYPE:
            continue
        was, now = before[account.pk], account.balance
        if now >= was:
            continue
        if threshold is None:
            threshold = settings_store.current("vendor_low_balance_pesewas")
        kind = "negative" if now < 0 <= was else "low" if 0 <= now <= threshold < was else None
        if kind is None:
            continue
        owner = BusinessOwner.objects.filter(pk=int(account.owner_id)).first()
        if owner is not None:
            balance_text(owner, now, kind)


# --- the optional daily digest (Task 7) ----------------------------------------------------------------------------

def wants_digest(owner):
    return VendorPreference.objects.filter(business_owner=owner, daily_digest=True).exists()


def digest_key(owner, day):
    return f"digest-{owner.pk}-{day:%Y-%m-%d}"


def digest_text(day, summary, pending, available):
    """`summary` is one day of vendor.daily (GH₵ strings); `pending` and `available` are pesewas now."""
    orders = summary["orders"]
    return (
        f"AshantiHub {day:%d %b}: {orders} order{'' if orders == 1 else 's'} paid, items GHS {summary['sold']}. "
        f"Released GHS {summary['released']}, fees GHS {summary['fees']}, refunds GHS {summary['refunded']}. "
        f"Now Pending GHS {money(pending)}, Available GHS {money(available)}."
    )


def run_digests(day, now=None, *, after_pk=0, batch=None, deadline=None):
    """One batch of `day`'s digests (spec §6, "optional daily digest"), with its in-app copy, for the businesses that
    turned it on, are not suspended and whose money moved that Accra day. Works through them in pk order after
    `after_pk`, at most `batch` of them (default: the digest_batch_size setting) and stopping once `deadline` (a
    time.monotonic() instant; default: now plus the digest_time_budget_seconds setting) has passed, but always handling
    at least one so a run cannot stall. Returns (queued, cursor): how many digests this batch queued, and the last pk
    handled if more businesses remain after it, else None.

    A business already sent that day's digest is skipped, so a re-run, or a catch-up after a killed run, adds nothing;
    two runs at once also give one text and one in-app notice, because the text is queued first (its key is unique)
    and the notice is made only if the text has none yet, under a lock on its row; one business that fails is logged
    and skipped."""
    if batch is None:
        batch = settings_store.current("digest_batch_size")
    if deadline is None:
        deadline = time.monotonic() + settings_store.current("digest_time_budget_seconds")
    owners = BusinessOwner.objects.filter(vendor_preference__daily_digest=True, is_suspended=False, pk__gt=after_pk).order_by("pk")
    queued, handled, last = 0, 0, None
    for owner in owners.iterator():
        if handled and (handled >= batch or time.monotonic() >= deadline):
            break
        handled, last = handled + 1, owner.pk
        queued += _queue_digest(owner, day, now)
    more = last is not None and owners.filter(pk__gt=last).exists()
    return queued, (last if more else None)


def queue_digests(day, now=None, *, after_pk=0, batch=None, deadline=None):
    """`run_digests` for a caller that only needs the cursor: the last pk handled if more businesses remain, else None."""
    return run_digests(day, now, after_pk=after_pk, batch=batch, deadline=deadline)[1]


def _queue_digest(owner, day, now):
    """Queue one business's digest; 1 if this call queued it, else 0."""
    key = digest_key(owner, day)
    if VendorText.objects.filter(key=key, notification__isnull=False).exists():
        return 0
    try:
        days = vendor.daily(owner, day, day)["days"]
        if not days:
            return 0  # nothing moved: no text
        body = digest_text(
            day, days[0], posting.balance_of(Account.VENDOR_PENDING, owner), posting.balance_of(Account.VENDOR_AVAILABLE, owner),
        )
        with transaction.atomic():
            text = queue(owner, VendorText.DAILY_DIGEST, key, body, day=day, now=now)  # first: an overlapping run gets this row
            if text is None:
                return 0
            if VendorText.objects.select_for_update().get(pk=text.pk).notification_id is None:
                notice = notify_business_owner(
                    owner, VENDOR_MONEY, f"Your AshantiHub day, {day:%d %b}", body=body, link="/business-dashboard", icon="💰",
                )
                VendorText.objects.filter(pk=text.pk).update(notification=notice)
                return 1
    except Exception as exc:  # noqa: BLE001 - one business never stops the others' digests
        logger.error("Digest for business %s not worked out: %s", owner.pk, type(exc).__name__)
    return 0
