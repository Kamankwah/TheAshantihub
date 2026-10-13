"""Growth funnel: every place a scout first visited in a window, followed
through registration, KYC, first live listing, first paid sale and three paid
months. A "visit" is only a done GPS check-in a scout logged; a place is a
registered business or, before registration, a prospect. Every count comes
from those records."""
from collections import defaultdict
from datetime import timedelta
from statistics import median

from django.db.models import Min
from django.utils import timezone

from accounts.models import BusinessOwner, Role, StaffUser
from bookings.models import Booking
from commission.services import PAID_MONTHS_FOR_BONUS, paid_months_by_owner
from field.models import VisitCheckIn
from listings.models import Listing, Zone
from orders.models import OrderItem
from services.models import ServiceRequest

from . import sales

STAGES = [
    ("visited", "Scout visited", "Places with a done GPS check-in"),
    ("registered", "Registered", "Became a business account"),
    ("kyc", "KYC approved", "Identity check passed"),
    ("listing", "First listing live", "A published listing"),
    ("order", "First paid sale", "A paid order, booking or service"),
    ("paid3", "3 months paid", "Three paid subscription months, trial excluded"),
]


def team_options():
    """Leads who have scouts reporting to them, for the Team picker."""
    leads = StaffUser.objects.filter(direct_reports__role__name=Role.SCOUT, direct_reports__is_active=True).distinct().order_by("full_name")
    return [{"id": lead.pk, "name": f"{lead.full_name}'s scouts"} for lead in leads]


def _units(start, end, scout_ids):
    """{unit key: {"scout", "first", "owner", "zone"}} for places first visited in start..end."""
    low, _ = sales.window(start, end)
    _, high = sales.window(start, end)
    visits = (
        VisitCheckIn.objects.filter(status=VisitCheckIn.DONE, scout_id__in=scout_ids)
        .select_related("prospect", "business_owner__profile")
        .order_by("checked_in_at", "id")
    )
    first = {}
    for v in visits:
        owner_id = v.business_owner_id or (v.prospect.registered_business_id if v.prospect_id else None)
        key = ("b", owner_id) if owner_id else ("p", v.prospect_id) if v.prospect_id else None
        if key is None or key in first:
            continue
        zone = None
        if v.business_owner_id and getattr(v.business_owner, "profile", None):
            zone = v.business_owner.profile.zone_id
        elif v.prospect_id:
            zone = v.prospect.zone_id
        first[key] = {"scout": v.scout_id, "first": v.checked_in_at, "owner": owner_id, "zone": zone}
    return {k: u for k, u in first.items() if low <= u["first"] < high}


def _median_days(values):
    values = [v for v in values if v is not None and v >= 0]
    return int(round(median(values))) if values else None


