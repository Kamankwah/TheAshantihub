"""Staff views of the Support desk (package B). Every view is named
`staff-conversation-*` so the realtime prefix covers it, carries
HasRolePermission, and locks the conversation row (select_for_update) before it
moves a thread between states. Notes and timeline events are staff-only: nothing
here is ever reused by a customer, owner or guest endpoint."""

import datetime

from django.db import transaction
from django.db.models import Avg, DurationField, ExpressionWrapper, F
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role, StaffUser
from accounts.permissions import HasAnyRolePermission, HasRolePermission
from activity.services import record
from notifications.services import notify_business_owner, notify_customer, notify_staff, notify_staff_role
from staff_tasks.models import Task
from staff_tasks.services import create_task

from . import context as context_pane
from . import desk, services
from .models import Conversation, ConversationTag, Message, SupportAgentState, SupportSettings
from .serializers import MessageCreateSerializer, MessageSerializer, StaffMessageSerializer

MAX_BULK = 50
MAX_SNOOZE = datetime.timedelta(days=30)
CONTEXT_LINK = "support-all-open"


def _conflict(code, detail, status=409):
    return Response({"code": code, "detail": detail}, status=status)


class DeskView(APIView):
    """Base: messaging.manage on every method."""

    def get_permissions(self):
        return [HasRolePermission("messaging.manage")]


def _locked(pk):
    return get_object_or_404(Conversation.objects.select_for_update(), pk=pk)


def _fresh(pk, now=None):
    """The conversation re-read with the inbox annotations, as a thread payload."""
    conversation = desk.annotated(Conversation.objects.filter(pk=pk)).get()
    return desk.thread(conversation, now)


def _record(request, verb, conversation, summary, before=None, after=None):
    # Last thing in the request's transaction: record() holds the activity chain lock until commit.
    record(
        request.user, verb, target_type="messaging.conversation", target_id=str(conversation.pk),
        target_label=f"Conversation #{conversation.pk}", summary=summary, before=before, after=after,
        method=request.method, request=request,
    )


def _label(conversation):
    return desk.person(conversation)[1]


# ---- reading ---------------------------------------------------------------

class StaffConversationPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class StaffConversationListView(generics.ListAPIView):
    """GET /api/messaging/staff/ — the inbox. `scope=mine|unassigned|all|past|snoozed|resolved`
    (none = every conversation, the older list), `sort=time_limit|newest|priority|oldest`,
    `q=` (people, businesses, listings, order numbers, thread numbers, message text),
    `mine=1` (past: only mine), `days=` (resolved window, default 7). The envelope adds
    the menu `counts` and a `summary` of the filtered scope. Read-only."""

    pagination_class = StaffConversationPagination

    def get_permissions(self):
        return [HasRolePermission("messaging.manage")]

    def get_queryset(self):
        params = self.request.query_params
        now = timezone.now()
        scope = params.get("scope", "")
        scope = scope if scope in desk.SCOPES else ""
        try:
            days = max(1, min(int(params.get("days", 7)), 90))
        except ValueError:
            days = 7
        queryset = desk.annotated(Conversation.objects.all())
        queryset = desk.scoped(queryset, scope, self.request.user, now, mine_only=params.get("mine") == "1", days=days)
        queryset = desk.searched(queryset, params.get("q"))
        sort = params.get("sort", "")
        return desk.ordered(queryset, sort if sort in desk.SORTS else "", scope or "legacy")

    def list(self, request, *args, **kwargs):
        now = timezone.now()
        queryset = self.get_queryset()
        page = self.paginate_queryset(queryset)
        rows = [desk.row(c, now) for c in page]
        response = self.get_paginated_response(rows)
        response.data["counts"] = services.desk_counts(request.user, now)
        response.data["summary"] = self._summary(queryset, now)
        return response

    @staticmethod
    def _summary(queryset, now):
        today_start = timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)
        answered = queryset.filter(first_reply_at__gte=today_start).annotate(
            wait=ExpressionWrapper(F("first_reply_at") - F("created_at"), output_field=DurationField())
        ).aggregate(avg=Avg("wait"))
        count = queryset.filter(first_reply_at__gte=today_start).count()
        avg = answered["avg"]
        return {
            "total": queryset.count(), "past_limit": queryset.filter(desk.past_q(now)).count(),
            "first_reply_today_count": count,
            "first_reply_today_avg_seconds": int(avg.total_seconds()) if avg is not None and count else None,
        }


