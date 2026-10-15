"""Platform-fee calculation. Pure functions over pesewa integers, plus the lookups that find the
rule set in force and a vendor's fees charged so far (for the lifetime cap)."""
from dataclasses import dataclass

from django.db.models import Sum
from django.utils import timezone

from .models import FeeRuleSet, OrderFeeSnapshot


class FeeError(Exception):
    pass


@dataclass(frozen=True)
class FeeQuote:
    rule_set_id: int
    base: int
    computed: int
    charged: int


def rule_set_in_force(category, at=None):
    at = at or timezone.now()
    return FeeRuleSet.objects.filter(category=category, effective_from__lte=at).order_by("-effective_from", "-id").first()


def band_fee(bands, base):
    for band in bands:
        if band.lower_pesewas <= base and (band.upper_pesewas is None or base <= band.upper_pesewas):
            if band.percent_bp is not None:
                return (base * band.percent_bp + 5000) // 10000  # half up
            return band.flat_pesewas
    raise FeeError(f"No fee band covers {base} pesewas")


def apply_cap(computed, cap, already_charged):
    if cap is None:
        return computed
    return max(0, min(computed, cap - already_charged))


def quote(category, base, *, cap, already_charged, at=None):
    rule_set = rule_set_in_force(category, at)
    if rule_set is None:
        raise FeeError(f"No fee rules are in force for {category}")
    computed = band_fee(list(rule_set.bands.all()), base)
    return FeeQuote(rule_set.pk, base, computed, apply_cap(computed, cap, already_charged))


def charged_to_date(owner):
    total = OrderFeeSnapshot.objects.filter(business_owner=owner, reversed_at__isnull=True).aggregate(total=Sum("charged_pesewas"))["total"]
    return total or 0


def validate_bands(bands):
    """Raises FeeError unless `bands` (dicts with lower/upper/percent_bp/flat) form a complete, gap-free
    ladder from 0 to no upper limit with exactly one of percent or flat on each band."""
    if not bands:
        raise FeeError("Add at least one fee band")
    previous_upper = -1
    for index, band in enumerate(bands):
        lower, upper = band.get("lower"), band.get("upper")
        percent, flat = band.get("percent_bp"), band.get("flat")
        if not isinstance(lower, int) or lower != previous_upper + 1:
            raise FeeError("Fee bands must start at 0 and follow one another with no gap or overlap")
        if (percent is None) == (flat is None):
            raise FeeError("Each fee band takes either a percentage or a flat amount, not both")
        if percent is not None and (not isinstance(percent, int) or not 0 <= percent <= 10000):
            raise FeeError("A percentage is whole basis points from 0 to 10000")
        if flat is not None and (not isinstance(flat, int) or flat < 0):
            raise FeeError("A flat fee is a whole number of pesewas, zero or more")
        last = index == len(bands) - 1
        if last != (upper is None):
            raise FeeError("Only the last fee band has no upper limit, and the last band must have none")
        if upper is not None:
            if not isinstance(upper, int) or upper < lower:
                raise FeeError("A band's upper limit cannot be below its lower limit")
            previous_upper = upper
