from django.core import mail
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase, override_settings

from accounts.models import Role, StaffUser
from activity import services
from activity.tasks import verify_activity_chain_nightly
from notifications.models import Notification


class NightlyChainCheckTests(TestCase):
    def setUp(self):
        self.boss = StaffUser.objects.create(
            full_name="Simon Peter", email="boss@example.com", password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )

    def test_a_clean_chain_passes_without_alerts(self):
        services.record(None, "test.ok")
        verify_activity_chain_nightly()
        self.assertFalse(Notification.objects.filter(kind="activity_chain_broken").exists())
        self.assertEqual(len(mail.outbox), 0)

    @override_settings(ACTIVITY_SEAL_EMAIL=True)
    def test_production_emails_the_seal(self):
        services.record(None, "test.ok")
        verify_activity_chain_nightly()
        self.assertEqual(mail.outbox[0].to, ["boss@example.com"])

    def test_a_broken_chain_alerts_super_admins_and_fails_the_job(self):
        events = [services.record(None, f"test.{i}") for i in range(2)]
        with connection.cursor() as cursor:
            cursor.execute("ALTER TABLE activity_activityevent DISABLE TRIGGER activity_event_no_update")
            cursor.execute("UPDATE activity_activityevent SET summary = 'forged' WHERE id = %s", [events[0].pk])
            cursor.execute("ALTER TABLE activity_activityevent ENABLE TRIGGER activity_event_no_update")
        with self.assertRaises(CommandError):
            verify_activity_chain_nightly()
        self.assertTrue(Notification.objects.filter(staff=self.boss, kind="activity_chain_broken").exists())
