"""Money settings that finance can change without a developer. Reading goes through `current`;
writing only ever happens in the approval kind's `apply` (ledger/approval_kinds.py)."""
from dataclasses import dataclass
from typing import Optional

from django.utils import timezone

from .models import MoneySetting


class SettingError(Exception):
    pass


@dataclass(frozen=True)
class Definition:
    label: str
    default: Optional[int]
    nullable: bool
    minimum: int
    maximum: int


DEFINITIONS = {
    "fee_cap_pesewas": Definition("Lifetime platform-fee cap per vendor (pesewas; blank = no cap)", None, True, 1, 10**12),
    "verification_overdue_hours": Definition("Hours after purchase by which an order must be verified or disputed", 72, False, 1, 720),
    "pickup_window_hours": Definition("Hours after purchase within which a store-pickup order is collected", 24, False, 1, 168),
    "rider_commission_bp": Definition("Third-party rider commission (basis points; 1000 = 10%)", 1000, False, 0, 10000),
    # Withdrawals and payout destinations (wallets plan 3b; spec §3.3, §8). The cooling period never goes below an hour,
    # so one approval cannot switch that control off.
    "withdrawal_per_tx_limit_pesewas": Definition("Largest single withdrawal (pesewas)", 500_000, False, 100, 10**10),
    "withdrawal_daily_limit_pesewas": Definition("Most a person may withdraw in one day, per account (pesewas)", 1_000_000, False, 100, 10**10),
    "payout_cooling_hours": Definition("Hours a new payout destination waits before it can receive money", 24, False, 1, 720),
}


def _definition(key):
    try:
        return DEFINITIONS[key]
    except (KeyError, TypeError):
        raise SettingError(f"Unknown money setting {key!r}") from None


def current(key, at=None):
    definition = _definition(key)
    at = at or timezone.now()
    row = MoneySetting.objects.filter(key=key, effective_from__lte=at).order_by("-effective_from", "-id").first()
    return definition.default if row is None else row.value


def check_limits(key, value, at=None):
    """The daily withdrawal limit may not be below the per-withdrawal limit (a person could never make one full-size
    withdrawal). Checked against the other limit as it is when this one starts; raises SettingError."""
    if key == "withdrawal_daily_limit_pesewas" and value < current("withdrawal_per_tx_limit_pesewas", at):
        raise SettingError("The daily limit cannot be below the largest single withdrawal limit")
    if key == "withdrawal_per_tx_limit_pesewas" and value > current("withdrawal_daily_limit_pesewas", at):
        raise SettingError("The largest single withdrawal cannot be above the daily limit")


def clean(key, raw):
    definition = _definition(key)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        if definition.nullable:
            return None
        raise SettingError(f"{definition.label} cannot be blank")
    if isinstance(raw, bool) or isinstance(raw, float):
        raise SettingError("Enter a whole number")
    try:
        value = int(str(raw).strip())
    except ValueError:
        raise SettingError("Enter a whole number") from None
    if not definition.minimum <= value <= definition.maximum:
        raise SettingError(f"{definition.label} must be between {definition.minimum} and {definition.maximum}")
    return value
