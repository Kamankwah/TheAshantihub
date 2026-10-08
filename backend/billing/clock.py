"""The subscription overdue clock (staff phase 2A; spec S7).

When a paid or trial period ends unpaid the subscription becomes overdue: the
owner is told and the account manager gets a task (day 1). Days 1-14 are
grace — listings stay live and the owner sees a renew banner — with a reminder
on day 7 and on day 13. At `overdue_since + 14 days` (the start of day 15) it
is paused: the business's listings and events drop out of public browse
through `listings.visibility.hidden_business_q`. Nothing is deleted or
unpublished.

Only a successful subscription payment stops the clock:
`payments.services._finalize_subscription` calls `clear_after_payment` inside
the payment's own transaction. POST /api/billing/subscriptions/me/ (a plan
without a payment) and the trial start never do.

Day N is `(now - overdue_since).days + 1`. Every step stamps its timestamp in
the same transaction as the notices it stands for, so the hourly job
(`billing.tasks.run_subscription_clock`) can run any number of times.
"""
import logging
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.emails import (
    day_text,
    send_subscription_overdue_email,
    send_subscription_paused_email,
    send_subscription_reminder_email,
)
from activity.services import record
from notifications.services import notify_business_owner, notify_staff_role
from staff_tasks.services import create_task

from .models import Subscription

logger = logging.getLogger(__name__)

GRACE_DAYS = 14
GRACE = timedelta(days=GRACE_DAYS)
# A period that ended more than this long before the job first saw it (the
# first run after this ships, or a long outage) gets its 14 days from that
# moment: nobody is paused on the spot for a lapse they were never told about.
LATE_DISCOVERY = timedelta(days=1)
TASK_DUE_IN = timedelta(days=1)
OWNER_LINK = "/business-dashboard"
CLOCK_FIELDS = ("overdue_since", "paused_at", "overdue_notice_at", "reminder_day7_at", "reminder_day13_at")

NONE, TRIAL, ACTIVE, OVERDUE, PAUSED = "none", "trial", "active", "overdue", "paused"


def _iso(value):
    return timezone.localtime(value).isoformat() if value is not None else None


def clock_start(current_period_end, now):
    """When the 14 days start for a period that ended at `current_period_end`
    and is first noticed at `now` (Decision 9)."""
    return current_period_end if now - current_period_end <= LATE_DISCOVERY else now


def day_number(overdue_since, now):
    """Day N of the clock; day 1 begins at `overdue_since`."""
    return max(1, (now - overdue_since).days + 1)


def _pause_at(overdue_since):
    return overdue_since + GRACE


def _hide_on(overdue_since):
    return timezone.localdate(_pause_at(overdue_since))


def _renew_by(overdue_since):
    return _hide_on(overdue_since) - timedelta(days=1)


def _empty_state():
    return {
        "state": NONE, "is_trial": False, "plan_name": None, "monthly_price": None,
        "current_period_end": None, "overdue_since": None, "overdue_day": None,
        "pause_at": None, "hide_on": None, "renew_by": None, "paused_at": None,
    }


def subscription_state(subscription, now=None):
    """The clock as screens show it (the owner's renew banner, portfolio cards,
    Subscriptions due). A period that has ended but that the hourly job hasn't
    marked yet already reads as overdue, from the moment the job will record.
    Paused: `pause_at`/`hide_on` say when the pause took effect; there is no
    `overdue_day` or `renew_by` any more."""
    state = _empty_state()
    if subscription is None:
        return state
    now = now or timezone.now()
    plan = subscription.plan
    state.update(
        is_trial=subscription.is_trial,
        plan_name=plan.name,
        monthly_price=str(plan.monthly_price),
        current_period_end=_iso(subscription.current_period_end),
    )
    if subscription.paused_at is not None:
        state.update(
            state=PAUSED,
            overdue_since=_iso(subscription.overdue_since),
            pause_at=_iso(subscription.paused_at),
            hide_on=timezone.localdate(subscription.paused_at).isoformat(),
            paused_at=_iso(subscription.paused_at),
        )
        return state
    overdue_since = subscription.overdue_since
    if overdue_since is None and subscription.current_period_end <= now:
        overdue_since = clock_start(subscription.current_period_end, now)
    if overdue_since is not None:
        state.update(
            state=OVERDUE,
            overdue_since=_iso(overdue_since),
            overdue_day=min(GRACE_DAYS, day_number(overdue_since, now)),
            pause_at=_iso(_pause_at(overdue_since)),
            hide_on=_hide_on(overdue_since).isoformat(),
            renew_by=_renew_by(overdue_since).isoformat(),
        )
        return state
    state["state"] = TRIAL if subscription.is_trial else ACTIVE
    return state


