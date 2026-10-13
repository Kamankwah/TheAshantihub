"""Featured listing slots (canvas 13): which paid featured promotion holds which place, which week.

The weekly slot price is the price of the PLACE (FeaturedSlot.weekly_price). What the owner
paid for the promotion is Promotion.amount_paid, priced per day by listings
PROMOTION_DAILY_RATES; the two are different numbers and a booking never changes either."""
import math
from datetime import date, timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone

from billing import clock
from fraud.models import FraudFlag
from listings.models import Category, Listing, Promotion
from listings.visibility import hidden_business_q

from .models_banners import FeaturedBooking, FeaturedSlot

MAX_WEEKS_AHEAD = 26
GRID_WEEKS = 4
# A booking whose business is under one of these is shown as held, and not shown on the site.
HOLD_CODES = ("fraud_hold", "subscription_overdue")


class FeaturedError(Exception):
    def __init__(self, message, status_code=400, code=""):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


def week_start_of(day):
    return day - timedelta(days=day.weekday())


def today():
    return timezone.localdate()


def week_label(start):
    end = start + timedelta(days=6)
    if start.month == end.month:
        return f"{start.day}–{end.day} {end:%b}"
    return f"{start.day} {start:%b} – {end.day} {end:%b}"


def blockers(listing, flags=None):
    """Why this listing's business can't hold a featured slot right now: [{code, message}]."""
    owner = listing.business_owner
    out = []
    if flags is not None:
        open_flag = owner.pk in flags
    else:
        open_flag = FraudFlag.objects.filter(business_owner_id=owner.pk, status=FraudFlag.OPEN).exists()
    if open_flag:
        out.append({"code": "fraud_hold", "message": "The business has an open fraud case. It is held until Operations closes the case."})
    subscription = getattr(owner, "subscription", None)
    if subscription is not None and clock.subscription_state(subscription)["state"] in (clock.OVERDUE, clock.PAUSED):
        out.append({"code": "subscription_overdue", "message": "The subscription is overdue, until it pays."})
    if Listing.objects.filter(pk=listing.pk).filter(hidden_business_q()).exists():
        out.append({"code": "hidden_business", "message": "The business is hidden from the site."})
    if listing.status != Listing.PUBLISHED:
        out.append({"code": "listing_not_live", "message": "The listing is hidden or still waiting for moderation."})
    if listing.stock_quantity is not None and listing.stock_quantity <= 0:
        out.append({"code": "out_of_stock", "message": "The listing is out of stock."})
    return out


def _flags(owner_ids):
    return set(FraudFlag.objects.filter(business_owner_id__in=list(owner_ids), status=FraudFlag.OPEN).values_list("business_owner_id", flat=True))


def paid_weeks(promotion):
    days = max(1, round((promotion.ends_at - promotion.starts_at).total_seconds() / 86400))
    return max(1, math.ceil(days / 7))


def _promotion_row(promotion, flags=None, now=None):
    listing = promotion.listing
    taken = promotion.featured_bookings.filter(status=FeaturedBooking.BOOKED).count()
    return {
        "promotion_id": promotion.pk, "status": promotion.status,
        "listing_id": listing.pk, "listing_name": listing.name,
        "business": listing.business_owner.display_name,
        "paid_days": max(1, round((promotion.ends_at - promotion.starts_at).total_seconds() / 86400)),
        "weeks_paid": paid_weeks(promotion), "weeks_placed": taken,
        "blockers": blockers(listing, flags),
    }


def candidates(search=""):
    """Featured promotions that can still be given a place: pending, or active and not finished."""
    now = timezone.now()
    from django.db.models import Q

    rows = (
        Promotion.objects.filter(kind=Promotion.FEATURED)
        .filter(Q(status=Promotion.PENDING) | Q(status=Promotion.ACTIVE, ends_at__gte=now))
        .select_related("listing", "listing__business_owner", "listing__business_owner__profile").order_by("created_at")
    )
    search = (search or "").strip()
    if search:
        rows = rows.filter(Q(listing__name__icontains=search) | Q(listing__business_owner__profile__business_name__icontains=search) | Q(listing__business_owner__full_name__icontains=search))
    rows = list(rows[:50])
    flags = _flags(p.listing.business_owner_id for p in rows)
    return [_promotion_row(p, flags, now) for p in rows]


# ─── Booking ────────────────────────────────────────────────────────────────
def _release_dead(slot, category, position, weeks):
    """Bookings whose promotion was rejected or cancelled no longer hold the place."""
    dead = FeaturedBooking.objects.select_for_update().filter(
        slot=slot, category=category, position=position, week_start__in=weeks, status=FeaturedBooking.BOOKED,
        promotion__status__in=[Promotion.REJECTED, Promotion.CANCELLED],
    )
    for b in dead:
        b.status = FeaturedBooking.RELEASED
        b.released_at = timezone.now()
        b.release_note = "The promotion was stopped."
        b.save(update_fields=["status", "released_at", "release_note"])


