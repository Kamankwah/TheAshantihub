"""Owner confirmation by texted link (staff-listing pipeline, plan M3).

Staff draft listings for a client business, and may register the business itself. Nothing goes live and a staff-made
registration cannot pass KYC until the owner confirms by a texted link valid 7 days (and then a second person approves).

* The raw token is made like a claim token (`secrets.token_urlsafe(32)`), stored only as its SHA-256 hash, single use,
  and exists only in the text body (and the owner's browser). It is never returned, logged, put in an activity body or
  a notice, and no staff response carries the link or the hash: staff see `state_of` (masked number, times, a state).
* One live link per owner (also a partial unique constraint). A new link revokes the older ones and takes over every
  draft still awaiting the owner on them, and the registration if still unconfirmed, so revoking strands nothing.
* Lock order for every mutation: the BusinessOwner row, then the owner's OwnerConfirmation rows, then ListingDraft
  rows, then the activity chain (last). The public confirm and decline find the row by hash WITHOUT a lock, lock the
  owner, then re-read and lock the confirmation and check it again, so they cannot deadlock with `request_confirmation`.
* The text goes after commit through `otp.senders` (the one door for texts), never inside a transaction. The row says
  honestly what happened: `sent`, `failed`, `simulated` (nothing left the building) or `no_phone`. It is counted by
  `otp.spend` and is never an OtpEvent.
"""
import logging
import secrets
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.claims import ClaimError, hash_token
from accounts.models import BusinessOwner, StaffUser
from accounts.phones import filter_by_phone, mask_phone, normalize_gh_phone
from activity.services import record
from notifications.services import notify_staff, notify_staff_on_commit
from otp import senders, spend
from otp.models import SMS
from wallets import vendor_texts

from .models import ListingDraft, OwnerConfirmation

logger = logging.getLogger(__name__)

LINK_TTL = timedelta(days=7)
RESEND_LIMIT = 3  # per draft per Accra day
MAX_BODY = 306

INVALID = "This link isn't valid. Check you opened the whole link, or ask AshantiHub for a new one."
USED = "This link has already been used or replaced. Ask AshantiHub for a new one if you still need to confirm."
EXPIRED = "This link has expired. Ask AshantiHub to send a new one."
NOTHING = "There is nothing to ask the owner to confirm."
NOT_CONFIRMABLE = "One of these drafts can't be sent to the owner in its present state."
NOT_SENT_YET = "This draft has not been sent to the owner yet."
ALREADY_ANSWERED = "The owner has already answered, so there is nothing to resend."
STILL_OPEN = "The link was sent and is still valid. Resend it only if it lapsed or the text did not go out."
RESEND_LIMITED = "A link can be resent three times a day. Try again tomorrow."
TOO_LONG = "The text for this business would be too long."
MIXED_OWNERS = "Those drafts belong to different businesses."

SEND_NOTES = {
    OwnerConfirmation.QUEUED: "Waiting to send",
    OwnerConfirmation.SENT: "Text sent",
    OwnerConfirmation.FAILED: "Not sent: the text could not be delivered",
    OwnerConfirmation.SIMULATED: "Not sent: texts are simulated",
    OwnerConfirmation.NO_PHONE: "Not sent: no phone number on file",
    OwnerConfirmation.BLOCKED: "Not sent: that number belongs to a staff account",
}
LAPSED = "lapsed"


def needs_owner_text(owner):
    """Whether this business's staff-made items wait for the owner's texted confirmation. Always True today; a later
    plan flips it for a company-owned business."""
    return True


def confirm_link(raw):
    return f"{settings.FRONTEND_BASE_URL}/business/confirm?token={raw}"


def _is_open(confirmation):
    return confirmation.confirmed_at is None and confirmation.declined_at is None and confirmation.revoked_at is None


_OPEN = Q(confirmed_at__isnull=True, declined_at__isnull=True, revoked_at__isnull=True)


