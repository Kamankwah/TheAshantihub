"""Live updates (staff foundations F2). Every ActivityEvent is published on
commit (activity.services.on_recorded). Two kinds of message travel:

* a feed event {type: "activity", verb, target, actor, at, invalidate} — only
  to staff who could read that event through GET /api/activity/;
* an invalidation {type: "invalidate", invalidate, at} — to permission and
  person groups whose lists changed. It names React Query keys only; the
  client refetches through the normal permission-checked REST endpoints.
"""
import asyncio
import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

logger = logging.getLogger(__name__)

# A hung Redis must not stall a staff write by more than about this long.
SEND_TIMEOUT = 2

STAFF_MANAGEMENT_VERBS = (
    "staff-invite", "staff-resend-invite", "staff-suspend", "staff-unsuspend",
    "staff-deactivate", "staff-reactivate", "staff-permissions", "staff-manager",
)
# (verb prefixes, permissions whose holders' queues changed, query keys)
QUEUE_INVALIDATIONS = [
    (("kyc-",), ("kyc.approve",), ("kyc-queue", "kyc-detail", "staff-badges")),
    # A KYC decision in the queue settles the maker's business.kyc request
    # without an approval.* event (accounts/kyc.py), so scouts' approvals
    # lists refresh from the decision itself.
    (("kyc-approve", "kyc-reject"), ("businesses.manage_portfolio",), ("approvals", "approval", "approval-counts")),
    (("moderation-",), ("listings.moderate",), ("moderation-queue", "staff-badges")),
    (("hero-moderation-",), ("hero_media.approve",), ("hero-moderation-queue", "staff-badges")),
    (("event-moderation-",), ("event.approve",), ("event-moderation-queue", "event-moderation-detail", "staff-badges")),
    (("review-approve", "review-hide"), ("reviews.moderate",), ("reviews-moderation-queue", "staff-badges")),
    (("contact-message",), ("contact_messages.manage",), ("contact-messages-queue", "staff-badges")),
    (("staff-conversation-",), ("messaging.manage",), ("staff-messaging-queue",)),
    (STAFF_MANAGEMENT_VERBS, ("staff.manage", "staff.invite_team"), ("staff-roster", "my-team")),
    (("promotion-",), ("promotions.manage",), ("promotions-queue",)),
    (("subscription-plan-",), ("subscription_plans.approve",), ("subscription-plan-pending-queue", "staff-badges")),
    (("escrow-",), ("escrow.view",), ("escrow-ledger", "staff-badges")),
    (("dispute-",), ("disputes.flag", "disputes.resolve_financial"), ("disputes-queue",)),
    (
        ("order-delivery-status-update", "order-assign-dispatch", "delivery-pickup", "delivery-deliver"),
        ("orders.manage_delivery",),
        ("delivery-queue",),
    ),
    (
        ("kyc-", "business.", "portfolio.", "subscription."),
        ("portfolio.manage", "businesses.manage_portfolio"),
        ("portfolio", "portfolio-business", "subscriptions-due"),
    ),
    # The subscription clock gives the account manager a task (billing.clock).
    (("subscription.",), ("businesses.manage_portfolio",), ("my-tasks", "staff-badges")),
    # A visit changes a business's "last contact" and its recent visits.
    (("visit.",), ("portfolio.manage", "businesses.manage_portfolio"), ("portfolio", "portfolio-business")),
    # The prospect list (and the people a call can be logged about) follow
    # prospect edits, visits (last visit) and a registration that links one.
    (("prospect.", "visit.", "business.registered"), ("businesses.register",), ("prospects", "call-counterparts", "my-tasks")),
    # A scout's delivery flag gives every Delivery Manager a task (portfolio/delivery.py).
    (("delivery.problem_flagged",), ("delivery.manage",), ("my-tasks", "staff-badges")),
    (("fraud.",), ("fraud.manage", "fraud.flag"), ("fraud-flags", "fraud-flag-counts", "kyc-queue", "portfolio-business", "staff-badges")),
]
# (verb prefixes, extra keys for everyone who receives the feed event)
FEED_KEYS = [
    (("task-",), ("my-tasks", "staff-badges")),
    (("call-",), ("call-logs",)),
    (("visit.",), ("visits", "visit-open")),
    # A returned request gives its maker a follow-up task (portfolio/approval_kinds.py).
    (("approval.",), ("approvals", "approval", "approval-counts", "staff-badges", "my-tasks")),
    (("report.",), ("my-reports", "report", "team-reports")),
]
APPROVAL_KEYS = ["approvals", "approval", "approval-counts", "staff-badges"]
REPORT_KEYS = ["my-reports", "report", "team-reports"]