def book(staff, *, promotion_id, slot_key, week_start, weeks=1, category_id=None, position=None):
    if not isinstance(weeks, int) or not 1 <= weeks <= 4:
        raise FeaturedError("Choose between 1 and 4 weeks.")
    if not isinstance(week_start, date) or week_start.weekday() != 0:
        raise FeaturedError("A booking starts on a Monday.")
    now = timezone.now()
    first = week_start_of(today())
    if week_start < first:
        raise FeaturedError("That week has already started. Choose this week or a later one.")
    if week_start > first + timedelta(weeks=MAX_WEEKS_AHEAD):
        raise FeaturedError(f"Bookings open up to {MAX_WEEKS_AHEAD} weeks ahead.")
    wanted = [week_start + timedelta(weeks=i) for i in range(weeks)]

    with transaction.atomic():
        try:
            slot = FeaturedSlot.objects.select_for_update().get(key=slot_key, active=True)
        except FeaturedSlot.DoesNotExist as exc:
            raise FeaturedError("That slot does not exist.", 404) from exc
        try:
            promotion = Promotion.objects.select_for_update(of=("self",)).select_related("listing", "listing__business_owner").get(pk=promotion_id)
        except Promotion.DoesNotExist as exc:
            raise FeaturedError("That promotion does not exist.", 404) from exc
        if promotion.kind != Promotion.FEATURED:
            raise FeaturedError("Only a featured promotion can take a featured slot. A boost cannot.")
        if promotion.status == Promotion.ACTIVE and promotion.ends_at < now:
            raise FeaturedError("That promotion has finished.")
        if promotion.status not in (Promotion.PENDING, Promotion.ACTIVE):
            raise FeaturedError("That promotion was stopped, so it cannot take a slot.")

        category = None
        if slot.kind == FeaturedSlot.CATEGORY_TOP:
            if not category_id:
                raise FeaturedError("Choose the category for a category-top slot.")
            category = Category.objects.filter(pk=category_id).first()
            if category is None:
                raise FeaturedError("That category does not exist.")
            position = position or 1
            if not 1 <= position <= slot.capacity:
                raise FeaturedError(f"This slot has {slot.capacity} places per category.")
        else:
            if category_id:
                raise FeaturedError("A home slot has no category.")
            position = 1

        reasons = blockers(promotion.listing)
        if reasons:
            raise FeaturedError(reasons[0]["message"], 409, reasons[0]["code"])

        already = FeaturedBooking.objects.filter(promotion=promotion, status=FeaturedBooking.BOOKED)
        if already.filter(week_start__in=wanted).exists():
            raise FeaturedError("This promotion already has a place in one of those weeks.", 409, "already_placed")
        if already.count() + weeks > paid_weeks(promotion):
            raise FeaturedError(f"This promotion paid for {paid_weeks(promotion)} week(s) of featuring, so it can hold at most that many weeks.", 409, "beyond_paid")

        _release_dead(slot, category, position, wanted)
        taken = FeaturedBooking.objects.filter(slot=slot, category=category, position=position, week_start__in=wanted, status=FeaturedBooking.BOOKED)
        if taken.exists():
            raise FeaturedError("That slot is already taken in " + ", ".join(week_label(b.week_start) for b in taken) + ".", 409, "taken")
        created = []
        try:
            with transaction.atomic():
                for w in wanted:
                    created.append(FeaturedBooking.objects.create(
                        slot=slot, category=category, position=position, promotion=promotion, week_start=w,
                        price_snapshot=slot.weekly_price, booked_by=staff,
                    ))
        except IntegrityError as exc:
            raise FeaturedError("That slot was just taken. Pick another.", 409, "taken") from exc
    return created


def release(booking_id, staff, note=""):
    with transaction.atomic():
        booking = FeaturedBooking.objects.select_for_update().filter(pk=booking_id).first()
        if booking is None:
            raise FeaturedError("That booking does not exist.", 404)
        if booking.status != FeaturedBooking.BOOKED:
            raise FeaturedError("This place is already released.", 409)
        booking.status = FeaturedBooking.RELEASED
        booking.released_by = staff
        booking.released_at = timezone.now()
        booking.release_note = (note or "")[:300]
        booking.save(update_fields=["status", "released_by", "released_at", "release_note"])
    return booking


# ─── The grid ───────────────────────────────────────────────────────────────
def _cell(booking, flags):
    promotion = booking.promotion
    reasons = blockers(promotion.listing, flags)
    held = [r for r in reasons if r["code"] in HOLD_CODES]
    if promotion.status in (Promotion.REJECTED, Promotion.CANCELLED):
        state = "stopped"
    elif held:
        state = "held"
    elif promotion.status == Promotion.PENDING:
        state = "waiting"
    else:
        state = "booked"
    return {
        "week_start": booking.week_start.isoformat(), "state": state, "booking_id": booking.pk,
        "business": promotion.listing.business_owner.display_name, "listing_name": promotion.listing.name,
        "promotion_id": promotion.pk, "reason": held[0]["message"] if held and state == "held" else "",
    }


