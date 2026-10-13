"""Support desk rules shared by the views, the beat tasks and the reports:
business-hours clocks and the per-priority time limits."""

import datetime

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import Conversation, Message, SupportAgentState, SupportSettings


def add_business_minutes(start, minutes, settings=None):
    """`start` plus `minutes` of OPEN time: the clock only runs inside the desk's
    opening hours on its open days (SupportSettings), in the server's local
    timezone. With no open days configured the clock simply runs around the clock."""
    settings = settings or SupportSettings.load()
    days = set(settings.open_days or [])
    if not days:
        return start + datetime.timedelta(minutes=minutes)
    tz = timezone.get_current_timezone()
    current = timezone.localtime(start, tz)
    remaining = datetime.timedelta(minutes=minutes)
    for _ in range(400):  # a hard stop: 400 days is far beyond any sensible limit
        opens = current.replace(hour=settings.opens_at.hour, minute=settings.opens_at.minute, second=0, microsecond=0)
        closes = current.replace(hour=settings.closes_at.hour, minute=settings.closes_at.minute, second=0, microsecond=0)
        if current.weekday() in days and closes > opens:
            window_start = max(current, opens)
            if window_start < closes:
                available = closes - window_start
                if remaining <= available:
                    return window_start + remaining
                remaining -= available
        current = (current + datetime.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return start + datetime.timedelta(minutes=minutes)


def stamp_clocks(conversation, start=None, save=True):
    """Set first_reply_due and resolve_due from the priority's limits. An already
    answered thread keeps its (met) first-reply target."""
    settings = SupportSettings.load()
    start = start or conversation.created_at or timezone.now()
    priority = conversation.priority or Conversation.MEDIUM
    first = (settings.first_reply_minutes or SupportSettings.DEFAULT_FIRST_REPLY).get(priority)
    resolve = (settings.resolve_minutes or SupportSettings.DEFAULT_RESOLVE).get(priority)
    if first is not None and conversation.first_reply_at is None:
        conversation.first_reply_due = add_business_minutes(start, first, settings)
    if resolve is not None:
        conversation.resolve_due = add_business_minutes(start, resolve, settings)
    if save and conversation.pk:
        conversation.save(update_fields=["first_reply_due", "resolve_due", "updated_at"])
    return conversation


def desk_counts(user, now=None):
    """The Support menu counts in ONE query: open threads that are Mine (assigned
    to `user`), Unassigned, All open, Past time limit and Snoozed. Snoozed threads
    are out of Mine / Unassigned / All open / Past limit until they wake."""
    from django.db.models import Count, Q

    now = now or timezone.now()
    awake = Q(status=Conversation.OPEN) & (Q(snoozed_until__isnull=True) | Q(snoozed_until__lte=now))
    past = awake & (
        Q(first_reply_at__isnull=True, first_reply_due__lt=now) | Q(resolve_due__lt=now)
    )
    return Conversation.objects.aggregate(
        mine=Count("pk", filter=awake & Q(assignee=user)),
        unassigned=Count("pk", filter=awake & Q(assignee__isnull=True)),
        all_open=Count("pk", filter=awake),
        past_limit=Count("pk", filter=past),
        snoozed=Count("pk", filter=Q(status=Conversation.OPEN, snoozed_until__gt=now)),
    )


# ---------------------------------------------------------------------------
# The desk: events, availability, round-robin and the conversation lifecycle.
# ---------------------------------------------------------------------------
RESOLUTION_CODES = [
    ("answered", "Answered"),
    ("item_sent", "Item sent separately"),
    ("return_booked", "Return booked"),
    ("refund_accounting", "Refund with Accounting"),
    ("duplicate", "Duplicate"),
    ("other", "Other"),
]
RESOLUTION_LABELS = dict(RESOLUTION_CODES)
REOPEN_WINDOW = datetime.timedelta(days=7)
SNOOZE_SOURCE = "messaging.conversation"


def current_settings():
    """The desk rules WITHOUT writing: the stored row, or an unsaved copy of the
    defaults when none was ever saved. Read paths (every GET) use this;
    SupportSettings.load() creates the row and belongs to write paths."""
    row = SupportSettings.objects.filter(pk=1).first()
    if row is None:
        row = SupportSettings(
            pk=1,
            first_reply_minutes=dict(SupportSettings.DEFAULT_FIRST_REPLY),
            resolve_minutes=dict(SupportSettings.DEFAULT_RESOLVE),
            open_days=list(SupportSettings.DEFAULT_DAYS),
        )
    return row


def add_event(conversation, text):
    """A staff-only line in the thread's timeline (never a public message)."""
    return Message.objects.create(conversation=conversation, sender_type=Message.STAFF, kind=Message.EVENT, body=text[:500])


def is_snoozed(conversation, now=None):
    now = now or timezone.now()
    return conversation.status == Conversation.OPEN and conversation.snoozed_until is not None and conversation.snoozed_until > now


def cancel_snooze_task(conversation):
    from staff_tasks.models import Task

    return Task.objects.filter(
        kind=Task.SNOOZE_WAKE, source_type=SNOOZE_SOURCE, source_id=str(conversation.pk), status=Task.OPEN,
    ).update(status=Task.CANCELLED)


def clear_snooze(conversation, event=None, keep_task=False):
    """Wake a snoozed thread (the row is locked by the caller). The snoozer's reminder task is
    cancelled, except when the snooze simply ran out (keep_task): then it stays open for them."""
    conversation.snoozed_until = None
    conversation.snoozed_by = None
    conversation.save(update_fields=["snoozed_until", "snoozed_by", "updated_at"])
    if not keep_task:
        cancel_snooze_task(conversation)
    if event:
        add_event(conversation, event)


# --- who can take a conversation ------------------------------------------

def desk_staff():
    """Everyone who can open the Support inbox (and so be assigned to or mentioned)."""
    from accounts.permissions import staff_holding

    return staff_holding("messaging.manage").filter(invite_token__isnull=True).select_related("role")


def _away(state, now):
    return bool(state and state.away and (state.away_until is None or state.away_until > now))


def open_loads():
    """{staff id: awake open conversations assigned}: a snoozed thread frees room."""
    from django.db.models import Count

    now = timezone.now()
    rows = (
        Conversation.objects.filter(status=Conversation.OPEN, assignee__isnull=False)
        .filter(Q(snoozed_until__isnull=True) | Q(snoozed_until__lte=now))
        .values("assignee").annotate(n=Count("pk"))
    )
    return {row["assignee"]: row["n"] for row in rows}


def capacity_board(now=None, rotation_only=True):
    """Each agent's room: open load against the capacity, signed in (a live
    StaffSession), Away, leave/holiday today. There is no shift roster, so no
    shift times are ever shown. `available` is what round-robin uses."""
    from accounts import sessions
    from accounts.models import Role, StaffSession
    from targets.models import Leave, PublicHoliday

    now = now or timezone.now()
    desk = current_settings()
    capacity = desk.capacity_per_agent
    staff = list(desk_staff().filter(is_suspended=False))
    if rotation_only:
        staff = [s for s in staff if s.role.name == Role.SUPPORT]
    ids = [s.pk for s in staff]
    signed_in = set(sessions.live(StaffSession.objects.filter(staff_id__in=ids), now).values_list("staff_id", flat=True))
    states = {s.staff_id: s for s in SupportAgentState.objects.filter(staff_id__in=ids)}
    today = timezone.localdate(now)
    on_leave = set(Leave.objects.filter(staff_id__in=ids, start__lte=today, end__gte=today).values_list("staff_id", flat=True))
    holiday = PublicHoliday.objects.filter(date=today).first()
    loads = open_loads()
    board = []
    for person in sorted(staff, key=lambda s: (s.full_name.lower(), s.pk)):
        state = states.get(person.pk)
        away = _away(state, now)
        load = loads.get(person.pk, 0)
        full = load >= capacity
        reasons = []
        if person.pk not in signed_in:
            reasons.append("Not signed in")
        if away:
            reasons.append("Away")
        if person.pk in on_leave:
            reasons.append("On leave")
        if holiday:
            reasons.append(f"Public holiday: {holiday.name}")
        if full:
            reasons.append("Full")
        board.append({
            "id": person.pk, "name": person.full_name, "role": person.role.name, "in_rotation": person.role.name == Role.SUPPORT,
            "open": load, "capacity": capacity, "full": full,
            "signed_in": person.pk in signed_in, "away": away,
            "away_until": state.away_until if away and state else None,
            "on_leave": person.pk in on_leave, "holiday": holiday.name if holiday else None,
            "available": not reasons,
            "note": "; ".join(reasons) if reasons else "Has room",
        })
    return board


def pick_assignee(now=None, exclude=()):
    """(staff id, "") for the on-shift agent with the fewest open conversations
    under the limit, else (None, the reason nobody was picked)."""
    board = capacity_board(now)
    if not board:
        return None, "No support agent is set up to take conversations."
    open_slots = [row for row in board if row["available"] and row["id"] not in exclude]
    if open_slots:
        open_slots.sort(key=lambda row: (row["open"], row["id"]))
        return open_slots[0]["id"], ""
    ready = [row for row in board if row["signed_in"] and not row["away"] and not row["on_leave"] and not row["holiday"]]
    if ready and all(row["full"] for row in ready):
        return None, "Everyone on shift is at their limit."
    return None, "Nobody is signed in and available."


def auto_assign(conversation, now=None):
    """Round-robin a new (or woken, or handed-back) conversation. The settings row
    is locked first, so two conversations arriving together cannot both take the
    last free place. Leaves it unassigned, with the reason, when nobody has room.
    Returns the assigned StaffUser or None."""
    from accounts.models import StaffUser

    with transaction.atomic():
        SupportSettings.load()
        desk = SupportSettings.objects.select_for_update().get(pk=1)
        if conversation.assignee_id:
            return conversation.assignee
        if not desk.round_robin:
            conversation.unassigned_reason = "Automatic assignment is switched off."
            conversation.save(update_fields=["unassigned_reason", "updated_at"])
            return None
        staff_id, reason = pick_assignee(now)
        if staff_id is None:
            conversation.unassigned_reason = reason
            conversation.save(update_fields=["unassigned_reason", "updated_at"])
            return None
        agent = StaffUser.objects.get(pk=staff_id)
        conversation.assignee = agent
        conversation.unassigned_reason = ""
        conversation.save(update_fields=["assignee", "unassigned_reason", "updated_at"])
        add_event(conversation, f"Assigned to {agent.full_name} automatically (fewest open conversations).")
        return agent


def notify_assignee(conversation, title, body, exclude=None, link="support-mine"):
    """Bell notice to the assignee ONLY (not the whole desk). Unassigned threads
    notify the agents who are on shift."""
    from notifications.services import notify_staff

    if conversation.assignee_id:
        if exclude is None or conversation.assignee_id != getattr(exclude, "pk", exclude):
            notify_staff(conversation.assignee, "new_message", title, body=body, link=link, icon="💬")
        return
    for row in capacity_board():
        if row["signed_in"] and not row["away"] and not row["on_leave"] and not row["holiday"]:
            from accounts.models import StaffUser

            notify_staff(StaffUser.objects.get(pk=row["id"]), "new_message", title, body=body, link="support-unassigned", icon="💬")


# --- the customer / owner / guest side of the lifecycle --------------------

def start_conversation(**fields):
    """A new conversation: clocks, then round-robin. (The first message is the caller's.)"""
    conversation = Conversation.objects.create(status=Conversation.OPEN, **fields)
    stamp_clocks(conversation)
    auto_assign(conversation)
    return conversation


def route_customer_message(conversation_id, sender_type, body):
    """Post a customer / owner / guest message and return (conversation, message).
    - an open snoozed thread wakes early;
    - a thread resolved less than 7 days ago reopens and goes back to whoever
      resolved it;
    - an older (or never-resolved) closed thread is not reopened: the message
      starts a NEW conversation that links back through previous_conversation."""
    now = timezone.now()
    with transaction.atomic():
        conversation = Conversation.objects.select_for_update().get(pk=conversation_id)
        if conversation.status == Conversation.CLOSED:
            if conversation.resolved_at and now - conversation.resolved_at <= REOPEN_WINDOW:
                resolver = conversation.resolved_by
                conversation.status = Conversation.OPEN
                conversation.resolved_at = None
                conversation.resolved_by = None
                conversation.resolution_code = ""
                conversation.resolution_note = ""
                conversation.snoozed_until = None
                if resolver is not None and resolver.is_active and not resolver.is_suspended:
                    conversation.assignee = resolver
                conversation.save()
                stamp_clocks(conversation, start=now)
                add_event(conversation, "Reopened: the customer replied within 7 days of it being resolved.")
                if conversation.assignee_id is None:
                    auto_assign(conversation)
            else:
                follow_up = Conversation.objects.create(
                    customer=conversation.customer, business_owner=conversation.business_owner,
                    guest_token=conversation.guest_token, subject=conversation.subject, source=conversation.source,
                    about_business=conversation.about_business, about_listing=conversation.about_listing,
                    about_order=conversation.about_order, previous_conversation=conversation,
                )
                stamp_clocks(follow_up)
                add_event(follow_up, f"Continues conversation #{conversation.pk}, which was resolved more than 7 days ago.")
                auto_assign(follow_up)
                conversation = follow_up
        elif is_snoozed(conversation, now):
            clear_snooze(conversation, "Woke early: they replied.")
        message = Message.objects.create(conversation=conversation, sender_type=sender_type, body=body)
        conversation.save()  # bump updated_at for the queue's recency ordering
        who = conversation.starter_display_name if conversation.guest_token is None else f"Guest (thread {conversation.pk})"
        notify_assignee(conversation, "New reply in a conversation", f"{who} replied.")
    return conversation, message


def staff_take_if_unassigned(conversation, user, event=True):
    """Replying to (or snoozing) an unassigned thread makes it yours."""
    if conversation.assignee_id is None:
        conversation.assignee = user
        conversation.unassigned_reason = ""
        conversation.save(update_fields=["assignee", "unassigned_reason", "updated_at"])
        if event:
            add_event(conversation, f"{user.full_name} took this conversation.")


def wake_due_snoozes(now=None):
    """Beat job: a snoozed thread whose time has come wakes (the lists already treat it as
    awake the moment the time passes; this puts the timeline line, tells the assignee and
    hands an unassigned one to round-robin). Rows are claimed with SKIP LOCKED so a second
    worker and a customer reply at the same moment never wake the same thread twice."""
    now = now or timezone.now()
    woken = 0
    ids = list(
        Conversation.objects.filter(status=Conversation.OPEN, snoozed_until__isnull=False, snoozed_until__lte=now)
        .values_list("pk", flat=True)
    )
    for pk in ids:
        with transaction.atomic():
            conversation = Conversation.objects.select_for_update(skip_locked=True).filter(
                pk=pk, status=Conversation.OPEN, snoozed_until__isnull=False, snoozed_until__lte=now,
            ).first()
            if conversation is None:
                continue
            clear_snooze(conversation, "Snooze ended: this conversation is back in the queue.", keep_task=True)
            if conversation.assignee_id is None:
                auto_assign(conversation)
            who = conversation.starter_display_name if conversation.guest_token is None else f"Guest (thread {conversation.pk})"
            notify_assignee(conversation, "A snoozed conversation woke up", f"{who}: back in your queue.")
            woken += 1
    return woken
