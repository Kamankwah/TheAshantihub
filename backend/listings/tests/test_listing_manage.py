from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner
from listings.models import Category, Listing, Zone


class ListingManageTests(TestCase):
    """Light edit of operational fields on a published listing without
    re-moderation (business item 2 / Wave H).
    """

    def setUp(self):
        self.client = APIClient()
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Trader", login_phone="+233207883300", password_hash="x",
        )
        self.other_owner = BusinessOwner.objects.create(
            full_name="Ama Trader", login_phone="+233207883399", password_hash="x",
        )
        self.listing = Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="hotels"),
            zone=Zone.objects.get(name="Manhyia"), name="Kente Cloth", description="A cloth.",
            contact_phone="+233207883300", price_amount="100.00", status=Listing.PUBLISHED,
            stock_quantity=10, specs=[{"label": "Color", "value": "Gold"}],
        )

    def _auth(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def _url(self, listing=None):
        return f"/api/listings/mine/{(listing or self.listing).id}/manage/"

    def test_owner_edits_price_on_a_published_listing_without_re_moderation(self):
        self._auth(self.owner)
        response = self.client.patch(self._url(), {"price_amount": "120.00"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.listing.refresh_from_db()
        self.assertEqual(str(self.listing.price_amount), "120.00")
        # The listing stays PUBLISHED — not pulled back to moderation.
        self.assertEqual(self.listing.status, Listing.PUBLISHED)

    def test_owner_edits_specs(self):
        self._auth(self.owner)
        response = self.client.patch(
            self._url(), {"specs": [{"label": "Size", "value": "Large"}]}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.specs, [{"label": "Size", "value": "Large"}])

    def test_manage_cannot_change_moderated_fields(self):
        """name is not in the manage serializer, so it's silently ignored —
        the content-moderated fields still require the full edit + re-review.
        """
        self._auth(self.owner)
        self.client.patch(self._url(), {"name": "Something Else", "price_amount": "99.00"}, format="json")
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.name, "Kente Cloth")  # unchanged
        self.assertEqual(str(self.listing.price_amount), "99.00")  # changed

    def test_another_owner_cannot_manage_your_listing(self):
        self._auth(self.other_owner)
        response = self.client.patch(self._url(), {"price_amount": "1.00"}, format="json")
        self.assertEqual(response.status_code, 403)
