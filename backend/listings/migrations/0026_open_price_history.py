from django.db import migrations
from django.utils import timezone


def open_history(apps, schema_editor):
    """One open history row per listing that has a price, started now: a "was" price can appear no earlier than 7 days
    after this deploy, because no earlier price was recorded (Plan M1 Task 6)."""
    Listing = apps.get_model("listings", "Listing")
    History = apps.get_model("listings", "ListingPriceHistory")
    now = timezone.now()
    rows = []
    for listing_id, price in Listing.objects.filter(price_amount__isnull=False).values_list("pk", "price_amount").iterator():
        rows.append(History(listing_id=listing_id, price=price, started_at=now))
        if len(rows) >= 1000:
            History.objects.bulk_create(rows)
            rows = []
    if rows:
        History.objects.bulk_create(rows)


def noop(apps, schema_editor):
    """The history table is dropped by 0024's reverse."""


class Migration(migrations.Migration):
    dependencies = [("listings", "0025_sale_price_sponsored_price_history")]
    operations = [migrations.RunPython(open_history, noop)]
