from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer, CustomerAddress, MobileSession
from listings.models import Category, Listing, Promotion, Zone
from orders.models import Order, OrderItem

PASSWORD = "s3cret-pass"
URL = "/api/accounts/me/delete/"


class AccountDeletionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.customer = Customer.objects.create(
            full_name="Ama Owusu", phone="+233241234567", email="ama@example.com",
            password_hash=make_password(PASSWORD), address="Adum", secondary_email="ama2@example.com",
        )
        CustomerAddress.objects.create(
            customer=self.customer, label="Home", gps_address="AK-039-5028", landmark="Near the market",
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Trader", login_phone="+233207886600", email="kwame@example.com",
            password_hash=make_password(PASSWORD),
        )
        BusinessOwnerProfile.objects.create(
            business_owner=self.owner, payout_momo_number="0207886600", payout_momo_name="Kwame Trader",
        )
        self.zone = Zone.objects.get(name="Manhyia")
        self.category = Category.objects.filter(kind="product").first()

    def _auth(self, account, kind):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")

    def _listing(self, status=Listing.PUBLISHED):
        return Listing.objects.create(
            business_owner=self.owner, category=self.category, zone=self.zone, name="Kente Cloth",
            description="D.", contact_phone="+233207886600", price_amount="100.00", status=status,
        )

    def _paid_order(self, listing, delivery_status=Order.PROCESSING):
        order = Order.objects.create(
            customer=self.customer, status=Order.PAID, delivery_status=delivery_status, total_amount="100.00",
        )
        OrderItem.objects.create(order=order, listing=listing, quantity=1, unit_price="100.00", line_total="100.00")
        return order

    def test_customer_delete_anonymises_and_blocks_login(self):
        self._auth(self.customer, "customer")
        response = self.client.post(URL, {"password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 204)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.full_name, "Deleted user")
        self.assertIsNone(self.customer.phone)
        self.assertIsNone(self.customer.email)
        self.assertIsNone(self.customer.secondary_email)
        self.assertIsNone(self.customer.address)
        self.assertIsNotNone(self.customer.deleted_at)
        self.assertFalse(check_password(PASSWORD, self.customer.password_hash))
        self.assertEqual(self.customer.addresses.count(), 0)
        self.client.credentials()
        login = self.client.post(
            "/api/accounts/customers/login/", {"identifier": "+233241234567", "password": PASSWORD}, format="json",
        )
        self.assertEqual(login.status_code, 400)

    def test_wrong_password_changes_nothing(self):
        self._auth(self.customer, "customer")
        response = self.client.post(URL, {"password": "not-it"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "wrong_password")
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.full_name, "Ama Owusu")
        self.assertIsNone(self.customer.deleted_at)

    def test_customer_with_open_order_is_blocked_with_reason(self):
        self._paid_order(self._listing())
        self._auth(self.customer, "customer")
        response = self.client.post(URL, {"password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"code": "deletion_blocked", "reasons": ["open_orders"]})
        self.customer.refresh_from_db()
        self.assertIsNone(self.customer.deleted_at)

    def test_delivered_order_does_not_block_and_is_kept(self):
        order = self._paid_order(self._listing(), delivery_status=Order.DELIVERED)
        self._auth(self.customer, "customer")
        self.assertEqual(self.client.post(URL, {"password": PASSWORD}, format="json").status_code, 204)
        self.assertTrue(Order.objects.filter(pk=order.pk).exists())

    def test_owner_with_live_listing_is_blocked(self):
        self._listing()
        self._auth(self.owner, "business_owner")
        response = self.client.post(URL, {"password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertIn("live_listings", response.json()["reasons"])

    def test_owner_with_active_promotion_is_blocked(self):
        listing = self._listing(status=Listing.DROPPED)
        now = timezone.now()
        Promotion.objects.create(
            listing=listing, kind=Promotion.BOOST, starts_at=now - timedelta(hours=1),
            ends_at=now + timedelta(days=3), amount_paid="35.00", status=Promotion.ACTIVE,
        )
        self._auth(self.owner, "business_owner")
        response = self.client.post(URL, {"password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["reasons"], ["active_promotion"])

    def test_owner_with_no_blockers_is_anonymised(self):
        self._listing(status=Listing.DROPPED)
        self._auth(self.owner, "business_owner")
        self.assertEqual(self.client.post(URL, {"password": PASSWORD}, format="json").status_code, 204)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.full_name, "Deleted user")
        self.assertEqual(self.owner.login_phone, f"deleted-{self.owner.pk}")
        self.assertIsNone(self.owner.email)
        self.assertIsNotNone(self.owner.deleted_at)
        self.owner.profile.refresh_from_db()
        self.assertFalse(self.owner.profile.payout_momo_number)

    def test_token_stops_working_after_deletion_so_second_delete_is_401(self):
        self._auth(self.customer, "customer")
        self.assertEqual(self.client.post(URL, {"password": PASSWORD}, format="json").status_code, 204)
        self.assertEqual(self.client.post(URL, {"password": PASSWORD}, format="json").status_code, 401)

    def test_deletion_revokes_mobile_sessions(self):
        MobileSession.objects.create(
            account_type="customer", account_id=self.customer.pk, family="f" * 32, token_hash="h" * 64,
            expires_at=timezone.now() + timedelta(days=1),
        )
        self._auth(self.customer, "customer")
        self.client.post(URL, {"password": PASSWORD}, format="json")
        self.assertFalse(MobileSession.objects.filter(revoked_at__isnull=True).exists())

    def test_the_same_phone_can_register_again(self):
        self._auth(self.customer, "customer")
        self.client.post(URL, {"password": PASSWORD}, format="json")
        self.client.credentials()
        response = self.client.post(
            "/api/accounts/customers/register/",
            {"full_name": "Ama Again", "phone": "+233241234567", "password": "another-pass-1"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_staff_cannot_use_the_endpoint(self):
        from accounts.models import Role, StaffUser

        staff = StaffUser.objects.create(
            email="s@example.com", full_name="Staff", password_hash=make_password(PASSWORD),
            role=Role.objects.first(),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")
        self.assertEqual(self.client.post(URL, {"password": PASSWORD}, format="json").status_code, 403)

    def test_two_owners_with_ghana_cards_can_both_delete(self):
        """The card number column is unique, so erasing it must store NULL, never an empty string twice."""
        second = BusinessOwner.objects.create(
            full_name="Efua Trader", login_phone="+233207886611", password_hash=make_password(PASSWORD),
        )
        BusinessOwnerProfile.objects.filter(business_owner=self.owner).update(ghana_card_number="GHA-111111111-1")
        BusinessOwnerProfile.objects.create(business_owner=second, ghana_card_number="GHA-222222222-2")
        for owner in (self.owner, second):
            self._auth(owner, "business_owner")
            response = self.client.post(URL, {"password": PASSWORD}, format="json")
            self.assertEqual(response.status_code, 204, response.content)
        self.assertEqual(BusinessOwnerProfile.objects.filter(ghana_card_number__isnull=True).count(), 2)
