"""ledger.fee_rules and ledger.setting: a new fee ladder or money-setting value, proposed by Accounting and
approved by a Super Admin (a Super Admin's own change applies at once). ledger.redelivery_fee is the same change for the
re-delivery fee alone, which Operations may also propose and decide (Director ruling 1, 2026-10-20). Applying never backdates: the
change takes effect at the later of the proposed time and now, so orders already paid keep their snapshot."""
from datetime import datetime

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from activity.services import record
from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError

from . import fees, settings_store
from .models import FeeBand, FeeRuleSet, MoneySetting

FEE_RULES_KEY = "ledger.fee_rules"
SETTING_KEY = "ledger.setting"
# The re-delivery fee alone (Director ruling 1, 2026-10-20): Operations or a Super Admin decides it.
REDELIVERY_FEE_KEY = "ledger.redelivery_fee"
REDELIVERY_FEE_PERMISSION = "redelivery_fee.manage"
SETTING_KINDS = (SETTING_KEY, REDELIVERY_FEE_KEY)
CATEGORY_LABELS = dict(FeeRuleSet.CATEGORY_CHOICES)


def effective_time(raw):
    """The later of the proposed time (ISO string, or None for now) and now."""
    now = timezone.now()
    if not raw:
        return now
    try:
        parsed = parse_datetime(str(raw)) if not isinstance(raw, datetime) else raw
    except ValueError:
        parsed = None
    if parsed is None:
        raise ApprovalError("Use a full date and time, like 2026-11-01T09:00:00Z, for when it starts.")
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return max(parsed, now)


def bands_as_dicts(rule_set):
    return [
        {"lower": b.lower_pesewas, "upper": b.upper_pesewas, "percent_bp": b.percent_bp, "flat": b.flat_pesewas}
        for b in rule_set.bands.all()
    ] if rule_set else []


def describe_band(band):
    upper, percent, flat = band.get("upper"), band.get("percent_bp"), band.get("flat")
    top = "and above" if upper is None else f"to {upper}"
    price = f"{percent / 100:g}%" if percent is not None else f"{flat} pesewas flat"
    return f"{band.get('lower')} {top}: {price}"


# --- fee rules -------------------------------------------------------------------------------------------

def fee_current_state(request):
    category = request.payload.get("category")
    return {"category": category, "bands": bands_as_dicts(fees.rule_set_in_force(category))}


def fee_validate(request):
    payload = request.payload
    if payload.get("category") not in CATEGORY_LABELS:
        raise ApprovalError("Pick products, services or events.")
    try:
        fees.validate_bands(payload.get("bands") or [])
    except fees.FeeError as exc:
        raise ApprovalError(str(exc)) from exc
    effective_time(payload.get("effective_from"))


def fee_apply(request):
    payload = request.payload
    decider = request.decided_by or request.maker
    rule_set = FeeRuleSet.objects.create(
        category=payload["category"], effective_from=effective_time(payload.get("effective_from")),
        created_by=decider, approval_id=request.pk,
    )
    for band in payload["bands"]:
        FeeBand.objects.create(
            rule_set=rule_set, lower_pesewas=band.get("lower"), upper_pesewas=band.get("upper"),
            percent_bp=band.get("percent_bp"), flat_pesewas=band.get("flat"),
        )
    # Last: the event refreshes every open fee screen live.
    record(
        decider, "ledger.fee_rules_applied", target=rule_set,
        summary=f"{CATEGORY_LABELS[rule_set.category]} fee rules changed, effective {rule_set.effective_from:%Y-%m-%d %H:%M}",
        after={"category": rule_set.category, "bands": payload["bands"]},
    )


def fee_diff(request):
    before = (request.before or {}).get("bands") or []
    label = CATEGORY_LABELS.get(request.payload["category"], request.payload["category"])
    return [{
        "field": f"{label} fee bands",
        "before": "; ".join(describe_band(b) for b in before) or None,
        "after": "; ".join(describe_band(b) for b in request.payload["bands"]),
    }]


def super_admin_only(request):
    return [(ApprovalRequest.SUPER_ADMIN, None)]


FEE_RULES = ApprovalKind(
    key=FEE_RULES_KEY, label="Change platform-fee rules", pool_permission="", current_state=fee_current_state,
    apply=fee_apply, response_hours=48, chain_note="Super Admin only", resolve_approver=super_admin_only,
    render_diff=fee_diff, validate=fee_validate, requires_sudo=True, money=True,
    consequences=lambda request: ["Applies only to orders paid after it starts. Orders already paid keep the fee they were given."],
)


# --- money settings --------------------------------------------------------------------------------------

def setting_current_state(request):
    key = request.payload.get("key")
    return {"key": key, "value": settings_store.current(key) if key in settings_store.DEFINITIONS else None}


