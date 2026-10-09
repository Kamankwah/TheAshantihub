import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0041_owner_claim_and_consent"),
        ("staff_tasks", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="kind",
            field=models.CharField(
                choices=[
                    ("subscription_overdue", "Subscription overdue"), ("delivery_problem", "Delivery problem"),
                    ("returned_approval", "Returned approval"), ("call_follow_up", "Call follow-up"),
                    ("prospect_follow_up", "Prospect follow-up"), ("ops_follow_up", "Follow-up from a lead"),
                    ("manual", "Added by hand"),
                ],
                default="manual", max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="task",
            name="business_owner",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+",
                to="accounts.businessowner",
            ),
        ),
    ]
