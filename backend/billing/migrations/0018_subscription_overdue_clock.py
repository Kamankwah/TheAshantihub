from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0017_subscriptionplan_hero_slots"),
    ]

    operations = [
        migrations.AddField(
            model_name="subscription",
            name="overdue_since",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="subscription",
            name="paused_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="subscription",
            name="overdue_notice_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="subscription",
            name="reminder_day7_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="subscription",
            name="reminder_day13_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
