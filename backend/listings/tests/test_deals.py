from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer, Role, StaffUser
from cart.models import CartItem
from listings import pricing
from listings.models import Category, Listing, ListingPriceHistory, Zone
from storefront.testing import open_marketplace

DEALS = "/api/storefront/deals/"


class DealsBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.zone = Zone.objects.get(name="Manhyia")
        self.owner = BusinessOwner.objects.create(full_name="Deal Owner", login_phone="+233207661001", password_hash="x")
        self.cat = Category.objects.create(slug="zz-deals", label="ZZ Deals", icon="x", color="#000", kind=Category.PRODUCT)

    def listing(self, name="Kente", **extra):
        fields = dict(business_owner=self.owner, category=self.cat, zone=self.zone, name=name, description="D.",
                      contact_phone="+233207661999", price_amount="100.00", status=Listing.PUBLISHED)
        fields.update(extra)
        return Listing.objects.create(**fields)

    def age_history(self, listing, days):
        ListingPriceHistory.objects.filter(listing=listing).update(started_at=timezone.now() - timedelta(days=days))

    def staff(self, role):
        user = StaffUser.objects.get_or_create(
            email=f"{role}-deals@example.com", defaults=dict(full_name=f"{role} person", password_hash="x", role=Role.objects.get(name=role)),
        )[0]
        return issue_token(user, "staff")

    def owner_auth(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")


class PriceHistoryTests(DealsBase):
    def test_new_listing_opens_history_row(self):
        listing = self.listing()
        rows = list(listing.price_history.all())
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].price, Decimal("100.00"))
        self.assertIsNone(rows[0].ended_at)

    def test_price_change_closes_and_reopens_history(self):
        listing = self.listing()
        listing.price_amount = Decimal("120.00")
        listing.save()
        rows = list(listing.price_history.order_by("pk"))
        self.assertEqual([r.price for r in rows], [Decimal("100.00"), Decimal("120.00")])
        self.assertIsNotNone(rows[0].ended_at)
        self.assertIsNone(rows[1].ended_at)

    def test_unchanged_price_does_not_add_rows(self):
        listing = self.listing()
        listing = Listing.objects.get(pk=listing.pk)
        listing.name = "Renamed"
        listing.save()
        listing.stock_quantity = 4
        listing.save(update_fields=["stock_quantity"])
        # update_fields without price_amount never touches history, even if the in-memory price is changed
        listing.price_amount = Decimal("999.00")
        listing.save(update_fields=["stock_quantity"])
        self.assertEqual(listing.price_history.count(), 1)

    def test_record_price_is_a_no_op_when_unchanged(self):
        listing = self.listing()
        pricing.record_price(listing)
        self.assertEqual(listing.price_history.count(), 1)


class WasPriceTests(DealsBase):
    def test_no_was_price_without_sale_price(self):
        listing = self.listing()
        self.age_history(listing, 30)
        self.assertIsNone(pricing.was_price(listing))

    def test_was_price_none_when_regular_price_held_less_than_7_days(self):
        listing = self.listing(sale_price="80.00")
        self.age_history(listing, 6)
        self.assertIsNone(pricing.was_price(listing))

    def test_was_price_returned_when_held_7_days(self):
        listing = self.listing(sale_price="80.00")
        self.age_history(listing, 8)
        self.assertEqual(pricing.was_price(listing), Decimal("100.00"))

    def test_raising_price_then_sale_has_no_was_price_for_7_days(self):
        listing = self.listing()
        self.age_history(listing, 40)
        listing.price_amount = Decimal("150.00")
        listing.save()
        listing.sale_price = Decimal("120.00")
        listing.save()
        self.assertIsNone(pricing.was_price(listing))
        # the new regular price standing a full 7 days makes the strike-through honest
        listing.price_history.filter(ended_at__isnull=True).update(started_at=timezone.now() - timedelta(days=7, minutes=1))
        self.assertEqual(pricing.was_price(listing), Decimal("150.00"))

    def test_sale_not_below_price_is_not_a_discount(self):
        listing = self.listing(sale_price="80.00")
        self.age_history(listing, 30)
        listing.price_amount = Decimal("70.00")  # owner lowered the price under the old sale price
        listing.save()
        self.age_history(listing, 30)
        listing.refresh_from_db()
        self.assertEqual(listing.effective_price, Decimal("70.00"))
        self.assertIsNone(pricing.was_price(listing))
        self.assertEqual(self.client.get(DEALS).json(), [])


