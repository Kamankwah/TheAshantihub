"""The ListingView retention window: rows older than 31 days are pruned by a daily beat task."""
from datetime import timedelta

from django.conf import settings
from django.test import TestCase
from django.utils import timezone

from accounts.models import BusinessOwner
from listings.models import Category, Listing, ListingView, Zone
from listings.tasks import prune_listing_views


class PruneListingViewsTests(TestCase):
    def setUp(self):
        owner = BusinessOwner.objects.create(full_name="Ama Shop", login_phone="+233207991055", password_hash="x")
        self.listing = Listing.objects.create(
            business_owner=owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name="Anchor", description="D.", contact_phone="+233207991055", price_amount="10.00", status=Listing.PUBLISHED,
        )

    def view(self, key, days_old):
        row = ListingView.objects.create(viewer_key=key, listing=self.listing, day=timezone.localdate() - timedelta(days=days_old))
        ListingView.objects.filter(pk=row.pk).update(viewed_at=timezone.now() - timedelta(days=days_old))
        return row

    def test_deletes_rows_older_than_31_days_and_keeps_the_rest(self):
        old, older = self.view("c:1", 40), self.view("a:x", 32)
        edge, fresh = self.view("c:2", 30), self.view("a:y", 0)
        self.assertEqual(prune_listing_views(), 2)
        self.assertEqual(set(ListingView.objects.values_list("pk", flat=True)), {edge.pk, fresh.pk})
        self.assertFalse(ListingView.objects.filter(pk__in=[old.pk, older.pk]).exists())

    def test_is_registered_on_the_beat_schedule(self):
        tasks = {entry["task"] for entry in settings.CELERY_BEAT_SCHEDULE.values()}
        self.assertIn("listings.tasks.prune_listing_views", tasks)