class StaffConversationDetailView(DeskView):
    """GET /api/messaging/staff/{id}/ — the whole thread, notes and events included. Read-only."""

    def get(self, request, pk):
        get_object_or_404(Conversation, pk=pk)
        return Response(_fresh(pk))


class StaffConversationContextView(DeskView):
    """GET /api/messaging/staff/{id}/context/ — the context pane (person, order, business,
    subscription, account manager, earlier conversations). Read-only."""

    def get(self, request, pk):
        conversation = get_object_or_404(
            Conversation.objects.select_related(
                "customer", "business_owner__profile", "business_owner__account_manager__role", "about_business__profile",
                "about_business__account_manager__role", "about_listing", "about_order",
            ).prefetch_related("tags"),
            pk=pk,
        )
        return Response(context_pane.build(conversation))


class StaffConversationTeamView(DeskView):
    """GET /api/messaging/staff/team/ — who can be assigned or mentioned, each agent's room
    (open of capacity, signed in, Away, leave) and the caller's own Away state. Read-only."""

    def get(self, request):
        desk_rules = services.current_settings()
        state = SupportAgentState.objects.filter(staff=request.user).first()
        now = timezone.now()
        return Response({
            "me": {"id": request.user.pk, "away": services._away(state, now), "away_until": state.away_until if state else None},
            "agents": services.capacity_board(now, rotation_only=False),
            "capacity": desk_rules.capacity_per_agent, "round_robin": desk_rules.round_robin,
        })


# ---- writing the thread ----------------------------------------------------

class StaffConversationReplyView(DeskView):
    """POST /api/messaging/staff/{id}/reply/ — a public reply as AshantiHub Support.
    Stamps the first reply, takes an unassigned thread for the replier."""

    def post(self, request, pk):
        serializer = MessageCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            conversation = _locked(pk)
            if conversation.status == Conversation.CLOSED:
                return _conflict("conversation_closed", "This conversation is resolved. Reopen it to reply.")
            message = Message.objects.create(
                conversation=conversation, sender_type=Message.STAFF, body=serializer.validated_data["body"], author=request.user,
            )
            if conversation.first_reply_at is None:
                conversation.first_reply_at = message.created_at
            conversation.save()
            services.staff_take_if_unassigned(conversation, request.user, event=False)
        if conversation.customer_id:
            notify_customer(
                conversation.customer, "support_reply", "AshantiHub Support replied",
                body="You have a new reply from AshantiHub Support.", link="/my-account", icon="💬",
            )
        elif conversation.business_owner_id:
            notify_business_owner(
                conversation.business_owner, "support_reply", "AshantiHub Support replied",
                body="You have a new reply from AshantiHub Support.", link="/business-dashboard", icon="💬",
            )
        return Response(MessageSerializer(message).data, status=201)


class NoteSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=4000)
    mentions = serializers.ListField(child=serializers.IntegerField(), required=False, default=list, max_length=10)


class StaffConversationNoteView(DeskView):
    """POST /api/messaging/staff/{id}/note/ — an internal note. Never visible to the customer,
    owner or guest. `mentions` (staff ids) notify teammates who can open the inbox."""

    def post(self, request, pk):
        serializer = NoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            conversation = _locked(pk)
            note = Message.objects.create(
                conversation=conversation, sender_type=Message.STAFF, kind=Message.NOTE, body=data["body"], author=request.user,
            )
            eligible = {s.pk: s for s in services.desk_staff().filter(pk__in=data["mentions"], is_suspended=False)}
            notified = []
            for staff_id in dict.fromkeys(data["mentions"]):
                person = eligible.get(staff_id)
                if person is None or person.pk == request.user.pk:
                    continue
                notify_staff(
                    person, "mention", f"{request.user.full_name} mentioned you in a note",
                    body=f"Conversation #{conversation.pk} ({_label(conversation)}): {data['body'][:140]}", link=CONTEXT_LINK, icon="📌",
                )
                notified.append({"id": person.pk, "name": person.full_name})
            ignored = [i for i in dict.fromkeys(data["mentions"]) if i not in eligible and i != request.user.pk]
        return Response({"message": StaffMessageSerializer(note).data, "notified": notified, "not_notified": ignored}, status=201)


