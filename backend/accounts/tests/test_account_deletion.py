from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer, CustomerAddress, MobileSession
from listings.models import Category, Listing, Promotion, Zone
from marketing import consent as marketing_consent
from marketing.models_consent import SMS, ConsentRecord
from otp.models import VerifiedContact
from wallets.models import PayoutDestination
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
        body = response.json()
        self.assertEqual((body["code"], body["reasons"]), ("deletion_blocked", ["open_orders"]))
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

    def test_old_undelivered_order_does_not_block_but_a_recent_one_does_and_names_the_order(self):
        old = self._paid_order(self._listing())
        Order.objects.filter(pk=old.pk).update(placed_at=timezone.now() - timedelta(days=60))
        self._auth(self.customer, "customer")
        self.assertEqual(self.client.post(URL, {"password": PASSWORD}, format="json").status_code, 204)

    def test_recent_open_order_names_its_id(self):
        order = self._paid_order(self._listing())
        self._auth(self.customer, "customer")
        body = self.client.post(URL, {"password": PASSWORD}, format="json").json()
        self.assertEqual(body["order_ids"], [order.pk])

    @override_settings(OTP_STEP_UP_ENFORCED=True)
    def test_deletion_asks_for_a_step_up_code_when_enforced(self):
        self._auth(self.customer, "customer")
        response = self.client.post(URL, {"password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json().get("code"), "step_up_required")
        self.customer.refresh_from_db()
        self.assertIsNone(self.customer.deleted_at)

    def test_company_account_cannot_delete_itself(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(is_company=True)
        self._auth(self.owner, "business_owner")
        response = self.client.post(URL, {"password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertIn("company_account", response.json()["reasons"])

    def test_open_withdrawal_blocks_deletion(self):
        from wallets.models import Withdrawal

        dest = PayoutDestination.objects.create(
            holder_type="customer", holder_id=self.customer.pk, rail="momo", institution="MTN",
            account_number="0241234567", account_name="Ama Owusu", matched_name="Ama Owusu",
            name_source="simulated", usable_from=timezone.now(),
        )
        Withdrawal.objects.create(
            holder_type="customer", holder_id=self.customer.pk, destination=dest, amount_pesewas=1000,
            charge_pesewas=0, net_pesewas=1000, status=Withdrawal.PENDING, reference="wd-test-1",
        )
        self._auth(self.customer, "customer")
        response = self.client.post(URL, {"password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertIn("open_withdrawal", response.json()["reasons"])

    def test_owner_deletion_closes_unpublished_listings_and_hides_them(self):
        pending = self._listing(status=Listing.PENDING_REVIEW)
        self._auth(self.owner, "business_owner")
        self.assertEqual(self.client.post(URL, {"password": PASSWORD}, format="json").status_code, 204)
        pending.refresh_from_db()
        self.assertEqual(pending.status, Listing.DISCONTINUED)

    def test_deleted_business_listings_are_hidden_even_if_published(self):
        from listings.visibility import hidden_business_q

        listing = self._listing()
        BusinessOwner.objects.filter(pk=self.owner.pk).update(deleted_at=timezone.now())
        hidden = Listing.objects.filter(hidden_business_q("business_owner__"), pk=listing.pk)
        self.assertTrue(hidden.exists())

    def test_erasure_reaches_payout_numbers_contacts_consent_and_listing_phones(self):
        PayoutDestination.objects.create(
            holder_type="business_owner", holder_id=self.owner.pk, rail="momo", institution="MTN",
            account_number="0207886600", account_name="Kwame Trader", matched_name="Kwame Trader",
            name_source="simulated", usable_from=timezone.now(),
        )
        VerifiedContact.objects.create(
            account_type="business_owner", account_id=self.owner.pk, channel="sms", destination="+233207886600",
        )
        ConsentRecord.objects.create(
            channel=SMS, status=ConsentRecord.OPTED_IN, source="test", wording_text="x", business_owner=self.owner,
        )
        listing = self._listing(status=Listing.DROPPED)
        BusinessOwnerProfile.objects.filter(business_owner=self.owner).update(identity_status="verified")
        self._auth(self.owner, "business_owner")
        self.assertEqual(self.client.post(URL, {"password": PASSWORD}, format="json").status_code, 204)
        self.assertFalse(PayoutDestination.objects.filter(holder_id=self.owner.pk, removed_at__isnull=True).exists())
        self.assertFalse(VerifiedContact.objects.filter(account_type="business_owner", account_id=self.owner.pk).exists())
        self.assertFalse(marketing_consent.is_opted_in(self.owner, SMS))
        listing.refresh_from_db()
        self.assertEqual(listing.contact_phone, "")
        self.owner.profile.refresh_from_db()
        self.assertEqual(self.owner.profile.identity_status, "not_submitted")

    def test_list_body_is_400_not_500(self):
        self._auth(self.customer, "customer")
        self.assertEqual(self.client.post(URL, [1, 2], format="json").status_code, 400)

    def test_owner_deletion_saves_only_what_it_erases_so_a_newer_category_change_survives(self):
        """Deletion erases from a profile loaded earlier; a category change committed in between must not be undone."""
        from accounts import deletion
        from accounts.categories import categories_of, set_categories

        first, second = Category.objects.filter(kind="product").order_by("pk")[:2]
        BusinessOwnerProfile.objects.filter(business_owner=self.owner).update(
            business_kind="product", ghana_card_number="GHA-333333333-3",
        )
        set_categories(BusinessOwnerProfile.objects.get(business_owner=self.owner), [first.pk])
        account = BusinessOwner.objects.select_related("profile").get(pk=self.owner.pk)
        self.assertEqual(account.profile.business_category_id, first.pk)  # the copy deletion will save from
        # Committed after that copy was loaded, as a concurrent owner PUT would be.
        set_categories(BusinessOwnerProfile.objects.get(business_owner=self.owner), [second.pk, first.pk])

        deletion.delete_account(account, "business_owner")

        profile = BusinessOwnerProfile.objects.get(business_owner=self.owner)
        self.assertEqual(profile.business_category_id, second.pk)
        self.assertEqual([c.pk for c in categories_of(profile)], [second.pk, first.pk])
        self.assertIsNone(profile.ghana_card_number)
        self.assertIsNone(profile.payout_momo_number)
        self.assertEqual(profile.identity_status, BusinessOwnerProfile.IDENTITY_NOT_SUBMITTED)
