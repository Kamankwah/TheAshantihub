import django.db.models.deletion
from django.db import migrations, models

PERMISSION = ("announcements.send", "Send staff announcements (notices to staff only)")


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    permission, _ = Permission.objects.get_or_create(codename=PERMISSION[0], defaults={"description": PERMISSION[1]})
    for role in Role.objects.filter(name="super_admin"):
        role.permissions.add(permission)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename=PERMISSION[0]).delete()


class Migration(migrations.Migration):
    initial = True
    dependencies = [("accounts", "0044_seed_cosigner_role")]

    operations = [
        migrations.CreateModel(
            name="Announcement",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=150)),
                ("body", models.TextField(max_length=2000)),
                ("roles", models.JSONField(blank=True, default=list)),
                ("require_confirm", models.BooleanField(default=False)),
                ("send_email", models.BooleanField(default=False)),
                ("status", models.CharField(choices=[("draft", "Draft"), ("scheduled", "Scheduled"), ("sent", "Sent"), ("cancelled", "Cancelled")], default="draft", max_length=10)),
                ("send_at", models.DateTimeField(blank=True, null=True)),
                ("sent_at", models.DateTimeField(blank=True, null=True)),
                ("recipient_count", models.PositiveIntegerField(default=0)),
                ("emailed_count", models.PositiveIntegerField(default=0)),
                ("last_reminded_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="accounts.staffuser")),
                ("team_manager", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="accounts.staffuser")),
            ],
            options={"ordering": ["-id"]},
        ),
        migrations.CreateModel(
            name="AnnouncementReceipt",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("opened_at", models.DateTimeField(blank=True, null=True)),
                ("confirmed_at", models.DateTimeField(blank=True, null=True)),
                ("announcement", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="receipts", to="announcements.announcement")),
                ("staff", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="+", to="accounts.staffuser")),
            ],
        ),
        migrations.AddIndex(model_name="announcement", index=models.Index(fields=["status", "send_at"], name="announcemen_status_cf09ca_idx")),
        migrations.AddConstraint(model_name="announcementreceipt", constraint=models.UniqueConstraint(fields=("announcement", "staff"), name="one_receipt_per_person")),
        migrations.RunPython(seed, unseed),
    ]
