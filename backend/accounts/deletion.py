"""A customer or business owner deleting their own account from the app (Apple and Google both require it).

The row stays so orders, ledger entries and disputes keep their foreign keys; what is erased is the person: name,
contacts, address book, avatar, identity and payout details. Deletion is refused while money or an order is open."""
from django.contrib.auth.hashers import make_password
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from . import files, mobile_sessions
from .models import BusinessOwner, Customer

DELETED_NAME = "Deleted user"
OPEN_ORDERS = "open_orders"
LIVE_LISTINGS = "live_listings"
ACTIVE_PROMOTION = "active_promotion"
WALLET_BALANCE = "wallet_balance"


def blockers(account, account_type):
    """Reason codes (OPEN_ORDERS, LIVE_LISTINGS, ACTIVE_PROMOTION, WALLET_BALANCE) that stop this deletion."""
    from ledger import escrow, posting
    from ledger.models import Account
    from listings.models import Listing, Promotion
    from orders.models import Order

    now = timezone.now()
    open_orders = Order.objects.filter(status=Order.PAID).exclude(delivery_status=Order.DELIVERED)
    reasons = []
    if account_type == "customer":
        if open_orders.filter(customer=account).exists():
            reasons.append(OPEN_ORDERS)
        kinds = [(Account.CUSTOMER_WALLET, account)]
    else:
        if open_orders.filter(items__listing__business_owner=account).exists():
            reasons.append(OPEN_ORDERS)
        if Listing.objects.filter(business_owner=account, status=Listing.PUBLISHED).exists():
            reasons.append(LIVE_LISTINGS)
        if Promotion.objects.filter(
            listing__business_owner=account, status=Promotion.ACTIVE, ends_at__gt=now
        ).exists():
            reasons.append(ACTIVE_PROMOTION)
        kinds = [(Account.VENDOR_PENDING, account), (Account.VENDOR_AVAILABLE, account)]
    if escrow.enabled() and any(posting.balance_of(kind, owner) != 0 for kind, owner in kinds):
        reasons.append(WALLET_BALANCE)
    return reasons


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
            for field in (
                "ghana_card_number", "ghana_card_front_image", "ghana_card_back_image", "business_reg_certificate",
                "signboard_photo", "business_contact_phone", "tin", "payout_bank_name", "payout_bank_account_number",
                "payout_bank_account_name", "payout_momo_network", "payout_momo_number", "payout_momo_name",
            ):
                setattr(profile, field, None)
            profile.save()
    mobile_sessions.revoke_all(account_type, account.pk)
    files.delete_after_commit(stale_files)