class AssignSerializer(serializers.Serializer):
    assignee = serializers.IntegerField(allow_null=True)
    override = serializers.BooleanField(required=False, default=False)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=150, default="")


def _capacity_error(target, rules):
    return _conflict("at_capacity", f"{target.full_name} already has {rules.capacity_per_agent} open conversations, the limit.")


def _assign_one(request, conversation, target, rules, loads, override):
    """Move one locked conversation to `target` (a StaffUser) if they have room.
    Returns an error Response or None. `loads` is the running open count per agent."""
    if conversation.assignee_id == target.pk:
        return None
    room = loads.get(target.pk, 0) < rules.capacity_per_agent
    if not room and not (override and "support.limits" in request.user.effective_permission_codenames()):
        return _capacity_error(target, rules)
    before = conversation.assignee.full_name if conversation.assignee_id else None
    awake = not services.is_snoozed(conversation)
    conversation.assignee = target
    conversation.unassigned_reason = ""
    conversation.save(update_fields=["assignee", "unassigned_reason", "updated_at"])
    services.add_event(conversation, f"Assigned to {target.full_name} by {request.user.full_name}" + (f" (was {before})." if before else "."))
    if awake:
        loads[target.pk] = loads.get(target.pk, 0) + 1
    if target.pk != request.user.pk:
        notify_staff(
            target, "assignment", "A conversation was assigned to you",
            body=f"Conversation #{conversation.pk} ({_label(conversation)}) by {request.user.full_name}.", link="support-mine", icon="🙋",
        )
    return None


class StaffConversationAssignView(DeskView):
    """POST /api/messaging/staff/{id}/assign/ {assignee: id|null} — assign to a teammate, or
    null to hand it back to Unassigned. A teammate at the capacity limit is refused (409
    at_capacity) unless the caller holds support.limits and sends override."""

    def post(self, request, pk):
        serializer = AssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            conversation = _locked(pk)
            if conversation.status == Conversation.CLOSED:
                return _conflict("conversation_closed", "This conversation is resolved. Reopen it first.")
            before = conversation.assignee.full_name if conversation.assignee_id else None
            if data["assignee"] is None:
                if conversation.assignee_id is not None:
                    conversation.assignee = None
                    conversation.unassigned_reason = (data["reason"] or f"Handed back by {request.user.full_name}.")[:200]
                    conversation.save(update_fields=["assignee", "unassigned_reason", "updated_at"])
                    services.add_event(conversation, f"{request.user.full_name} handed this back to Unassigned.")
            else:
                target = services.desk_staff().filter(pk=data["assignee"], is_suspended=False).first()
                if target is None:
                    return _conflict("not_eligible", "That person cannot take Support conversations.", 400)
                rules = SupportSettings.load()
                SupportSettings.objects.select_for_update().get(pk=1)  # one assignment at a time
                error = _assign_one(request, conversation, target, rules, services.open_loads(), data["override"])
                if error is not None:
                    return error
            after = conversation.assignee.full_name if conversation.assignee_id else None
            _record(request, "support.conversation_assigned", conversation, f"Assigned: {before or 'nobody'} to {after or 'nobody'}.",
                    before={"assignee": before}, after={"assignee": after})
        return Response(_fresh(pk))


class BulkAssignSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(), min_length=1, max_length=MAX_BULK)
    assignee = serializers.IntegerField()
    override = serializers.BooleanField(required=False, default=False)


class StaffConversationBulkAssignView(DeskView):
    """POST /api/messaging/staff/assign/ {ids, assignee} — assign several open conversations to one
    teammate. All or nothing: if the teammate has not got room for all of them, nothing moves (409
    at_capacity, with how many places are free). Resolved conversations are skipped."""

    def post(self, request):
        serializer = BulkAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            rows = list(Conversation.objects.select_for_update().filter(pk__in=data["ids"], status=Conversation.OPEN).order_by("pk"))
            target = services.desk_staff().filter(pk=data["assignee"], is_suspended=False).first()
            if target is None:
                return _conflict("not_eligible", "That person cannot take Support conversations.", 400)
            rules = SupportSettings.load()
            SupportSettings.objects.select_for_update().get(pk=1)
            loads = services.open_loads()
            moving = [c for c in rows if c.assignee_id != target.pk]
            free = max(0, rules.capacity_per_agent - loads.get(target.pk, 0))
            override = data["override"] and "support.limits" in request.user.effective_permission_codenames()
            if len(moving) > free and not override:
                response = _conflict(
                    "at_capacity", f"{target.full_name} has room for {free} more, not {len(moving)}. Nothing was assigned.")
                response.data["free"] = free
                return response
            for conversation in moving:
                _assign_one(request, conversation, target, rules, loads, True)
            skipped = sorted(set(data["ids"]) - {c.pk for c in rows})
            if moving:
                record(
                    request.user, "support.conversations_bulk_assigned", target_type="messaging.conversation",
                    target_id=",".join(str(c.pk) for c in moving)[:64], target_label=f"{len(moving)} conversations",
                    summary=f"Assigned {len(moving)} conversations to {target.full_name}.",
                    after={"assignee": target.full_name, "ids": [c.pk for c in moving]}, method=request.method, request=request,
                )
        return Response({"assigned": [c.pk for c in moving], "skipped": skipped, "assignee": {"id": target.pk, "name": target.full_name}})


