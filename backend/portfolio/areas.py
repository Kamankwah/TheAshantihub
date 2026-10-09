"""The areas a scout works in, shared by /api/auth/me/ and the leaderboard."""
from collections import Counter

from accounts.models import BusinessOwner

AREA_COUNT = 2


def scout_areas(scouts):
    """{scout pk: the zones holding most of their businesses (at most two, most first)}.
    A rejected business counts for nothing."""
    zones = {s.pk: Counter() for s in scouts}
    rows = (
        BusinessOwner.objects.filter(account_manager__in=scouts, profile__zone__isnull=False)
        .exclude(kyc_status=BusinessOwner.REJECTED)
        .values_list("account_manager_id", "profile__zone__name")
    )
    for scout_id, zone in rows:
        zones[scout_id][zone] += 1
    return {pk: [name for name, _ in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:AREA_COUNT]] for pk, c in zones.items()}
