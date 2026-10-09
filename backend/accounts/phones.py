"""Ghana phone numbers (staff phase 2). Owners typed their phones however
they liked ("0241234567", "+233 24 123 4567", …), so stored rows are not
uniform: compare phones by their key — the last 9 digits — and store the
ones this code writes as "+233" + key."""
import re

from django.db.models import CharField, F, Func, Value

PHONE_HINT = "Enter a Ghana phone number, for example 024 123 4567."
_NOT_DIGITS = re.compile(r"\D")


def _digits(raw):
    return _NOT_DIGITS.sub("", "" if raw is None else str(raw))


def phone_key(raw):
    """The last 9 digits of `raw` once everything but digits is stripped, or
    "" when fewer than 9 digits remain (too short to be a phone)."""
    digits = _digits(raw)
    return digits[-9:] if len(digits) >= 9 else ""


def normalize_gh_phone(raw):
    """Return "+233" + the key for a Ghana mobile number written as 9 digits
    (a local number without its 0), 10 digits starting 0, or 12 digits
    starting 233 — and only when the key starts with 2 or 5 (the mobile
    ranges). Anything else raises ValueError with the message a form shows."""
    digits = _digits(raw)
    shaped = (
        len(digits) == 9
        or (len(digits) == 10 and digits.startswith("0"))
        or (len(digits) == 12 and digits.startswith("233"))
    )
    if not shaped or digits[-9] not in "25":
        raise ValueError(PHONE_HINT)
    return "+233" + digits[-9:]


def filter_by_phone(queryset, field, raw):
    """The rows of `queryset` whose `field` holds the same phone as `raw`,
    however either was written: the column's digits — spaces, dashes, "+" and
    brackets stripped in SQL by REGEXP_REPLACE — end with the key. `field` may
    cross a relation ("profile__payout_momo_number"). An input with no key
    matches nothing. (No index serves this; the owner and profile tables are
    small enough to scan.)"""
    key = phone_key(raw)
    if not key:
        return queryset.none()
    name = f"_digits_{field.replace('__', '_')}"
    digits = Func(
        F(field), Value("[^0-9]"), Value(""), Value("g"),
        function="REGEXP_REPLACE", output_field=CharField(),
    )
    return queryset.annotate(**{name: digits}).filter(**{f"{name}__endswith": key})