class PrioritySerializer(serializers.Serializer):
    priority = serializers.ChoiceField(choices=[c[0] for c in Conversation.PRIORITY_CHOICES])


class StaffConversationPriorityView(DeskView):
    """POST /api/messaging/staff/{id}/priority/ — change the priority; the time limits are
    measured again from when the conversation arrived."""

    def post(self, request, pk):
        serializer = PrioritySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            conversation = _locked(pk)
            before = conversation.priority
            if before != serializer.validated_data["priority"]:
                conversation.priority = serializer.validated_data["priority"]
                conversation.save(update_fields=["priority", "updated_at"])
                services.stamp_clocks(conversation, start=conversation.created_at)
                services.add_event(conversation, f"{request.user.full_name} changed the priority from {before} to {conversation.priority}.")
                _record(request, "support.conversation_priority", conversation, f"Priority {before} to {conversation.priority}.",
                        before={"priority": before}, after={"priority": conversation.priority})
        return Response(_fresh(pk))


class SnoozeSerializer(serializers.Serializer):
    until = serializers.DateTimeField()


class StaffConversationSnoozeView(DeskView):
    """POST /api/messaging/staff/{id}/snooze/ {until} — hide an open thread until a time (at most
    30 days). It wakes then, or early when they reply, and the snoozer gets a task for the wake time.
    Posting again changes the time."""

    def post(self, request, pk):
        serializer = SnoozeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        until = serializer.validated_data["until"]
        now = timezone.now()
        if until <= now + datetime.timedelta(minutes=1) or until > now + MAX_SNOOZE:
            return _conflict("bad_snooze_time", "Pick a time between a minute from now and 30 days away.", 400)
        with transaction.atomic():
            conversation = _locked(pk)
            if conversation.status == Conversation.CLOSED:
                return _conflict("conversation_closed", "A resolved conversation cannot be snoozed.")
            services.cancel_snooze_task(conversation)
            conversation.snoozed_until = until
            conversation.snoozed_by = request.user
            conversation.save(update_fields=["snoozed_until", "snoozed_by", "updated_at"])
            services.staff_take_if_unassigned(conversation, request.user)
            create_task(
                request.user, f"Snoozed conversation wakes: {_label(conversation)}", until,
                notes=f"You snoozed conversation #{conversation.pk} until this time.", source=conversation,
                created_by=request.user, kind=Task.SNOOZE_WAKE,
            )
            local = timezone.localtime(until).strftime("%a %d %b %H:%M")
            services.add_event(conversation, f"{request.user.full_name} snoozed this until {local}.")
            _record(request, "support.conversation_snoozed", conversation, f"Snoozed until {local}.", after={"until": until.isoformat()})
        return Response(_fresh(pk))


class StaffConversationWakeView(DeskView):
    """POST /api/messaging/staff/{id}/wake/ — wake a snoozed thread now."""

    def post(self, request, pk):
        with transaction.atomic():
            conversation = _locked(pk)
            if not services.is_snoozed(conversation):
                return _conflict("not_snoozed", "This conversation is not snoozed.")
            services.clear_snooze(conversation, f"{request.user.full_name} woke this conversation.")
            _record(request, "support.conversation_woken", conversation, "Woke a snoozed conversation.")
        return Response(_fresh(pk))


class ResolveSerializer(serializers.Serializer):
    code = serializers.ChoiceField(choices=[c[0] for c in services.RESOLUTION_CODES])
    note = serializers.CharField(required=False, allow_blank=True, max_length=300, default="")


