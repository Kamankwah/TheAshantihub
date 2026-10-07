import threading
from io import StringIO

from django.core import mail
from django.core.management import CommandError, call_command
from django.db import InternalError, connection, transaction
from django.test import TestCase, TransactionTestCase

from accounts.models import Role, StaffUser
from activity import services
from activity.models import ActivityEvent


class ChainTests(TestCase):
    def setUp(self):
        self.staff = StaffUser.objects.create(
            full_name="Ama Boateng", email="ama@example.com", password_hash="x",
            role=Role.objects.get(name="operations"),
        )

    def test_events_link_to_genesis_then_to_each_other(self):
        first = services.record(self.staff, "test.first")
        second = services.record(None, "test.second", summary="system job")
        self.assertEqual(first.prev_hash, services.GENESIS)
        self.assertEqual(second.prev_hash, first.hash)
        self.assertEqual((first.actor_type, first.actor_role, first.actor_label), ("staff", "operations", "Ama Boateng"))
        self.assertEqual((second.actor_type, second.actor_label), ("system", "System"))

    def test_target_instance_fills_target_fields(self):
        event = services.record(self.staff, "test.target", target=self.staff)
        self.assertEqual(
            (event.target_type, event.target_id, event.target_label),
            ("accounts.staffuser", str(self.staff.pk), str(self.staff)),
        )

    def test_secrets_are_redacted(self):
        event = services.record(
            self.staff, "test.redact",
            after={"password": "hunter2", "nested": {"invite_token": "abc"}, "reason": "ok"},
        )
        self.assertEqual(event.after["password"], "[redacted]")
        self.assertEqual(event.after["nested"]["invite_token"], "[redacted]")
        self.assertEqual(event.after["reason"], "ok")

    def test_large_payloads_are_truncated(self):
        event = services.record(self.staff, "test.big", after={"blob": "x" * 20000})
        self.assertTrue(event.after["truncated"])

    def test_chain_verifies_after_reload(self):
        for i in range(5):
            services.record(self.staff, f"test.{i}", after={"n": i, "price": 12.5})
        self.assertEqual(services.verify_chain(), (True, None))

    def test_update_and_delete_are_refused(self):
        event = services.record(self.staff, "test.locked")
        with self.assertRaises(InternalError):
            with transaction.atomic():
                ActivityEvent.objects.filter(pk=event.pk).update(summary="changed")
        with self.assertRaises(InternalError):
            with transaction.atomic():
                ActivityEvent.objects.filter(pk=event.pk).delete()

    def test_tampering_is_detected(self):
        events = [services.record(self.staff, f"test.{i}") for i in range(3)]
        with connection.cursor() as cursor:
            cursor.execute("ALTER TABLE activity_activityevent DISABLE TRIGGER activity_event_no_update")
            cursor.execute("UPDATE activity_activityevent SET summary = 'forged' WHERE id = %s", [events[1].pk])
            cursor.execute("ALTER TABLE activity_activityevent ENABLE TRIGGER activity_event_no_update")
        self.assertEqual(services.verify_chain(), (False, events[1].pk))


class ConcurrentChainTests(TransactionTestCase):
    serialized_rollback = True

    def test_simultaneous_records_do_not_fork_the_chain(self):
        errors = []

        def worker(n):
            try:
                for i in range(10):
                    services.record(None, f"test.thread{n}.{i}")
            except Exception as exc:  # surfaced through the assertion below
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker, args=(n,)) for n in range(3)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(ActivityEvent.objects.count(), 30)
        self.assertEqual(ActivityEvent.objects.values("prev_hash").distinct().count(), 30)
        self.assertEqual(services.verify_chain(), (True, None))


class VerifyCommandTests(TestCase):
    def test_ok_chain_prints_and_emails_the_seal(self):
        StaffUser.objects.create(
            full_name="Boss", email="boss@example.com", password_hash="x", role=Role.objects.get(name="super_admin")
        )
        services.record(None, "test.one")
        out = StringIO()
        call_command("verify_activity_chain", "--email-seal", stdout=out)
        self.assertIn("OK · 1 events", out.getvalue())
        self.assertEqual(mail.outbox[0].to, ["boss@example.com"])

    def test_broken_chain_fails(self):
        event = services.record(None, "test.one")
        with connection.cursor() as cursor:
            cursor.execute("ALTER TABLE activity_activityevent DISABLE TRIGGER activity_event_no_update")
            cursor.execute("UPDATE activity_activityevent SET verb = 'forged' WHERE id = %s", [event.pk])
            cursor.execute("ALTER TABLE activity_activityevent ENABLE TRIGGER activity_event_no_update")
        with self.assertRaises(CommandError):
            call_command("verify_activity_chain", stdout=StringIO())
