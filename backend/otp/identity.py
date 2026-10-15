"""Who a code goes to. Everything in this app names an account by (account_type, account_id), account_type being
one of accounts.authentication.ACCOUNT_MODELS' keys: "customer", "business_owner", "staff"."""
from django.utils.crypto import salted_hmac

from accounts.authentication import ACCOUNT_MODELS
from accounts.models import BusinessOwner, Customer, StaffUser
from accounts.phones import mask_phone, normalize_gh_phone

from .models import EMAIL, SMS

CUSTOMER, BUSINESS_OWNER, STAFF = "customer", "business_owner", "staff"
FINGERPRINT_SALT = "otp.password-fingerprint"


def account_type_of(account):
    if isinstance(account, StaffUser):
        return STAFF
    if isinstance(account, BusinessOwner):
        return BUSINESS_OWNER
    if isinstance(account, Customer):
        return CUSTOMER
    raise TypeError(f"Not an account: {type(account).__name__}")


def ref(account):
    """(account_type, account_id) as the rows of this app store them."""
    return account_type_of(account), account.pk


def load(account_type, account_id):
    """The account, or None when the type is unknown or the row is gone."""
    model = ACCOUNT_MODELS.get(account_type) if isinstance(account_type, str) else None
    if model is None or account_id is None:
        return None
    return model.objects.filter(pk=account_id).first()


def can_sign_in(account):
    """The login serializers' refusals: a suspended account, or a deactivated staff member, never finishes."""
    if account is None or account.is_suspended:
        return False
    return not isinstance(account, StaffUser) or account.is_active


def _phone(raw):
    try:
        return normalize_gh_phone(raw) if raw else ""
    except ValueError:
        return ""


def _email(raw):
    return (raw or "").strip().lower()


def contacts(account):
    """{channel: destination} this account can receive a code on, normalised (+233… phones, lower-case emails): its
    own phone and email; a customer without one falls back to the verified secondary of that kind."""
    if isinstance(account, Customer):
        phone = account.phone or (account.secondary_phone if account.secondary_phone_verified else "")
        email = account.email or (account.secondary_email if account.secondary_email_verified else "")
    elif isinstance(account, BusinessOwner):
        phone, email = account.login_phone, account.email
    else:
        phone, email = account.phone, account.email
    found = {}
    if _phone(phone):
        found[SMS] = _phone(phone)
    if _email(email):
        found[EMAIL] = _email(email)
    return found


def hint(channel, destination):
    """What a screen may show of a destination: "024 *** 4567" or "am•••@example.com"."""
    if channel == SMS:
        return mask_phone(destination)
    from accounts.claims import mask_email  # accounts.claims imports activity, which imports accounts.serializers

    return mask_email(destination)


def channel_list(account):
    return [{"channel": channel, "hint": hint(channel, destination)} for channel, destination in contacts(account).items()]


def fingerprint(account):
    """Changes whenever the password does, so anything bound to it dies with any password change."""
    return salted_hmac(FINGERPRINT_SALT, account.password_hash).hexdigest()