class StaffConversationResolveView(DeskView):
    """POST /api/messaging/staff/{id}/resolve/ {code, note} — resolve with a reason. If they reply
    within 7 days it reopens by itself; later, their message starts a new linked conversation."""

    def post(self, request, pk):
        serializer = ResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            conversation = _locked(pk)
            if conversation.status == Conversation.CLOSED:
                return _conflict("already_resolved", "This conversation is already resolved.")
            conversation.status = Conversation.CLOSED
            conversation.resolved_at = timezone.now()
            conversation.resolved_by = request.user
            conversation.resolution_code = data["code"]
            conversation.resolution_note = data["note"]
            conversation.snoozed_until = None
            conversation.snoozed_by = None
            conversation.save()
            services.cancel_snooze_task(conversation)
            label = services.RESOLUTION_LABELS[data["code"]]
            services.add_event(conversation, f"{request.user.full_name} resolved this: {label}." + (f" {data['note']}" if data["note"] else ""))
            _record(request, "support.conversation_resolved", conversation, f"Resolved: {label}.",
                    after={"code": data["code"], "note": data["note"]})
        return Response(_fresh(pk))


class StaffConversationReopenView(DeskView):
    """POST /api/messaging/staff/{id}/reopen/ — put a resolved conversation back to work."""

    def post(self, request, pk):
        with transaction.atomic():
            conversation = _locked(pk)
            if conversation.status != Conversation.CLOSED:
                return _conflict("not_resolved", "This conversation is not resolved.")
            conversation.status = Conversation.OPEN
            conversation.resolved_at = None
            conversation.resolved_by = None
            conversation.resolution_code = ""
            conversation.resolution_note = ""
            if conversation.assignee_id is None:
                conversation.assignee = request.user
                conversation.unassigned_reason = ""
            conversation.save()
            services.stamp_clocks(conversation, start=timezone.now())
            services.add_event(conversation, f"{request.user.full_name} reopened this conversation.")
            _record(request, "support.conversation_reopened", conversation, "Reopened a resolved conversation.")
        return Response(_fresh(pk))


class TagsSerializer(serializers.Serializer):
    tags = serializers.ListField(child=serializers.IntegerField(), max_length=20)


class StaffConversationTagsView(DeskView):
    """POST /api/messaging/staff/{id}/tags/ {tags: [tag ids]} — set the thread's tags. Archived tags
    already on it stay; only live tags can be added."""

    def post(self, request, pk):
        serializer = TagsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            conversation = _locked(pk)
            wanted = set(ConversationTag.objects.filter(pk__in=serializer.validated_data["tags"], archived_at__isnull=True).values_list("pk", flat=True))
            kept = set(conversation.tags.filter(archived_at__isnull=False).values_list("pk", flat=True))
            before = sorted(conversation.tags.values_list("name", flat=True))
            conversation.tags.set(wanted | kept)
            conversation.save(update_fields=["updated_at"])
            after = sorted(conversation.tags.values_list("name", flat=True))
            if before != after:
                _record(request, "support.conversation_tagged", conversation, "Changed tags.", before={"tags": before}, after={"tags": after})
        return Response({"tags": [{"id": t.pk, "name": t.name} for t in conversation.tags.all()]})


# ---- hand-offs -------------------------------------------------------------

class LoopInSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=500, default="")


