"""Is the name on a payout account the holder's own? (spec §8). A destination is accepted only when the name the
network or bank returns matches a verified name: a customer's profile name; an identity-verified vendor's owner name or
registered business name (staff have approved the owner's Ghana Card; an address check alone is not enough). Names are compared as sets of words, accents and punctuation dropped and case ignored:
the account's name must contain every word of the verified name (so it may carry a middle name or "LTD" the verified
name lacks, never the reverse), and the verified name needs at least two words of two letters or more.

A customer's profile name is self-declared (there is no customer KYC) and can be changed without a code, so for
customers this stops typing mistakes, not a determined holder (a recorded deviation: spec §13 (xxix)). A third-party
rider's verified name is the name on their staff account, once the Delivery Manager has approved an in-date Ghana Card
(wallets Plan 5; nothing yet compares the card's name with it: spec §13 (xcii))."""
import re
import unicodedata

_WORD = re.compile(r"[A-Z0-9]+")


def words(name):
    plain = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().upper()
    return set(_WORD.findall(plain))


def matches(account_name, verified_name):
    """The account's name must contain every word of the verified name, and the verified name must have at least two
    words of two letters or more (an initial does not count toward that floor)."""
    account, verified = words(account_name), words(verified_name)
    return usable(verified_name) and verified <= account


def usable(verified_name):
    """Whether a name could ever match: at least two words of two letters or more."""
    return sum(len(w) >= 2 for w in words(verified_name)) >= 2


def verified_names(holder):
    """The names a destination may match, or [] when there is none yet (a vendor whose identity staff have not approved, a blank profile, a
    rider without an approved Ghana Card, AshantiHub's own riders and office staff)."""
    from accounts.models import BusinessOwner, Customer, StaffUser

    if isinstance(holder, StaffUser):
        from delivery import employment

        rider = employment.wallet_rider(holder)
        if rider is None or not employment.id_verified(rider) or not (holder.full_name or "").strip():
            return []
        return [holder.full_name]

    if isinstance(holder, Customer):
        return [holder.full_name] if (holder.full_name or "").strip() else []
    if isinstance(holder, BusinessOwner):
        if not holder.identity_verified:  # address-checked (kyc_status) is not identity proven
            return []
        profile = getattr(holder, "profile", None)
        business = (profile.business_name or "").strip() if profile is not None else ""
        return [name for name in (holder.full_name, business) if (name or "").strip()]
    return []


def matching_name(account_name, holder):
    """The verified name `account_name` matches, or None."""
    return next((name for name in verified_names(holder) if matches(account_name, name)), None)
