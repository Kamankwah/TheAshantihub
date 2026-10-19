import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("listings", "0022_listing_cancellation_policy")]

    operations = [
        migrations.AddField(
            model_name="category", name="parent",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name="children", to="listings.category",
            ),
        ),
        migrations.AddField(
            model_name="category", name="sort_order", field=models.PositiveIntegerField(default=0),
        ),
        migrations.CreateModel(
            name="CategoryVisit",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("day", models.DateField()),
                ("count", models.PositiveIntegerField(default=0)),
                ("category", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE, related_name="visits", to="listings.category",
                )),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("category", "day"), name="uniq_category_visit_day"),
                ],
            },
        ),
    ]