class StaffConversationLoopInView(DeskView):
    """POST /api/messaging/staff/{id}/loop-in/ {note} — ask the business's account manager to help on
    a business-owner conversation. They get a task and a bell notice carrying the OWNER's own latest
    question and your note to them. They do not get the thread, and internal notes never leave it."""

    def post(self, request, pk):
        serializer = LoopInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            conversation = _locked(pk)
            if not conversation.business_owner_id:
                return _conflict("not_owner_thread", "Only a conversation with a business owner can loop in an account manager.", 400)
            owner = conversation.business_owner
            manager = owner.account_manager
            if manager is None or not manager.is_active or manager.is_suspended:
                return _conflict("no_account_manager", "This business has no working account manager.")
            if Task.objects.filter(kind=Task.HANDOVER, source_type=services.SNOOZE_SOURCE, source_id=str(conversation.pk), status=Task.OPEN).exists():
                return _conflict("already_looped", "An account manager is already looped in on this conversation.")
            question = context_pane.last_owner_question(conversation)
            notes = f"{owner.display_name} wrote to Support:\n\"{question[:600]}\"" if question else f"{owner.display_name} wrote to Support."
            if serializer.validated_data["note"]:
                notes += f"\n\nFrom {request.user.full_name} in Support: {serializer.validated_data['note']}"
            create_task(
                manager, f"Help {owner.display_name} with their Support question", timezone.now() + datetime.timedelta(days=1),
                notes=notes, source=conversation, created_by=request.user, kind=Task.HANDOVER, business=owner,
            )
            notify_staff(
                manager, "support_handover", f"Support asks you to help {owner.display_name}",
                body=notes[:400], link="tasks", icon="🤝",
            )
            services.add_event(conversation, f"{request.user.full_name} looped in {manager.full_name} (account manager). They got a task, not this thread.")
            _record(request, "support.conversation_loop_in", conversation, f"Looped in {manager.full_name}.", after={"manager": manager.full_name})
        return Response({"looped_in": {"id": manager.pk, "name": manager.full_name}, "thread": _fresh(pk)})


class AskAccountingSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=500, default="")


class StaffConversationAskAccountingView(DeskView):
    """POST /api/messaging/staff/{id}/ask-accounting/ {note} — a bell notice to everyone who holds the
    Accounting transaction duties. Accounting has no inbox of its own yet, so this says exactly that:
    how many people were told, and none if nobody holds the duty."""

    def post(self, request, pk):
        serializer = AskAccountingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            conversation = _locked(pk)
            note = serializer.validated_data["note"]
            created = notify_staff_role(
                "transactions.report", "support_question", "Support asks Accounting to trace a payment",
                body=f"{request.user.full_name} (Support) asks about a payment for {_label(conversation)}, conversation #{conversation.pk}." + (f" {note}" if note else ""),
                link="activity", icon="🧾",
            )
            services.add_event(conversation, f"{request.user.full_name} asked Accounting to trace a payment ({len(created)} told).")
            _record(request, "support.conversation_ask_accounting", conversation, "Asked Accounting to trace a payment.", after={"notified": len(created)})
        copy = (
            f"Accounting was told ({len(created)} {'person' if len(created) == 1 else 'people'}). They see it in their notices; there is no shared Accounting queue yet."
            if created else "Nobody holds Accounting duties yet, so nobody was told. Log a call or ask your lead."
        )
        return Response({"notified": len(created), "message": copy})


class EscalateSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=500)


def escalation_targets(conversation, actor):
    """Who an escalation goes to: the manager of whoever owns the conversation, else the
    caller's manager, else every Super Admin."""
    owner = conversation.assignee or actor
    for person in (owner, actor):
        manager = person.manager
        if manager is not None and manager.is_active and not manager.is_suspended:
            return [manager]
    return list(StaffUser.objects.filter(role__name=Role.SUPER_ADMIN, is_active=True, is_suspended=False, invite_token__isnull=True))


class StaffConversationEscalateView(DeskView):
    """POST /api/messaging/staff/{id}/escalate/ {message} — a task (escalation follow-up) and a bell
    notice for the owner's manager, else the Super Admin. The conversation's owner does not change."""

    def post(self, request, pk):
        serializer = EscalateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        text = serializer.validated_data["message"]
        with transaction.atomic():
            conversation = _locked(pk)
            targets = escalation_targets(conversation, request.user)
            if not targets:
                return _conflict("nobody_to_escalate_to", "There is no manager or Super Admin to escalate to.")
            for person in targets:
                create_task(
                    person, f"Escalation: {_label(conversation)} (conversation #{conversation.pk})",
                    timezone.now() + datetime.timedelta(hours=4),
                    notes=f"{request.user.full_name} (Support) escalated this: {text}", source=conversation,
                    created_by=request.user, kind=Task.ESCALATION_FOLLOW_UP,
                )
                notify_staff(
                    person, "support_escalation", f"Support escalated a conversation: {_label(conversation)}",
                    body=f"{request.user.full_name}: {text[:300]}", link="tasks", icon="⏰",
                )
            names = ", ".join(p.full_name for p in targets)
            services.add_event(conversation, f"{request.user.full_name} escalated this to {names}: {text}")
            _record(request, "support.conversation_escalated", conversation, f"Escalated to {names}.", after={"to": [p.pk for p in targets]})
        return Response({"escalated_to": [{"id": p.pk, "name": p.full_name} for p in targets], "thread": _fresh(pk)})


