"""The areas a scout works in, shared by /api/auth/me/ and the leaderboard."""
from collections import Counter

from accounts.models import BusinessOwner

AREA_COUNT = 2


def scout_areas(scouts):
    """{scout pk: the zones holding most of their businesses (at most two, most first)}.
    A rejected business counts for nothing. A scout with fewer than two such
    zones is topped up with the zones they were invited to work (StaffUser.areas),
    so a new scout shows where they start before they have any business."""
    zones = {s.pk: Counter() for s in scouts}
    rows = (
        BusinessOwner.objects.filter(account_manager__in=scouts, profile__zone__isnull=False)
        .exclude(kyc_status=BusinessOwner.REJECTED)
        .values_list("account_manager_id", "profile__zone__name")
    )
    for scout_id, zone in rows:
        zones[scout_id][zone] += 1
    result = {pk: [name for name, _ in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:AREA_COUNT]] for pk, c in zones.items()}
    if any(len(names) < AREA_COUNT for names in result.values()):
        declared = declared_areas([pk for pk, names in result.items() if len(names) < AREA_COUNT])
        for pk, names in result.items():
            names.extend(n for n in declared.get(pk, []) if n not in names)
            del names[AREA_COUNT:]
    return result


def declared_areas(scout_ids):
    """{scout pk: the zone names set at invite time (StaffUser.areas), alphabetical}."""
    from accounts.models import StaffUser

    rows = StaffUser.areas.through.objects.filter(staffuser_id__in=list(scout_ids)).values_list("staffuser_id", "zone__name")
    out = {}
    for pk, name in sorted(rows, key=lambda r: r[1]):
        out.setdefault(pk, []).append(name)
    return out