# --- the hourly job ---------------------------------------------------------

def _overdue_due(now):
    return Q(overdue_since__isnull=True, paused_at__isnull=True, current_period_end__lte=now)


def _reminder_due(now):
    day7 = now - timedelta(days=6)    # day 7 has begun
    day13 = now - timedelta(days=12)  # day 13 has begun
    return Q(overdue_since__isnull=False, paused_at__isnull=True, overdue_since__gt=now - GRACE) & (
        Q(reminder_day13_at__isnull=True, overdue_since__lte=day13)
        | Q(reminder_day7_at__isnull=True, reminder_day13_at__isnull=True, overdue_since__lte=day7)
    )


def _pause_due(now):
    return Q(overdue_since__isnull=False, paused_at__isnull=True, overdue_since__lte=now - GRACE)


def _email_on_commit(owner, send, *args):
    # An email can't be taken back, so it waits for the commit.
    if owner.email:
        transaction.on_commit(lambda: send(owner, *args))


def _working_manager(owner):
    """The account manager, unless there is none or they've left or are
    suspended — then the business counts as unmanaged."""
    manager = owner.account_manager
    if manager is not None and manager.is_active and not manager.is_suspended:
        return manager
    return None


def _follow_up(subscription, owner, now, *, day):
    """The account manager's task (day 1, 7 and 13) — or, with no working
    account manager, a notice to everyone who manages portfolios."""
    name = owner.display_name
    hide_on = _hide_on(subscription.overdue_since)
    manager = _working_manager(owner)
    if manager is None:
        notify_staff_role(
            "portfolio.manage", "subscription_overdue_unmanaged",
            f"{name}: subscription overdue, no account manager",
            body=(f"Day {day} of {GRACE_DAYS}. Its listings are hidden on {day_text(hide_on)} "
                  "if it's still unpaid. Assign a scout or follow it up."),
            link="subscriptions-due", icon="⏳",
        )
        return None
    create_task(
        manager,
        f"Remind {name} to renew — subscription overdue, day {day} of {GRACE_DAYS}",
        min(now + TASK_DUE_IN, _pause_at(subscription.overdue_since)),
        notes=(f"Listings are hidden on {day_text(hide_on)} if still unpaid. "
               "The owner pays in the app — scouts never collect cash."),
        source=subscription,
    )
    return manager


def _mark_overdue(subscription, now):
    lapsed_at = subscription.current_period_end
    started_late = now - lapsed_at > LATE_DISCOVERY
    subscription.overdue_since = clock_start(lapsed_at, now)
    subscription.overdue_notice_at = now
    subscription.save(update_fields=["overdue_since", "overdue_notice_at"])
    owner = subscription.business_owner
    renew_by = _renew_by(subscription.overdue_since)
    notify_business_owner(
        owner, "subscription_overdue", "Your subscription has ended",
        body=(f"Renew by {day_text(renew_by)} to keep your listings visible. "
              "You pay in the app, from your dashboard."),
        link=OWNER_LINK, icon="⏳",
    )
    _email_on_commit(owner, send_subscription_overdue_email, renew_by)
    manager = _follow_up(subscription, owner, now, day=day_number(subscription.overdue_since, now))
    record(
        None, "subscription.overdue", target=owner,
        summary=f"Subscription overdue — renew by {day_text(renew_by)}",
        after={
            "overdue_since": _iso(subscription.overdue_since),
            "hide_on": _hide_on(subscription.overdue_since).isoformat(),
            "started_late": started_late,
            "account_manager_id": getattr(manager, "pk", None),
        },
    )
    return True


