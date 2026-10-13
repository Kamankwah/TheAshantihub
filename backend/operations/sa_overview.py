"""The Super Admin command center (canvas screen 01).

Nothing is typed in. Decisions waiting come from `approvals.services`; each
team's line comes from the Operations scoreboard, the service-issues counts and
the approvals engine; "online" is a live `StaffSession`; the platform strip
reads settings and pings only what the app can really check. What has no
source (SMS, push, service time limits, payouts) is reported as such, never as
zero. The live feed is the activity log, read by the page."""
from django.conf import settings
from django.db import connection
from django.utils import timezone

from accounts import sessions
from accounts.models import Role, StaffSession, StaffUser
from activity.models import ChainCheck
from approvals import services as approval_services
from approvals.models import ApprovalRequest
from approvals.registry import get_kind
from core.views import _redis_state
from fraud.models import FraudFlag
from fraud.views import visible_flags
from portfolio import health
from portfolio.views import portfolio_queryset
from reports.models import StaffReport

from . import service_issues
from .scoreboard import scouts_scoreboard

WAITING_SHOWN = 5
# Teams in the order the canvas draws them, each with the menu item that steps into it.
TEAMS = [
    (Role.OPERATIONS, "Operations & scouts", "step-in-operations"),
    (Role.SUPPORT, "Support", "step-in-support"),
    (Role.DELIVERY_MANAGER, "Delivery & dispatch", "step-in-delivery"),
    (Role.MARKETING, "Marketing", "step-in-marketing"),
    (Role.ACCOUNTANT, "Accounting", "step-in-accounting"),
]


def _waiting(user):
    rows = approval_services.waiting_for(user).select_related("maker__role").order_by("-escalation_level", "due_at", "id")
    items = []
    for approval in rows[:WAITING_SHOWN]:
        kind = get_kind(approval.kind)
        items.append({
            "id": approval.pk, "title": approval.title, "kind": approval.kind,
            "kind_label": kind.label if kind else approval.kind, "target_label": approval.target_label,
            "maker": approval.maker.full_name, "maker_role": approval.maker.role.name,
            "amount": approval.amount, "requires_sudo": bool(kind and kind.requires_sudo),
            "created_at": approval.created_at, "due_at": approval.due_at, "escalation_level": approval.escalation_level,
        })
    return rows.count(), items


def _online_by_role(now):
    """Staff with a live session, per role (a person counts once)."""
    live = sessions.live(StaffSession.objects.filter(staff__is_active=True), now)
    online = {}
    for role, staff_id in live.values_list("staff__role__name", "staff_id").distinct():
        online.setdefault(role, set()).add(staff_id)
    return {role: len(ids) for role, ids in online.items()}


def _teams(user, now, today):
    online = _online_by_role(now)
    staff = {}
    for role in StaffUser.objects.filter(is_active=True, invite_token__isnull=True).values_list("role__name", flat=True):
        staff[role] = staff.get(role, 0) + 1
    waiting = {}
    for role in ApprovalRequest.objects.filter(status=ApprovalRequest.PENDING).values_list("maker__role__name", flat=True):
        waiting[role] = waiting.get(role, 0) + 1
    rows = []
    for role, label, step_in in TEAMS:
        work, flag = [], None
        if role == Role.OPERATIONS:
            board = scouts_scoreboard(user, "all", today=today, now=now)
            scouts = board["scouts"]
            working = [s for s in scouts if s["state"] == "working"]
            work.append(f"{sum(1 for s in working if s['check_in'])} of {len(working)} scouts checked in")
            registrations = board["totals"]["registrations"]
            work.append(
                f"{registrations['done']} of {registrations['target']} registrations today" if registrations["target"]
                else f"{registrations['done']} registrations today"
            )
            if board["totals"]["visits_flagged"]:
                flag = f"{board['totals']['visits_flagged']} visit(s) outside the radius"
        elif role == Role.SUPPORT:
            work.append(f"{service_issues.open_issue_count(user)} open service issues")
        elif role == Role.DELIVERY_MANAGER:
            work.append(f"{service_issues.deliveries_open_count()} open delivery disputes")
        if waiting.get(role):
            work.append(f"{waiting[role]} request(s) waiting on someone")
        rows.append({
            "role": role, "label": label, "step_in": step_in, "staff": staff.get(role, 0),
            "online": online.get(role, 0), "work": work, "flag": flag,
        })
    return rows


