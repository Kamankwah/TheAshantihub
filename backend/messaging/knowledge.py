"""Support knowledge: canned replies and conversation tags (staff only, all
behind messaging.manage). Kept apart from messaging/views.py (the thread
views) so the desk and the library can change independently.

Canned replies are retired, never deleted. A body may hold {placeholders}; the
composer contract (GET canned/?conversation=<id>) returns the body already
filled from real records and leaves every field it cannot resolve as the
literal "{field}" so the agent types it. Nothing is guessed."""
import datetime
import re

from django.db import IntegrityError, transaction
from django.db.models import Count, F, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission

from .models import CannedReply, Conversation, ConversationTag

PLACEHOLDERS = (
    "customer_first_name", "order_number", "business_name", "rider_first_name", "eta",
    "agent_first_name", "listing_title",
)
PLACEHOLDER_HINTS = {
    "customer_first_name": "The customer's first name",
    "order_number": "For example #1",
    "business_name": "The business the conversation is about",
    "rider_first_name": "The rider on the order",
    "eta": "Expected time, if one is set",
    "agent_first_name": "Your first name",
    "listing_title": "The listing the conversation is about",
}
_FIELD = re.compile(r"\{([A-Za-z0-9_]*)\}")
# A phone number is nine or more digits, however it is spaced or dashed.
_PHONE = re.compile(r"(?<!\w)\+?\d(?:[\s().-]{0,2}\d){8,}")
_WHATSAPP = re.compile(r"wa\.me|whatsapp\.com|api\.whatsapp", re.I)
_SHORTCUT = re.compile(r"^/[a-z0-9][a-z0-9-]{0,28}$")
_TAG_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def fields_in(body):
    return sorted(set(_FIELD.findall(body or "")))


def validate_body(value):
    unknown = [name for name in fields_in(value) if name not in PLACEHOLDERS]
    if unknown:
        raise ValidationError("Unknown field {%s}. Use the Insert a field buttons." % unknown[0])
    if _PHONE.search(value) or _WHATSAPP.search(value):
        raise ValidationError("A canned reply cannot hold a phone number or a WhatsApp link.")
    return value


def _first_name(full_name):
    parts = (full_name or "").split()
    return parts[0] if parts else None


def context_values(conversation, agent):
    """{field: value or None} from the records the conversation points at. None
    means no real value exists (rider and ETA only resolve with real data; there
    is no ETA field anywhere, so it always stays unresolved)."""
    values = dict.fromkeys(PLACEHOLDERS)
    values["agent_first_name"] = _first_name(getattr(agent, "full_name", ""))
    if conversation is None:
        return values
    person = conversation.customer or conversation.business_owner
    if person is not None:
        values["customer_first_name"] = _first_name(person.full_name)
    order = conversation.about_order
    if order is not None:
        values["order_number"] = f"#{order.pk}"
        try:
            assignment = order.delivery_assignment
        except Exception:
            assignment = None
        if assignment is not None and assignment.dispatch_id:
            values["rider_first_name"] = _first_name(assignment.dispatch.full_name)
    business = conversation.about_business
    if business is None and conversation.about_listing_id:
        business = conversation.about_listing.business_owner
    if business is None and conversation.business_owner_id:
        business = conversation.business_owner
    if business is not None:
        values["business_name"] = business.display_name or None
    if conversation.about_listing_id:
        values["listing_title"] = conversation.about_listing.name or None
    return values


def fill(body, values):
    """(text, unresolved): known fields replaced, the rest left as "{field}"."""
    unresolved = []

    def replace(match):
        name = match.group(1)
        value = values.get(name)
        if value:
            return value
        if name not in unresolved:
            unresolved.append(name)
        return match.group(0)

    return _FIELD.sub(replace, body), unresolved


def _audiences_for(conversation):
    if conversation.customer_id:
        return [CannedReply.ANYONE, CannedReply.CUSTOMERS]
    if conversation.business_owner_id:
        return [CannedReply.ANYONE, CannedReply.OWNERS]
    return [CannedReply.ANYONE]


def _conversation_or_404(pk):
    if not str(pk).isdigit() or int(pk) > 2**31 - 1:
        raise ValidationError({"conversation": "Not a conversation."})
    return get_object_or_404(
        Conversation.objects.select_related("customer", "business_owner", "about_business", "about_listing", "about_order"),
        pk=int(pk),
    )


