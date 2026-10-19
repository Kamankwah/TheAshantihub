"""Fixtures for the third-party rider tests across apps (not test cases themselves; wallets Plan 5)."""
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from accounts.models import Customer
from accounts.testing import make_staff
from delivery.models import PickupStop, Rider, RiderDocument, RiderEarning, RiderEmploymentPeriod
from ledger import posting, riders
from ledger.models import Account
from marketing.models_waivers import DeliveryWaiver, WaivedFeeCharge
from orders.models import DeliveryAssignment, Order


def rider(email="rider@example.com", *, name="Kojo Mensah", phone="+233244000002", third_party=True, since=None,
          company="Swift Riders Ltd"):
    """A Dispatch staff member (two-word name, so a payout name can match it) and their Rider row: third-party from
    `since` (a month ago by default) unless third_party=False."""
    staff = make_staff("dispatch", email, phone=phone)
    staff.full_name = name
    staff.save(update_fields=["full_name"])
    row = Rider.objects.select_related("staff").get(staff=staff)
    if third_party:
        row.employment, row.company_name = Rider.THIRD_PARTY, company
        row.third_party_since = since or timezone.now() - timedelta(days=30)
        row.save(update_fields=["employment", "company_name", "third_party_since"])
        RiderEmploymentPeriod.objects.create(rider=row, started_at=row.third_party_since)    # the periods decide who was paid
    return row


def delivered_by(order, rider_row, *, at=None, status=DeliveryAssignment.CONFIRMED):
    """The order went door to door and `rider_row` delivered it (and the customer confirmed), or failed it."""
    at = at or timezone.now()
    order.delivery_method = Order.DOOR_TO_DOOR
    order.save(update_fields=["delivery_method"])
    failed = status == DeliveryAssignment.FAILED
    return DeliveryAssignment.objects.create(
        order=order, dispatch=rider_row.staff, status=status, delivered_at=None if failed else at,
        confirmed_at=at if status == DeliveryAssignment.CONFIRMED else None, failed_at=at if failed else None,
    )


def stop_collected(order, owner, at=None, *, status=PickupStop.COLLECTED):
    """One pickup stop of the order's delivery at `owner`'s shop, collected at `at` (now by default) unless `status` says
    otherwise (a skipped or waiting stop has no collection time). The order must already have its assignment."""
    assignment = DeliveryAssignment.objects.get(order=order)
    collected = status == PickupStop.COLLECTED
    return PickupStop.objects.create(
        assignment=assignment, sequence=assignment.stops.count() + 1, business_owner=owner, status=status,
        collected_at=(at or timezone.now()) if collected else None,
    )


def waived(order, owner, amount="15.00"):
    """The business covered the order's delivery fee with its free-delivery promo (charged to it at release)."""
    now = timezone.now()
    waiver = DeliveryWaiver.objects.create(
        business_owner=owner, name="Free delivery week", starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1),
        status=DeliveryWaiver.ACTIVE,
    )
    return WaivedFeeCharge.objects.create(order=order, waiver=waiver, business_owner=owner, amount=Decimal(amount))


def earning(rider_row, *, gross, at, bp=1000):
    """A delivery already paid to the rider as a release leaves it (journal order-rider-<order>, the earning row), on an
    order with no money of its own: for the end-of-day, wallet and staff tests. It debits platform delivery income, as the
    real release does; rider earnings never touch provider clearing (R13), so reconciliation tests are not polluted."""
    customer = Customer.objects.get_or_create(phone="+233200770001", defaults={"full_name": "Esi Mensah", "password_hash": "x"})[0]
    order = Order.objects.create(customer=customer, status=Order.PAID, total_amount=Decimal("0.00"), delivery_method=Order.DOOR_TO_DOOR)
    reserve, net = riders.split(gross, bp)
    posting.post(                       # the payment journal a real order has (payroll_jobs and unreleased_deliveries read it); a pesewa between neutral accounts
        key=f"order-pay-{order.pk}", kind="order_payment", reference_type="orders.order", reference_id=str(order.pk),
        lines=[posting.debit(posting.account_for(Account.PLATFORM_PROMO_SUBSIDY), 1), posting.credit(posting.account_for(Account.PLATFORM_FEE_INCOME), 1)],
        allow_negative=(Account.PLATFORM_PROMO_SUBSIDY,),
    )
    balance, held = riders.accounts_of(rider_row)
    lines = [posting.debit(posting.account_for(Account.PLATFORM_DELIVERY_INCOME), gross)]
    if net:
        lines.append(posting.credit(balance, net))
    if reserve:
        lines.append(posting.credit(held, reserve))
    journal = posting.post(
        key=riders.earning_key(order), kind="rider_earning", lines=lines, reference_type="orders.order", reference_id=str(order.pk),
        allow_negative=(Account.PLATFORM_DELIVERY_INCOME,),     # the fixture has no release behind it to have filled the account
    )
    return RiderEarning.objects.create(
        order=order, rider=rider_row, gross_pesewas=gross, commission_bp=bp, reserve_pesewas=reserve, net_pesewas=net,
        earned_at=at, earned_on=timezone.localdate(at), journal=journal,
    )


def ghana_card(rider_row, *, expires_on=None, status=RiderDocument.APPROVED):
    """A Ghana Card on file, approved and in date unless told otherwise. No file is written: the row only names one (the
    paper review itself is tested in delivery)."""
    return RiderDocument.objects.create(
        rider=rider_row, kind=RiderDocument.GHANA_CARD, file="documents/ghana-card.png", status=status,
        expires_on=expires_on or timezone.localdate() + timedelta(days=365),
    )