def funnel_report(*, team=None, start, end):
    scouts = StaffUser.objects.filter(role__name=Role.SCOUT, is_active=True)
    if team is not None:
        scouts = scouts.filter(manager_id=team)
    scout_map = {s.pk: s for s in scouts.select_related("role")}
    units = _units(start, end, list(scout_map))
    owner_ids = {u["owner"] for u in units.values() if u["owner"]}
    owners = {o.pk: o for o in BusinessOwner.objects.filter(pk__in=owner_ids).select_related("profile")}
    kyc = {pk for pk, o in owners.items() if o.kyc_status == BusinessOwner.VERIFIED}
    listed = defaultdict(lambda: None)
    for row in Listing.objects.filter(business_owner_id__in=kyc, status=Listing.PUBLISHED).values("business_owner").annotate(first=Min("reviewed_at")):
        listed[row["business_owner"]] = row["first"] or True
    sold = {}
    for row in OrderItem.objects.filter(listing__business_owner_id__in=kyc, order__status="paid").values("listing__business_owner").annotate(first=Min("order__placed_at")):
        sold[row["listing__business_owner"]] = row["first"]
    for row in Booking.objects.filter(business_owner_id__in=kyc, paid_at__isnull=False).values("business_owner").annotate(first=Min("paid_at")):
        sold[row["business_owner"]] = min(filter(None, [sold.get(row["business_owner"]), row["first"]]))
    for row in ServiceRequest.objects.filter(business_owner_id__in=kyc, paid_at__isnull=False).values("business_owner").annotate(first=Min("paid_at")):
        sold[row["business_owner"]] = min(filter(None, [sold.get(row["business_owner"]), row["first"]]))
    months = paid_months_by_owner(list(owner_ids))

    def stages_of(unit):
        owner = owners.get(unit["owner"])
        reached = {"visited": True, "registered": owner is not None}
        reached["kyc"] = reached["registered"] and owner.pk in kyc
        reached["listing"] = reached["kyc"] and listed.get(owner.pk) is not None
        reached["order"] = reached["listing"] and owner.pk in sold
        reached["paid3"] = reached["order"] and months.get(owner.pk, 0) >= PAID_MONTHS_FOR_BONUS
        return reached

    def tally(rows):
        counts = {key: 0 for key, *_ in STAGES}
        for unit in rows:
            for key, ok in stages_of(unit).items():
                counts[key] += 1 if ok else 0
        return counts

    everyone = list(units.values())
    team_counts = tally(everyone)
    gaps = defaultdict(list)
    for unit in everyone:
        owner = owners.get(unit["owner"])
        if owner is None:
            continue
        gaps["registered"].append((owner.created_at - unit["first"]).days)
        if owner.pk in kyc and owner.reviewed_at:
            gaps["kyc"].append((owner.reviewed_at - owner.created_at).days)
            first_listing = listed.get(owner.pk)
            if first_listing not in (None, True):
                gaps["listing"].append((first_listing - owner.reviewed_at).days)
                if sold.get(owner.pk):
                    gaps["order"].append((sold[owner.pk] - first_listing).days)
    stages = []
    previous = None
    for key, label, note in STAGES:
        n = team_counts[key]
        stages.append({
            "key": key, "label": label, "note": note, "count": n,
            "share_of_visited": round(n / team_counts["visited"] * 100, 1) if team_counts["visited"] else None,
            "share_of_previous": round(n / previous * 100, 1) if previous else None,
            "median_days": _median_days(gaps.get(key, [])) if key in ("registered", "kyc", "listing", "order") else None,
        })
        previous = n
    zones = {z.pk: z.name for z in Zone.objects.all()}
    by_scout = []
    for pk, scout in scout_map.items():
        mine = [u for u in everyone if u["scout"] == pk]
        if not mine:
            continue
        c = tally(mine)
        by_scout.append({
            "staff_id": pk, "name": scout.full_name, "counts": c,
            "kyc_share": round(c["kyc"] / c["registered"] * 100, 1) if c["registered"] else None,
            "overall": round(c["paid3"] / c["visited"] * 100, 1) if c["visited"] else None,
        })
    by_scout.sort(key=lambda r: -r["counts"]["visited"])
    team_kyc = round(team_counts["kyc"] / team_counts["registered"] * 100, 1) if team_counts["registered"] else None
    for row in by_scout:
        row["below_team"] = bool(row["kyc_share"] is not None and team_kyc is not None and row["counts"]["registered"] >= 5 and row["kyc_share"] < team_kyc - 10)
    by_zone = []
    zone_units = defaultdict(list)
    for u in everyone:
        zone_units[u["zone"]].append(u)
    for z, rows in zone_units.items():
        by_zone.append({"zone_id": z, "zone": zones.get(z, "No zone recorded"), "counts": tally(rows)})
    by_zone.sort(key=lambda r: -r["counts"]["visited"])
    return {
        "from": start, "to": end, "team": team, "scouts": len(scout_map),
        "stages": stages, "overall": stages[-1]["share_of_visited"], "by_scout": by_scout, "by_zone": by_zone,
        "team_options": team_options(), "notes": _notes(stages, by_scout, team_kyc, end),
    }


def _notes(stages, by_scout, team_kyc, end):
    """Drop-off sentences built from the counts only."""
    notes = []
    drops = [(stages[i - 1]["count"] - stages[i]["count"], stages[i - 1], stages[i]) for i in range(1, len(stages))]
    if drops and stages[0]["count"]:
        lost, a, b = max(drops, key=lambda d: d[0])
        if lost > 0:
            notes.append({"title": f"{a['label']} to {b['label']}: {lost} didn't continue", "body": "The largest drop by count."})
    last = stages[-1]
    prior = stages[-2]
    if prior["count"] > last["count"]:
        notes.append({
            "title": f"{prior['label']} to {last['label']}: {prior['count'] - last['count']} not there yet",
            "body": "Some may still have time to reach three paid months; the rest paid less or have not paid.",
        })
    for row in by_scout:
        if row["below_team"]:
            notes.append({
                "title": f"{row['name']}: {row['kyc_share']:.0f}% of registrations approved",
                "body": f"Against {team_kyc:.0f}% for the whole group.",
            })
    if (timezone.localdate() - end).days < 92:
        notes.append({"title": "The last stage is still filling", "body": "Businesses first visited less than three months ago cannot have three paid months unless they paid ahead."})
    return notes[:5]


def funnel_document(report):
    cols = ["Scout"] + [s["label"] for s in report["stages"]] + ["Visit to 3 months paid"]
    rows = [
        [r["name"], *[r["counts"][k] for k, *_ in STAGES], "" if r["overall"] is None else f"{r['overall']}%"]
        for r in report["by_scout"]
    ]
    rows.append(["Group total", *[s["count"] for s in report["stages"]], "" if report["overall"] is None else f"{report['overall']}%"])
    zone_rows = [[r["zone"], *[r["counts"][k] for k, *_ in STAGES]] for r in report["by_zone"]]
    return [
        ("By scout", cols, rows),
        ("By zone", ["Zone"] + [s["label"] for s in report["stages"]], zone_rows),
    ]
