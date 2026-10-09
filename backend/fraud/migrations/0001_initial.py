import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("accounts", "0040_business_identity_and_portfolio_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="FraudFlag",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("kind", models.CharField(choices=[
                    ("duplicate", "Duplicate registration"),
                    ("similar_nearby", "Similar business nearby"),
                    ("self_dealing", "Self-dealing"),
                    ("owner_objected", "Owner said “This wasn't me”"),
                    ("outside_radius", "Repeated outside-radius check-ins"),
                    ("fake_business", "Fake business"),
                    ("other", "Other"),
                ], max_length=30)),
                ("status", models.CharField(
                    choices=[("open", "Open"), ("confirmed", "Confirmed"), ("dismissed", "Dismissed")],
                    default="open", max_length=12,
                )),
                ("source", models.CharField(
                    choices=[("system", "The system"), ("staff", "Staff"), ("owner", "The owner")], max_length=10,
                )),
                ("title", models.CharField(max_length=200)),
                ("detail", models.TextField(blank=True, default="")),
                ("evidence", models.JSONField(blank=True, default=list)),
                ("dedupe_key", models.CharField(blank=True, default="", max_length=120)),
                ("resolved_at", models.DateTimeField(blank=True, null=True)),
                ("resolution_note", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("business_owner", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="fraud_flags", to="accounts.businessowner",
                )),
                ("related_business_owner", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="+", to="accounts.businessowner",
                )),
                ("staff_subject", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="fraud_flags_about", to="accounts.staffuser",
                )),
                ("raised_by", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="fraud_flags_raised", to="accounts.staffuser",
                )),
                ("resolved_by", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="+", to="accounts.staffuser",
                )),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [models.Index(fields=["status", "-created_at"], name="fraud_flag_status_idx")],
                "constraints": [
                    models.UniqueConstraint(
                        condition=models.Q(status="open") & ~models.Q(dedupe_key=""),
                        fields=("dedupe_key",),
                        name="one_open_fraud_flag_per_key",
                    ),
                ],
            },
        ),
    ]
