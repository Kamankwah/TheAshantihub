"""Recording and reading consent (Marketing M2).

Every change goes through record_consent(): it appends a line (never edits one), copies the wording
the person saw, and (for staff-visible history) leaves the ledger as the only store of the answer.
Nothing here sends anything."""
from django.core import signing
from django.db.models import OuterRef, Subquery
from django.utils import timezone

from accounts.models import BusinessOwner, Customer

from .models_consent import BUSINESS, CHANNEL_LABELS, CUSTOMER, ConsentRecord, ConsentWording

CHANNEL_KEYS = tuple(CHANNEL_LABELS)
UNSUBSCRIBE_SALT = "marketing.unsubscribe"
UNSUBSCRIBE_MAX_AGE = 60 * 60 * 24 * 365 * 3   # a link in an old email still works for 3 years


class ConsentError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


def audience_of(subject):
    if isinstance(subject, Customer):
        return CUSTOMER
    if isinstance(subject, BusinessOwner):
        return BUSINESS
    raise ConsentError("Only customers and businesses can give marketing consent.")


def live_wording(audience, channel):
    """The wording in force for this audience and channel (the latest unretired version), or None."""
    return ConsentWording.objects.filter(audience=audience, channel=channel, retired_at__isnull=True).order_by("-version").first()


def _subject_filter(subject):
    return {"customer": subject} if isinstance(subject, Customer) else {"business_owner": subject}


def current(subject, channel):
    """The latest record for this person and channel, or None (never asked)."""
    return ConsentRecord.objects.filter(channel=channel, **_subject_filter(subject)).order_by("-at", "-id").first()


def is_opted_in(subject, channel):
    row = current(subject, channel)
    return bool(row and row.status == ConsentRecord.OPTED_IN)


def client_details(request):
    if request is None:
        return None, ""
    meta = getattr(request, "META", {}) or {}
    ip = (meta.get("HTTP_X_REAL_IP") or meta.get("REMOTE_ADDR") or "").strip() or None
    return ip, (meta.get("HTTP_USER_AGENT") or "")[:200]


def record_consent(subject, channel, opted_in, source, *, request=None, source_detail="", staff=None, campaign_id=None, force=False):
    """Append a line. Returns the new record, or None if the answer is unchanged (no duplicate lines),
    unless `force`. Opting in needs a live wording; an opt-out is recorded against the wording
    that was in force (or none if the channel had none)."""
    if channel not in CHANNEL_KEYS:
        raise ConsentError("Unknown channel.")
    audience = audience_of(subject)
    wording = live_wording(audience, channel)
    status = ConsentRecord.OPTED_IN if opted_in else ConsentRecord.OPTED_OUT
    if opted_in and wording is None:
        raise ConsentError("There is no wording to agree to for this channel yet.")
    existing = current(subject, channel)
    if not force:
        if existing and existing.status == status:
            return None
    ip, agent = client_details(request)
    prior = existing.wording if (existing and existing.wording_id and not opted_in) else None
    use = wording if opted_in else (prior or wording)
    return ConsentRecord.objects.create(
        channel=channel, status=status, source=source, source_detail=source_detail[:200], wording=use,
        wording_text=use.text if use else "", ip=ip, user_agent=agent, recorded_by=staff, campaign_id=campaign_id,
        **_subject_filter(subject),
    )


def latest_status_subquery(subject_field, channel):
    """Annotation: the status of the latest record for each row's person on `channel`."""
    return Subquery(
        ConsentRecord.objects.filter(**{subject_field: OuterRef("pk")}, channel=channel).order_by("-at", "-id").values("status")[:1]
    )


def state_for(subject):
    """{channel: {"status": 'opted_in'|'opted_out'|None, "at": time|None, "wording": text}} for the account's own settings screen."""
    out = {}
    audience = audience_of(subject)
    for channel in CHANNEL_KEYS:
        row = current(subject, channel)
        wording = live_wording(audience, channel)
        out[channel] = {
            "label": CHANNEL_LABELS[channel], "status": row.status if row else None, "at": row.at if row else None,
            "wording": wording.text if wording else "", "wording_label": wording.label if wording else "",
        }
    return out


def unsubscribe_token(subject, channel, campaign_id=None):
    payload = {"k": "c" if isinstance(subject, Customer) else "b", "id": subject.pk, "ch": channel}
    if campaign_id:
        payload["cp"] = campaign_id
    return signing.dumps(payload, salt=UNSUBSCRIBE_SALT)


def short_stop_token(recipient):
    """The short stop code in an SMS: names one campaign recipient (so one person, one channel, one campaign)."""
    return f"r-{recipient.click_token}"


def read_unsubscribe_token(token):
    """(subject, channel, campaign_id) from a signed link or a short campaign code, or raises ConsentError."""
    if token.startswith("r-"):
        from .models_campaigns import CampaignRecipient

        row = CampaignRecipient.objects.select_related("campaign", "customer", "business_owner").filter(click_token=token[2:]).first()
        if row is None:
            raise ConsentError("This link is not valid or has expired.")
        return row.subject, row.campaign.channel, row.campaign_id
    try:
        data = signing.loads(token, salt=UNSUBSCRIBE_SALT, max_age=UNSUBSCRIBE_MAX_AGE)
        model = Customer if data["k"] == "c" else BusinessOwner
        subject = model.objects.get(pk=data["id"])
        channel = data["ch"]
    except (signing.BadSignature, KeyError, TypeError, Customer.DoesNotExist, BusinessOwner.DoesNotExist):
        raise ConsentError("This link is not valid or has expired.")
    if channel not in CHANNEL_KEYS:
        raise ConsentError("This link is not valid or has expired.")
    return subject, channel, data.get("cp")


def capture_at_signup(subject, choices, request=None, source=ConsentRecord.SIGNUP, detail=""):
    """`choices` = {channel: True|False} from the sign-up form. Only a ticked box records anything
    (an untouched box means no answer, so the person stays 'never asked')."""
    if not isinstance(choices, dict):
        return []
    made = []
    for channel, ticked in choices.items():
        if channel in CHANNEL_KEYS and ticked is True:
            row = record_consent(subject, channel, True, source, request=request, source_detail=detail)
            if row:
                made.append(row)
    return made
