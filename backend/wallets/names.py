"""Is the name on a payout account the holder's own? (spec §8). A destination is accepted only when the name the
network or bank returns matches a verified name: a customer's profile name; a KYC-verified vendor's owner name or
registered business name. Names are compared as sets of words, accents and punctuation dropped and case ignored:
equal, or every word of the shorter name (at least two words) found in the longer, so a middle name or "LTD" may be
missing. One word alone never matches a longer name.

A customer's profile name is self-declared (there is no customer KYC) and can be changed without a code, so for
customers this stops typing mistakes, not a determined holder (a recorded deviation: spec §13 (xxix))."""
import re
import unicodedata

_WORD = re.compile(r"[A-Z0-9]+")


def words(name):
    plain = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().upper()
    return set(_WORD.findall(plain))


def matches(account_name, verified_name):
    a, b = words(account_name), words(verified_name)
    if not a or not b:
        return False
    if a == b:
        return True
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    return len(shorter) >= 2 and shorter <= longer


def verified_names(holder):
    """The names a destination may match, or [] when there is none yet (a vendor not KYC-verified, a blank profile)."""
    from accounts.models import BusinessOwner, Customer

    if isinstance(holder, Customer):
        return [holder.full_name] if (holder.full_name or "").strip() else []
    if isinstance(holder, BusinessOwner):
        if holder.kyc_status != BusinessOwner.VERIFIED:
            return []
        profile = getattr(holder, "profile", None)
        business = (profile.business_name or "").strip() if profile is not None else ""
        return [name for name in (holder.full_name, business) if (name or "").strip()]
    return []


def matching_name(account_name, holder):
    """The verified name `account_name` matches, or None."""
    return next((name for name in verified_names(holder) if matches(account_name, name)), None)
