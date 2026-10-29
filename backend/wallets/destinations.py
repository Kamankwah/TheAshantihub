"""Payout destinations (spec §8): a MoMo number or bank account a customer, business owner or third-party rider may withdraw to.

Adding one is two calls. `check` does everything that needs no lock (the holder may add one, the details are sound, the
provider's name on the account matches a verified name in wallets.names) and runs outside any transaction, because for
a real provider the name lookup is a network call. `save` then writes it inside the transaction in which the view spends
the holder's step-up code (so a refused add keeps the code), checking duplicates and the five-destination limit again
under a lock on the holder's own row. A destination can receive money from `usable_from` = now +
`payout_cooling_hours` (governed, default 24). It is never edited: a change is a removal and a new one, with a new
cooling period. The business's registered payout details (BusinessOwnerProfile.payout_*) are left as they are;
`from_profile` copies them into a new destination. Numbers are stored unmasked and only ever leave the server through
mask_but_last; every local variable holding one is named `account_number`, which Sentry filters by name."""
import logging
import re
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.models import BusinessOwner, BusinessOwnerProfile, StaffUser
from accounts.phones import normalize_gh_phone
from accounts.serializers import mask_but_last
from ledger import settings_store
from otp.identity import ref
from payments import providers

from . import names
from .models import PayoutDestination

logger = logging.getLogger(__name__)
MAX_LIVE = 5
NETWORKS = {"MTN": "MTN", "TELECEL": "Telecel", "AIRTELTIGO": "AirtelTigo"}
_BANK_NUMBER = re.compile(r"[0-9]{6,20}")
_INSTITUTION = re.compile(r"[A-Za-z0-9 &.'-]{1,60}")
DUPLICATE = "That account is already one of your payout destinations."
TOO_MANY = f"You can keep at most {MAX_LIVE} payout destinations. Remove one first."


class DestinationError(Exception):
    def __init__(self, message, code, status_code=400, field=None):
        super().__init__(message)
        self.message, self.code, self.status_code, self.field = message, code, status_code, field

    def body(self):
        data = {"detail": self.message, "code": self.code}
        if self.field:
            data["field"] = self.field
        return data


def live_for(holder):
    holder_type, holder_id = ref(holder)
    return PayoutDestination.objects.filter(holder_type=holder_type, holder_id=holder_id, removed_at__isnull=True)


def _from_profile(holder):
    profile = BusinessOwnerProfile.objects.filter(business_owner_id=holder.pk).first() if isinstance(holder, BusinessOwner) else None
    if profile is None or profile.default_payout_method not in (BusinessOwnerProfile.MOMO, BusinessOwnerProfile.BANK) or not profile.has_payout_details():
        raise DestinationError("There are no registered payout details to use.", "no_profile_details")
    if profile.default_payout_method == BusinessOwnerProfile.MOMO:
        return {"rail": PayoutDestination.MOMO, "institution": profile.payout_momo_network, "account_number": profile.payout_momo_number}
    return {"rail": PayoutDestination.BANK, "institution": profile.payout_bank_name, "account_number": profile.payout_bank_account_number}


def clean(data, holder):
    """(rail, institution, account_number) from a request body, normalised: a MoMo number as +233…, a bank account as
    digits. Raises DestinationError (400) naming the field."""
    if data.get("from_profile") is True:
        data = _from_profile(holder)
    rail = data.get("rail")
    if rail not in (PayoutDestination.MOMO, PayoutDestination.BANK):
        raise DestinationError("Choose mobile money or a bank account.", "invalid", field="rail")
    institution = str(data.get("institution") or "").strip()
    account_number = str(data.get("account_number") or "").strip()
    if rail == PayoutDestination.MOMO:
        network = NETWORKS.get(re.sub(r"[^A-Z]", "", institution.upper()))
        if network is None:
            raise DestinationError("Choose MTN, Telecel or AirtelTigo.", "invalid", field="institution")
        try:
            return rail, network, normalize_gh_phone(account_number)
        except ValueError as exc:
            raise DestinationError(str(exc), "invalid", field="account_number") from None
    if not _INSTITUTION.fullmatch(institution) or re.search(r"\d(?:[\s-]?\d){3,}", institution):  # a long number would show unmasked in notices
        raise DestinationError("Name the bank.", "invalid", field="institution")
    account_number = re.sub(r"[\s-]", "", account_number)
    if not _BANK_NUMBER.fullmatch(account_number):
        raise DestinationError("A bank account number is 6 to 20 digits.", "invalid", field="account_number")
    return rail, institution, account_number


def _rider_problem(staff):
    """A staff account may hold destinations only as an active third-party rider with an approved, in-date Ghana Card
    (wallets Plan 5)."""
    from delivery import employment

    if not staff.is_active:
        return DestinationError("This account is suspended.", "suspended", 403)
    if employment.wallet_rider(staff) is None:
        return DestinationError(employment.WALLET_DISABLED, "wallet_disabled", 409)
    if not names.verified_names(staff):
        return DestinationError(
            "Your Ghana Card must be approved, and in date, before money can be paid out to you. Ask your delivery manager.",
            "id_required", 409,
        )
    return None