def registration_confirmed(owner):
    """True unless a staff-registered business has a registration confirmation request and none was confirmed.
    (a) not registered by staff, (b) a registration link confirmed, or (c) no registration link was ever made
    (grandfathered: rows are never deleted, and staff registration creates its row with the owner) -> True."""
    if owner.registration_channel != BusinessOwner.SCOUT or owner.registered_by_id is None:
        return True
    rows = OwnerConfirmation.objects.filter(business_owner=owner, scope=OwnerConfirmation.REGISTRATION)
    if rows.filter(confirmed_at__isnull=False).exists():
        return True
    return not rows.exists()


def _registration_row_confirmed(owner):
    return OwnerConfirmation.objects.filter(
        business_owner=owner, scope=OwnerConfirmation.REGISTRATION, confirmed_at__isnull=False,
    ).exists()


# --- the text -------------------------------------------------------------------------------------------------------

def _plain(text, limit):
    kept = "".join(char for char in (text or "") if char in vendor_texts.PLAIN)
    return " ".join(kept.split())[:limit].strip()


def _body(staff, business, count, link):
    first = _plain((staff.full_name or "").split(" ")[0], 20) or "Our team"
    items = f"{count} item" + ("" if count == 1 else "s")
    head, tail = f"AshantiHub: {first} asks you to confirm {items} for ", f". Open {link}. Valid 7 days."
    room = MAX_BODY - len(head) - len(tail)
    name = _plain(business, 200) or "your business"
    if len(name) > room:
        name = name[: max(room - 2, 1)].rstrip() + ".."
    return head + name + tail


def _send_after_commit(pk, phone, body):
    """Send the text and record what happened. Called after commit, outside any transaction; never raises."""
    try:
        delivery = senders.deliver(SMS, phone, "", body)
        now = timezone.now()
        if not delivery.ok:
            state, sent_at = OwnerConfirmation.FAILED, None
        elif delivery.provider == "simulated":
            state, sent_at = OwnerConfirmation.SIMULATED, None  # nothing was sent: never pretend
        else:
            state, sent_at = OwnerConfirmation.SENT, now
        OwnerConfirmation.objects.filter(pk=pk, send_state=OwnerConfirmation.QUEUED).update(
            send_state=state, sent_at=sent_at,
        )
        if state == OwnerConfirmation.SENT:
            spend.check_quietly(now)
    except Exception as exc:  # noqa: BLE001 - a text never fails the request that asked for it; log the type only
        logger.error("Owner confirmation text %s not sent: %s", pk, type(exc).__name__)
        try:
            OwnerConfirmation.objects.filter(pk=pk, send_state=OwnerConfirmation.QUEUED).update(
                send_state=OwnerConfirmation.FAILED,
            )
        except Exception:  # noqa: BLE001
            pass


# --- issuing --------------------------------------------------------------------------------------------------------

def _resendable(confirmation, now):
    """A link may be resent when it lapsed, was revoked, or its text failed or had no number."""
    if confirmation.revoked_at is not None:
        return True
    if confirmation.confirmed_at is not None or confirmation.declined_at is not None:
        return False
    return confirmation.expires_at <= now or confirmation.send_state in (
        OwnerConfirmation.FAILED, OwnerConfirmation.NO_PHONE,
    )


