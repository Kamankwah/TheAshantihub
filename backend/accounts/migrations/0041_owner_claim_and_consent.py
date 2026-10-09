import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0040_business_identity_and_portfolio_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="OwnerClaimToken",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("channel", models.CharField(
                    choices=[("handover", "Hand-over on the scout's phone"), ("link", "Claim link")], max_length=10,
                )),
                ("token_hash", models.CharField(max_length=64, unique=True)),
                ("sent_to", models.CharField(blank=True, default="", max_length=254)),
                ("expires_at", models.DateTimeField()),
                ("used_at", models.DateTimeField(blank=True, null=True)),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("business_owner", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE, related_name="claim_tokens",
                    to="accounts.businessowner",
                )),
                ("created_by", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+",
                    to="accounts.staffuser",
                )),
                ("staff_session", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+",
                    to="accounts.staffsession",
                )),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="OwnerConsent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("terms_version", models.CharField(max_length=40)),
                ("accepted_at", models.DateTimeField()),
                ("channel", models.CharField(
                    choices=[
                        ("handover", "Hand-over on the scout's phone"),
                        ("link", "Claim link"),
                        ("self", "Registered online"),
                    ],
                    max_length=10,
                )),
                ("user_agent", models.CharField(blank=True, default="", max_length=300)),
                ("ip", models.GenericIPAddressField(blank=True, null=True)),
                ("business_owner", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE, related_name="consents",
                    to="accounts.businessowner",
                )),
                ("staff", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+",
                    to="accounts.staffuser",
                )),
            ],
            options={"ordering": ["-accepted_at"]},
        ),
    ]
