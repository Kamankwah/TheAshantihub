"""The team leaderboard (spec S11). Ranks come only from real counts: an
activation is a business the scout registered, KYC-verified, whose first
listing is published; it counts on the later of those two review dates. Leave
days and holidays never count against anyone — they are shown, not subtracted.
No money, and nothing about another team, is ever returned."""
import calendar
from datetime import date, timedelta

from django.db.models import Count, Min, Q
from django.utils import timezone

from accounts.models import BusinessOwner, Role, StaffUser
from listings.models import Listing
from portfolio.areas import scout_areas
from targets.services import ON_LEAVE, Calendar


class LeaderboardError(Exception):
    pass


def parse_month(value, today):
    if not value:
        return today.replace(day=1)
    try:
        year, month = str(value).split("-")
        first = date(int(year), int(month), 1)
    except ValueError:
        raise LeaderboardError("Use YYYY-MM for the month.") from None
    if not 2020 <= first.year <= 2100:
        raise LeaderboardError("Pick a month between 2020 and 2100.")
    if first > today.replace(day=1):
        raise LeaderboardError("That month hasn't started yet.")
    return first


def _previous(first):
    return (first.replace(day=1) - timedelta(days=1)).replace(day=1)


def team_of(user):
    """The scouts who share the caller's manager (and the caller)."""
    if user.manager_id is None:
        return [user]
    members = StaffUser.objects.filter(is_active=True, role__name=Role.SCOUT, manager_id=user.manager_id)
    return sorted({*members, user}, key=lambda s: s.full_name)


def activation_days(scouts):
    """{scout id: [local date of each activation]}."""
    owners = (
        BusinessOwner.objects.filter(registered_by__in=scouts, kyc_status=BusinessOwner.VERIFIED, reviewed_at__isnull=False)
        .annotate(first_live=Min("listings__reviewed_at", filter=Q(listings__status=Listing.PUBLISHED)))
        .filter(first_live__isnull=False)
        .values_list("registered_by_id", "reviewed_at", "first_live")
    )
    days = {s.pk: [] for s in scouts}
    for scout_id, kyc_at, live_at in owners:
        days[scout_id].append(timezone.localtime(max(kyc_at, live_at)).date())
    return days


def _ranks(counts):
    """Competition ranking: equal counts share a rank (1, 2, 2, 4)."""
    ordered = sorted(counts.values(), reverse=True)
    return {pk: ordered.index(n) + 1 for pk, n in counts.items()}


def build(user, month_value=None, *, today=None):
    today = today or timezone.localdate()
    first = parse_month(month_value, today)
    last_day = calendar.monthrange(first.year, first.month)[1]
    upto = min(today, first.replace(day=last_day))
    before_first = _previous(first)
    before_upto = before_first.replace(day=min(upto.day, calendar.monthrange(before_first.year, before_first.month)[1]))

    scouts = team_of(user)
    days = activation_days(scouts)
    areas = scout_areas(scouts)
    now_counts = {s.pk: sum(1 for d in days[s.pk] if first <= d <= upto) for s in scouts}
    then_counts = {s.pk: sum(1 for d in days[s.pk] if before_first <= d <= before_upto) for s in scouts}
    ranks = _ranks(now_counts)

    improved = [(now_counts[s.pk] - then_counts[s.pk], now_counts[s.pk], s.full_name, s) for s in scouts if now_counts[s.pk] > then_counts[s.pk]]
    best = min(improved, key=lambda t: (-t[0], -t[1], t[2]))[3] if improved else None

    rows = []
    for s in sorted(scouts, key=lambda s: (-now_counts[s.pk], s.full_name)):
        leave = Calendar(s, first, upto)
        rows.append({
            "id": s.pk,
            "name": s.full_name,
            "areas": areas[s.pk],
            "activations": now_counts[s.pk],
            "leave_days": sum(1 for day in leave.days() if leave.state(day) == ON_LEAVE),
            "rank": ranks[s.pk],
            "is_me": s.pk == user.pk,
            "most_improved": best is not None and s.pk == best.pk,
        })

    mine = now_counts[user.pk]
    above = sorted((n, s.full_name) for s in scouts if (n := now_counts[s.pk]) > mine)
    gap = {"name": above[0][1], "count": above[0][0] - mine} if above else None
    return {
        "month": first.strftime("%Y-%m"),
        "as_of": upto,
        "lead": {"id": user.manager_id, "name": user.manager.full_name} if user.manager_id else None,
        "rows": rows,
        "team_total": sum(now_counts.values()),
        "my_rank": ranks[user.pk],
        "my_count": mine,
        "gap": gap,
        "most_improved": (
            {"name": best.full_name, "now": now_counts[best.pk], "then": then_counts[best.pk], "as_of": upto,
             "then_month": before_first.strftime("%Y-%m")}
            if best is not None else None
        ),
    }