class SalePriceRuleTests(DealsBase):
    def test_sale_price_must_be_below_price(self):
        listing = self.listing(status=Listing.DRAFT)
        self.owner_auth()
        url = f"/api/listings/mine/{listing.pk}/"
        for bad in ("100.00", "120.00", "0", "-5"):
            response = self.client.patch(url, {"sale_price": bad}, format="json")
            self.assertEqual(response.status_code, 400, (bad, response.content))
            self.assertIn("sale_price", response.json())
        ok = self.client.patch(url, {"sale_price": "90.00"}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        listing.refresh_from_db()
        self.assertEqual(listing.sale_price, Decimal("90.00"))
        # the incoming price counts when both are sent
        both = self.client.patch(url, {"price_amount": "50.00", "sale_price": "60.00"}, format="json")
        self.assertEqual(both.status_code, 400)
        # null ends the sale
        ended = self.client.patch(url, {"sale_price": None}, format="json")
        self.assertEqual(ended.status_code, 200, ended.content)
        listing.refresh_from_db()
        self.assertIsNone(listing.sale_price)

    def test_sale_goes_live_immediately_no_approval(self):
        listing = self.listing()
        self.owner_auth()
        response = self.client.patch(f"/api/listings/mine/{listing.pk}/manage/", {"sale_price": "75.00"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertEqual(listing.status, Listing.PUBLISHED)
        self.assertEqual(listing.sale_price, Decimal("75.00"))
        self.assertEqual([row["id"] for row in self.client.get(DEALS).json()], [listing.pk])
        bad = self.client.patch(f"/api/listings/mine/{listing.pk}/manage/", {"sale_price": "100.00"}, format="json")
        self.assertEqual(bad.status_code, 400)

    def test_public_listing_shows_sale_and_was_price(self):
        listing = self.listing(sale_price="80.00")
        self.age_history(listing, 10)
        body = self.client.get(f"/api/listings/{listing.pk}/").json()
        self.assertEqual(body["sale_price"], "80.00")
        self.assertEqual(body["was_price"], "100.00")


class DealsFeedTests(DealsBase):
    def test_deals_include_sale_and_sponsored_only(self):
        sale = self.listing("On sale", sale_price="80.00")
        self.age_history(sale, 9)
        sale_new = self.listing("New sale", sale_price="90.00")
        sponsored = self.listing("Sponsored", sponsored=True)
        self.listing("Plain")
        rows = self.client.get(DEALS).json()
        by_id = {row["id"]: row for row in rows}
        self.assertEqual(set(by_id), {sale.pk, sale_new.pk, sponsored.pk})
        self.assertEqual(by_id[sale.pk]["was_price"], "100.00")
        self.assertEqual(by_id[sale.pk]["discount_percent"], 20)
        self.assertFalse(by_id[sale.pk]["sponsored"])
        self.assertIsNone(by_id[sale_new.pk]["was_price"])
        self.assertIsNone(by_id[sale_new.pk]["discount_percent"])
        self.assertEqual(by_id[sale_new.pk]["sale_price"], "90.00")
        self.assertTrue(by_id[sponsored.pk]["sponsored"])
        self.assertIsNone(by_id[sponsored.pk]["sale_price"])
        for row in rows:
            self.assertFalse({"contact_phone", "phone", "email", "business_owner", "whatsapp"} & set(row))
        self.assertEqual([row["id"] for row in rows], sorted(by_id, reverse=True))

    def test_deals_exclude_hidden_business_sold_out_unpublished(self):
        good = self.listing("Good", sale_price="80.00")
        self.listing("Draft", sale_price="80.00", status=Listing.DRAFT)
        self.listing("Sold out", sale_price="80.00", stock_quantity=0)
        hidden_owner = BusinessOwner.objects.create(
            full_name="Hidden", login_phone="+233207661002", password_hash="x", is_suspended=True)
        self.listing("Hidden", sale_price="80.00", business_owner=hidden_owner)
        service = Category.objects.create(slug="zz-deals-svc", label="ZZ Svc", icon="x", color="#000", kind=Category.SERVICE)
        self.listing("Service", sale_price="80.00", category=service)
        self.assertEqual([row["id"] for row in self.client.get(DEALS).json()], [good.pk])

    def test_food_on_sale_is_a_deal(self):
        # Food (a service-kind category flagged is_food) is carted and can carry a sale price, so it is a deal too.
        food = Category.objects.create(slug="zz-deals-food", label="ZZ Food", icon="x", color="#000",
                                       kind=Category.SERVICE, is_food=True)
        stay = Category.objects.create(slug="zz-deals-stay", label="ZZ Stay", icon="x", color="#000",
                                       kind=Category.SERVICE, is_accommodation=True)
        jollof = self.listing("Jollof", sale_price="60.00", category=food)
        self.listing("Room", sale_price="60.00", category=stay)
        rows = self.client.get(DEALS).json()
        self.assertEqual([row["id"] for row in rows], [jollof.pk])
        self.assertEqual(rows[0]["sale_price"], "60.00")

    def test_limit_param(self):
        for i in range(3):
            self.listing(f"S{i}", sale_price="50.00")
        self.assertEqual(len(self.client.get(DEALS + "?limit=2").json()), 2)


class SponsoredFlagTests(DealsBase):
    def post(self, token, listing, value=True):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return self.client.post(f"/api/listings/{listing.pk}/sponsored/", {"sponsored": value}, format="json")

    def test_only_marketing_operations_super_admin_can_flag_sponsored(self):
        listing = self.listing()
        for role in ("support", "scout"):
            self.assertEqual(self.post(self.staff(role), listing).status_code, 403, role)
        listing.refresh_from_db()
        self.assertFalse(listing.sponsored)
        for role in ("marketing", "operations", "super_admin"):
            response = self.post(self.staff(role), listing)
            self.assertEqual(response.status_code, 200, (role, response.content))
        listing.refresh_from_db()
        self.assertTrue(listing.sponsored)
        self.assertEqual(listing.sponsored_by.role.name, "super_admin")
        self.assertEqual(self.post(self.staff("marketing"), listing, False).status_code, 200)
        listing.refresh_from_db()
        self.assertFalse(listing.sponsored)
        self.assertIsNone(listing.sponsored_by)

    def test_sponsored_needs_a_boolean_and_a_listing(self):
        listing = self.listing()
        token = self.staff("marketing")
        self.assertEqual(self.post(token, listing, "yes").status_code, 400)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(self.client.post("/api/listings/9999999/sponsored/", {"sponsored": True}, format="json").status_code, 404)

    def test_sponsored_list_reads_the_flag_not_the_deals_feed(self):
        # 49 newer discounted listings push an older sponsored one past the Deals feed's 48-row cap.
        old = self.listing("Old sponsored", sponsored=True)
        draft = self.listing("Draft sponsored", sponsored=True, status=Listing.DRAFT)
        for i in range(49):
            self.listing(f"Sale {i}", sale_price="50.00")
        self.assertNotIn(old.pk, [row["id"] for row in self.client.get(DEALS + "?limit=48").json()])
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.staff('marketing')}")
        response = self.client.get("/api/listings/sponsored/")
        self.assertEqual(response.status_code, 200, response.content)
        rows = {row["id"]: row for row in response.json()}
        self.assertEqual(set(rows), {old.pk, draft.pk})
        self.assertTrue(rows[old.pk]["live"])
        self.assertFalse(rows[draft.pk]["live"])
        self.assertEqual(set(rows[old.pk]), {"id", "name", "category_label", "live"})

    def test_sponsored_list_is_for_deals_managers_only(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.staff('support')}")
        self.assertEqual(self.client.get("/api/listings/sponsored/").status_code, 403)
        self.client.credentials()
        self.assertIn(self.client.get("/api/listings/sponsored/").status_code, (401, 403))


class CartPriceTests(DealsBase):
    def test_cart_snapshots_effective_price(self):
        open_marketplace()
        listing = self.listing(sale_price="80.00")
        customer = Customer.objects.create(full_name="Buyer", phone="+233200661001", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        response = self.client.post("/api/cart/items/", {"listing": listing.pk, "quantity": 1}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(CartItem.objects.get().unit_price_snapshot, Decimal("80.00"))


class OffersPriceTests(DealsBase):
    def test_offers_order_and_lowest_price_use_the_sale_price(self):
        from catalogue.models import CatalogueProduct
        from catalogue.offers import live_offers

        product = CatalogueProduct.objects.create(name="Gari 1kg", normalised_name="gari 1kg", brand="Tasty")
        dear = self.listing("Dear", price_amount="50.00", catalogue_product=product)
        cheap_sale = self.listing("Sale", price_amount="60.00", sale_price="40.00", catalogue_product=product)
        self.assertEqual([o.pk for o in live_offers(product.pk)], [cheap_sale.pk, dear.pk])


class FixRoundTests(DealsBase):
    def stay(self, **extra):
        cat = Category.objects.get(slug="hotels")
        return self.listing("Room", category=cat, **extra)

    def test_sale_price_rejected_on_a_stay_both_endpoints(self):
        stay = self.stay(status=Listing.DRAFT)
        self.owner_auth()
        response = self.client.patch(f"/api/listings/mine/{stay.pk}/", {"sale_price": "50.00"}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("sale_price", response.json())
        published = self.stay()
        response = self.client.patch(f"/api/listings/mine/{published.pk}/manage/", {"sale_price": "50.00"}, format="json")
        self.assertEqual(response.status_code, 400, response.content)

    def test_stay_with_stored_sale_price_charges_and_shows_regular_price(self):
        stay = self.stay(sale_price="50.00")
        self.age_history(stay, 30)
        stay = Listing.objects.get(pk=stay.pk)
        self.assertEqual(stay.effective_price, Decimal("100.00"))
        body = self.client.get(f"/api/listings/{stay.pk}/").json()
        self.assertIsNone(body["sale_price"])
        self.assertIsNone(body["was_price"])
        self.assertEqual(body["effective_price"], "100.00")

    def test_feed_was_price_matches_the_current_price_row(self):
        listing = self.listing(sale_price="80.00")
        self.age_history(listing, 30)
        listing.price_amount = Decimal("150.00")
        listing.save()
        row = self.client.get(DEALS).json()[0]
        self.assertIsNone(row["was_price"])
        self.assertIsNone(pricing.was_price(Listing.objects.get(pk=listing.pk)))

    def test_lowering_price_to_the_sale_price_clears_the_sale(self):
        listing = self.listing(sale_price="80.00")
        self.owner_auth()
        response = self.client.patch(f"/api/listings/mine/{listing.pk}/manage/", {"price_amount": "80.00"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertIsNone(listing.sale_price)
        # a valid sale sent together with the new price is kept
        response = self.client.patch(
            f"/api/listings/mine/{listing.pk}/manage/", {"price_amount": "60.00", "sale_price": "50.00"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        listing.refresh_from_db()
        self.assertEqual(listing.sale_price, Decimal("50.00"))
        # raising the price above the sale leaves the sale alone
        self.client.patch(f"/api/listings/mine/{listing.pk}/manage/", {"price_amount": "90.00"}, format="json")
        listing.refresh_from_db()
        self.assertEqual(listing.sale_price, Decimal("50.00"))

    def test_public_list_price_filter_and_ordering_use_the_sale_price(self):
        cheap_on_sale = self.listing("OnSale", price_amount="100.00", sale_price="30.00")
        mid = self.listing("Mid", price_amount="50.00")
        base = "/api/listings/?category=zz-deals"
        ids = lambda q: [r["id"] for r in self.client.get(base + q).json()["results"]]
        self.assertEqual(ids("&max_price=40"), [cheap_on_sale.pk])
        self.assertEqual(ids("&min_price=40"), [mid.pk])
        self.assertEqual(ids("&ordering=price_amount"), [cheap_on_sale.pk, mid.pk])
        self.assertEqual(ids("&ordering=-price_amount"), [mid.pk, cheap_on_sale.pk])