class CannedReplySerializer(serializers.ModelSerializer):
    is_default = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()
    fields_used = serializers.SerializerMethodField()

    class Meta:
        model = CannedReply
        fields = [
            "id", "title", "shortcut", "body", "audience", "uses", "is_default", "created_by_name",
            "updated_by_name", "created_at", "updated_at", "retired_at", "fields_used",
        ]
        read_only_fields = ["id", "uses", "created_at", "updated_at", "retired_at"]

    def get_is_default(self, obj):
        return obj.created_by_id is None

    def get_created_by_name(self, obj):
        return obj.created_by.full_name if obj.created_by_id else "AshantiHub default"

    def get_updated_by_name(self, obj):
        return obj.updated_by.full_name if obj.updated_by_id else None

    def get_fields_used(self, obj):
        return fields_in(obj.body)

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise ValidationError("Give the reply a title.")
        return value

    def validate_shortcut(self, value):
        value = (value or "").strip().lower()
        if value and not value.startswith("/"):
            value = "/" + value
        if not _SHORTCUT.match(value):
            raise ValidationError("A shortcut starts with / then lower-case letters, numbers or dashes, for example /late.")
        taken = CannedReply.objects.filter(shortcut=value)
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise ValidationError("That shortcut is already used by another canned reply (it may be retired).")
        return value

    def validate_body(self, value):
        value = value.strip()
        if not value:
            raise ValidationError("Write the message.")
        return validate_body(value)


class _Staff(APIView):
    def get_permissions(self):
        return [HasRolePermission("messaging.manage")]


class StaffCannedListView(_Staff):
    """GET canned/ — the library (title, shortcut, body, audience, uses...),
    ?status=active|retired|all (default active). With ?conversation=<id> it is
    instead the composer's contract: only the active replies meant for that
    thread's audience, as [{id, title, shortcut, body, audience}] with the body
    filled from the thread's real records. POST creates a reply."""

    def get(self, request):
        conversation_id = request.query_params.get("conversation")
        if conversation_id is not None:
            conversation = _conversation_or_404(conversation_id)
            values = context_values(conversation, request.user)
            replies = CannedReply.objects.filter(
                retired_at__isnull=True, audience__in=_audiences_for(conversation)
            ).order_by("-uses", "title")
            return Response([
                {
                    "id": r.pk, "title": r.title, "shortcut": r.shortcut, "body": fill(r.body, values)[0],
                    "audience": r.audience,
                }
                for r in replies
            ])
        wanted = request.query_params.get("status", "active")
        replies = CannedReply.objects.select_related("created_by", "updated_by")
        if wanted == "retired":
            replies = replies.filter(retired_at__isnull=False)
        elif wanted != "all":
            replies = replies.filter(retired_at__isnull=True)
        return Response(CannedReplySerializer(replies.order_by("-uses", "title"), many=True).data)

    def post(self, request):
        serializer = CannedReplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            reply = serializer.save(created_by=request.user, updated_by=request.user)
        except IntegrityError:
            raise ValidationError({"shortcut": "That shortcut is already used by another canned reply."})
        return Response(CannedReplySerializer(reply).data, status=201)