def _group_send(group, message):
    """The ONE place anything is sent to the channel layer: bounded by
    SEND_TIMEOUT, never raises. True if the message was handed over."""
    layer = get_channel_layer()

    async def send():
        await asyncio.wait_for(layer.group_send(group, message), timeout=SEND_TIMEOUT)

    try:
        async_to_sync(send)()
    except Exception:  # Redis down or hung: live updates are best-effort
        logger.warning("Could not send to %s", group, exc_info=True)
        return False
    return True


def _send(group, payload):
    return _group_send(group, {"type": "staff.event", "payload": payload})


def feed_recipients(event):
    """Staff ids who may read `event` through GET /api/activity/ — the rules
    of activity.views.visible_events, evaluated for one event."""
    from accounts.models import StaffUser
    from accounts.permissions import staff_holding
    from activity.models import ActivityEvent
    from activity.views import ROLE_ACTIVITY_VISIBILITY

    ids = set(staff_holding("activity.view_all").values_list("pk", flat=True))
    if event.actor_type != ActivityEvent.STAFF or event.actor_id is None:
        return ids
    ids.add(event.actor_id)
    manager_id = StaffUser.objects.filter(pk=event.actor_id).values_list("manager_id", flat=True).first()
    if manager_id and staff_holding("activity.view_team").filter(pk=manager_id).exists():
        ids.add(manager_id)
    overseers = [
        role for role, rule in ROLE_ACTIVITY_VISIBILITY.items()
        if event.actor_role in rule.get("roles", [])
        or event.verb.startswith(tuple(rule.get("partial", {}).get(event.actor_role, [])))
    ]
    if overseers:
        ids.update(
            staff_holding("activity.view_domains").filter(role__name__in=overseers).values_list("pk", flat=True)
        )
    return ids


def _approval_groups(event):
    from approvals.models import ApprovalRequest

    if event.target_type != "approvals.approvalrequest" or not event.target_id.isdigit():
        return []
    approval = ApprovalRequest.objects.select_related("maker").filter(pk=event.target_id).first()
    if approval is None:
        return []
    groups = {f"staff.{approval.maker_id}", "perm.approvals.view_all"}
    if approval.maker.manager_id:
        groups.add(f"staff.{approval.maker.manager_id}")
    if approval.assigned_to_id:
        groups.add(f"staff.{approval.assigned_to_id}")
    if approval.stage == ApprovalRequest.POOL and approval.pool_permission:
        groups.add(f"perm.{approval.pool_permission}")
    return sorted(groups)


def _report_groups(event):
    from reports.models import StaffReport

    if event.target_type != "reports.staffreport" or not event.target_id.isdigit():
        return []
    report = StaffReport.objects.select_related("staff").filter(pk=event.target_id).first()
    if report is None:
        return []
    groups = {f"staff.{report.staff_id}", "perm.reports.view_all"}
    if report.staff.manager_id:
        groups.add(f"staff.{report.staff.manager_id}")
    return sorted(groups)


def publish_activity(event):
    at = event.occurred_at.isoformat()
    keys = ["activity"]
    for prefixes, extra in FEED_KEYS:
        if event.verb.startswith(prefixes):
            keys += [key for key in extra if key not in keys]
    feed = {
        "type": "activity",
        "verb": event.verb,
        "target": {"type": event.target_type, "id": event.target_id, "label": event.target_label},
        "actor": {"id": event.actor_id, "name": event.actor_label, "role": event.actor_role},
        "at": at,
        "invalidate": keys,
    }
    sends = [(f"staff.{staff_id}", feed) for staff_id in sorted(feed_recipients(event))]
    for prefixes, codenames, query_keys in QUEUE_INVALIDATIONS:
        if event.verb.startswith(prefixes):
            for codename in codenames:
                sends.append((f"perm.{codename}", {"type": "invalidate", "invalidate": list(query_keys), "at": at}))
    if event.verb.startswith("approval."):
        for group in _approval_groups(event):
            sends.append((group, {"type": "invalidate", "invalidate": APPROVAL_KEYS, "at": at}))
    if event.verb.startswith("report."):
        for group in _report_groups(event):
            sends.append((group, {"type": "invalidate", "invalidate": REPORT_KEYS, "at": at}))
    for group, payload in sends:
        if not _send(group, payload):
            # The layer is down or hung; don't make the request wait per message.
            logger.warning("Stopped publishing %s after a failed send", event.verb)
            return


def force_disconnect(group):
    """Ask every socket in `group` to reconnect (and so re-check access)."""
    _group_send(group, {"type": "force.disconnect"})


def force_disconnect_on_commit(group):
    transaction.on_commit(lambda: force_disconnect(group))
