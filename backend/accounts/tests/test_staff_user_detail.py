import json

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer, Role, StaffUser
from accounts.serializers import mask_but_last, owner_details_change
from accounts.testing import staff_token
from activity.models import ActivityEvent
from payments.models import CheckoutSession


class MaskHelperTests(TestCase):
    def test_masks_all_but_last_five(self):
        self.assertEqual(mask_but_last("0244123456"), "•••••23456")

    def test_short_value_is_fully_masked(self):
        # A value no longer than the keep length reveals nothing.
        self.assertEqual(mask_but_last("1234"), "••••")

    def test_empty_is_none(self):
        self.assertIsNone(mask_but_last(""))
        self.assertIsNone(mask_but_last(None))


class StaffUserDetailTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = StaffUser.objects.create(
            full_name="Admin Person", email="admin-detail@example.com", password_hash="x",
            role=Role.objects.get(name="operations"),
        )
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233241234567", email="ama-detail@example.com",
            address="12 Ash Road, Kumasi", password_hash=make_password("x"),
        )
        self.owner = BusinessOwner.objects.create(
            full_name="Kwame Trader", login_phone="+233201112233", email="kwame-detail@example.com",
            password_hash=make_password("x"),
        )
        self.profile = BusinessOwnerProfile.objects.create(
            business_owner=self.owner, business_kind="product", gps_address="AK-039-5028",
            tin="C0001234567", is_formal=True,
            payout_momo_network="MTN", payout_momo_name="Kwame Trader",
            payout_momo_number="0244999888", default_payout_method="momo",
        )
        CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.ORDER_CHECKOUT,
            amount="150.00", purpose="Order #5", status=CheckoutSession.SUCCESS,
        )

    def _auth(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.admin, 'staff')}")

    def test_customer_detail_includes_address_and_payment_history(self):
        self._auth()
        response = self.client.get(f"/api/accounts/customers/{self.customer.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["address"], "12 Ash Road, Kumasi")
        self.assertEqual(len(body["payment_history"]), 1)
        row = body["payment_history"][0]
        self.assertEqual(row["purpose"], "Order #5")
        self.assertEqual(row["amount"], "150.00")
        self.assertEqual(row["status"], "success")

    def test_customer_detail_never_ships_a_card_number_or_payment_type(self):
        """No payment-instrument model exists — the detail must not fabricate a
        'payment type' or 'last 5 digits' field for a customer.
        """
        self._auth()
        body = self.client.get(f"/api/accounts/customers/{self.customer.id}/").json()
        self.assertNotIn("payment_type", body)
        self.assertNotIn("card_last_5", body)

    def test_business_owner_detail_surfaces_profile_and_masks_payout_number(self):
        self._auth()
        response = self.client.get(f"/api/accounts/business-owners/{self.owner.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        profile = response.json()["profile"]
        self.assertEqual(profile["business_kind"], "product")
        self.assertEqual(profile["gps_address"], "AK-039-5028")
        self.assertEqual(profile["tin"], "C0001234567")
        self.assertEqual(profile["payout_momo_number_masked"], "•••••99888")

    def test_business_owner_detail_never_ships_the_full_payout_number(self):
        self._auth()
        raw = self.client.get(f"/api/accounts/business-owners/{self.owner.id}/").content.decode()
        self.assertNotIn("0244999888", raw)

    def test_business_owner_without_profile_is_tolerated(self):
        ownerless = BusinessOwner.objects.create(
            full_name="No Profile", login_phone="+233209990000", password_hash="x",
        )
        self._auth()
        response = self.client.get(f"/api/accounts/business-owners/{ownerless.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIsNone(response.json()["profile"])


class PayoutDetailPermissionTests(TestCase):
    """Payout + TIN are users.manage-only: a users.view-only session's
    business-owner detail must not carry those keys at all."""

    RESTRICTED = (
        "tin", "default_payout_method", "payout_verification_status", "payout_bank_name",
        "payout_bank_account_name", "payout_bank_account_number_masked",
        "payout_momo_network", "payout_momo_name", "payout_momo_number_masked",
    )

    # Same fixtures as StaffUserDetailTests (not subclassed, so its tests
    # don't run twice).
    _auth = StaffUserDetailTests._auth

    def setUp(self):
        StaffUserDetailTests.setUp(self)
        self.support = StaffUser.objects.create(
            full_name="Support Person", email="support-detail@example.com", password_hash="x",
            role=Role.objects.get(name="support"),
        )

    def _auth_support(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.support, 'staff')}")

    def test_view_only_session_gets_no_tin_or_payout_keys(self):
        self._auth_support()
        response = self.client.get(f"/api/accounts/business-owners/{self.owner.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        profile = response.json()["profile"]
        self.assertEqual(profile["business_kind"], "product")
        self.assertEqual(profile["gps_address"], "AK-039-5028")
        for key in self.RESTRICTED:
            self.assertNotIn(key, profile)
        self.assertFalse(any(k.startswith("payout_") for k in profile))
        raw = response.content.decode()
        self.assertNotIn("C0001234567", raw)
        self.assertNotIn("99888", raw)

    def test_manage_session_still_gets_tin_and_masked_payout(self):
        self._auth()
        profile = self.client.get(f"/api/accounts/business-owners/{self.owner.id}/").json()["profile"]
        for key in self.RESTRICTED:
            self.assertIn(key, profile)
        self.assertEqual(profile["tin"], "C0001234567")
        self.assertEqual(profile["payout_momo_number_masked"], "•••••99888")

    def test_view_only_session_keeps_customer_dob_gender_and_payment_history(self):
        self._auth_support()
        body = self.client.get(f"/api/accounts/customers/{self.customer.id}/").json()
        for key in ("gender", "date_of_birth", "payment_history"):
            self.assertIn(key, body)

    def test_patch_unchanged_manage_ok_and_view_only_forbidden(self):
        self._auth()
        response = self.client.patch(
            f"/api/accounts/business-owners/{self.owner.id}/", {"full_name": "Kwame T."}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["profile"]["payout_momo_number_masked"], "•••••99888")
        self._auth_support()
        response = self.client.patch(
            f"/api/accounts/business-owners/{self.owner.id}/", {"full_name": "Nope"}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.full_name, "Kwame T.")


class OwnerDetailsAuditTests(TestCase):
    """User decision U2: a staff edit to a business owner's details records one
    business_owner.details_changed event holding only the changed fields,
    masked — never the raw request body."""

    def setUp(self):
        StaffUserDetailTests.setUp(self)
        self.boss = StaffUser.objects.create(
            full_name="Boss Person", email="boss-detail@example.com", password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )

    def _auth(self, staff=None):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff or self.admin)}")

    def patch(self, body):
        self._auth()
        return self.client.patch(f"/api/accounts/business-owners/{self.owner.id}/", body, format="json")

    def test_an_edit_records_one_event_with_only_the_changed_fields(self):
        response = self.patch({
            "full_name": "Kwame A. Trader", "email": "kwame.new@example.com",
            "login_phone": "+233201112233",  # unchanged
            "profile": {"payout_momo_number": "0244999888", "tin": "C0001234567"},  # read-only, ignored
        })
        self.assertEqual(response.status_code, 200, response.content)
        event = ActivityEvent.objects.get()
        self.assertEqual(event.verb, "business_owner.details_changed")
        self.assertEqual((event.actor_type, event.actor_id), (ActivityEvent.STAFF, self.admin.pk))
        self.assertEqual((event.target_type, event.target_id), ("accounts.businessowner", str(self.owner.pk)))
        self.assertEqual(event.method, "PATCH")
        self.assertEqual(event.before, {"full_name": "Kwame Trader", "email": "kwame-detail@example.com"})
        self.assertEqual(event.after, {"full_name": "Kwame A. Trader", "email": "kwame.new@example.com"})
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.full_name, "Kwame A. Trader")

    def test_no_raw_payout_number_or_tin_reaches_the_activity_log(self):
        self.patch({"full_name": "Kwame A. Trader", "profile": {"payout_momo_number": "0244999888", "tin": "C0001234567"}})
        self.patch({"full_name": "Kwame A. Trader", "payout_momo_number": "0244999888"})  # a no-op
        stored = json.dumps(list(ActivityEvent.objects.values("before", "after", "summary")))
        self.assertNotIn("0244999888", stored)
        self.assertNotIn("C0001234567", stored)
        self.assertNotIn('"request"', stored)

    def test_a_patch_that_changes_nothing_records_nothing(self):
        response = self.patch({"full_name": "Kwame Trader", "login_phone": "+233201112233"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(ActivityEvent.objects.exists())

    def test_a_refused_patch_records_nothing_and_changes_nothing(self):
        response = self.patch({"email": "not-an-email"})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ActivityEvent.objects.exists())

    def test_the_change_shows_in_the_owners_activity_log(self):
        self.patch({"full_name": "Kwame A. Trader"})
        self._auth(self.boss)
        response = self.client.get(
            f"/api/activity/?target_type=accounts.businessowner&target_id={self.owner.pk}",
        )
        self.assertEqual(response.status_code, 200, response.content)
        rows = response.json()["results"]
        self.assertEqual([row["verb"] for row in rows], ["business_owner.details_changed"])
        self.assertEqual(rows[0]["after"], {"full_name": "Kwame A. Trader"})
        self.assertEqual(rows[0]["summary"], "Changed full name")

    def test_sensitive_values_are_masked_and_a_password_hash_never_kept(self):
        before = {
            "full_name": "Kwame Trader", "payout_momo_number": "0244999888",
            "payout_bank_account_number": "1234567890123", "tin": "C0001234567", "password_hash": "pbkdf2$old",
        }
        after = {
            "full_name": "Kwame Trader", "payout_momo_number": "0244111222",
            "payout_bank_account_number": "9876543210987", "tin": "C0009999999", "password_hash": "pbkdf2$new",
        }
        changed_before, changed_after = owner_details_change(before, after)
        self.assertEqual(changed_before, {
            "payout_momo_number": "•••••••888", "payout_bank_account_number": "••••••••••123", "tin": "••••••••567",
        })
        self.assertEqual(changed_after, {
            "payout_momo_number": "•••••••222", "payout_bank_account_number": "••••••••••987", "tin": "••••••••999",
        })
        self.assertEqual(owner_details_change({"full_name": "A"}, {"full_name": "A"}), ({}, {}))
