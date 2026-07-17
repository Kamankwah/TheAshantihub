from datetime import timedelta

from .models import Booking


def units_booked_on(listing, night, exclude_id=None):
    """How many units of `listing` are held by active bookings covering the
    given `night` (a date). A booking covers a night when check_in <= night <
    check_out (half-open range).
    """
    qs = Booking.objects.filter(
        listing=listing,
        status__in=Booking.ACTIVE_STATUSES,
        check_in__lte=night,
        check_out__gt=night,
    )
    if exclude_id is not None:
        qs = qs.exclude(id=exclude_id)
    return sum(b.units for b in qs)


def is_available(listing, check_in, check_out, units, exclude_id=None):
    """True if `units` more units can be booked for every night in
    [check_in, check_out) without exceeding listing.units_total. Iterates per
    night — bookings span days/weeks, so this is cheap and exact (no off-by-one
    risk from range-overlap arithmetic).
    """
    night = check_in
    while night < check_out:
        if units_booked_on(listing, night, exclude_id) + units > listing.units_total:
            return False
        night += timedelta(days=1)
    return True


def min_units_free(listing, check_in, check_out):
    """The smallest number of free units across the requested nights — what the
    date-picker shows as "N left". 0 means the range is full.
    """
    free = listing.units_total
    night = check_in
    while night < check_out:
        free = min(free, listing.units_total - units_booked_on(listing, night))
        night += timedelta(days=1)
    return max(0, free)