class StaffCannedDetailView(_Staff):
    """PATCH canned/<id>/ — edit a reply. There is no delete: retire it."""

    def patch(self, request, pk):
        with transaction.atomic():
            reply = get_object_or_404(CannedReply.objects.select_for_update(), pk=pk)
            serializer = CannedReplySerializer(reply, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            reply = serializer.save(updated_by=request.user)
        return Response(CannedReplySerializer(reply).data)


class _RetireView(_Staff):
    retire = True

    def post(self, request, pk):
        with transaction.atomic():
            reply = get_object_or_404(CannedReply.objects.select_for_update(), pk=pk)
            reply.retired_at = timezone.now() if self.retire else None
            reply.updated_by = request.user
            reply.save(update_fields=["retired_at", "updated_by", "updated_at"])
        return Response(CannedReplySerializer(reply).data)


class StaffCannedRetireView(_RetireView):
    retire = True


class StaffCannedRestoreView(_RetireView):
    retire = False


class StaffCannedUseView(_Staff):
    """POST canned/<id>/use/ — the composer calls this when an agent sends a
    message built from a reply. Bumps the uses counter only. Not written to the
    activity log: it is a counter, and the sent message is its own record."""

    activity_exempt = True

    def post(self, request, pk):
        updated = CannedReply.objects.filter(pk=pk, retired_at__isnull=True).update(uses=F("uses") + 1)
        if not updated:
            get_object_or_404(CannedReply, pk=pk)  # 404 for an unknown id
            raise ValidationError({"detail": "That canned reply is retired."})
        return Response({"id": int(pk), "uses": CannedReply.objects.values_list("uses", flat=True).get(pk=pk)})


class StaffCannedPreviewView(_Staff):
    """POST canned/preview/ {body, conversation?} — the body filled from a real
    conversation, with the fields that have no value listed as unresolved."""

    activity_exempt = True

    def post(self, request):
        body = request.data.get("body", "")
        if not isinstance(body, str) or not body.strip():
            raise ValidationError({"body": "Write the message to preview."})
        validate_body(body)
        conversation = _conversation_or_404(request.data["conversation"]) if request.data.get("conversation") else None
        values = context_values(conversation, request.user)
        text, unresolved = fill(body, values)
        return Response({"text": text, "unresolved": unresolved, "values": values})


class StaffCannedFieldsView(_Staff):
    """GET canned/fields/ — the field chips for the editor."""

    def get(self, request):
        return Response([{"name": n, "code": "{%s}" % n, "hint": PLACEHOLDER_HINTS[n]} for n in PLACEHOLDERS])


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------
def _tag_counts():
    month_ago = timezone.now() - datetime.timedelta(days=30)
    return ConversationTag.objects.annotate(
        open_now=Count("conversations", filter=Q(conversations__status=Conversation.OPEN), distinct=True),
        last_30_days=Count("conversations", filter=Q(conversations__created_at__gte=month_ago), distinct=True),
    )


class TagSerializer(serializers.ModelSerializer):
    open_now = serializers.IntegerField(read_only=True, default=0)
    last_30_days = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = ConversationTag
        fields = ["id", "name", "description", "archived_at", "created_at", "open_now", "last_30_days"]
        read_only_fields = ["id", "archived_at", "created_at"]
        extra_kwargs = {"name": {"validators": []}}

    def validate_name(self, value):
        value = (value or "").strip().lower()
        if not _TAG_NAME.match(value) or len(value) > 40:
            raise ValidationError("Lower case, words joined with a dash, up to 40 characters.")
        taken = ConversationTag.objects.filter(name=value)
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise ValidationError("There is already a tag with that name.")
        return value


def _tag_with_counts(pk):
    return _tag_counts().get(pk=pk)


class StaffTagListView(_Staff):
    """GET tags/ — in-use tags with live counts (open now; started in the last
    30 days); ?archived=1 lists the archived ones. POST adds a tag."""

    def get(self, request):
        tags = _tag_counts().filter(archived_at__isnull=request.query_params.get("archived") not in ("1", "true"))
        return Response(TagSerializer(tags.order_by("name"), many=True).data)

    def post(self, request):
        serializer = TagSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            tag = serializer.save()
        except IntegrityError:
            raise ValidationError({"name": "There is already a tag with that name."})
        return Response(TagSerializer(_tag_with_counts(tag.pk)).data, status=201)


class StaffTagDetailView(_Staff):
    """PATCH tags/<id>/ — rename and/or change the description. Past reports
    and the activity log keep the old name."""

    def patch(self, request, pk):
        with transaction.atomic():
            tag = get_object_or_404(ConversationTag.objects.select_for_update(), pk=pk)
            serializer = TagSerializer(tag, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            before = {"name": tag.name, "description": tag.description}
            tag = serializer.save()
            _record(request, "tag.renamed" if before["name"] != tag.name else "tag.updated", tag, before,
                    {"name": tag.name, "description": tag.description})
        return Response(TagSerializer(_tag_with_counts(tag.pk)).data)


def _record(request, verb, tag, before, after):
    from activity import services as activity

    activity.record(
        request.user, f"support.{verb}", target=tag, method=request.method, summary=verb.replace(".", " "),
        before=before, after=after, request=request,
    )


class _ArchiveView(_Staff):
    archive = True

    def post(self, request, pk):
        with transaction.atomic():
            tag = get_object_or_404(ConversationTag.objects.select_for_update(), pk=pk)
            tag.archived_at = timezone.now() if self.archive else None
            tag.save(update_fields=["archived_at"])
        return Response(TagSerializer(_tag_with_counts(tag.pk)).data)


class StaffTagArchiveView(_ArchiveView):
    archive = True


class StaffTagUnarchiveView(_ArchiveView):
    archive = False


class StaffTagMergeView(_Staff):
    """POST tags/<id>/merge/ {into: <tag id>} — every conversation carrying this
    tag gets the target tag instead, then this tag is archived. The activity
    event names both tags and counts the conversations, so history keeps the
    old name."""

    def post(self, request, pk):
        into = request.data.get("into")
        if not str(into).isdigit() or int(into) > 2**31 - 1:
            raise ValidationError({"into": "Pick the tag to merge into."})
        if int(into) == int(pk):
            raise ValidationError({"into": "A tag cannot be merged into itself."})
        with transaction.atomic():
            first, second = sorted([int(pk), int(into)])
            locked = {t.pk: t for t in ConversationTag.objects.select_for_update().filter(pk__in=[first, second]).order_by("pk")}
            source, target = locked.get(int(pk)), locked.get(int(into))
            if source is None:
                get_object_or_404(ConversationTag, pk=-1)
            if target is None:
                raise ValidationError({"into": "That tag does not exist."})
            if target.archived_at is not None:
                raise ValidationError({"into": "Merge into a tag that is in use, not an archived one."})
            moved = list(source.conversations.values_list("pk", flat=True))
            through = Conversation.tags.through
            already = set(through.objects.filter(conversationtag_id=target.pk, conversation_id__in=moved).values_list("conversation_id", flat=True))
            through.objects.bulk_create(
                [through(conversation_id=c, conversationtag_id=target.pk) for c in moved if c not in already]
            )
            through.objects.filter(conversationtag_id=source.pk).delete()
            source.archived_at = timezone.now()
            source.save(update_fields=["archived_at"])
            _record(
                request, "tag.merged", source, {"name": source.name},
                {"into": target.name, "into_id": target.pk, "conversations_moved": len(moved)},
            )
        return Response({"moved": len(moved), "into": TagSerializer(_tag_with_counts(target.pk)).data})
