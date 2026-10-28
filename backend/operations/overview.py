"""The Operations overview (canvas screen 01): six counts, the team's scouts,
what waits for the caller, and open issues on the team's businesses.

Nothing is typed in. The scouts and their numbers come from
`operations.scoreboard`; targets and actuals from `targets.services`;
approvals from `approvals.services`; the health mix from `portfolio.health`;
issues from `fraud`. The live feed is the activity log, read by the page.

Issues are open fraud cases plus, for a caller who holds service_issues.view,
the Support issues list (contact messages, disputes, owner chats) and the open
delivery disputes; without that permission those two are None, not 0."""
from django.db.models import Q
from django.utils import timezone

from accounts.models import BusinessOwner, Role
from accounts.permissions import sees_every_team
from approvals import services as approval_services
from fraud.models import FraudFlag
from fraud.views import visible_flags
from portfolio import health, leaderboard
from portfolio.views import portfolio_queryset
from reports import services as report_services
from . import service_issues as service
from targets import services as target_services
from targets.models import REGISTRATIONS

from .scoreboard import scouts_in_scope, scouts_scoreboard

PERIODS = ("today", "week", "month")
WAITING_SHOWN = 3
ISSUES_SHOWN = 5


def _bounds(period, today):
    if period == "today":
        return today, today, today
    low, high = report_services.period_bounds("week" if period == "week" else "month", today)
    return low, high, min(high, today)


def _registrations(scouts, period, today):
    """Done and target for the period, over the scouts who work today or in it.
    The target is the sum of the plans that exist; None when nobody has one."""
    low, high, upto = _bounds(period, today)
    done = target = 0
    planned = 0
    for scout in scouts:
        done += target_services.actual(scout, REGISTRATIONS, low, upto)
        calendar = target_services.Calendar(scout, low, high)
        if calendar.has_plan(REGISTRATIONS):
            planned += 1
            target += calendar.total(REGISTRATIONS, low, high)
    return {"done": done, "target": target if planned else None, "planned": planned}


def _waiting(user):
    rows = approval_services.waiting_for(user).select_related("maker", "decided_by").order_by("created_at", "id")
    total = rows.count()
    items = []
    for approval in rows[:WAITING_SHOWN]:
        move = approval_services.next_move(approval)
        items.append({
            "id": approval.pk, "title": approval.title, "kind": approval.kind, "target_label": approval.target_label,
            "maker": approval.maker.full_name, "created_at": approval.created_at, "due_at": approval.due_at,
            "next_move": {"label": move["label"], "at": move["at"]} if move else None,
        })
    return total, items


def _flag_place(flag):
    if flag.business_owner_id:
        return flag.business_owner.display_name
    return flag.staff_subject.full_name if flag.staff_subject_id else "—"


def _issues(user, scouts):
    """Open fraud cases on the team's businesses (or about the team's scouts)."""
    ids = [s.pk for s in scouts]
    team = Q(business_owner__account_manager_id__in=ids) | Q(staff_subject_id__in=ids)
    if sees_every_team(user):
        team = Q()
    flags = visible_flags(user).filter(status=FraudFlag.OPEN).filter(team).order_by("created_at", "id")
    now = timezone.now()
    rows = []
    for flag in flags[:ISSUES_SHOWN]:
        manager = flag.business_owner.account_manager if flag.business_owner_id else None
        rows.append({
            "id": flag.pk, "type": "fraud", "kind_label": flag.get_kind_display(), "business": _flag_place(flag),
            "business_id": flag.business_owner_id, "what": flag.title,
            "account_manager": manager.full_name if manager else (flag.staff_subject.full_name if flag.staff_subject_id else None),
            "opened_at": flag.created_at, "open_seconds": int((now - flag.created_at).total_seconds()),
        })
    return flags.count(), rows


def overview(user, period="today", *, today=None, now=None):
    period = period if period in PERIODS else "today"
    now = now or timezone.now()
    today = today or timezone.localdate()
    board = scouts_scoreboard(user, "team", today=today, now=now)
    rows = board["scouts"]
    scouts = list(scouts_in_scope(user, "team"))
    low, _, upto = _bounds(period, today)

    registrations = _registrations(scouts, period, today)
    activations = sum(1 for days in leaderboard.activation_days(scouts).values() for d in days if low <= d <= upto)
    registered = BusinessOwner.objects.filter(registered_by__in=scouts, created_at__date__gte=low, created_at__date__lte=upto).count()

    waiting_total, waiting = _waiting(user)
    oldest = waiting[0] if waiting else None

    working = [r for r in rows if r["state"] == target_services.WORKING]
    checked_in = [r for r in working if r["check_in"]]
    on_leave = [r["name"] for r in rows if r["state"] == target_services.ON_LEAVE]

    mix = {"at_risk": 0, "needs_attention": 0, "healthy": 0, "new": 0}
    for row in health.rate_all(portfolio_queryset(user, "team"), now):
        mix[row.rating] += 1
    fraud_total, issues = _issues(user, scouts)
    support = delivery = None
    issue_total = fraud_total
    if "service_issues.view" in user.effective_permission_codenames():
        service_rows = service.service_issues(user, status="open", now=now)
        support = len(service_rows)
        delivery = service.deliveries_open_count()
        # The delivery figure is every business's open disputes (screen 17), some
        # of which are already in the support count, so it is not added to the total.
        issue_total = fraud_total + support
        issues = sorted(issues + service_rows, key=lambda row: row["opened_at"])[:ISSUES_SHOWN]

    return {
        "period": period, "today": today, "now": now, "scout_count": len(scouts),
        "kpis": {
            "registrations": registrations,
            "activations": {"count": activations, "registered": registered},
            "approvals": {
                "waiting": waiting_total,
                "oldest": {"title": oldest["title"], "target_label": oldest["target_label"], "created_at": oldest["created_at"]} if oldest else None,
            },
            "checked_in": {
                "count": len(checked_in), "working": len(working), "on_leave": on_leave,
                "flagged": board["totals"]["visits_flagged"],
            },
            "at_risk": {"count": mix["at_risk"], "needs_attention": mix["needs_attention"]},
            "issues": {"total": issue_total, "fraud": fraud_total, "support": support, "delivery": delivery},
        },
        "scouts": rows,
        "totals": board["totals"],
        "month_label": board["month_label"],
        "waiting": waiting,
        "issues": issues,
        "issue_total": issue_total,
    }

