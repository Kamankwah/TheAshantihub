"""Ashanti Direct, the company business (marketplace Plan 2, Task 11): the one company owner, its command, and the
`direct.operate` permission. Money behaviour is pinned in listings/tests/test_direct_listings.py."""
from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings

from accounts import direct
from accounts.models import BusinessOwner, Role
from accounts.testing import make_staff

SETTINGS = {"ASHANTI_DIRECT_PHONE": "0244000111", "ASHANTI_DIRECT_EMAIL": "direct@theashantihub.com"}


@override_settings(**SETTINGS)
class EnsureAshantiDirectTests(TestCase):
    def test_command_creates_ashanti_direct_once(self):
        call_command("ensure_ashanti_direct", stdout=StringIO())
        call_command("ensure_ashanti_direct", stdout=StringIO())
        owner = BusinessOwner.objects.get(is_company=True)
        self.assertEqual(BusinessOwner.objects.filter(is_company=True).count(), 1)
        self.assertEqual(owner.full_name, "Ashanti Direct")
        self.assertEqual(owner.kyc_status, BusinessOwner.VERIFIED)
        self.assertEqual(owner.login_phone, "+233244000111")
        self.assertEqual(owner.email, "direct@theashantihub.com")
        self.assertEqual(owner.profile.business_name, "Ashanti Direct")
        self.assertEqual(owner.profile.business_kind, "product")
        self.assertEqual(direct.ashanti_direct().pk, owner.pk)
        self.assertTrue(direct.is_direct(owner))

    def test_password_is_unusable_until_a_super_admin_sets_one(self):
        call_command("ensure_ashanti_direct", stdout=StringIO())
        from django.contrib.auth.hashers import check_password, is_password_usable

        owner = direct.ashanti_direct()
        self.assertFalse(is_password_usable(owner.password_hash))
        self.assertFalse(check_password("", owner.password_hash))

    def test_ashanti_direct_raises_lookup_error_until_created(self):
        with self.assertRaises(LookupError):
            direct.ashanti_direct()

    def test_command_refuses_a_blank_phone_or_email_and_creates_nothing(self):
        for key in SETTINGS:
            with override_settings(**{key: ""}):
                with self.assertRaises(CommandError):
                    call_command("ensure_ashanti_direct", stdout=StringIO())
        self.assertFalse(BusinessOwner.objects.filter(is_company=True).exists())

    def test_the_phone_check_ignores_how_a_stored_phone_was_written(self):
        BusinessOwner.objects.create(full_name="Old", login_phone="0244 000 111", password_hash="x")
        with self.assertRaises(CommandError):
            call_command("ensure_ashanti_direct", stdout=StringIO())
        self.assertFalse(BusinessOwner.objects.filter(is_company=True).exists())

    def test_only_one_company_owner_can_exist(self):
        call_command("ensure_ashanti_direct", stdout=StringIO())
        with self.assertRaises(IntegrityError), transaction.atomic():
            BusinessOwner.objects.create(
                full_name="Second Company", login_phone="+233207000999", password_hash="x", is_company=True,
            )
        # Any number of ordinary businesses is fine.
        BusinessOwner.objects.create(full_name="A", login_phone="+233207000998", password_hash="x")
        BusinessOwner.objects.create(full_name="B", login_phone="+233207000997", password_hash="x")


class DirectPermissionTests(TestCase):
    def test_operations_holds_direct_operate_and_support_does_not(self):
        ops = make_staff("operations", "ops@example.com")
        boss = make_staff("super_admin", "boss@example.com")
        support = make_staff("support", "support@example.com")
        self.assertIn("direct.operate", ops.effective_permission_codenames())
        self.assertIn("direct.operate", boss.effective_permission_codenames())
        self.assertNotIn("direct.operate", support.effective_permission_codenames())
        self.assertTrue(direct.is_operator(ops))
        self.assertFalse(direct.is_operator(support))
        self.assertFalse(direct.is_operator(BusinessOwner(full_name="x")))



class NoMoneyCodeBranchesOnTheCompanyTests(TestCase):
    def test_no_money_package_mentions_is_company(self):
        backend = Path(__file__).resolve().parents[2]
        offenders = []
        for package in ("ledger", "wallets", "payments", "billing"):
            for path in (backend / package).rglob("*.py"):
                if "migrations" in path.parts or "tests" in path.parts:
                    continue
                if "is_company" in path.read_text():
                    offenders.append(str(path.relative_to(backend)))
        self.assertEqual(offenders, [])
