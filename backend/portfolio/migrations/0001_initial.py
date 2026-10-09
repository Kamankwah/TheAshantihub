import accounts.validators
import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("accounts", "0040_business_identity_and_portfolio_fields"),
        ("approvals", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="AccountManagerAssignment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("reason", models.CharField(blank=True, default="", max_length=300)),
                ("started_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("ended_at", models.DateTimeField(blank=True, null=True)),
                ("assigned_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="accounts.staffuser")),
                ("business_owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="manager_assignments", to="accounts.businessowner")),
                ("scout", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="portfolio_assignments", to="accounts.staffuser")),
            ],
            options={
                "ordering": ["-started_at"],
                "constraints": [
                    models.UniqueConstraint(
                        condition=models.Q(("ended_at__isnull", True)), fields=("business_owner",),
                        name="one_open_account_manager",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="AppliedChange",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("kind", models.CharField(max_length=40)),
                ("summary", models.CharField(max_length=200)),
                ("applied_at", models.DateTimeField()),
                ("undo_until", models.DateTimeField()),
                ("result", models.JSONField(blank=True, default=dict)),
                ("undone_at", models.DateTimeField(blank=True, null=True)),
                ("undo_failed", models.CharField(blank=True, default="", max_length=200)),
                ("fraud_flag_id", models.PositiveIntegerField(blank=True, null=True)),
                ("approval", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="applied_change", to="approvals.approvalrequest")),
                ("business_owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="applied_changes", to="accounts.businessowner")),
            ],
            options={
                "ordering": ["-applied_at"],
            },
        ),
        migrations.CreateModel(
            name="BusinessHealthSnapshot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("date", models.DateField()),
                ("rating", models.CharField(max_length=20)),
                ("reasons", models.JSONField(blank=True, default=list)),
                ("business_owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="health_snapshots", to="accounts.businessowner")),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("business_owner", "date"), name="one_health_snapshot_per_day"),
                ],
            },
        ),
        migrations.CreateModel(
            name="StagedPhoto",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("image", models.ImageField(upload_to="staged_photos/", validators=[accounts.validators.validate_image_content_type])),
                ("taken_lat", models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True)),
                ("taken_lng", models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True)),
                ("taken_accuracy_m", models.PositiveIntegerField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("used_at", models.DateTimeField(blank=True, null=True)),
                ("business_owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="staged_photos", to="accounts.businessowner")),
                ("uploaded_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="+", to="accounts.staffuser")),
            ],
        ),
    ]
