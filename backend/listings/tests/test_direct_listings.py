"""Ashanti Direct's listing tools: the owner views mounted a second time under /api/direct/listings/ for Operations."""
import tempfile
from io import StringIO
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts import direct
from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from ledger import escrow, posting
from ledger.models import Account, OrderFeeSnapshot
from listings.models import Category, Listing, ListingRevision, Zone
from orders.models import Order, OrderItem

TEST_MEDIA_ROOT = tempfile.mkdtemp()
BASE = "/api/direct/listings/"


@override_settings(ASHANTI_DIRECT_PHONE="0244000111", ASHANTI_DIRECT_EMAIL="direct@theashantihub.com", MEDIA_ROOT=TEST_MEDIA_ROOT)
class DirectBase(TestCase):
    def setUp(self):
        call_command("ensure_ashanti_direct", stdout=StringIO())
        self.direct = direct.ashanti_direct()
        self.client = APIClient()
        self.shops = Category.objects.get(slug="shops")
        self.zone = Zone.objects.get(name="Manhyia")
        self.ops = make_staff("operations", "ops@example.com")
        self.ops2 = make_staff("operations", "ops2@example.com")
        self.boss = make_staff("super_admin", "boss@example.com")
        self.support = make_staff("support", "support@example.com")
        self.partner = BusinessOwner.objects.create(
            full_name="Ama Personal", login_phone="+233207123001", password_hash="x", kyc_status=BusinessOwner.VERIFIED,
        )
        BusinessOwnerProfile.objects.create(
            business_owner=self.partner, business_name="Ama Foods", business_contact_phone="+233207123001",
            business_kind="product",
        )

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def as_owner(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def listing(self, owner, name="Item", status=Listing.PUBLISHED, price="50.00", category=None, **extra):
        return Listing.objects.create(
            business_owner=owner, category=category or self.shops, zone=self.zone, name=name, description="D.",
            contact_phone="+233207123001", price_amount=Decimal(price), status=status, **extra,
        )

    def payload(self, **extra):
        return {"category": self.shops.id, "zone": self.zone.id, "name": "Direct Kettle", "description": "Boils.",
                "price_amount": "80.00", "has_warranty": False, "has_expiry": False,
                "return_policy": "Seven days", **extra}


class DirectListingTests(DirectBase):
    def test_operator_creates_and_lists_only_direct_listings(self):
        self.listing(self.partner, "Partner item")
        self.as_staff(self.ops)
        created = self.client.post(BASE, self.payload(), format="json")
        self.assertEqual(created.status_code, 201, created.content)
        row = Listing.objects.get(pk=created.json()["id"])
        self.assertEqual(row.business_owner_id, self.direct.pk)
        self.assertEqual(row.created_by_staff_id, self.ops.pk)
        names = [item["name"] for item in self.client.get(BASE).json()]
        self.assertEqual(names, ["Direct Kettle"])

    def test_a_client_supplied_owner_is_ignored(self):
        self.as_staff(self.ops)
        response = self.client.post(BASE, self.payload(business_owner=self.partner.pk), format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Listing.objects.get(pk=response.json()["id"]).business_owner_id, self.direct.pk)

    def test_operator_cannot_touch_a_partner_listing(self):
        theirs = self.listing(self.partner, "Partner item")
        self.as_staff(self.ops)
        for method, suffix, body in [
            ("patch", "", {"name": "x"}), ("patch", "manage/", {"price_amount": "1.00"}),
            ("post", "restock/", {"add": 1}), ("post", "drop/", {}), ("post", "submit/", {}),
            ("get", "variants/", None), ("get", "discounts/", None), ("get", "revision/", None),
            ("post", "photos/", {}), ("post", "videos/", {}),
        ]:
            response = getattr(self.client, method)(f"{BASE}{theirs.pk}/{suffix}", body, format="json") if body is not None \
                else getattr(self.client, method)(f"{BASE}{theirs.pk}/{suffix}")
            self.assertEqual(response.status_code, 404, (method, suffix, response.status_code))
        theirs.refresh_from_db()
        self.assertEqual((theirs.name, theirs.status), ("Partner item", Listing.PUBLISHED))

    def test_partner_owner_cannot_use_the_direct_urls(self):
        mine = self.listing(self.partner, "Partner item")
        own = self.listing(self.direct, "Direct item")
        self.as_owner(self.partner)
        self.assertEqual(self.client.get(BASE).status_code, 403)
        self.assertEqual(self.client.post(BASE, self.payload(), format="json").status_code, 403)
        self.assertEqual(self.client.post(f"{BASE}{own.pk}/drop/", {}, format="json").status_code, 403)
        self.assertEqual(self.client.get(f"{BASE}{mine.pk}/variants/").status_code, 403)

    def test_staff_without_direct_operate_is_refused(self):
        self.as_staff(self.support)
        self.assertEqual(self.client.get(BASE).status_code, 403)
        self.assertEqual(self.client.post(BASE, self.payload(), format="json").status_code, 403)

    def test_anonymous_is_refused(self):
        self.assertIn(self.client.get(BASE).status_code, (401, 403))

    def test_the_mirrored_tools_work_on_a_direct_listing(self):
        own = self.listing(self.direct, "Direct item", stock_quantity=2)
        self.as_staff(self.ops)
        self.assertEqual(self.client.post(f"{BASE}{own.pk}/restock/", {"add": 3}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(f"{BASE}{own.pk}/manage/", {"price_amount": "60.00"}, format="json").status_code, 200)
        self.assertEqual(self.client.get(f"{BASE}{own.pk}/variants/").status_code, 200)
        self.assertEqual(self.client.get(f"{BASE}{own.pk}/discounts/").status_code, 200)
        draft = self.client.put(f"{BASE}{own.pk}/revision/", {"changes": {"name": "Better"}}, format="json")
        self.assertEqual(draft.status_code, 200, draft.content)
        revision = ListingRevision.objects.get(listing=own)
        self.assertEqual(revision.created_by_staff_id, self.ops.pk)
        self.assertIsNone(revision.created_by_id)
        self.assertEqual(self.client.post(f"{BASE}{own.pk}/drop/", {}, format="json").status_code, 200)
        self.assertEqual(self.client.post(f"{BASE}{own.pk}/restore/", {}, format="json").status_code, 200)
        own.refresh_from_db()
        self.assertEqual((own.stock_quantity, own.price_amount, own.status), (5, Decimal("60.00"), Listing.PUBLISHED))

    def test_a_second_operator_editing_a_revision_becomes_its_maker_of_record(self):
        own = self.listing(self.direct, "Direct item")
        self.as_staff(self.ops)
        self.client.put(f"{BASE}{own.pk}/revision/", {"changes": {"name": "One"}}, format="json")
        self.as_staff(self.ops2)
        self.client.put(f"{BASE}{own.pk}/revision/", {"changes": {"name": "Two"}}, format="json")
        self.assertEqual(ListingRevision.objects.get(listing=own).created_by_staff_id, self.ops2.pk)

    def test_review_focus_creator_of_a_direct_listing_cannot_approve_it(self):
        self.as_staff(self.ops)
        listing_id = self.client.post(BASE, self.payload(), format="json").json()["id"]
        self.assertEqual(self.client.post(f"{BASE}{listing_id}/submit/", {}, format="json").status_code, 200)
        self.assertEqual(self.client.post(f"/api/listings/moderation/{listing_id}/approve/").status_code, 403)
        self.as_staff(self.boss)
        self.assertEqual(self.client.post(f"/api/listings/moderation/{listing_id}/approve/").status_code, 200)
        self.assertEqual(Listing.objects.get(pk=listing_id).status, Listing.PUBLISHED)

    def test_review_focus_creator_of_a_direct_revision_cannot_approve_it(self):
        own = self.listing(self.direct, "Direct item")
        self.as_staff(self.ops)
        self.client.put(f"{BASE}{own.pk}/revision/", {"changes": {"name": "Better"}}, format="json")
        self.assertEqual(self.client.post(f"{BASE}{own.pk}/revision/submit/", {}, format="json").status_code, 200)
        revision = ListingRevision.objects.get(listing=own)
        self.assertEqual(self.client.post(f"/api/listings/revisions/{revision.pk}/approve/").status_code, 403)
        self.as_staff(self.ops2)
        self.assertEqual(self.client.post(f"/api/listings/revisions/{revision.pk}/approve/").status_code, 200)

    def test_the_submitter_of_a_direct_revision_cannot_approve_it_either(self):
        own = self.listing(self.direct, "Direct item")
        self.as_staff(self.ops)
        self.client.put(f"{BASE}{own.pk}/revision/", {"changes": {"name": "Better"}}, format="json")
        self.as_staff(self.ops2)
        self.client.post(f"{BASE}{own.pk}/revision/submit/", {}, format="json")
        revision = ListingRevision.objects.get(listing=own)
        self.assertEqual(self.client.post(f"/api/listings/revisions/{revision.pk}/approve/").status_code, 403)

    @override_settings(SUBSCRIPTIONS_ENABLED=True)
    def test_direct_listing_skips_kind_and_subscription_checks(self):
        service = Category.objects.filter(kind=Category.SERVICE, is_accommodation=False).first()
        self.as_staff(self.ops)
        response = self.client.post(BASE, self.payload(category=service.pk), format="json")
        self.assertEqual(response.status_code, 201, response.content)  # kind product business, service category, no plan
        # The same request from a partner without a plan is refused.
        self.as_owner(self.partner)
        refused = self.client.post("/api/listings/mine/", self.payload(), format="json")
        self.assertEqual(refused.status_code, 400)

    def test_direct_urls_without_the_company_row_are_404(self):
        BusinessOwner.objects.filter(is_company=True).delete()
        self.as_staff(self.ops)
        self.assertEqual(self.client.get(BASE).status_code, 404)


class DirectPublicTests(DirectBase):
    def test_sold_by_direct_filter_returns_only_direct_listings_and_partners_stay_visible(self):
        self.listing(self.direct, "Direct item")
        self.listing(self.partner, "Partner item")
        names = lambda url: sorted(item["name"] for item in self.client.get(url).json()["results"])  # noqa: E731
        self.assertEqual(names("/api/listings/?sold_by=direct"), ["Direct item"])
        self.assertEqual(names("/api/listings/"), ["Direct item", "Partner item"])

    def test_public_listing_marks_is_ashanti_direct(self):
        own = self.listing(self.direct, "Direct item")
        theirs = self.listing(self.partner, "Partner item")
        mine = self.client.get(f"/api/listings/{own.pk}/").json()["business_owner"]
        other = self.client.get(f"/api/listings/{theirs.pk}/").json()["business_owner"]
        self.assertTrue(mine["is_ashanti_direct"])
        self.assertFalse(other["is_ashanti_direct"])
        self.assertEqual((mine["name"], other["name"]), ("Ashanti Direct", "Ama Foods"))
        self.assertNotIn("login_phone", mine)

    def test_seller_page_marks_is_ashanti_direct(self):
        self.assertTrue(self.client.get(f"/api/listings/sellers/{self.direct.pk}/").json()["is_ashanti_direct"])
        self.assertFalse(self.client.get(f"/api/listings/sellers/{self.partner.pk}/").json()["is_ashanti_direct"])


@override_settings(LEDGER_ENABLED=True)
class DirectMoneyTests(DirectBase):
    def order(self, listing, quantity=1):
        customer = self.customer()
        total = listing.price_amount * quantity
        order = Order.objects.create(customer=customer, status=Order.PAID, total_amount=total, discount_amount="0.00")
        OrderItem.objects.create(
            order=order, listing=listing, quantity=quantity, unit_price=listing.price_amount, line_total=total,
        )
        return order

    def customer(self):
        from accounts.models import Customer

        self.n = getattr(self, "n", 0) + 1
        return Customer.objects.create(full_name="Ama", phone=f"+2332009900{self.n:02d}", password_hash="x")

    def test_review_focus_direct_order_gets_the_same_fee_snapshot_as_a_partner(self):
        snaps = []
        for owner in (self.direct, self.partner):
            order = self.order(self.listing(owner, "Same", price="120.00"))
            escrow.record_order_payment(order)
            snaps.append(OrderFeeSnapshot.objects.get(order=order))
        self.assertEqual(snaps[0].rule_set_id, snaps[1].rule_set_id)
        self.assertEqual(snaps[0].charged_pesewas, snaps[1].charged_pesewas)
        self.assertEqual(snaps[0].base_pesewas, snaps[1].base_pesewas)
        self.assertGreater(snaps[0].charged_pesewas, 0)

    def test_direct_vendor_balance_follows_the_normal_wallet_account(self):
        escrow.record_order_payment(self.order(self.listing(self.direct, "Same", price="120.00"), 2))
        self.assertEqual(posting.account_for(Account.VENDOR_PENDING, self.direct).balance, 24000)


class DirectActivityTests(DirectBase):
    def test_direct_writes_are_recorded_in_the_activity_log(self):
        self.as_staff(self.ops)
        response = self.client.post(BASE, self.payload(), format="json")
        self.assertEqual(response.status_code, 201)
        event = ActivityEvent.objects.get(method="POST", actor_id=self.ops.pk)
        self.assertEqual((event.actor_type, event.actor_role), (ActivityEvent.STAFF, "operations"))
        self.assertEqual(event.after["request"]["name"], "Direct Kettle")
