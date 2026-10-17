"""Staff read customers' wallets and vendors' balances (wallets plan 3a, Task 9): wallets.view only, names and
balances, never an account number."""
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer, Role
from accounts.testing import make_staff, staff_token
from ledger import posting
from ledger.models import Account

URL = "/api/wallet/staff/wallets/"


def credit(kind, owner, pesewas, key):
    posting.post(key=key, kind="test", lines=[
        posting.debit(posting.account_for(Account.PROVIDER_CLEARING), pesewas), posting.credit(posting.account_for(kind, owner), pesewas),
    ])


class StaffWalletsBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.accountant = make_staff("accountant", "kofi@example.com")
        self.support = make_staff("support", "esi@example.com")

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")


@override_settings(LEDGER_ENABLED=True)
class StaffWalletsTests(StaffWalletsBase):
    def test_the_accountant_sees_customer_wallets_largest_first(self):
        ama = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        kojo = Customer.objects.create(full_name="Kojo Asare", phone="+233241234568", password_hash="x")
        credit(Account.CUSTOMER_WALLET, ama, 1250, "a")
        credit(Account.CUSTOMER_WALLET, kojo, 9000, "b")
        self.as_staff(self.accountant)
        page = self.client.get(URL).json()
        self.assertEqual(page["count"], 2)
        self.assertEqual(
            [(row["holder_id"], row["name"], row["balance"]) for row in page["results"]],
            [(kojo.pk, "Kojo Asare", "90.00"), (ama.pk, "Ama Owusu", "12.50")],
        )

    def test_vendors_show_pending_and_available_under_the_business_name(self):
        owner = BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x")
        BusinessOwnerProfile.objects.create(business_owner=owner, business_name="Adepa Ventures", payout_momo_number="+233201112233")
        credit(Account.VENDOR_PENDING, owner, 5000, "p")
        credit(Account.VENDOR_AVAILABLE, owner, 700, "v")
        self.as_staff(self.accountant)
        response = self.client.get(URL, {"kind": "vendor"})
        self.assertEqual(response.status_code, 200, response.content)
        row = response.json()["results"][0]
        self.assertEqual((row["holder_id"], row["name"], row["pending"], row["available"]), (owner.pk, "Adepa Ventures", "50.00", "7.00"))
        self.assertNotIn("201112233", response.content.decode())                              # never a payout number

    def test_an_unknown_kind_is_refused(self):
        self.as_staff(self.accountant)
        self.assertEqual(self.client.get(URL, {"kind": "drivers"}).status_code, 400)                # riders exist since Plan 5

    def test_only_wallets_view_holders_may_look(self):
        self.as_staff(self.support)
        self.assertEqual(self.client.get(URL).status_code, 403)

    def test_the_accountant_and_super_admin_hold_both_wallet_permissions(self):
        for role in ("accountant", "super_admin"):
            held = set(Role.objects.get(name=role).permissions.values_list("codename", flat=True))
            self.assertLessEqual({"wallets.view", "wallets.manage"}, held, role)


class StaffWalletsLedgerOffTests(StaffWalletsBase):
    def test_it_says_ledger_off(self):
        self.as_staff(self.accountant)
        response = self.client.get(URL)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
