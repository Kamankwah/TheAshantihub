from django.test import override_settings

from activity.models import ActivityEvent
from listings.models import Category, Listing
from portfolio.tests.health_fixtures import add_listings, make_business, subscribe_paused

from .base import MarketplaceTestCase


class ListingOversightTests(MarketplaceTestCase):
    def setUp(self):
        super().setUp()
        self.waiting = add_listings(self.business, 1, status=Listing.PENDING_REVIEW)[0]
        self.rejected = add_listings(self.business, 1, status=Listing.REJECTED)[0]
        self.suspended_owner = make_business("Ejisu Fresh Juice", is_suspended=True)
        self.hidden = add_listings(self.suspended_owner, 1)[0]
        for listing, name in ((self.waiting, "Waiting stole"), (self.rejected, "Rejected stole"), (self.hidden, "Hidden juice"), (self.listing, "Live stole")):
            listing.name = name
        Listing.objects.filter(pk=self.waiting.pk).update(name="Waiting stole")
        Listing.objects.filter(pk=self.rejected.pk).update(name="Rejected stole", rejection_reason="Blurry photo")
        Listing.objects.filter(pk=self.hidden.pk).update(name="Hidden juice")
        Listing.objects.filter(pk=self.listing.pk).update(name="Live stole")
        self.sign_in()

    def names(self, query=""):
        response = self.client.get(f"/api/marketplace/listings/{query}")
        self.assertEqual(response.status_code, 200, response.content)
        return {row["name"]: row for row in response.json()["results"]}

    def test_every_state_is_listed_with_why_a_published_one_is_hidden(self):
        rows = self.names()
        self.assertEqual(rows[self.hidden.name]["state"], "hidden")
        self.assertEqual(rows[self.hidden.name]["state_note"], "Business suspended")
        self.assertEqual(rows[self.listing.name]["state"], "live")
        self.assertEqual(rows["Waiting stole"]["state"], "waiting")
        self.assertEqual(rows[self.rejected.name]["state_note"], "Blurry photo")

    def test_status_filters(self):
        self.assertEqual(set(self.names("?status=live")), {self.listing.name})
        self.assertEqual(set(self.names("?status=hidden")), {self.hidden.name})
        self.assertEqual(set(self.names("?status=waiting")), {self.waiting.name})
        self.assertEqual(set(self.names("?status=rejected")), {self.rejected.name})

    def test_type_and_added_by_filters(self):
        service = Category.objects.create(slug="svc-test", icon="x", label="Services test", color="#000", kind=Category.SERVICE)
        Listing.objects.filter(pk=self.waiting.pk).update(category=service, created_by_staff=self.support)
        self.assertEqual(set(self.names("?type=service")), {self.waiting.name})
        self.assertNotIn(self.waiting.name, self.names("?type=product"))
        self.assertEqual(set(self.names("?added_by=scout")), {self.waiting.name})
        self.assertEqual(self.names()[self.waiting.name]["added_by"], self.support.full_name)
        # the lister's real role, so the table never calls an Operations or Super Admin listing "scout" (final-fix M3)
        self.assertEqual(self.names()[self.waiting.name]["added_by_role"], "Support")
        self.assertIsNone(self.names()[self.listing.name]["added_by_role"])

    def test_counts_separate_suspended_from_unpaid(self):
        body = self.client.get("/api/marketplace/listings/counts/").json()
        self.assertEqual(body["live"], 1)
        self.assertEqual(body["waiting"], 1)
        self.assertEqual(body["hidden_suspended"], 1)
        self.assertEqual(body["hidden_suspended_businesses"], 1)
        self.assertIsNone(body["hidden_unpaid"])  # the pause is off: nothing is hidden for unpaid

    @override_settings(SUBSCRIPTION_PAUSE_ENABLED=True)
    def test_unpaid_hidden_counts_appear_only_while_the_pause_is_on(self):
        paused = make_business("Adum Electronics")
        subscribe_paused(paused)
        add_listings(paused, 2)
        body = self.client.get("/api/marketplace/listings/counts/").json()
        self.assertEqual(body["hidden_unpaid"], 2)
        self.assertEqual(body["hidden_unpaid_businesses"], 1)
        notes = {row["state_note"] for row in self.names("?status=hidden").values()}
        self.assertIn("Subscription unpaid", notes)

    def test_history_shows_decisions_with_their_reason_and_who_added_it(self):
        response = self.client.post(f"/api/listings/moderation/{self.listing.pk}/reject/", {"reason": "Not allowed"}, format="json")
        self.assertEqual(response.status_code, 200)
        body = self.client.get(f"/api/marketplace/listings/{self.listing.pk}/history/").json()
        texts = [row["text"] for row in body["events"]]
        self.assertIn("Rejected: Not allowed", texts)
        self.assertTrue(any(text.startswith("Added by the owner") for text in texts))
        self.assertEqual(ActivityEvent.objects.filter(verb="moderation-reject", target_id=str(self.listing.pk)).count(), 1)

    def test_export_is_a_csv_without_personal_data(self):
        response = self.client.get("/api/marketplace/listings/export/?status=live")
        text = b"".join(response.streaming_content).decode("utf-8-sig")
        self.assertIn(self.listing.name, text)
        self.assertFalse(ActivityEvent.objects.get(verb="report.exported").after["personal_data"])

    def test_needs_the_moderation_permission(self):
        self.sign_in(self.support)
        self.assertEqual(self.client.get("/api/marketplace/listings/").status_code, 403)