def _issue(owner, staff, drafts, registration, *, resend=False, source=None):
    explicit = {draft.pk for draft in drafts}
    with transaction.atomic():
        locked = BusinessOwner.objects.select_for_update().get(pk=owner.pk)  # 1. the owner
        now = timezone.now()
        today = timezone.localdate(now)
        # 2. the owner's links that are not answered (open or revoked), in key order
        links = {
            link.pk: link for link in OwnerConfirmation.objects.select_for_update().filter(
                business_owner=locked, confirmed_at__isnull=True, declined_at__isnull=True,
            ).order_by("pk")
        }
        # 3. the explicit drafts and every draft still awaiting the owner, in key order
        found = list(
            ListingDraft.objects.select_for_update().filter(business_owner=locked)
            .filter(Q(pk__in=explicit) | Q(status=ListingDraft.AWAITING_OWNER)).order_by("pk")
        )
        if explicit - {draft.pk for draft in found}:
            raise ClaimError(NOT_CONFIRMABLE, code="not_confirmable")
        for draft in found:
            if draft.pk not in explicit:
                continue
            if resend:
                if draft.status != ListingDraft.AWAITING_OWNER:
                    if draft.status == ListingDraft.DRAFT:
                        raise ClaimError(NOT_SENT_YET, code="not_sent")
                    raise ClaimError(ALREADY_ANSWERED, code="used")
                current = links.get(draft.confirmation_id)
                if current is not None and not _resendable(current, now):
                    raise ClaimError(STILL_OPEN, code="still_open")
            elif draft.status not in (ListingDraft.DRAFT, ListingDraft.AWAITING_OWNER):
                raise ClaimError(NOT_CONFIRMABLE, code="not_confirmable")

        olds = [link for link in links.values() if _is_open(link)]
        want_registration = registration or (source is not None and source.scope == OwnerConfirmation.REGISTRATION)
        if source is not None:
            held = links.get(source.pk)
            if held is None:  # confirmed or declined meanwhile
                raise ClaimError(ALREADY_ANSWERED, code="used")
            if not _resendable(held, now):
                raise ClaimError(STILL_OPEN, code="still_open")
        take_registration = (want_registration or any(
            link.scope == OwnerConfirmation.REGISTRATION for link in olds
        )) and not _registration_row_confirmed(locked)
        if not found and not take_registration:
            raise ClaimError(NOTHING, code="nothing_to_confirm")

        if resend:
            for draft in found:
                used = draft.resends_today if draft.resend_day == today else 0
                if used >= RESEND_LIMIT:
                    raise ClaimError(RESEND_LIMITED, code="rate_limited", status_code=429)
            if not found:
                start = timezone.make_aware(datetime.combine(today, time.min))
                tried = OwnerConfirmation.objects.filter(
                    business_owner=locked, scope=OwnerConfirmation.REGISTRATION, resend_count__gt=0, created_at__gte=start,
                ).count()
                if tried >= RESEND_LIMIT:
                    raise ClaimError(RESEND_LIMITED, code="rate_limited", status_code=429)

        count = len(found) + (1 if take_registration else 0)
        raw = secrets.token_urlsafe(32)
        confirm_url = confirm_link(raw)
        body = _body(staff, locked.display_name, count, confirm_url)
        if not vendor_texts.fits(body):
            raise ClaimError(TOO_LONG, code="too_long")
        try:
            phone = normalize_gh_phone(locked.login_phone)
        except ValueError:
            phone = ""
        # A staff member's own number must never receive a token (they could confirm their own listing). One query.
        blocked = bool(phone) and filter_by_phone(StaffUser.objects.filter(is_active=True), "phone", phone).exists()

        previous = [link.resend_count for link in links.values()]
        if olds:
            OwnerConfirmation.objects.filter(pk__in=[link.pk for link in olds]).update(revoked_at=now)
        row = OwnerConfirmation.objects.create(
            business_owner=locked,
            scope=OwnerConfirmation.REGISTRATION if take_registration else OwnerConfirmation.LISTINGS,
            token_hash=hash_token(raw), sent_to=phone, expires_at=now + LINK_TTL, created_by=staff,
            send_state=(
                OwnerConfirmation.BLOCKED if blocked else OwnerConfirmation.QUEUED if phone else OwnerConfirmation.NO_PHONE
            ),
            resend_count=(max(previous, default=0) + 1) if resend else 0,
        )
        if found:
            for draft in found:
                if resend:
                    draft.resends_today = (draft.resends_today if draft.resend_day == today else 0) + 1
                    draft.resend_day = today
                draft.status, draft.confirmation = ListingDraft.AWAITING_OWNER, row
                draft.save(update_fields=["status", "confirmation", "resends_today", "resend_day", "updated_at"])
        record(
            staff, "owner_confirmation.resent" if resend else "owner_confirmation.sent", target=row,
            summary=f"Asked the owner to confirm {count} item(s); text to {mask_phone(phone) if phone else 'no number'}",
            after={"scope": row.scope, "items": count, "sent_to": mask_phone(phone) if phone else ""},
        )  # 4. the activity chain, last
        if phone and not blocked:
            transaction.on_commit(lambda: _send_after_commit(row.pk, phone, body), robust=True)
    return row