# ---- the agent and the desk rules ------------------------------------------

class AwaySerializer(serializers.Serializer):
    away = serializers.BooleanField()
    until = serializers.DateTimeField(required=False, allow_null=True, default=None)


class StaffConversationAwayView(DeskView):
    """POST /api/messaging/staff/me/away/ {away, until?} — stop (or resume) getting new conversations
    from round-robin. Conversations you already have stay yours."""

    def post(self, request):
        serializer = AwaySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        until = data["until"] if data["away"] else None
        if until is not None and until <= timezone.now():
            return _conflict("bad_time", "Pick a time in the future.", 400)
        with transaction.atomic():
            state, _ = SupportAgentState.objects.select_for_update().get_or_create(staff=request.user)
            state.away = data["away"]
            state.away_until = until
            state.save()
            record(
                request.user, "support.agent_away" if data["away"] else "support.agent_back", target=request.user,
                summary="Marked Away." if data["away"] else "Back on the desk.", method=request.method, request=request,
            )
        return Response({"away": state.away, "away_until": state.away_until})


def _limits_payload(rules):
    return {
        "first_reply_minutes": rules.first_reply_minutes, "resolve_minutes": rules.resolve_minutes, "open_days": rules.open_days,
        "opens_at": rules.opens_at.strftime("%H:%M"), "closes_at": rules.closes_at.strftime("%H:%M"),
        "capacity_per_agent": rules.capacity_per_agent, "round_robin": rules.round_robin,
        "updated_by": rules.updated_by.full_name if rules.updated_by_id else None,
        "updated_at": rules.updated_at if rules.pk and rules.updated_by_id else None,
    }


class LimitsSerializer(serializers.Serializer):
    first_reply_minutes = serializers.DictField(child=serializers.IntegerField(min_value=1, max_value=60 * 24 * 30), required=False)
    resolve_minutes = serializers.DictField(child=serializers.IntegerField(min_value=1, max_value=60 * 24 * 30), required=False)
    open_days = serializers.ListField(child=serializers.IntegerField(min_value=0, max_value=6), required=False, min_length=1, max_length=7)
    opens_at = serializers.TimeField(required=False)
    closes_at = serializers.TimeField(required=False)
    capacity_per_agent = serializers.IntegerField(min_value=1, max_value=50, required=False)
    round_robin = serializers.BooleanField(required=False)

    def validate(self, attrs):
        for key in ("first_reply_minutes", "resolve_minutes"):
            if key in attrs and set(attrs[key]) != {"high", "medium", "low"}:
                raise serializers.ValidationError({key: "Give a limit for high, medium and low."})
        return attrs


class StaffConversationLimitsView(APIView):
    """GET/PATCH /api/messaging/staff/limits/ — the time limits, business hours, capacity and
    round-robin (SupportSettings). Reading is for the whole desk; changing is support.limits only
    (Operations, Super Admin) and activity-logged. New limits apply to new conversations and to
    priority changes, not to conversations already open."""

    def get_permissions(self):
        if self.request.method == "GET":
            return [HasAnyRolePermission("messaging.manage", "support.limits")]
        return [HasRolePermission("support.limits")]

    def get(self, request):
        return Response(_limits_payload(services.current_settings()))

    def patch(self, request):
        serializer = LimitsSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            SupportSettings.load()
            rules = SupportSettings.objects.select_for_update().get(pk=1)
            opens, closes = data.get("opens_at", rules.opens_at), data.get("closes_at", rules.closes_at)
            if closes <= opens:
                return _conflict("bad_hours", "Closing time must be after opening time.", 400)
            before = _limits_payload(rules)
            for field, value in data.items():
                setattr(rules, field, sorted(set(value)) if field == "open_days" else value)
            rules.updated_by = request.user
            rules.save()
            after = _limits_payload(rules)
            record(
                request.user, "support.limits_changed", target_type="messaging.supportsettings", target_id="1",
                target_label="Support time limits and capacity", summary="Changed Support's limits, hours or capacity.",
                before={k: v for k, v in before.items() if k not in ("updated_at", "updated_by")},
                after={k: v for k, v in after.items() if k not in ("updated_at", "updated_by")}, method=request.method, request=request,
            )
        return Response(after)
