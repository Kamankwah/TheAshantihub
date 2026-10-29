from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner
from listings.models import Category, Listing, Zone


class ListingManageTests(TestCase):
    """The live edit of a published listing without re-moderation (business item 2 / Wave H).

    Narrowed in marketplace Plan 2 (decision V5): `manage` now carries only price, the sale price and the price unit
    (stock has `restock`). Specs, tag, contact phone and the other fields a shopper sees used to go through here
    unmoderated; they now need approval through a revision (test_listing_revisions), so the two tests that edited
    them here assert the refusal instead."""

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

    def test_specs_are_no_longer_a_live_edit(self):
        self._auth(self.owner)
        response = self.client.patch(
            self._url(), {"specs": [{"label": "Size", "value": "Large"}]}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("specs", response.json())
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.specs, [{"label": "Color", "value": "Gold"}])

    def test_manage_refuses_moderated_fields_and_changes_nothing(self):
        """name was silently ignored before; now any field that is not live is a 400 and the request is not applied."""
        self._auth(self.owner)
        response = self.client.patch(self._url(), {"name": "Something Else", "price_amount": "99.00"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.name, "Kente Cloth")
        self.assertEqual(str(self.listing.price_amount), "100.00")

    def test_another_owner_cannot_manage_your_listing(self):
        self._auth(self.other_owner)
        response = self.client.patch(self._url(), {"price_amount": "1.00"}, format="json")
        self.assertEqual(response.status_code, 403)
