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
  given up (FAILED; five tries in all); a business whose login phone is not a confirmed Ghana mobile (an otp.VerifiedContact,
  the Stage 2 rule for lock notices) gets none (NO_PHONE). Every status change after the claim is conditional on the text
  still being queued, so a worker that finishes after its lease ran out cannot undo what another did. The in-app copy stays
  either way.
* A sent text is counted by the SMS-spend alert (otp.spend, spec §9) with the code texts. It is never an OtpEvent: those
  rows are what the code send limits count, and a busy shop's order texts must never use up its own sign-in codes.
* Bodies are plain GSM-7 characters ("GHS", never "GH₵", which would make every text cost about three times as much), at
  most two text parts (306 characters), and hold no customer's name, phone or address. Never logged."""
import logging
import string
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from accounts.phones import mask_phone
from otp import senders, spend
from otp.identity import contacts, ref
from otp.models import SMS, VerifiedContact

from .models import VendorText

logger = logging.getLogger(__name__)

LEASE = timedelta(minutes=10)
BACKOFF = (timedelta(minutes=5), timedelta(minutes=15), timedelta(hours=1), timedelta(hours=4))
MAX_ATTEMPTS = len(BACKOFF) + 1
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
    mistyped or recycled number must never receive a shop's order amounts; the Stage 2 rule for lock notices). None
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
    except Exception as exc:  # noqa: BLE001 - spec §6: a text never blocks the money movement that asked for it
        logger.error("Business text %s not queued: %s", kind, type(exc).__name__)
        return None
    if created:
        transaction.on_commit(lambda pk=text.pk: _send_soon(pk), robust=True)
    return text


def _send_soon(pk):
    """After commit: hand the text to a worker. A broker that cannot be reached is fine (send_due_vendor_texts picks
    the text up within 5 minutes). Never raises: a text never stops the payment or release that queued it."""
    try:
        from .tasks import send_vendor_text

        send_vendor_text.delay(pk)
    except Exception as exc:  # noqa: BLE001
        logger.error("Business text %s not handed to a worker: %s", pk, type(exc).__name__)


def deliver(pk, now=None):
    """Send text `pk` if it is queued and due. Returns its new status, or None when it was not due or another sender
    holds it. Call outside any transaction: a real provider's call is a network round trip. The claim is one conditional
    UPDATE (still queued and due), and every later status change is conditional on the text still being queued, so a
    worker that finishes after its lease ran out cannot undo what another worker did."""
    now = now or timezone.now()
    claimed = VendorText.objects.filter(pk=pk, status=VendorText.QUEUED, next_attempt_at__lte=now).update(
        attempts=F("attempts") + 1, last_attempt_at=now, next_attempt_at=now + LEASE,
    )
    if not claimed:
        return None
    text = VendorText.objects.select_related("business_owner").get(pk=pk)
    phone = confirmed_phone(text.business_owner)
    if not phone:
        VendorText.objects.filter(pk=pk, status=VendorText.QUEUED).update(status=VendorText.NO_PHONE)
        return VendorText.NO_PHONE
    delivery = senders.deliver(SMS, phone, "", text.body)
    hint, provider = mask_phone(phone), (delivery.provider or "")[:20]
    if delivery.ok:
        VendorText.objects.filter(pk=pk, status=VendorText.QUEUED).update(
            status=VendorText.SENT, sent_at=now, provider=provider, provider_ref=(delivery.ref or "")[:64], to_hint=hint,
        )
        spend.check_quietly(now)
        return VendorText.SENT
    if text.attempts >= MAX_ATTEMPTS:
        VendorText.objects.filter(pk=pk, status=VendorText.QUEUED).update(status=VendorText.FAILED, provider=provider, to_hint=hint)
        return VendorText.FAILED
    VendorText.objects.filter(pk=pk, status=VendorText.QUEUED).update(
        next_attempt_at=now + BACKOFF[text.attempts - 1], provider=provider, to_hint=hint,
    )
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
    for pk in due:
        try:
            sent += deliver(pk) == VendorText.SENT  # claimed and stamped at its own time
        except Exception as exc:  # noqa: BLE001 - one bad row never stops the rest
            logger.error("Business text %s not sent: %s", pk, type(exc).__name__)
    return sent


def row(text):
    """A text as its business sees it. A text the simulated provider "sent" says it was not sent."""
    simulated = text.status == VendorText.SENT and text.provider == "simulated"
    return {
        "id": text.pk, "kind": text.kind, "order": text.order_id, "day": text.day, "body": text.body,
        "status": text.status, "status_label": SIMULATED_LABEL if simulated else STATUS_LABELS[text.status],
        "to": text.to_hint, "created_at": text.created_at, "sent_at": text.sent_at,
    }
