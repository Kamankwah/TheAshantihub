from django.db import migrations

KIND_BY_SOURCE = {
    "billing.subscription": "subscription_overdue",
    "calls.calllog": "call_follow_up",
    "field.prospect": "prospect_follow_up",
}


def backfill(apps, schema_editor):
    Task = apps.get_model("staff_tasks", "Task")
    BusinessOwner = apps.get_model("accounts", "BusinessOwner")
    Subscription = apps.get_model("billing", "Subscription")
    CallLog = apps.get_model("calls", "CallLog")
    live = set(BusinessOwner.objects.values_list("pk", flat=True))
    for task in Task.objects.exclude(source_type="").iterator():
        kind, business_id = None, None
        if task.source_type in KIND_BY_SOURCE:
            kind = KIND_BY_SOURCE[task.source_type]
        if task.source_type == "billing.subscription" and task.source_id.isdigit():
            business_id = Subscription.objects.filter(pk=task.source_id).values_list("business_owner_id", flat=True).first()
        elif task.source_type == "calls.calllog" and task.source_id.isdigit():
            call = CallLog.objects.filter(pk=task.source_id).first()
            if call is not None and call.related_type == "business_owner" and call.related_id.isdigit():
                business_id = int(call.related_id)
        elif task.source_type == "accounts.businessowner" and task.source_id.isdigit():
            # A follow-up set from a business page: from a lead when someone else made it.
            business_id = int(task.source_id)
            kind = "ops_follow_up" if task.created_by_id not in (None, task.owner_id) else "manual"
        if kind is None and business_id is None:
            continue
        if kind:
            task.kind = kind
        task.business_owner_id = business_id if business_id in live else None
        task.save(update_fields=["kind", "business_owner"])


class Migration(migrations.Migration):

    dependencies = [
        ("staff_tasks", "0002_task_kind_business_owner"),
        ("accounts", "0041_owner_claim_and_consent"),
        ("billing", "0018_subscription_overdue_clock"),
        ("calls", "0002_alter_calllog_counterpart_type"),
    ]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
