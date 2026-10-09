import os
from io import StringIO
from unittest import mock

from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings

from accounts.models import BusinessOwner
from accounts.testing import make_staff
from approvals.models import ApprovalRequest

PASSWORD = "Demo-test-pass-1"


@override_settings(DEBUG=True)
class SeedPhase2DemoTests(TestCase):
    def setUp(self):
        self.lead = make_staff("operations", "staging-admin@example.com")
        self.scout = make_staff("scout", "staging-scout@example.com")

    def run_seed(self, password=PASSWORD):
        out = StringIO()
        args = ["--password", password] if password is not None else []
        call_command("seed_phase2_demo", *args, stdout=out)
        return out.getvalue()

    @override_settings(SUBSCRIPTION_PAUSE_ENABLED=True)
    def test_seeds_demo_businesses_for_the_scout_under_the_operations_lead(self):
        self.run_seed()
        self.scout.refresh_from_db()
        self.assertEqual(self.scout.manager_id, self.lead.pk)
        demo = BusinessOwner.objects.filter(email__endswith="@example.com", full_name__startswith="Demo ")
        self.assertEqual(demo.count(), 4)
        self.assertTrue(all(o.account_manager_id == self.scout.pk for o in demo))
        pending = demo.get(login_phone="+233550000201")
        self.assertTrue(pending.needs_claim)
        self.assertTrue(
            ApprovalRequest.objects.filter(kind="business.kyc", target_id=str(pending.pk), status="pending").exists()
        )
        overdue = demo.get(login_phone="+233550000203")
        self.assertIsNotNone(overdue.subscription.overdue_since)
        paused = demo.get(login_phone="+233550000204")
        self.assertIsNotNone(paused.subscription.paused_at)

    @override_settings(SUBSCRIPTION_PAUSE_ENABLED=False)
    def test_with_the_pause_off_the_would_be_paused_business_is_seeded_overdue(self):
        self.run_seed()
        spares = BusinessOwner.objects.get(login_phone="+233550000204")
        self.assertIsNone(spares.subscription.paused_at)
        self.assertIsNotNone(spares.subscription.overdue_since)

    def test_running_twice_changes_nothing(self):
        self.run_seed()
        counts = (BusinessOwner.objects.count(), ApprovalRequest.objects.count())
        self.run_seed()
        self.assertEqual((BusinessOwner.objects.count(), ApprovalRequest.objects.count()), counts)

    @override_settings(DEBUG=False)
    def test_refuses_outside_debug_unless_the_environment_is_staging(self):
        with mock.patch.dict(os.environ, {"SENTRY_ENVIRONMENT": "production"}):
            with self.assertRaises(CommandError):
                self.run_seed()
        with mock.patch.dict(os.environ, {"SENTRY_ENVIRONMENT": "staging"}):
            self.run_seed()  # allowed on staging

    def test_needs_the_two_staging_accounts(self):
        self.scout.delete()
        with self.assertRaises(CommandError):
            self.run_seed()

    def test_needs_a_password_of_at_least_eight_characters(self):
        with self.assertRaises(CommandError):
            self.run_seed(password=None)
        with self.assertRaises(CommandError):
            self.run_seed(password="short")
        self.assertFalse(BusinessOwner.objects.filter(full_name__startswith="Demo ").exists())
