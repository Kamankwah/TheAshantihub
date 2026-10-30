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
    "staff-invite", "staff-resend-invite", "staff-cancel-invite", "staff.invite_cancelled", "staff-suspend", "staff-unsuspend",
    "staff-deactivate", "staff-reactivate", "staff-permissions", "staff-manager",
    "staff.manager_changed", "staff.role_changed", "role.permissions_changed", "staff.signed_out_everyone",
)
# (verb prefixes, permissions whose holders' queues changed, query keys)
QUEUE_INVALIDATIONS = [
    # identity-* covers the staff decisions and the owner's own submission (identity-submitted, owner actor).
    (("kyc-", "identity-"), ("kyc.approve",), ("kyc-queue", "kyc-detail", "kyc-stats", "identity-queue", "staff-badges")),
    # A KYC decision in the queue settles the maker's business.kyc request
    # without an approval.* event (accounts/kyc.py), so scouts' approvals
    # lists refresh from the decision itself.
    (("kyc-approve", "kyc-reject"), ("businesses.manage_portfolio",), ("approvals", "approval", "approval-counts", "approval-stats")),
    # Address verification: a decision, the owner sharing a location, and staff sending a link (address-*) refresh the queue.
    (("address-",), ("address.verify",), ("address-verification", "staff-badges")),
    (("moderation-",), ("listings.moderate",), ("moderation-queue", "moderation-stats", "staff-badges")),
    (("hero-moderation-",), ("hero_media.approve",), ("hero-moderation-queue", "staff-badges")),
    (("event-moderation-",), ("event.approve",), ("event-moderation-queue", "event-moderation-detail", "staff-badges")),
    (("review-approve", "review-hide"), ("reviews.moderate",), ("reviews-moderation-queue", "staff-badges")),
    (("contact-message",), ("contact_messages.manage",), ("contact-messages-queue", "staff-badges")),
    # The Support desk: every conversation write refreshes the inbox lists, a thread, and the menu counts.
    (("staff-conversation-",), ("messaging.manage",), ("staff-messaging-queue", "support-inbox", "support-thread", "staff-badges")),
    (("staff-canned-",), ("messaging.manage",), ("support-canned",)),
    (("staff-tag-",), ("messaging.manage",), ("support-tags", "support-inbox")),
    # staff-badges: Super Admin's Invites badge counts open invites (invite, resend, cancel, deactivate change it).
    (STAFF_MANAGEMENT_VERBS, ("staff.manage", "staff.invite_team"), ("staff-roster", "my-team", "ops-invites", "staff-badges")),
    (("promotion-",), ("promotions.manage",), ("promotions-queue",)),
    # Product grouping: a staff decision (approve, reject, re-review, detach) refreshes the other reviewers' queue and the
    # menu badge. A business's own request is not a staff write and makes no activity event: it reaches staff through the
    # catalogue_needs_review notice and the badge's 60 s poll.
    (("catalogue-staff-",), ("listings.moderate",), ("catalogue-queue", "staff-badges")),
    (("zone.",), ("zones.manage",), ("zones-summary", "zones")),
    (("site_settings.",), ("site_settings.manage",), ("site-settings", "site-settings-history")),
    (("subscription-plan-",), ("subscription_plans.approve",), ("subscription-plan-pending-queue", "staff-badges")),
    (("escrow-",), ("escrow.view",), ("escrow-ledger", "staff-badges")),
    (("dispute-",), ("disputes.flag", "disputes.resolve_financial"), ("disputes-queue", "staff-badges")),
    # Support's Order status screen: running late / cancelled by the customer.
    (("order-support-",), ("orders.support_update",), ("support-orders",)),
    # Support's verification call and the Pickup Desk: a hand-over (rider delivery or desk collection) adds a row, a
    # call or a cancel removes one. Customer and owner actions write no staff event, so the screens also refetch on focus.
    (
        (
            "ledger-order-verification", "ledger-booking-verification", "ledger-booking-cancel", "ledger-pickup-collected",
            "delivery-rider-deliver", "delivery-deliver",
        ),
        ("orders.verify",),
        ("ledger-verification",),
    ),
    (("ledger-pickup-collected",), ("pickup.confirm",), ("ledger-pickup",)),
    (
        ("order-delivery-status-update", "order-assign-dispatch", "delivery-pickup", "delivery-deliver"),
        ("orders.manage_delivery",),
        ("delivery-queue",),
    ),
    (
        ("delivery.early_send",),
        ("delivery.manage",),
        ("delivery-queue", "delivery-live", "delivery-manager-orders", "delivery-scheduled"),
    ),
    (
        ("kyc-", "business.", "portfolio.", "subscription."),
        ("portfolio.manage", "businesses.manage_portfolio"),
        ("portfolio", "portfolio-business", "subscriptions-due", "staff-badges"),
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
    # Targets, leave and holidays change what a scout's Targets screen shows; a KYC approval
    # (registrations) and a listing approval (listings) change the counts.
    (("targets.", "leave.", "calendar.", "kyc-approve", "approval.", "moderation-"), ("businesses.manage_portfolio",), ("my-targets",)),
    # Operations' scoreboard (screen 04) follows targets, leave, visits, calls, reports and the counts they come from.
    (("targets.", "leave.", "calendar.", "visit.", "kyc-approve", "approval.", "moderation-", "call-", "report.", "fraud."), ("portfolio.manage",), ("ops-scouts", "ops-overview")),
    # The Operations Visit map (20) follows check-ins and check-outs.
    (("visit.",), ("portfolio.manage",), ("team-visits",)),
    # The Operations overview (01) also follows approvals waiting and the businesses' health.
    (("approval.", "kyc-", "portfolio.", "business."), ("portfolio.manage",), ("ops-overview",)),
    # Operations' Targets (07) and Leave (08) editors.
    (("targets.", "leave.", "calendar.", "approval."), ("targets.manage", "leave.record"), ("targets-plans", "targets-history", "team-leave")),
    # A KYC approval may complete an activation (the leaderboard counts it once its first listing is live too).
    (("kyc-approve",), ("businesses.manage_portfolio",), ("leaderboard",)),
    # Commission lines are earned, released, reversed and exported by events; a policy change is an approval.
    (("commission.",), ("commission.view_own", "commission.view_all", "commission.policy"), ("my-commission", "commission-accruals", "commission-policies")),
    # Operations' read-only Service screens (16, 17, 05): contact messages, disputes, conversations and deliveries.
    (
        ("contact-message", "dispute-", "staff-conversation-", "order-delivery-status-update", "order-assign-dispatch", "delivery-pickup", "delivery-deliver"),
        ("service_issues.view",),
        ("service-issues", "ops-deliveries", "ops-overview", "staff-badges"),
    ),
    (("staff-conversation-",), ("staff.invite_team",), ("ops-support-team",)),
    (("fraud.",), ("fraud.manage", "fraud.flag"), ("fraud-flags", "fraud-flag-counts", "kyc-queue", "portfolio-business", "staff-badges")),
    # Super Admin marketplace screens (SA-5): each follows the events that change its list and its counts.
    (("business.", "kyc-", "portfolio.", "subscription.", "fraud."), ("portfolio.manage",), ("sa-businesses",)),
    (("customer.", "order-delivery-status-update", "order-assign-dispatch", "delivery-pickup", "delivery-deliver", "dispute-"), ("users.view",), ("sa-customers",)),
    (("moderation-", "business.", "approval."), ("listings.moderate",), ("sa-listings",)),
    (("order-delivery-status-update", "order-assign-dispatch", "delivery-pickup", "delivery-deliver", "dispute-"), ("orders.manage_delivery",), ("sa-orders",)),
    (("event-moderation-", "escrow-", "event."), ("escrow.view", "event.approve"), ("sa-events",)),
    (("dispute-",), ("disputes.flag", "disputes.resolve_financial"), ("sa-disputes",)),
    # Delivery Manager (delivery app). A rider's step, an assignment or a flag decision changes the live board,
    # the active list, one delivery's record and the queue; location pings are exempt from the log (no event).
    (
        ("delivery-rider-accept", "delivery-rider-arrive-", "delivery-rider-pickup", "delivery-rider-deliver", "delivery-rider-cant-deliver",
         "delivery-rider-shift-", "delivery-rider-issues", "delivery-rider-note", "delivery-rider-photo", "delivery-rider-call",
         "delivery-job-", "order-assign-dispatch", "dispute-"),
        ("delivery.manage",),
        ("delivery-live", "delivery-active", "delivery-job", "staff-badges"),
    ),
    # The fleet screens: riders, papers, vehicles, zones and the pending-invite list.
    (
        ("delivery-rider-shift-", "delivery-rider-documents", "delivery-rider-job-hold", "delivery-rider-reinstate", "delivery-rider",
         "delivery-document-", "delivery-vehicle", "delivery-zone", "order-assign-dispatch", "delivery-rider-accept", "delivery-rider-deliver"),
        ("delivery.fleet",),
        ("delivery-riders", "delivery-rider", "delivery-documents", "delivery-vehicles", "delivery-zones", "staff-badges"),
    ),
    (STAFF_MANAGEMENT_VERBS, ("delivery.fleet",), ("delivery-invites", "delivery-riders")),
    # Dispatch queue and offers, delivery cases, cash, the rota and the rules.
    (
        ("delivery-queue-", "delivery-auto-assign-", "delivery-rider-offer-", "delivery-rider-accept", "delivery-rider-shift-", "order-assign-dispatch",
         "delivery-rider-cant-deliver", "delivery-rules-", "approval."),
        ("delivery.manage",),
        ("delivery-queue", "delivery-live"),
    ),
    (("delivery-case-decide", "dispute-", "delivery-rider-cant-deliver"), ("delivery.manage", "delivery.disputes"), ("delivery-cases", "delivery-case")),
    (("delivery-cash", "delivery-rider-deliver"), ("delivery.cash",), ("delivery-cash", "delivery-payouts")),
    (("delivery-shift", "delivery-rider-shift"), ("delivery.fleet",), ("delivery-shifts",)),
    (("delivery-rules-", "approval."), ("delivery.rates",), ("delivery-rules",)),
    # The rider app: any step, offer, hand-over or rota change refreshes every rider's own reads.
    (
        ("delivery-queue-", "delivery-rider-", "delivery-cash", "delivery-shift", "order-assign-dispatch", "delivery-job-"),
        ("delivery.dispatch",),
        ("delivery-rider-me", "delivery-rider-offers", "delivery-rider-jobs", "delivery-rider-shifts", "delivery-rider-cash"),
    ),
    # Edits of approved listings: submit, approve, reject and re-review refresh the revisions queue.
    (("listing-revision-",), ("listings.moderate",), ("listing-revisions-queue",)),
]
# (verb prefixes, extra keys for everyone who receives the feed event)
FEED_KEYS = [
    (("task-",), ("my-tasks", "staff-badges")),
    (("call-",), ("call-logs", "my-targets")),
    (("visit.",), ("visits", "visit-open", "my-targets")),
    # A returned request gives its maker a follow-up task (portfolio/approval_kinds.py).
    (("approval.",), ("approvals", "approval", "approval-counts", "approval-stats", "staff-badges", "my-tasks")),
    (("report.",), ("my-reports", "report", "team-reports", "staff-badges")),
]
APPROVAL_KEYS = ["approvals", "approval", "approval-counts", "approval-stats", "staff-badges"]
REPORT_KEYS = ["my-reports", "report", "team-reports", "staff-badges"]


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
