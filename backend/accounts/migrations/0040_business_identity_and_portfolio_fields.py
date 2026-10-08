import accounts.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0039_seed_phase2_permissions"),
        ("listings", "0018_heromediasubmission_listing"),
    ]

    operations = [
        migrations.AddField(
            model_name="businessowner",
            name="registration_channel",
            field=models.CharField(
                choices=[("self", "Registered online by the owner"), ("scout", "Registered by a scout")],
                default="self", max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="businessowner",
            name="registered_by",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="registered_businesses", to="accounts.staffuser",
            ),
        ),
        migrations.AddField(
            model_name="businessowner",
            name="account_manager",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="managed_businesses", to="accounts.staffuser",
            ),
        ),
        migrations.AddField(
            model_name="businessowner",
            name="claimed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="business_name",
            field=models.CharField(blank=True, default="", max_length=150),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="business_category",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="+", to="listings.category",
            ),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="zone",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="+", to="listings.zone",
            ),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="business_description",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="opening_hours",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="lat",
            field=models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="lng",
            field=models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="location_accuracy_m",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="location_set_by",
            field=models.CharField(
                blank=True, choices=[("owner", "Owner"), ("scout", "Scout"), ("operations", "Operations")],
                default="", max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="location_set_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="location_is_manual",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="businessownerprofile",
            name="signboard_photo",
            field=models.ImageField(
                blank=True, null=True, upload_to="signboards/",
                validators=[accounts.validators.validate_image_content_type],
            ),
        ),
    ]