def request_confirmation(owner, staff, *, drafts=(), registration=False):
    """Ask the owner, by one texted link, to confirm `drafts` and (when `registration`) the business registration.
    Revokes the owner's older links; the new one takes over what was still waiting on them. Returns the row; the
    raw token is only in the text."""
    return _issue(owner, staff, list(drafts), bool(registration))


def resend(target, staff):
    """A fresh link for a lapsed, revoked or failed one. `target` is an OwnerConfirmation or draft ids/instances of one
    business. Refused for drafts the owner answered, while the link is still good and sent, and past three a day."""
    if isinstance(target, OwnerConfirmation):
        owner = target.business_owner
        drafts = list(ListingDraft.objects.filter(confirmation=target, status=ListingDraft.AWAITING_OWNER))
        return _issue(owner, staff, drafts, False, resend=True, source=target)
    ids = [getattr(item, "pk", item) for item in target]
    drafts = list(ListingDraft.objects.select_related("business_owner").filter(pk__in=ids))
    if not drafts or len(drafts) != len(set(ids)):
        raise ClaimError(NOT_CONFIRMABLE, code="not_confirmable")
    if len({draft.business_owner_id for draft in drafts}) != 1:
        raise ClaimError(MIXED_OWNERS, code="mixed_owners")
    return _issue(drafts[0].business_owner, staff, drafts, False, resend=True)


# --- what staff see -------------------------------------------------------------------------------------------------

def state_of(draft):
    """A draft's confirmation state for staff. No token, hash, link or whole phone number."""
    confirmation = draft.confirmation
    if confirmation is None:
        return {
            "state": draft.status, "sent_to_masked": "", "sent_at": None, "expires_at": None,
            "send_note": "Not sent to the owner yet" if draft.status == ListingDraft.DRAFT else "",
        }
    state = draft.status
    if (
        state == ListingDraft.AWAITING_OWNER and confirmation.confirmed_at is None
        and confirmation.expires_at < timezone.now()
    ):
        state = LAPSED
    return {
        "state": state,
        "sent_to_masked": mask_phone(confirmation.sent_to) if confirmation.sent_to else "",
        "sent_at": confirmation.sent_at,
        "expires_at": confirmation.expires_at,
        "send_note": SEND_NOTES[confirmation.send_state],
    }


# --- the owner's side (Task 6 exposes these) -------------------------------------------------------------------------

def _find(raw):
    raw = raw.strip() if isinstance(raw, str) else ""
    row = OwnerConfirmation.objects.filter(token_hash=hash_token(raw)).first() if raw else None
    if row is None:
        raise ClaimError(INVALID, code="invalid")
    return row


def _check_usable(row, now):
    if row.confirmed_at is not None or row.declined_at is not None or row.revoked_at is not None:
        raise ClaimError(USED, code="used")
    if row.expires_at <= now:
        raise ClaimError(EXPIRED, code="expired")


def _lock_usable(raw, now):
    """Find by hash without a lock, lock the owner, then re-read and lock the row and check it again."""
    found = _find(raw)
    owner = BusinessOwner.objects.select_for_update().get(pk=found.business_owner_id)
    row = OwnerConfirmation.objects.select_for_update().get(pk=found.pk)
    _check_usable(row, now)
    return owner, row


def _item(draft):
    payload = draft.payload if isinstance(draft.payload, dict) else {}
    name = payload.get("name") or payload.get("title") or ""
    price = payload.get("price_amount", payload.get("price"))
    return {"kind": draft.kind, "name": str(name)[:150], "price": None if price in (None, "") else str(price)}