def _holder_problem(holder):
    """The DestinationError that stops this holder adding a destination now, or None."""
    if getattr(holder, "is_suspended", False):
        return DestinationError("This account is suspended.", "suspended", 403)
    if isinstance(holder, StaffUser):
        return _rider_problem(holder)
    if not names.verified_names(holder):
        if isinstance(holder, BusinessOwner):
            return DestinationError(
                "Your identity must be verified before you can add a payout account. Go to Profile & Settings, open Get "
                "verified, upload your Ghana Card and wait for AshantiHub to approve it.", "kyc_required", 409,
            )
        return DestinationError("Add your full name to your profile first.", "name_required", 409)
    return None


def check(holder, data):
    """Everything about a new destination that needs no lock, including the provider's name lookup (a network call for
    a real provider, so never inside a transaction). Returns what save() writes. Raises DestinationError when anything
    is wrong."""
    problem = _holder_problem(holder)
    if problem:
        raise problem
    verified = names.verified_names(holder)
    if not any(names.usable(name) for name in verified):
        if isinstance(holder, StaffUser):  # a rider cannot edit their staff name
            raise DestinationError(
                "The name on your staff account is too short to check against a bank or mobile money account. "
                "Ask your delivery manager to put your full name, at least two words, on it.", "name_unusable", 400,
                field="full_name",
            )
        raise DestinationError(
            "The name on your profile is too short to check against a bank or mobile money account. "
            "Put your full name, at least two words, on your profile first.", "name_unusable", 400, field="full_name",
        )
    rail, institution, account_number = clean(data if isinstance(data, dict) else {}, holder)
    live = live_for(holder)
    if live.filter(rail=rail, account_number=account_number).exists():
        raise DestinationError(DUPLICATE, "duplicate", 409)
    if live.count() >= MAX_LIVE:
        raise DestinationError(TOO_MANY, "too_many", 409)
    provider = providers.get_provider()
    try:
        account_name = provider.lookup_account_name(rail, institution, account_number, holder_name=verified[0])
    except providers.NotConnected:
        raise DestinationError("Account names can't be checked yet, so payout destinations can't be added.", "name_check_unavailable", 409) from None
    except Exception as exc:
        # A timeout or a 5xx from the network: only the type is logged (the text may hold the account number).
        logger.warning("Account name lookup failed (%s)", type(exc).__name__)
        raise DestinationError("The account name could not be checked right now. Try again shortly.", "name_check_unreachable", 503) from None
    matched = names.matching_name(account_name, holder) if account_name else None
    if matched is None:
        # Never echo the name the network answered: it may be someone else's.
        raise DestinationError("The name on that account doesn't match the name we have verified for you.", "name_mismatch", 400)
    return {
        "rail": rail, "institution": institution, "account_number": account_number,
        "account_name": account_name[:150], "matched_name": matched[:150], "name_source": provider.name,
    }


def save(holder, checked, now=None):
    """Write a destination `check` accepted. Call inside the transaction that spends the step-up code. The holder's
    own row is locked and reloaded first (a lock on live destinations would lock nothing for the first adds), so two
    adds at once are taken one after the other; then, on the fresh row, the suspension, identity and name checks are run
    again (they may have changed since `check`) and the duplicate and five-destination checks see what the other add
    committed. Raises DestinationError, saving nothing."""
    now = now or timezone.now()
    holder_type, holder_id = ref(holder)
    fresh = type(holder).objects.select_for_update(no_key=True).get(pk=holder.pk)
    problem = _holder_problem(fresh)
    if problem:
        raise problem
    matched = names.matching_name(checked["account_name"], fresh)
    if matched is None:
        raise DestinationError("The name on that account doesn't match the name we have verified for you.", "name_mismatch", 400)
    checked = {**checked, "matched_name": matched[:150]}
    live = live_for(holder)
    if live.filter(rail=checked["rail"], account_number=checked["account_number"]).exists():
        raise DestinationError(DUPLICATE, "duplicate", 409)
    if live.count() >= MAX_LIVE:
        raise DestinationError(TOO_MANY, "too_many", 409)
    hours = settings_store.current("payout_cooling_hours", now)
    try:
        with transaction.atomic():
            return PayoutDestination.objects.create(
                holder_type=holder_type, holder_id=holder_id, usable_from=now + timedelta(hours=hours), **checked,
            )
    except IntegrityError:
        raise DestinationError(DUPLICATE, "duplicate", 409) from None


def remove(holder, destination_id, now=None):
    """Stop paying to a live destination of `holder` (a withdrawal already sent still completes)."""
    now = now or timezone.now()
    destination = live_for(holder).select_for_update().filter(pk=destination_id).first()
    if destination is None:
        raise DestinationError("That payout destination isn't yours, or it was already removed.", "not_found", 404)
    destination.removed_at = now
    destination.save(update_fields=["removed_at"])
    return destination


def row(destination, now=None):
    """What a holder or staff member sees of a destination: the number masked, always."""
    now = now or timezone.now()
    return {
        "id": destination.pk, "rail": destination.rail, "institution": destination.institution,
        "account_number_masked": mask_but_last(destination.account_number), "account_name": destination.account_name,
        "name_check": destination.name_source, "usable_from": destination.usable_from,
        "usable": destination.removed_at is None and destination.usable_from <= now,
        "removed": destination.removed_at is not None, "created_at": destination.created_at,
    }
