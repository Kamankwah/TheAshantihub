"""Business health (spec S3; plan 2A Task 8, Decision 12).

Worked out live from records on every read — the subscription clock,
listings, sales (paid orders, bookings and service requests taken on), open
disputes, fraud cases and logged calls — and saved
nightly into BusinessHealthSnapshot for reports and the "a week ago"
comparison. Nobody marks a business by hand.

Lists rate every business of the filtered set in Python after ONE annotated
query (each input below is a correlated subquery, so the query count never
grows with the portfolio), then sort by rating before cutting a page. That is
fine for thousands of businesses; past that, sort on the snapshot table.
"""
from collections import namedtuple
from datetime import timedelta

from django.db.models import CharField, IntegerField, OuterRef, Q, Subquery
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Cast, Greatest
from django.utils import timezone

from accounts.models import BusinessOwner
from approvals.models import ApprovalRequest
from billing.clock import subscription_state
from bookings.models import Booking
from calls.models import CallLog
from field.models import VisitCheckIn
from disputes.models import Dispute
from fraud.models import FraudFlag
from listings.models import Listing
from orders.models import Order
from services.models import ServiceRequest

from .models import BusinessHealthSnapshot

NEW = "new"
HEALTHY = "healthy"
NEEDS_ATTENTION = "needs_attention"
AT_RISK = "at_risk"
# Also the order lists sort in: at risk, needs attention, new, healthy.
RATINGS = (AT_RISK, NEEDS_ATTENTION, NEW, HEALTHY)
SORT_RANK = {rating: rank for rank, rating in enumerate(RATINGS)}

PAUSED = "Subscription paused"
NO_LISTING_LIVE = "No listing live"
NO_ORDER_60 = "No order in 60 days"
CONFIRMED_FRAUD = "Confirmed fraud case"
OVERDUE = "Subscription overdue"
FEW_LISTINGS = "Fewer than 3 listings live"
NO_ORDER_30 = "No order in 30 days"
OPEN_DISPUTE = "Open dispute"
NO_CONTACT = "No contact in 30 days"
KYC_WAITING = "KYC waiting"

MIN_LIVE_LISTINGS = 3
ORDER_RULES_AFTER = timedelta(days=30)  # Decision 12: both "no order" rules wait until KYC is this old
AT_RISK_WITHOUT_ORDER = timedelta(days=60)
ATTENTION_WITHOUT_ORDER = timedelta(days=30)
ATTENTION_WITHOUT_CONTACT = timedelta(days=30)
OPEN_DISPUTE_STATUSES = (Dispute.OPEN, Dispute.INVESTIGATING)
# A service business's "orders": a service request the owner took on (accepted,
# then paid and in progress, or done) — not one still asked, declined or cancelled.
TAKEN_SERVICE_REQUEST_STATUSES = (ServiceRequest.ACCEPTED, ServiceRequest.IN_PROGRESS, ServiceRequest.COMPLETED)
BUSINESS_OWNER = "business_owner"  # CallLog.related_type / counterpart_type for a business
LISTING_CREATE = "listing.create"
SNAPSHOT_BATCH = 500

RatedBusiness = namedtuple("RatedBusiness", "owner rating reasons subscription")


class SubqueryCount(Subquery):
    """COUNT(*) of a correlated queryset as one integer column (0 when it is
    empty). Each count is its own subquery, so several never multiply each
    other's rows the way joined Count()s would."""

    template = "(SELECT COUNT(*) FROM (%(subquery)s) AS counted)"
    output_field = IntegerField()


def _count(queryset):
    return SubqueryCount(queryset.order_by().values("pk").distinct())


def _outer_pk_text():
    return Cast(OuterRef("pk"), output_field=CharField())


def calls_about(owner_id):
    """Calls with this business's owner, or logged about the business. A logged
    call, like a completed visit, counts as scout contact."""
    return Q(related_type=BUSINESS_OWNER, related_id=str(owner_id)) | Q(
        counterpart_type=BUSINESS_OWNER, counterpart_id=owner_id
    )


def with_health_inputs(queryset, now):
    """Annotate every input rate() reads, and select the subscription. Orders
    and calls stamped after `now` are ignored, so a rating is reproducible as
    of `now`."""
    listings = Listing.objects.filter(business_owner=OuterRef("pk"))
    # A scout's proposed product waits in Approvals, not in the listings table.
    proposed = (
        ApprovalRequest.objects.filter(kind=LISTING_CREATE, status=ApprovalRequest.PENDING)
        .annotate(_business=KeyTextTransform("business_owner_id", "payload"))
        .filter(_business=_outer_pk_text())
    )
    # The last "order" is the latest of a paid order with a line from this
    # business, a booking that wasn't cancelled, and a service request the
    # owner took on — one correlated subquery each.
    paid_orders = Order.objects.filter(
        status=Order.PAID, items__listing__business_owner=OuterRef("pk"), placed_at__lte=now,
    ).order_by("-placed_at")
    bookings = Booking.objects.filter(
        listing__business_owner=OuterRef("pk"), created_at__lte=now,
    ).exclude(status=Booking.CANCELLED).order_by("-created_at")
    service_requests = ServiceRequest.objects.filter(
        listing__business_owner=OuterRef("pk"), status__in=TAKEN_SERVICE_REQUEST_STATUSES, created_at__lte=now,
    ).order_by("-created_at")
    open_disputes = Dispute.objects.filter(
        status__in=OPEN_DISPUTE_STATUSES, order__items__listing__business_owner=OuterRef("pk"),
    )
    calls = CallLog.objects.filter(
        Q(related_type=BUSINESS_OWNER, related_id=_outer_pk_text())
        | Q(counterpart_type=BUSINESS_OWNER, counterpart_id=OuterRef("pk")),
        started_at__lte=now,
    ).order_by("-started_at")
    flags = FraudFlag.objects.filter(business_owner=OuterRef("pk"))
    visits = VisitCheckIn.objects.filter(
        business_owner=OuterRef("pk"), status=VisitCheckIn.DONE, checked_out_at__lte=now,
    ).order_by("-checked_out_at")
    return queryset.select_related("subscription__plan").annotate(
        live_listings=_count(listings.filter(status=Listing.PUBLISHED)),
        total_listings=_count(listings),
        listings_waiting=_count(listings.filter(status=Listing.PENDING_REVIEW)) + _count(proposed),
        # Postgres GREATEST skips NULLs, so a business with one kind of sale still gets its date.
        last_order_at=Greatest(
            Subquery(paid_orders.values("placed_at")[:1]),
            Subquery(bookings.values("created_at")[:1]),
            Subquery(service_requests.values("created_at")[:1]),
        ),
        open_disputes=_count(open_disputes),
        confirmed_fraud=_count(flags.filter(status=FraudFlag.CONFIRMED)),
        open_fraud_flags=_count(flags.filter(status=FraudFlag.OPEN)),
        last_call_at=Subquery(calls.values("started_at")[:1]),
        last_visit_at=Subquery(visits.values("checked_out_at")[:1]),
    )


