import datetime as dt

from django.utils import timezone
from rest_framework import serializers

from accounts.models import BusinessOwner, Customer
from accounts.serializers import mask_but_last
from staff_tasks.models import Task
from staff_tasks.services import create_task

from .models import CallLog, purposes_for

FUTURE_TOLERANCE = dt.timedelta(minutes=5)
NOT_FOUND = "We couldn't find that record."
NOT_ALLOWED_TO_LOOK_UP = "You can't look up customers or businesses to log a call."
NOT_YOUR_BUSINESS = "That business isn't in your portfolio."
NOT_YOUR_PROSPECT = "That prospect isn't on your list."
PROSPECT_REGISTERED = "That prospect is registered now. Log the call on the business."


def _masked(phone):
    from field.prospects import masked_phone

    return masked_phone(phone)


def _conversation_model():
    from messaging.models import Conversation

    return Conversation


def _order_model():
    from orders.models import Order

    return Order


RELATED_PERMISSION = {"messaging.conversation": "messaging.manage", "orders.order": "orders.support_update"}
RELATED_MODELS = {"messaging.conversation": _conversation_model, "orders.order": _order_model}


class CallLogSerializer(serializers.ModelSerializer):
    staff_name = serializers.CharField(source="staff.full_name", read_only=True)
    # Optional: the scout sheet never sends it, and the server stamps now minus the duration.
    started_at = serializers.DateTimeField(required=False)

    class Meta:
        model = CallLog
        fields = [
            "id", "staff", "staff_name", "direction", "channel", "counterpart_type", "counterpart_id",
            "counterpart_name", "counterpart_phone", "related_type", "related_id", "related_label",
            "purpose", "outcome", "sentiment", "notes", "started_at", "duration_seconds",
            "follow_up_at", "follow_up_task", "created_at", "updated_at",
        ]
        read_only_fields = ["staff", "follow_up_task", "created_at", "updated_at"]

    def _viewer(self):
        return self.context["request"].user

    def validate_purpose(self, value):
        allowed = {code for code, _ in purposes_for(self._viewer().role.name)}
        if value not in allowed:
            raise serializers.ValidationError("That purpose isn't available for your role.")
        return value

    def validate_started_at(self, value):
        if value > timezone.now() + FUTURE_TOLERANCE:
            raise serializers.ValidationError("A call can't start in the future.")
        return value

    def validate_follow_up_at(self, value):
        if value is not None and value <= timezone.now():
            raise serializers.ValidationError("Pick a follow-up time in the future.")
        return value

    def validate(self, attrs):
        """A call about a record of ours (counterpart_id) takes its name and
        phone from that record, and the caller must be allowed to see it."""
        if self.instance is not None:
            return attrs
        self._check_related(attrs)
        kind, record_id = attrs.get("counterpart_type"), attrs.get("counterpart_id")
        perms = self._viewer().effective_permission_codenames()
        # Support looks people up across the whole platform; it never holds a full
        # number for them, so what is stored is the masked form.
        may_look_up = "calls.view_peers" in perms and "users.view" in perms
        if record_id and kind == "business_owner":
            owner = BusinessOwner.objects.select_related("profile").filter(pk=record_id).first()
            managed = owner is not None and (
                owner.account_manager_id == self._viewer().id or "portfolio.manage" in perms or "calls.view_all" in perms
            )
            if owner is None or not (managed or may_look_up):
                raise serializers.ValidationError({"counterpart_id": NOT_YOUR_BUSINESS})
            profile = getattr(owner, "profile", None)
            attrs.update(
                counterpart_name=owner.full_name,
                counterpart_phone=(owner.login_phone or "") if managed else _masked(owner.login_phone),
                related_type="business_owner", related_id=str(owner.pk),
                related_label=(getattr(profile, "business_name", "") or owner.full_name)[:200],
            )
        elif record_id and kind == "customer":
            if not may_look_up:
                raise serializers.ValidationError({"counterpart_id": NOT_ALLOWED_TO_LOOK_UP})
            customer = Customer.objects.filter(pk=record_id).first()
            if customer is None:
                raise serializers.ValidationError({"counterpart_id": NOT_FOUND})
            attrs.update(counterpart_name=customer.full_name, counterpart_phone=_masked(customer.phone))
            if not attrs.get("related_type"):
                attrs.update(related_type="customer", related_id=str(customer.pk), related_label=customer.full_name[:200])
        elif record_id and kind == "prospect":
            from field.models import Prospect

            from field.prospects import manages_prospects

            prospects = Prospect.objects.filter(pk=record_id)
            if not manages_prospects(self._viewer()):
                prospects = prospects.filter(scout=self._viewer())
            prospect = prospects.first()
            if prospect is None:
                raise serializers.ValidationError({"counterpart_id": NOT_YOUR_PROSPECT})
            if prospect.status == Prospect.REGISTERED:
                raise serializers.ValidationError({"counterpart_id": PROSPECT_REGISTERED})
            attrs.update(
                counterpart_name=prospect.name, counterpart_phone=prospect.phone,
                related_type="prospect", related_id=str(prospect.pk), related_label=prospect.name[:200],
            )
        elif kind == "prospect":
            raise serializers.ValidationError({"counterpart_id": NOT_YOUR_PROSPECT})
        return attrs

    def _check_related(self, attrs):
        """A call can be filed under a conversation or an order; the record has to
        exist (the label is filled from it when the sheet did not send one)."""
        related_type, related_id = attrs.get("related_type", ""), str(attrs.get("related_id", ""))
        if related_type not in RELATED_MODELS:
            return
        if not related_id.isdecimal():
            raise serializers.ValidationError({"related_id": "Choose the record this call is about."})
        needed = RELATED_PERMISSION[related_type]
        if needed not in self._viewer().effective_permission_codenames():
            raise serializers.ValidationError({"related_type": "You can't link a call to that kind of record."})
        record = RELATED_MODELS[related_type]().objects.filter(pk=int(related_id)).first()
        if record is None:
            raise serializers.ValidationError({"related_id": NOT_FOUND})
        # Neutral label, never a name taken from the record (and never one the client typed).
        attrs["related_label"] = f"{'Order' if related_type == 'orders.order' else 'Conversation'} #{record.pk}"

    def create(self, validated_data):
        staff = self._viewer()
        if validated_data.get("started_at") is None:
            validated_data["started_at"] = timezone.now() - dt.timedelta(seconds=validated_data.get("duration_seconds", 0))
        call = CallLog.objects.create(staff=staff, **validated_data)
        self._sync_follow_up(call)
        return call

    def update(self, instance, validated_data):
        call = super().update(instance, validated_data)
        if "follow_up_at" in validated_data:
            self._sync_follow_up(call)
        return call

    def _sync_follow_up(self, call):
        """The call's follow-up date keeps one open Task: made, moved or cancelled."""
        staff = call.staff
        task = call.follow_up_task if call.follow_up_task and call.follow_up_task.status == Task.OPEN else None
        if call.follow_up_at is None:
            if task is not None:
                task.status = Task.CANCELLED
                task.save(update_fields=["status"])
            return
        label = call.related_label or call.counterpart_name or "call"
        if task is None:
            business = BusinessOwner.objects.filter(pk=call.related_id).first() if call.related_type == "business_owner" and call.related_id.isdigit() else None
            call.follow_up_task = create_task(
                staff, f"Follow up: {label}", call.follow_up_at, source=call, created_by=staff,
                kind=Task.CALL_FOLLOW_UP, business=business,
            )
            call.save(update_fields=["follow_up_task"])
        elif task.due_at != call.follow_up_at:
            task.due_at = call.follow_up_at
            task.save(update_fields=["due_at"])

    def to_representation(self, instance):
        data = super().to_representation(instance)
        viewer = self._viewer()
        sees_full = instance.staff_id == viewer.id or "calls.view_all" in viewer.effective_permission_codenames()
        # A Support agent never sees a business owner's number in full, even on a call they logged.
        business_for_support = instance.counterpart_type == "business_owner" and viewer.role.name == "support"
        if data["counterpart_phone"] and (not sees_full or business_for_support):
            data["counterpart_phone"] = mask_but_last(data["counterpart_phone"], keep=3)
        return data