def owner_view(raw):
    """What the owner sees before answering. No phone, no email, nothing of any other business."""
    row = _find(raw)
    _check_usable(row, timezone.now())
    owner = BusinessOwner.objects.select_related("profile").get(pk=row.business_owner_id)
    drafts = row.drafts.filter(status=ListingDraft.AWAITING_OWNER).order_by("pk")
    return {
        "business_name": owner.display_name,
        "owner_name_first": (owner.full_name or "").split(" ")[0],
        "registration": row.scope == OwnerConfirmation.REGISTRATION,
        "items": [_item(draft) for draft in drafts],
        "expires_at": row.expires_at,
    }


def _after_owner_confirmed(drafts):
    """Seam: Task 7 calls submit_draft for each draft here, inside the confirming transaction."""


def confirm(raw, request=None):
    """The owner confirms: their drafts become owner_confirmed and the registration confirmed, in one transaction."""
    with transaction.atomic():
        now = timezone.now()
        _owner, row = _lock_usable(raw, now)
        drafts = list(
            ListingDraft.objects.select_for_update().filter(
                confirmation=row, status=ListingDraft.AWAITING_OWNER,
            ).order_by("pk")
        )
        for draft in drafts:
            draft.status = ListingDraft.OWNER_CONFIRMED
            draft.save(update_fields=["status", "updated_at"])
        row.confirmed_at = now
        row.save(update_fields=["confirmed_at"])
        _after_owner_confirmed(drafts)
    return row


def decline(raw, reason, request=None):
    """The owner says no. Their drafts become owner_declined and the staff who made the request are told; the reason
    goes to staff only."""
    reason = " ".join(str(reason or "").split())[:300]
    with transaction.atomic():
        now = timezone.now()
        owner, row = _lock_usable(raw, now)
        drafts = list(
            ListingDraft.objects.select_for_update(of=("self",)).filter(
                confirmation=row, status=ListingDraft.AWAITING_OWNER,
            ).select_related("created_by").order_by("pk")  # of=self: the staff rows stay unlocked
        )
        for draft in drafts:
            draft.status = ListingDraft.OWNER_DECLINED
            draft.save(update_fields=["status", "updated_at"])
        row.declined_at, row.decline_reason = now, reason
        row.save(update_fields=["declined_at", "decline_reason"])
        makers = {draft.created_by_id: draft.created_by for draft in drafts}
        makers.setdefault(row.created_by_id, row.created_by)
        count = len(drafts) + (1 if row.scope == OwnerConfirmation.REGISTRATION else 0)
        for staff in makers.values():
            notify_staff_on_commit(
                staff, "owner_declined", f"{owner.display_name} declined {count} item(s)",
                body=f"The owner declined what you sent for confirmation. Reason: {reason or 'none given'}",
                link="portfolio", icon="✋",
            )
    return row


# --- lapsed links ----------------------------------------------------------------------------------------------------

def notify_lapsed(now=None):
    """Tell the staff behind each link that lapsed unanswered, once. Returns how many links were announced."""
    now = now or timezone.now()
    due = OwnerConfirmation.objects.filter(_OPEN, expires_at__lte=now, lapse_notified_at__isnull=True)
    announced = 0
    for row in due.select_related("business_owner", "created_by").order_by("pk"):
        if not OwnerConfirmation.objects.filter(pk=row.pk, lapse_notified_at__isnull=True).update(lapse_notified_at=now):
            continue  # another run announced it
        waiting = list(row.drafts.filter(status=ListingDraft.AWAITING_OWNER).select_related("created_by"))
        if not waiting and row.scope != OwnerConfirmation.REGISTRATION:
            continue
        makers = {draft.created_by_id: draft.created_by for draft in waiting}
        makers.setdefault(row.created_by_id, row.created_by)
        for staff in makers.values():
            notify_staff(
                staff, "owner_link_lapsed", f"{row.business_owner.display_name} did not confirm in time",
                body="The 7-day link lapsed. Resend it from the draft to give the owner another 7 days.",
                link="portfolio", icon="⏳",
            )
        announced += 1
    return announced
