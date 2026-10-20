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


# The three low-stock numbers (catalogue plan 6): named once here; catalogue.stock and approval_kinds use these names.
STOCK_COVER_DAYS, STOCK_FALLBACK_UNITS, STOCK_WINDOW_DAYS = (
    "low_stock_cover_days", "low_stock_fallback_units", "stock_cover_window_days",
)

REDELIVERY_FEE = "redelivery_fee_pesewas"

DEFINITIONS = {
    "fee_cap_pesewas": Definition("Lifetime platform-fee cap per vendor (pesewas; blank = no cap)", None, True, 1, 10**12),
    "verification_overdue_hours": Definition(
        "Hours after purchase by which an ORDER (products) must be verified by Support or disputed", 72, False, 1, 720,
    ),
    "pickup_window_hours": Definition("Hours after purchase within which a store-pickup order is collected", 24, False, 1, 168),
    "rider_commission_bp": Definition("Third-party rider commission (basis points; 1000 = 10%)", 1000, False, 0, 10000),
    "rider_withdrawals_per_day": Definition("Withdrawals a rider may make per day (the day resets at midnight, Accra)", 3, False, 1, 20),
    # Withdrawals and payout destinations (wallets plan 3b; spec §3.3, §8). The cooling period never goes below an hour,
    # so one approval cannot switch that control off.
    "withdrawal_per_tx_limit_pesewas": Definition("Largest single withdrawal (pesewas)", 500_000, False, 100, 10**10),
    "withdrawal_daily_limit_pesewas": Definition("Most a person may withdraw in one day, per account (pesewas)", 1_000_000, False, 100, 10**10),
    "payout_cooling_hours": Definition("Hours a new payout destination waits before it can receive money", 24, False, 1, 720),
    # Wallet rulings (plan 7A, owner decisions 2026-10-18). A top-up waits at least an hour before it can be withdrawn.
    "wallet_topup_hold_minutes": Definition("Minutes a wallet top-up must wait before it can be withdrawn", 60, False, 60, 10080),
    "otp_daily_failure_cap": Definition("Wrong sign-in or step-up codes allowed per account per day before it is locked until tomorrow", 20, False, 5, 200),
    # Texts to businesses (plan 7D).
    "vendor_low_balance_pesewas": Definition("Text a business when its Available balance falls to this amount or below (pesewas)", 10_000, False, 0, 10**10),
    "digest_batch_size": Definition("Businesses handled per batch when the daily money digest is texted", 200, False, 10, 5000),
    "digest_time_budget_seconds": Definition("Most seconds one digest batch may run before it hands over to the next", 600, False, 30, 3600),
    # When bookings release (plan 7E): services, stays and tickets follow their own milestone, not the product rule above.
    "service_auto_accept_hours": Definition("Hours after a service is marked done before it is accepted automatically (the customer may accept sooner)", 48, False, 1, 720),
    "stay_issue_window_hours": Definition("Hours after a stay's check-in time in which the guest can report a problem; money releases when it ends", 24, False, 1, 168),
    "event_release_delay_hours": Definition("Hours after an event ends before its ticket money is released", 48, False, 1, 720),
    # Re-delivery at the customer's request (plan 7F-E Task 7, Ruling R5, proposed): a flat charge, copied onto the request
    # when it is made. GH₵ 15.00 is a placeholder (the example delivery fee); the owner sets the real value.
    REDELIVERY_FEE: Definition("Re-delivery fee a customer pays to have an order delivered again after they were not available (pesewas)", 1500, False, 0, 20_000),
    # Low-stock alerts (catalogue plan 6; spec §1 row 15, §10). Not money, but governed the same way (§3.3): Accounting
    # proposes, a Super Admin approves.
    STOCK_COVER_DAYS: Definition("Low stock: alert when an offer has fewer than this many days of sales left", 7, False, 1, 90),
    STOCK_FALLBACK_UNITS: Definition("Low stock with no sales in the window: alert at this many units or fewer", 5, False, 0, 100_000),
    STOCK_WINDOW_DAYS: Definition("Days of past sales used to work out days of stock left", 28, False, 7, 180),
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
