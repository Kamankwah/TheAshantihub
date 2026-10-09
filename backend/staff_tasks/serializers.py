from rest_framework import serializers

from billing.clock import GRACE_DAYS, subscription_state

from .models import Task

ORDER_SOURCE = "orders.order"
PROSPECT_SOURCE = "field.prospect"


def _subscription_states(ids):
    from billing.models import Subscription

    return {
        sub.pk: subscription_state(sub)
        for sub in Subscription.objects.filter(pk__in=ids).select_related("plan")
    }


class TaskSerializer(serializers.ModelSerializer):
    """A follow-up. `business` and `prospect` are what it is about (null when
    nothing); `order_id` is the order of a delivery problem. Nothing here
    carries a customer's identity."""

    business = serializers.SerializerMethodField()
    prospect = serializers.SerializerMethodField()
    order_id = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    overdue = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id", "title", "notes", "due_at", "status", "done_at", "kind", "business", "prospect", "order_id",
            "overdue", "created_by_name", "source_type", "source_id", "created_at",
        ]
        read_only_fields = ["status", "done_at", "kind", "source_type", "source_id", "created_at"]

    def get_business(self, task):
        owner = task.business_owner
        return {"id": owner.pk, "name": owner.display_name} if owner is not None else None

    def get_prospect(self, task):
        if task.source_type != PROSPECT_SOURCE or not task.source_id.isdigit():
            return None
        names = self.context.get("prospect_names")
        if names is None:
            from field.models import Prospect

            names = {p.pk: p.name for p in Prospect.objects.filter(pk=task.source_id)}
        name = names.get(int(task.source_id))
        return {"id": int(task.source_id), "name": name} if name else None

    def get_order_id(self, task):
        if task.source_type == ORDER_SOURCE and task.source_id.isdigit():
            return int(task.source_id)
        return None

    def get_overdue(self, task):
        """For a subscription task: how far into being overdue the business is,
        and whether the pause is switched on (so the screen never counts down
        to a hiding that is off). Null once the subscription is not overdue."""
        if task.kind != Task.SUBSCRIPTION_OVERDUE or task.source_type != "billing.subscription" or not task.source_id.isdigit():
            return None
        states = self.context.get("subscription_states")
        if states is None:
            states = _subscription_states([task.source_id])
        state = states.get(int(task.source_id))
        if not state or state["state"] not in ("overdue", "paused"):
            return None
        return {
            "day": state["overdue_day"], "pause_enabled": state["pause_enabled"], "hide_on": state["hide_on"],
            "grace_days": GRACE_DAYS,
        }

    def get_created_by_name(self, task):
        return task.created_by.full_name if task.created_by_id and task.created_by_id != task.owner_id else None
