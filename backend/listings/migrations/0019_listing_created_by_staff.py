import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0040_business_identity_and_portfolio_fields"),
        ("listings", "0018_heromediasubmission_listing"),
    ]

    operations = [
        migrations.AddField(
            model_name="listing",
            name="created_by_staff",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="listings_created_for_owners", to="accounts.staffuser",
            ),
        ),
    ]