def last_contact(owner):
    """{kind, at} of the later of the scout's last logged call and last
    completed visit, or None. Needs an owner annotated by with_health_inputs()."""
    call, visit = owner.last_call_at, owner.last_visit_at
    if call is None and visit is None:
        return None
    if visit is not None and (call is None or visit >= call):
        return {"kind": "visit", "at": visit}
    return {"kind": "call", "at": call}


def last_contact_at(owner):
    contact = last_contact(owner)
    return contact["at"] if contact else None


def _missing_or_before(moment, cutoff):
    return moment is None or moment < cutoff


def rate(owner, now):
    """(rating, reasons) for an owner annotated by with_health_inputs(), at-risk
    reasons first. A business whose KYC isn't approved is New — "KYC waiting"
    while pending; a rejected one isn't waiting, so it gets no reason."""
    if owner.kyc_status != BusinessOwner.VERIFIED:
        return NEW, [KYC_WAITING] if owner.kyc_status == BusinessOwner.PENDING else []
    state = subscription_state(getattr(owner, "subscription", None), now=now)["state"]
    # reviewed_at is when KYC was approved; a row approved before that field
    # was filled in falls back to when the business joined.
    order_rules_apply = (owner.reviewed_at or owner.created_at) <= now - ORDER_RULES_AFTER
    at_risk, attention = [], []
    if state == "paused":
        at_risk.append(PAUSED)
    if owner.live_listings == 0:
        at_risk.append(NO_LISTING_LIVE)
    if order_rules_apply and _missing_or_before(owner.last_order_at, now - AT_RISK_WITHOUT_ORDER):
        at_risk.append(NO_ORDER_60)
    if owner.confirmed_fraud:
        at_risk.append(CONFIRMED_FRAUD)
    if state == "overdue":
        attention.append(OVERDUE)
    if 0 < owner.live_listings < MIN_LIVE_LISTINGS:  # none live is already "No listing live"
        attention.append(FEW_LISTINGS)
    if (order_rules_apply and NO_ORDER_60 not in at_risk
            and _missing_or_before(owner.last_order_at, now - ATTENTION_WITHOUT_ORDER)):
        attention.append(NO_ORDER_30)
    if owner.open_disputes:
        attention.append(OPEN_DISPUTE)
    if _missing_or_before(last_contact_at(owner), now - ATTENTION_WITHOUT_CONTACT):
        attention.append(NO_CONTACT)
    if at_risk:
        return AT_RISK, at_risk + attention
    if attention:
        return NEEDS_ATTENTION, attention
    return HEALTHY, []


def rate_all(queryset, now):
    """Every business in `queryset`, rated, with its subscription clock — one
    query however many rows. Callers filter and sort the list in Python."""
    owners = with_health_inputs(queryset.select_related("profile__zone", "account_manager"), now)
    rows = []
    for owner in owners:
        rating, reasons = rate(owner, now)
        rows.append(RatedBusiness(owner, rating, reasons, subscription_state(getattr(owner, "subscription", None), now=now)))
    return rows


def snapshot(day, now=None):
    """Save every non-rejected business's rating for `day` (an upsert, so a
    second run on the same day updates the row). Returns how many it saved."""
    now = now or timezone.now()
    owners = with_health_inputs(
        BusinessOwner.objects.exclude(kyc_status=BusinessOwner.REJECTED).order_by("pk"), now,
    )
    saved, batch = 0, []
    for owner in owners.iterator(chunk_size=SNAPSHOT_BATCH):
        rating, reasons = rate(owner, now)
        batch.append(BusinessHealthSnapshot(business_owner_id=owner.pk, date=day, rating=rating, reasons=reasons))
        if len(batch) == SNAPSHOT_BATCH:
            saved += _upsert(batch)
            batch = []
    if batch:
        saved += _upsert(batch)
    return saved


def _upsert(rows):
    BusinessHealthSnapshot.objects.bulk_create(
        rows, update_conflicts=True, unique_fields=["business_owner", "date"], update_fields=["rating", "reasons"],
    )
    return len(rows)