def grid(start=None, weeks=GRID_WEEKS):
    first = week_start_of(start or today())
    starts = [first + timedelta(weeks=i) for i in range(weeks)]
    slots = list(FeaturedSlot.objects.filter(active=True))
    bookings = list(
        FeaturedBooking.objects.filter(status=FeaturedBooking.BOOKED, week_start__in=starts)
        .select_related("slot", "category", "promotion", "promotion__listing", "promotion__listing__business_owner", "promotion__listing__business_owner__profile")
    )
    flags = _flags(b.promotion.listing.business_owner_id for b in bookings)
    by_key = {}
    for b in bookings:
        by_key.setdefault((b.slot_id, b.category_id, b.position), {})[b.week_start] = b

    rows = []
    for slot in slots:
        if slot.kind == FeaturedSlot.HOME:
            keys = [(None, 1)]
        else:
            seen = sorted({(b.category_id, b.position) for b in bookings if b.slot_id == slot.pk})
            keys = seen
        for category_id, position in keys:
            placed = by_key.get((slot.pk, category_id, position), {})
            category = next((b.category for b in bookings if b.slot_id == slot.pk and b.category_id == category_id), None) if category_id else None
            name = slot.label if category is None else f"{category.label} · top {position}"
            cells = []
            for w in starts:
                b = placed.get(w)
                cells.append(_cell(b, flags) if b else {"week_start": w.isoformat(), "state": "open", "booking_id": None})
            rows.append({
                "slot_key": slot.key, "kind": slot.kind, "name": name, "position": position,
                "category": {"id": category.pk, "slug": category.slug, "label": category.label} if category else None,
                "weekly_price": str(slot.weekly_price), "cells": cells,
            })
    booked_now = [b for b in bookings if b.week_start == starts[0] and _cell(b, flags)["state"] == "booked"]
    waiting_now = [b for b in bookings if b.week_start == starts[0] and _cell(b, flags)["state"] == "waiting"]
    total = sum((b.price_snapshot for b in booked_now), Decimal("0"))
    return {
        "weeks": [{"start": w.isoformat(), "label": week_label(w), "current": w == week_start_of(today())} for w in starts],
        "rows": rows,
        "summary": {
            "week_label": week_label(starts[0]), "booked": len(booked_now), "waiting": len(waiting_now),
            "list_price_total": str(total.quantize(Decimal("0.01"))),
        },
        "prices": prices(),
    }


def prices():
    from listings.views import PROMOTION_DAILY_RATES

    slots = list(FeaturedSlot.objects.filter(active=True))
    home = [s for s in slots if s.kind == FeaturedSlot.HOME]
    top = [s for s in slots if s.kind == FeaturedSlot.CATEGORY_TOP]
    out = []
    if home:
        out.append({"key": "home", "label": "Home featured row", "weekly_price": str(home[0].weekly_price), "places": len(home), "per": "places"})
    if top:
        out.append({"key": "category_top", "label": "Category top", "weekly_price": str(top[0].weekly_price), "places": top[0].capacity, "per": "per category"})
    return {
        "slots": out,
        "promotion_daily_rate": str(PROMOTION_DAILY_RATES[Promotion.FEATURED]),
        "note": "Slot prices are set on the slot rows. The price an owner pays when buying a featured promotion is a daily rate set elsewhere, and the two are not reconciled yet. A booking changes neither.",
    }


# ─── Public ─────────────────────────────────────────────────────────────────
def public_listings(category_slug=None, request=None):
    """Listings on the featured row right now: booked this week, promotion active and in its
    window, business and listing in good standing. Newest first within slot order."""
    now = timezone.now()
    week = week_start_of(today())
    rows = (
        FeaturedBooking.objects.filter(status=FeaturedBooking.BOOKED, week_start=week, promotion__status=Promotion.ACTIVE,
                                      promotion__starts_at__lte=now, promotion__ends_at__gte=now)
        .select_related("slot", "category", "promotion__listing__category", "promotion__listing__business_owner", "promotion__listing__business_owner__profile")
        .order_by("slot__position", "position", "id")
    )
    if category_slug:
        rows = rows.filter(slot__kind=FeaturedSlot.CATEGORY_TOP, category__slug=category_slug)
    else:
        rows = rows.filter(slot__kind=FeaturedSlot.HOME)
    rows = list(rows)
    flags = _flags(b.promotion.listing.business_owner_id for b in rows)
    out = []
    for b in rows:
        listing = b.promotion.listing
        if blockers(listing, flags):
            continue
        photo = listing.main_photo.url if listing.main_photo else ""
        if request is not None and photo:
            photo = request.build_absolute_uri(photo)
        out.append({
            "id": listing.pk, "name": listing.name, "main_photo": photo, "price_amount": listing.price_amount, "price_unit": listing.price_unit,
            "category": listing.category.slug, "business": listing.business_owner.display_name,
            "verified": listing.business_owner.kyc_status == listing.business_owner.VERIFIED,
        })
    return out
