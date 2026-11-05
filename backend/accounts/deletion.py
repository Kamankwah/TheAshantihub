"""A customer or business owner deleting their own account from the app (Apple and Google both require it).

The row stays so orders, ledger entries and disputes keep their foreign keys; what is erased is the person: name,
contacts, address book, avatar, identity and payout details, payout numbers, verified contacts and marketing consent.
Deletion is refused while money or work is still open."""
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.db import transaction
from django.utils import timezone

from . import files, mobile_sessions
from .models import BusinessOwner, Customer

DELETED_NAME = "Deleted user"
OPEN_ORDERS = "open_orders"
OPEN_WITHDRAWAL = "open_withdrawal"
ACTIVE_BOOKING = "active_booking"
OPEN_SERVICE_REQUEST = "open_service_request"
LIVE_LISTINGS = "live_listings"
ACTIVE_PROMOTION = "active_promotion"
WALLET_BALANCE = "wallet_balance"
COMPANY_ACCOUNT = "company_account"
# With the ledger off nothing marks a pickup order delivered, so an old paid order would block deletion for good.
# Only a recent one counts as still in flight; a person is shown which orders hold things up (open_order_ids).
OPEN_ORDER_WINDOW = timedelta(days=30)


def open_order_ids(account, account_type):
    from orders.models import Order

    orders = Order.objects.filter(
        status=Order.PAID, placed_at__gte=timezone.now() - OPEN_ORDER_WINDOW
    ).exclude(delivery_status=Order.DELIVERED)
    if account_type == "customer":
        orders = orders.filter(customer=account)
    else:
        orders = orders.filter(items__listing__business_owner=account)
    return sorted(set(orders.values_list("pk", flat=True)))


def blockers(account, account_type):
    """Reason codes that stop this deletion (the constants above), in a stable order."""
    from bookings.models import Booking
    from ledger import escrow, posting
    from ledger.models import Account
    from listings.models import Listing, Promotion
    from services.models import ServiceRequest
    from wallets.models import Withdrawal

    reasons = []
    if open_order_ids(account, account_type):
        reasons.append(OPEN_ORDERS)
    if Withdrawal.objects.filter(holder_type=account_type, holder_id=account.pk, status__in=Withdrawal.OPEN).exists():
        reasons.append(OPEN_WITHDRAWAL)
    open_requests = (ServiceRequest.REQUESTED, ServiceRequest.ACCEPTED, ServiceRequest.IN_PROGRESS)
    if account_type == "customer":
        if Booking.objects.filter(customer=account, status__in=Booking.ACTIVE_STATUSES).exists():
            reasons.append(ACTIVE_BOOKING)
        if ServiceRequest.objects.filter(customer=account, status__in=open_requests).exists():
            reasons.append(OPEN_SERVICE_REQUEST)
        kinds = [(Account.CUSTOMER_WALLET, account)]
    else:
        if account.is_company:
            reasons.append(COMPANY_ACCOUNT)
        if Booking.objects.filter(listing__business_owner=account, status__in=Booking.ACTIVE_STATUSES).exists():
            reasons.append(ACTIVE_BOOKING)
        if ServiceRequest.objects.filter(business_owner=account, status__in=open_requests).exists():
            reasons.append(OPEN_SERVICE_REQUEST)
        if Listing.objects.filter(business_owner=account, status=Listing.PUBLISHED).exists():
            reasons.append(LIVE_LISTINGS)
        if Promotion.objects.filter(
            listing__business_owner=account, status=Promotion.ACTIVE, ends_at__gt=timezone.now()
        ).exists():
            reasons.append(ACTIVE_PROMOTION)
        kinds = [(Account.VENDOR_PENDING, account), (Account.VENDOR_AVAILABLE, account)]
    if escrow.enabled() and any(posting.balance_of(kind, owner) != 0 for kind, owner in kinds):
        reasons.append(WALLET_BALANCE)
    return reasons