def setting_validate(request):
    payload = request.payload
    starts = effective_time(payload.get("effective_from"))
    try:
        value = settings_store.clean(payload.get("key"), payload.get("value"))
        settings_store.check_limits(payload.get("key"), value, starts)
    except settings_store.SettingError as exc:
        raise ApprovalError(str(exc)) from exc


def setting_apply(request):
    payload = request.payload
    decider = request.decided_by or request.maker
    value = settings_store.clean(payload["key"], payload.get("value"))
    row = MoneySetting.objects.create(
        key=payload["key"], value=value, effective_from=effective_time(payload.get("effective_from")),
        created_by=decider, approval_id=request.pk,
    )
    record(
        decider, "ledger.setting_applied", target=row,
        summary=f"{settings_store.DEFINITIONS[row.key].label} set to {'blank' if value is None else value}",
        after={"key": row.key, "value": value},
    )


def setting_diff(request):
    definition = settings_store.DEFINITIONS[request.payload["key"]]
    before = (request.before or {}).get("value")
    return [{"field": definition.label, "before": None if before is None else str(before), "after": "blank" if request.payload.get("value") in (None, "") else str(request.payload["value"])}]


WALLET_SETTING_KEYS = (
    "withdrawal_per_tx_limit_pesewas", "withdrawal_daily_limit_pesewas", "payout_cooling_hours", "wallet_topup_hold_minutes",
)
# Plan 7A: bookings release on their own milestone; texts and sign-in codes never touch an order's money.
BOOKING_SETTING_KEYS = ("service_auto_accept_hours", "stay_issue_window_hours", "event_release_delay_hours")
TEXT_SETTING_KEYS = ("vendor_low_balance_pesewas", "digest_batch_size", "digest_time_budget_seconds")
# Rider withdrawals a day (plan 7F-D): only counts riders' requests, so an order's money is untouched.
RIDER_SETTING_KEYS = ("rider_withdrawals_per_day",)
# Low-stock alerts (catalogue plan 6): they never touch an order or any money.
STOCK_SETTING_KEYS = (settings_store.STOCK_COVER_DAYS, settings_store.STOCK_FALLBACK_UNITS, settings_store.STOCK_WINDOW_DAYS)


def setting_consequences(request):
    """What the approver is told the change touches: withdrawal settings never touch an order (wallets plan 3b), and
    stock settings neither (catalogue plan 6)."""
    key = request.payload.get("key")
    if key in WALLET_SETTING_KEYS:
        return ["Applies to withdrawals asked for, and payout destinations added, after it starts. Destinations already "
                "added keep the waiting time they were given."]
    if key in RIDER_SETTING_KEYS:
        return ["Applies to riders' withdrawals asked for after it starts. Withdrawals already made today still count."]
    if key in STOCK_SETTING_KEYS:
        return ["Applies from when it starts to the \"needs restocking\" lists and, when low-stock alerts are switched on, to "
                "the alerts. Offers where the business set its own low-stock line keep that line. Offers already told "
                "they are low are not told again until they are restocked."]
    if key in BOOKING_SETTING_KEYS:
        return ["Applies to every booking, service or ticket sale not yet released, including ones already paid."]
    if key in TEXT_SETTING_KEYS:
        return ["Changes which texts businesses receive and how the daily digest is sent. It moves no money."]
    if key == settings_store.REDELIVERY_FEE:
        return ["Applies to re-deliveries requested after it starts. A re-delivery already asked for keeps the fee it was given."]
    if key == "otp_daily_failure_cap":
        return ["Applies to wrong codes counted from today. An account already over the new limit stays locked until tomorrow."]
    return ["Applies only to orders paid after it starts."]


MONEY_SETTING = ApprovalKind(
    key=SETTING_KEY, label="Change a money setting", pool_permission="", current_state=setting_current_state,
    apply=setting_apply, response_hours=48, chain_note="Super Admin only", resolve_approver=super_admin_only,
    render_diff=setting_diff, validate=setting_validate, requires_sudo=True, money=True,
    consequences=setting_consequences,
)


def operations_or_super_admin(request):
    return [(ApprovalRequest.POOL, None), (ApprovalRequest.SUPER_ADMIN, None)]


# The re-delivery fee (Director ruling 1, 2026-10-20): editable by Operations as well as the Super Admin. Anyone holding
# redelivery_fee.manage (Operations, Super Admin) decides it, never the maker; a Super Admin's own change applies at once
# (approvals engine rule). The payload, checks, apply, diff and audit trail are the money setting's own.
REDELIVERY_FEE_SETTING = ApprovalKind(
    key=REDELIVERY_FEE_KEY, label="Change the re-delivery fee", pool_permission=REDELIVERY_FEE_PERMISSION,
    current_state=setting_current_state, apply=setting_apply, response_hours=48, chain_note="Operations or Super Admin",
    resolve_approver=operations_or_super_admin, render_diff=setting_diff, validate=setting_validate, requires_sudo=True, money=True,
    consequences=setting_consequences,
)