def _send_reminder(subscription, now):
    day = day_number(subscription.overdue_since, now)
    # Only the latest reminder that is due goes out: a run that comes late
    # never sends day 7 and day 13 together.
    if subscription.reminder_day13_at is None and day >= 13:
        which, field = 13, "reminder_day13_at"
    elif subscription.reminder_day7_at is None and subscription.reminder_day13_at is None and day >= 7:
        which, field = 7, "reminder_day7_at"
    else:
        return False
    setattr(subscription, field, now)
    subscription.save(update_fields=[field])
    owner = subscription.business_owner
    renew_by = _renew_by(subscription.overdue_since)
    hide_on = _hide_on(subscription.overdue_since)
    notify_business_owner(
        owner, "subscription_reminder", f"Reminder: renew by {day_text(renew_by)}",
        body=(f"Day {day} of {GRACE_DAYS}. Your listings are hidden on {day_text(hide_on)} if your "
              "subscription is still unpaid. Renew in the app, from your dashboard."),
        link=OWNER_LINK, icon="⏰",
    )
    _email_on_commit(owner, send_subscription_reminder_email, day, renew_by)
    _follow_up(subscription, owner, now, day=day)
    record(
        None, "subscription.reminder_sent", target=owner,
        summary=f"Day {which} renewal reminder sent",
        after={"day": which, "hide_on": hide_on.isoformat()},
    )
    return True


def _pause(subscription, now):
    subscription.paused_at = now
    subscription.save(update_fields=["paused_at"])
    owner = subscription.business_owner
    notify_business_owner(
        owner, "subscription_paused", "Your listings are hidden until you renew",
        body=("Your subscription wasn't renewed within 14 days, so your listings and events are "
              "hidden from the marketplace. Nothing has been deleted — renew in the app and they "
              "come back at once."),
        link=OWNER_LINK, icon="⏸️",
    )
    _email_on_commit(owner, send_subscription_paused_email)
    record(
        None, "subscription.paused", target=owner,
        summary="Subscription paused — listings and events hidden",
        after={"overdue_since": _iso(subscription.overdue_since), "paused_at": _iso(now)},
    )
    return True


def _each(condition, handle, now):
    """Run `handle(subscription, now)` for every subscription matching
    `condition`, each in its own transaction under a row lock. A row someone
    else holds (another run, a payment being finalised) is skipped this hour;
    the condition is re-checked under the lock, so a payment that landed in
    between wins. One bad row is logged and never stops the rest."""
    done = 0
    ids = list(Subscription.objects.filter(condition).order_by("pk").values_list("pk", flat=True))
    for pk in ids:
        try:
            with transaction.atomic():
                subscription = (
                    Subscription.objects.select_for_update(skip_locked=True, of=("self",))
                    .select_related("business_owner__account_manager")
                    .filter(condition, pk=pk)
                    .first()
                )
                if subscription is not None and handle(subscription, now):
                    done += 1
        except Exception:
            logger.exception("The subscription clock failed on subscription %s", pk)
    return done


def tick(now=None):
    """One run of the hourly job: mark lapsed periods overdue, send the day-7
    and day-13 reminders, pause at the start of day 15. Idempotent."""
    now = now or timezone.now()
    return {
        "overdue": _each(_overdue_due(now), _mark_overdue, now),
        "reminders": _each(_reminder_due(now), _send_reminder, now),
        "paused": _each(_pause_due(now), _pause, now),
    }


# --- payment ----------------------------------------------------------------

def clear_after_payment(subscription, *, now):
    """Stop the clock after a successful subscription payment. Called only by
    payments.services._finalize_subscription, inside the payment's transaction
    and right after the period was renewed, so a paused business's listings
    come back in the same commit as its payment. Returns "paused" or "overdue"
    when it stopped a running clock — then the owner is told and
    subscription.resumed is recorded, last — else None."""
    with transaction.atomic():
        locked = Subscription.objects.select_for_update().get(pk=subscription.pk)
        was = PAUSED if locked.paused_at else OVERDUE if locked.overdue_since else None
        overdue_since, paused_at = locked.overdue_since, locked.paused_at
        if any(getattr(locked, field) is not None for field in CLOCK_FIELDS):
            for field in CLOCK_FIELDS:
                setattr(locked, field, None)
                setattr(subscription, field, None)
            locked.save(update_fields=list(CLOCK_FIELDS))
        if was is None:
            return None
        owner = subscription.business_owner
        notify_business_owner(
            owner, "subscription_resumed", "Your subscription is renewed",
            body=("Your listings and events are visible again." if was == PAUSED
                  else "Thank you — your listings stay visible."),
            link=OWNER_LINK, icon="✅",
        )
        record(
            owner, "subscription.resumed", target=owner,
            summary="Paid in the app — pause lifted" if was == PAUSED else "Paid in the app during grace",
            after={
                "was": was,
                "paid_on_day": day_number(overdue_since, now) if overdue_since else None,
                "overdue_since": _iso(overdue_since),
                "paused_at": _iso(paused_at),
                "business_name": owner.display_name,
            },
        )
        return was