def _opt_out_everywhere(account):
    from marketing import consent
    from marketing.models_consent import CHANNELS

    for channel, _label in CHANNELS:
        try:
            consent.record_consent(account, channel, False, "account_deleted")
        except consent.ConsentError:
            pass  # a channel that was never offered has nothing to withdraw


def _erase_traces(account, account_type):
    """What lives in other apps and still names the person: payout numbers, verified contacts, consent."""
    from otp.models import VerifiedContact
    from wallets.models import PayoutDestination

    now = timezone.now()
    PayoutDestination.objects.filter(holder_type=account_type, holder_id=account.pk, removed_at__isnull=True).update(
        removed_at=now
    )
    VerifiedContact.objects.filter(account_type=account_type, account_id=account.pk).delete()
    _opt_out_everywhere(account)


def _close_business(account):
    from billing.models import Subscription
    from listings import revisions
    from listings.models import Listing

    now = timezone.now()
    for listing in Listing.objects.filter(business_owner=account).exclude(status=Listing.DISCONTINUED):
        revisions.delete_open(listing)  # an open edit goes, with the files it staged
    Listing.objects.filter(business_owner=account).exclude(status=Listing.DISCONTINUED).update(
        status=Listing.DISCONTINUED, discontinued_at=now
    )
    Listing.objects.filter(business_owner=account).update(contact_phone="")
    subscription = getattr(account, "subscription", None)
    if subscription is not None and subscription.status != Subscription.CANCELLED:
        subscription.status = Subscription.CANCELLED
        subscription.save(update_fields=["status"])


@transaction.atomic
def delete_account(account, account_type):
    """Erase the person behind this account and end its sessions. Order, ledger and dispute rows are untouched."""
    now = timezone.now()
    unusable = make_password(None)
    stale_files = []
    if account_type == "customer":
        stale_files.append(account.avatar.name if account.avatar else "")
        Customer.objects.filter(pk=account.pk).update(
            full_name=DELETED_NAME, phone=None, email=None, avatar=None, address=None, gender=None,
            date_of_birth=None, secondary_email=None, secondary_email_verified=False,
            secondary_email_verify_code=None, secondary_email_verify_expires_at=None, secondary_phone=None,
            secondary_phone_verified=False, secondary_phone_verify_code=None, secondary_phone_verify_expires_at=None,
            password_hash=unusable, deleted_at=now,
        )
        account.addresses.all().delete()
    else:
        _close_business(account)
        BusinessOwner.objects.filter(pk=account.pk).update(
            full_name=DELETED_NAME, login_phone=f"deleted-{account.pk}", email=None, password_hash=unusable,
            deleted_at=now,
        )
        profile = getattr(account, "profile", None)
        if profile is not None:
            for field in ("ghana_card_front_image", "ghana_card_back_image", "business_reg_certificate", "signboard_photo"):
                stale = getattr(profile, field)
                if stale:
                    stale_files.append(stale.name)
            # NULL, never "": the card number column is unique, and two erased cards must not collide.
            erased = (
                "ghana_card_number", "ghana_card_front_image", "ghana_card_back_image", "business_reg_certificate",
                "signboard_photo", "business_contact_phone", "tin", "payout_bank_name", "payout_bank_account_number",
                "payout_bank_account_name", "payout_momo_network", "payout_momo_number", "payout_momo_name",
            )
            for field in erased:
                setattr(profile, field, None)
            profile.identity_status = profile.IDENTITY_NOT_SUBMITTED
            # Only what is erased: this copy was loaded unlocked, and a whole-row save would write back stale values
            # (the main category, which accounts.categories.set_categories keeps in step with the links).
            profile.save(update_fields=[*erased, "identity_status"])
    _erase_traces(account, account_type)
    mobile_sessions.revoke_all(account_type, account.pk)
    files.delete_after_commit(stale_files)