def _check(key, name, state, detail):
    return {"key": key, "name": name, "state": state, "detail": detail}


def platform_status():
    """Only what the app can measure or read from its own settings. "configured"
    means the setting is present, not that the provider was reached."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        database = _check("database", "Database", "ok", "Answering")
    except Exception:
        database = _check("database", "Database", "down", "Not answering")
    redis = _redis_state()
    live = {
        "ok": _check("live", "Live updates", "ok", "Redis answering"),
        "down": _check("live", "Live updates", "down", "Redis not answering; pages refresh on a timer"),
        "not_configured": _check("live", "Live updates", "not_connected", "Single-process mode (no Redis)"),
    }[redis]
    chain = ChainCheck.objects.first()
    if chain is None:
        audit = _check("audit", "Audit log chain", "not_tracked", "No nightly check has run yet")
    else:
        audit = _check(
            "audit", "Audit log chain", "ok" if chain.ok else "down",
            f"{'Intact' if chain.ok else 'BROKEN'} at the last check, {timezone.localtime(chain.checked_at):%d %b %H:%M}",
        )
    return [
        database, live, audit,
        _check("email", "Email", "configured" if settings.EMAIL_HOST else "not_connected",
               "Mail server set" if settings.EMAIL_HOST else "No mail server set"),
        _check("payments", "Payments", "simulated" if settings.PAYMENTS_PROVIDER == "simulated" else "configured",
               "Simulated until Hubtel is connected" if settings.PAYMENTS_PROVIDER == "simulated" else "Hubtel keys set"),
        _check("errors", "Error alerts", "configured" if settings.SENTRY_DSN else "not_connected",
               "Sentry set" if settings.SENTRY_DSN else "Sentry not set"),
        _check("sms", "SMS", "not_connected", "Not connected"),
    ]


def overview(user, *, now=None, today=None):
    now = now or timezone.now()
    today = today or timezone.localdate()
    waiting_total, waiting = _waiting(user)
    pending = ApprovalRequest.objects.filter(status=ApprovalRequest.PENDING)
    live = sessions.live(StaffSession.objects.filter(staff__is_active=True), now)
    mix = {"at_risk": 0, "needs_attention": 0}
    for row in health.rate_all(portfolio_queryset(user, "all"), now):
        if row.rating in mix:
            mix[row.rating] += 1
    reports = StaffReport.objects.filter(staff__is_active=True, period=StaffReport.DAY, period_start=today)
    return {
        "now": now,
        "kpis": {
            "decisions": {
                "waiting": waiting_total, "escalated": approval_services.waiting_for(user).filter(escalation_level__gt=0).count(),
                "open_everywhere": pending.count(),
            },
            "staff_online": {
                "online": live.values("staff_id").distinct().count(),
                "active": StaffUser.objects.filter(is_active=True, invite_token__isnull=True).count(),
            },
            "fraud_open": visible_flags(user).filter(status=FraudFlag.OPEN).count(),
            "reports_today": {
                "submitted": reports.filter(status__in=[StaffReport.SUBMITTED, StaffReport.ACKNOWLEDGED]).count(),
            },
            "at_risk": {"count": mix["at_risk"], "needs_attention": mix["needs_attention"]},
            "service_issues": service_issues.open_issue_count(user),
        },
        "waiting": waiting,
        "teams": _teams(user, now, today),
        "platform": platform_status(),
        # What the canvas draws but nothing records yet; the page lists these as "Not tracked yet".
        "not_tracked": ["Service time limits missed", "Payouts waiting", "SMS balance"],
    }
