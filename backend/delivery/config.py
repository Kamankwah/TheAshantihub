"""Versioned delivery settings: the auto-assign rules, the time limits and the rate card.

A change is a request: the Delivery Manager proposes values, a Super Admin approves (a Super Admin's own
proposal applies at once, recorded), and applying writes a NEW version and marks the previous one replaced.
Nothing is edited in place and no number is pre-filled: with no live version the screens say so, and the
engine uses the built-in defaults below (shown as "built-in defaults", never as an approved version)."""
from datetime import time
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from approvals import services as approvals
from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError

from .models import AutoAssignRules, ConfigVersion, RateCard, TimeLimits, VEHICLE_TYPES

AUTO_ASSIGN, TIME_LIMITS, RATE_CARD, REFUND = "delivery.auto_assign", "delivery.time_limits", "delivery.rate_card", "delivery.refund_request"


class ConfigError(Exception):
    def __init__(self, message, field=None):
        super().__init__(message)
        self.message, self.field = message, field


def _int(data, name, lo, hi, default=None):
    raw = data.get(name, default)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ConfigError("Enter a whole number.", name)
    if not lo <= value <= hi:
        raise ConfigError(f"Enter a number from {lo} to {hi}.", name)
    return value


def _money(data, name, lo=Decimal("0"), hi=Decimal("100000"), default=None):
    raw = data.get(name, default)
    try:
        value = Decimal(str(raw)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        raise ConfigError("Enter an amount in GH₵.", name)
    if not lo <= value <= hi:
        raise ConfigError(f"Enter an amount from {lo} to {hi}.", name)
    return value


def _factor(data, name, lo=Decimal("0.5"), hi=Decimal("10"), default=None):
    raw = data.get(name, default)
    try:
        value = Decimal(str(raw)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        raise ConfigError("Enter a multiplier such as 1.25.", name)
    if not lo <= value <= hi:
        raise ConfigError(f"Enter a multiplier from {lo} to {hi}.", name)
    return value


def _clock(data, name, default):
    raw = data.get(name, default)
    try:
        hour, minute = str(raw).split(":")[:2]
        return time(int(hour), int(minute))
    except (ValueError, TypeError):
        raise ConfigError("Enter a time such as 07:00.", name)


# ── Auto-assign rules ──────────────────────────────────────────────────────────────────────────
RULE_FIELDS = (
    "w_distance", "w_fairness", "w_idle", "offer_timeout_s", "max_declines", "force_slack_min", "radius_km",
    "max_active_jobs", "stale_s", "batch_radius_km", "cash_cap",
)
RULE_DEFAULTS = {
    "w_distance": 50, "w_fairness": 30, "w_idle": 20, "offer_timeout_s": 45, "max_declines": 3, "force_slack_min": 10,
    "radius_km": "5.00", "max_active_jobs": 2, "stale_s": 120, "batch_radius_km": "2.00", "cash_cap": "500.00",
}


def clean_rules(data):
    out = {
        "w_distance": _int(data, "w_distance", 0, 100), "w_fairness": _int(data, "w_fairness", 0, 100), "w_idle": _int(data, "w_idle", 0, 100),
        "offer_timeout_s": _int(data, "offer_timeout_s", 15, 300), "max_declines": _int(data, "max_declines", 1, 10),
        "force_slack_min": _int(data, "force_slack_min", 0, 240), "radius_km": str(_money(data, "radius_km", Decimal("0.5"), Decimal("50"))),
        "max_active_jobs": _int(data, "max_active_jobs", 1, 6), "stale_s": _int(data, "stale_s", 30, 900),
        "batch_radius_km": str(_money(data, "batch_radius_km", Decimal("0"), Decimal("20"))), "cash_cap": str(_money(data, "cash_cap", Decimal("0"), Decimal("10000"))),
    }
    if out["w_distance"] + out["w_fairness"] + out["w_idle"] != 100:
        raise ConfigError("The three weights must add up to 100.", "w_distance")
    return out


# ── Time limits ────────────────────────────────────────────────────────────────────────────────
LIMIT_DEFAULTS = {
    "promise_standard_min": 90, "promise_express_min": 45, "opens_at": "07:00", "closes_at": "20:00",
    "assign_within_min": 10, "pickup_within_min": 30, "first_response_hours": 2, "dispute_answer_hours": 24,
}


def clean_limits(data):
    out = {
        "promise_standard_min": _int(data, "promise_standard_min", 10, 1440), "promise_express_min": _int(data, "promise_express_min", 10, 1440),
        "opens_at": _clock(data, "opens_at", "07:00").strftime("%H:%M"), "closes_at": _clock(data, "closes_at", "20:00").strftime("%H:%M"),
        "assign_within_min": _int(data, "assign_within_min", 1, 240), "pickup_within_min": _int(data, "pickup_within_min", 1, 480),
        "first_response_hours": _int(data, "first_response_hours", 1, 72), "dispute_answer_hours": _int(data, "dispute_answer_hours", 1, 240),
    }
    if out["promise_express_min"] > out["promise_standard_min"]:
        raise ConfigError("An express promise cannot be longer than the standard one.", "promise_express_min")
    if out["opens_at"] >= out["closes_at"]:
        raise ConfigError("Opening time must be before closing time.", "opens_at")
    return out


# ── Rate card ──────────────────────────────────────────────────────────────────────────────────
def clean_rate_card(data):
    multipliers = data.get("vehicle_multipliers") or {}
    if not isinstance(multipliers, dict):
        raise ConfigError("Vehicle multipliers must be a list of vehicle types.", "vehicle_multipliers")
    cleaned = {}
    for vehicle, _label in VEHICLE_TYPES:
        cleaned[vehicle] = str(_factor(multipliers, vehicle, default="1"))
    unknown = set(multipliers) - set(cleaned)
    if unknown:
        raise ConfigError("Unknown vehicle type.", "vehicle_multipliers")
    return {
        "customer_base": str(_money(data, "customer_base")), "customer_per_km": str(_money(data, "customer_per_km")),
        "customer_min_fee": str(_money(data, "customer_min_fee")), "extra_pickup": str(_money(data, "extra_pickup", default="0")),
        "express_multiplier": str(_factor(data, "express_multiplier", default="1")), "round_up_to": str(_money(data, "round_up_to", Decimal("0"), Decimal("10"), default="0.50")),
        "vehicle_multipliers": cleaned, "rider_per_job": str(_money(data, "rider_per_job")), "rider_per_km": str(_money(data, "rider_per_km")),
        "wait_after_min": _int(data, "wait_after_min", 0, 120, default=10), "wait_per_min": str(_money(data, "wait_per_min", default="0")),
    }


# ── Reading ────────────────────────────────────────────────────────────────────────────────────
def live(model):
    return model.objects.filter(status=ConfigVersion.LIVE).first()


def row_values(row, fields):
    return {f: (str(getattr(row, f)) if not isinstance(getattr(row, f), (int, bool)) else getattr(row, f)) for f in fields}


def effective_rules():
    """The rules the engine uses: the live version, else the built-in defaults (flagged)."""
    row = live(AutoAssignRules)
    values = row_values(row, RULE_FIELDS) if row else dict(RULE_DEFAULTS)
    return {"source": "version" if row else "defaults", "version": row.version if row else None, **{k: _num(v) for k, v in values.items()}}


def _num(value):
    if isinstance(value, int):
        return value
    return Decimal(str(value))


def effective_limits():
    row = live(TimeLimits)
    if row is None:
        return None
    return row


def limits_dict(row):
    if row is None:
        return None
    return {
        "version": row.version, "promise_standard_min": row.promise_standard_min, "promise_express_min": row.promise_express_min,
        "opens_at": row.opens_at.strftime("%H:%M"), "closes_at": row.closes_at.strftime("%H:%M"), "assign_within_min": row.assign_within_min,
        "pickup_within_min": row.pickup_within_min, "first_response_hours": row.first_response_hours, "dispute_answer_hours": row.dispute_answer_hours,
        "effective_at": row.effective_at, "proposed_by": row.proposed_by.full_name if row.proposed_by_id else None,
        "approved_by": row.approved_by.full_name if row.approved_by_id else None,
    }


RATE_FIELDS = (
    "customer_base", "customer_per_km", "customer_min_fee", "extra_pickup", "express_multiplier", "round_up_to",
    "rider_per_job", "rider_per_km", "wait_after_min", "wait_per_min",
)


def rate_dict(row):
    if row is None:
        return None
    out = row_values(row, RATE_FIELDS)
    out.update({
        "version": row.version, "vehicle_multipliers": row.vehicle_multipliers, "effective_at": row.effective_at, "id": row.pk,
        "proposed_by": row.proposed_by.full_name if row.proposed_by_id else None, "approved_by": row.approved_by.full_name if row.approved_by_id else None,
    })
    return out


def rules_dict(row):
    if row is None:
        return None
    out = row_values(row, RULE_FIELDS)
    out.update({"version": row.version, "effective_at": row.effective_at, "proposed_by": row.proposed_by.full_name if row.proposed_by_id else None,
                "approved_by": row.approved_by.full_name if row.approved_by_id else None})
    return out


# ── Applying (inside the approval's transaction) ───────────────────────────────────────────────
def _publish(model, values, request, note):
    previous = live(model)
    next_version = (model.objects.aggregate(m=Max("version"))["m"] or 0) + 1
    if previous is not None:
        previous.status = ConfigVersion.SUPERSEDED
        previous.save(update_fields=["status"])
    fields = dict(values)
    for key in ("opens_at", "closes_at"):
        if key in fields:
            hour, minute = fields[key].split(":")
            fields[key] = time(int(hour), int(minute))
    return model.objects.create(
        version=next_version, status=ConfigVersion.LIVE, proposed_by=request.maker, approved_by=request.decided_by or request.maker,
        approval_id=request.pk, note=note[:300], effective_at=timezone.now(), **fields,
    )


def _make_kind(key, label, model, cleaner, describe, response_hours=48):
    def current_state(request):
        row = live(model)
        return {"version": row.version if row else None}

    def validate(request):
        try:
            cleaner(request.payload["values"])
        except ConfigError as exc:
            raise ApprovalError(exc.message)

    def apply(request):
        from activity.services import record

        values = cleaner(request.payload["values"])
        row = _publish(model, values, request, request.maker_note or "")
        record(request.decided_by or request.maker, f"{key}_applied", target=row, summary=f"{label}: version {row.version} in force", after={"version": row.version})

    def render_diff(request):
        before = live(model)
        old = (rate_dict(before) if model is RateCard else rules_dict(before) if model is AutoAssignRules else limits_dict(before)) or {}
        return [{"field": k, "before": str(old.get(k)) if old.get(k) is not None else None, "after": str(v)} for k, v in request.payload["values"].items()]

    def resolve_approver(request):
        return [(ApprovalRequest.SUPER_ADMIN, None)]

    return ApprovalKind(
        key=key, label=label, pool_permission="", current_state=current_state, apply=apply, response_hours=response_hours,
        resolve_approver=resolve_approver, render_diff=render_diff, validate=validate, chain_note="Super Admin only",
        consequences=lambda request: [describe],
    )


AUTO_ASSIGN_KIND = _make_kind(
    AUTO_ASSIGN, "Change the auto-assign rules", AutoAssignRules, clean_rules,
    "From the moment it is approved, the engine picks riders by these rules. Offers already out keep their timers.",
)
TIME_LIMITS_KIND = _make_kind(
    TIME_LIMITS, "Change the delivery time limits", TimeLimits, clean_limits,
    "New orders get their deliver-by time from these promises. Orders already placed keep theirs.",
)
RATE_CARD_KIND = _make_kind(
    RATE_CARD, "Change the delivery rate card", RateCard, clean_rate_card,
    "The rate card is recorded. Customers are charged a delivery fee only when delivery fees are switched on, which is a separate decision.",
)


def refund_current_state(request):
    return {"dispute": request.payload.get("dispute_id")}


def refund_apply(request):
    """Records that a refund was asked for. No money moves: payments are simulated until a payment provider is connected."""
    from activity.services import record

    record(request.decided_by or request.maker, "delivery.refund_request_decided", target_type="disputes.dispute", target_id=str(request.payload.get("dispute_id")),
           summary=f"Refund of GH₵ {request.payload.get('amount')} for case #{request.payload.get('dispute_id')} approved (recorded only; payments are simulated)")


REFUND_KIND = ApprovalKind(
    key=REFUND, label="Refund asked for a delivery case", pool_permission="", current_state=refund_current_state, apply=refund_apply, response_hours=48,
    resolve_approver=lambda request: [(ApprovalRequest.SUPER_ADMIN, None)], chain_note="Super Admin only", requires_sudo=True,
    consequences=lambda request: ["Approving records the decision. No money moves: payments are simulated until a payment provider is connected."],
    render_diff=lambda request: [{"field": "Refund (GH₵)", "before": None, "after": str(request.payload.get("amount"))}],
)

KINDS = (AUTO_ASSIGN_KIND, TIME_LIMITS_KIND, RATE_CARD_KIND, REFUND_KIND)


def propose(maker, kind_key, values, *, title, note="", request=None):
    """Submit a change. Refuses a second pending request of the same kind. Returns the ApprovalRequest."""
    if ApprovalRequest.objects.filter(kind=kind_key, status=ApprovalRequest.PENDING).exists():
        raise ConfigError("A change of this kind is already waiting for approval.")
    return approvals.submit(maker, kind_key, title=title, payload={"values": values}, target_type=kind_key, target_id="1", target_label=title, maker_note=note[:500], request=request)


def pending(kind_key):
    request = ApprovalRequest.objects.filter(kind=kind_key, status=ApprovalRequest.PENDING).select_related("maker").first()
    if request is None:
        return None
    return {"approval_id": request.pk, "values": request.payload.get("values"), "proposed_by": request.maker.full_name, "created_at": request.created_at, "note": request.maker_note}
