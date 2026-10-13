import accounts.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0047_seed_marketing_permissions"),
        ("approvals", "0003_decisions_rules"),
        ("listings", "0019_listing_created_by_staff"),
        ("marketing", "0003_seed_consent_wordings"),
    ]

    operations = [
        migrations.CreateModel(
            name="Banner",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slot", models.CharField(choices=[("home_hero", "Home page, hero"), ("home_strip", "Home page, middle strip"), ("category_top", "Category page, top"), ("events_top", "Events page, top")], max_length=14)),
                ("title", models.CharField(max_length=140)),
                ("alt_text", models.CharField(max_length=200)),
                ("image", models.ImageField(upload_to="marketing/banners/", validators=[accounts.validators.validate_image_content_type])),
                ("link_path", models.CharField(blank=True, max_length=200)),
                ("sponsored", models.BooleanField(default=False)),
                ("internal_note", models.CharField(blank=True, max_length=300)),
                ("starts_at", models.DateTimeField()),
                ("ends_at", models.DateTimeField(blank=True, null=True)),
                ("state", models.CharField(choices=[("draft", "Draft"), ("waiting", "Waiting for Super Admin"), ("approved", "Approved"), ("rejected", "Returned"), ("taken_down", "Taken down")], default="draft", max_length=10)),
                ("approved_at", models.DateTimeField(blank=True, null=True)),
                ("return_note", models.CharField(blank=True, max_length=500)),
                ("taken_down_at", models.DateTimeField(blank=True, null=True)),
                ("views", models.PositiveBigIntegerField(default=0)),
                ("clicks", models.PositiveBigIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("approval", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="approvals.approvalrequest")),
                ("approved_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="accounts.staffuser")),
                ("category", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="listings.category")),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="accounts.staffuser")),
                ("taken_down_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="accounts.staffuser")),
            ],
            options={
                "ordering": ["-starts_at", "-id"],
                "indexes": [models.Index(fields=["slot", "state", "starts_at"], name="mkt_banner_live_idx")],
            },
        ),
        migrations.CreateModel(
            name="FeaturedSlot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("key", models.SlugField(max_length=30, unique=True)),
                ("kind", models.CharField(choices=[("home", "Home featured row"), ("category_top", "Category top")], max_length=14)),
                ("label", models.CharField(max_length=60)),
                ("weekly_price", models.DecimalField(decimal_places=2, max_digits=8)),
                ("capacity", models.PositiveSmallIntegerField(default=1)),
                ("position", models.PositiveSmallIntegerField(default=1)),
                ("active", models.BooleanField(default=True)),
            ],
            options={"ordering": ["kind", "position", "key"]},
        ),
        migrations.CreateModel(
            name="FeaturedBooking",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("position", models.PositiveSmallIntegerField(default=1)),
                ("week_start", models.DateField()),
                ("price_snapshot", models.DecimalField(decimal_places=2, max_digits=8)),
                ("status", models.CharField(choices=[("booked", "Booked"), ("released", "Released")], default="booked", max_length=10)),
                ("booked_at", models.DateTimeField(auto_now_add=True)),
                ("released_at", models.DateTimeField(blank=True, null=True)),
                ("release_note", models.CharField(blank=True, max_length=300)),
                ("booked_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="accounts.staffuser")),
                ("category", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="listings.category")),
                ("promotion", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="featured_bookings", to="listings.promotion")),
                ("released_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="accounts.staffuser")),
                ("slot", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="bookings", to="marketing.featuredslot")),
            ],
            options={"ordering": ["week_start", "slot_id", "position", "id"]},
        ),
        migrations.AddConstraint(
            model_name="featuredbooking",
            constraint=models.UniqueConstraint(condition=models.Q(("category__isnull", True), ("status", "booked")), fields=("slot", "position", "week_start"), name="mkt_featured_home_once"),
        ),
        migrations.AddConstraint(
            model_name="featuredbooking",
            constraint=models.UniqueConstraint(condition=models.Q(("category__isnull", False), ("status", "booked")), fields=("slot", "category", "position", "week_start"), name="mkt_featured_cat_once"),
        ),
    ]
