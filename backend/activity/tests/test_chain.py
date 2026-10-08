import threading
from io import StringIO

from django.core import mail
from django.core.management import CommandError, call_command
from django.db import IntegrityError, InternalError, connection, transaction
from django.test import RequestFactory, TestCase, TransactionTestCase

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

    def test_personal_numbers_are_masked_before_hashing(self):
        event = services.record(
            self.staff, "test.mask",
            after={"counterpart_phone": "0244123118", "nested": {"payout_momo_number": 551234567}, "note": "x", "momo_number": None},
        )
        self.assertTrue(event.after["counterpart_phone"].endswith("118"))
        self.assertNotIn("0244123118", event.after["counterpart_phone"])
        self.assertTrue(event.after["nested"]["payout_momo_number"].endswith("567"))
        self.assertEqual((event.after["note"], event.after["momo_number"]), ("x", None))
        self.assertEqual(services.verify_chain(), (True, None))

    def test_target_instance_fills_target_fields(self):
        event = services.record(self.staff, "test.target", target=self.staff)
        self.assertEqual(
            (event.target_type, event.target_id, event.target_label),
            ("accounts.staffuser", str(self.staff.pk), str(self.staff)),
        )

    def test_nul_is_stripped_from_the_label_and_summary_before_hashing(self):
        event = services.record(self.staff, "test.nul", target_label="Bon\x00wire", summary="sum\x00mary")
        event.refresh_from_db()
        self.assertEqual((event.target_label, event.summary), ("Bonwire", "summary"))
        self.assertEqual(services.verify_chain(), (True, None))

    def test_secrets_are_redacted(self):
        event = services.record(
            self.staff, "test.redact",
            after={"password": "hunter2", "nested": {"invite_token": "abc"}, "reason": "ok"},
        )
        self.assertEqual(event.after["password"], "[redacted]")
        self.assertEqual(event.after["nested"]["invite_token"], "[redacted]")
        self.assertEqual(event.after["reason"], "ok")

    def test_code_pin_and_credential_keys_are_redacted_but_codenames_kept(self):
        event = services.record(
            self.staff, "test.redact2",
            after={
                "code": "1", "delivery_code": "2", "pin": "3", "api_key": "4", "Authorization": "5",
                "codename": "users.view", "codenames": ["a"],
            },
        )
        for key in ("code", "delivery_code", "pin", "api_key", "Authorization"):
            self.assertEqual(event.after[key], "[redacted]", key)
        self.assertEqual(event.after["codename"], "users.view")
        self.assertEqual(event.after["codenames"], ["a"])

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
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        self.assertEqual(errors, [])
        self.assertEqual(ActivityEvent.objects.count(), 30)
        self.assertEqual(ActivityEvent.objects.values("prev_hash").distinct().count(), 30)
        self.assertEqual(services.verify_chain(), (True, None))


class PrevHashUniqueTests(TestCase):
    def test_a_forked_prev_hash_is_rejected(self):
        first = services.record(None, "test.first")
        services.record(None, "test.second")
        fork = ActivityEvent(
            occurred_at=first.occurred_at, actor_type="system", verb="test.fork", prev_hash=first.prev_hash, hash="f" * 64,
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            fork.save(force_insert=True)


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

    def test_seal_skips_suspended_super_admins_and_warns_when_none(self):
        role = Role.objects.get(name="super_admin")
        StaffUser.objects.create(full_name="Gone", email="gone@example.com", password_hash="x", role=role, is_suspended=True)
        services.record(None, "test.one")
        with self.assertLogs("activity.management.commands.verify_activity_chain", level="WARNING") as logs:
            call_command("verify_activity_chain", "--email-seal", stdout=StringIO())
        self.assertIn("No active Super Admin to receive the activity seal", logs.output[0])
        self.assertEqual(mail.outbox, [])

    def test_broken_chain_fails(self):
        event = services.record(None, "test.one")
        with connection.cursor() as cursor:
            cursor.execute("ALTER TABLE activity_activityevent DISABLE TRIGGER activity_event_no_update")
            cursor.execute("UPDATE activity_activityevent SET verb = 'forged' WHERE id = %s", [event.pk])
            cursor.execute("ALTER TABLE activity_activityevent ENABLE TRIGGER activity_event_no_update")
        with self.assertRaises(CommandError):
            call_command("verify_activity_chain", stdout=StringIO())


class RequestCaptureTests(TestCase):
    def test_ip_comes_from_x_real_ip_canonicalised_and_chain_verifies(self):
        request = RequestFactory().get(
            "/", HTTP_X_REAL_IP="2001:DB8:0000::0001", HTTP_X_FORWARDED_FOR="9.9.9.9",
            HTTP_USER_AGENT="TestAgent/1.0",
        )
        request.activity_request_id = "req-123"
        event = services.record(None, "test.request", request=request)
        self.assertEqual(event.ip, "2001:db8::1")
        reloaded = ActivityEvent.objects.get(pk=event.pk)
        self.assertEqual(reloaded.ip, "2001:db8::1")
        self.assertEqual(reloaded.user_agent, "TestAgent/1.0")
        self.assertEqual(reloaded.request_id, "req-123")
        self.assertEqual(services.verify_chain(), (True, None))

    def test_invalid_ip_is_stored_as_none(self):
        request = RequestFactory().get("/", HTTP_X_REAL_IP="1.2.3.4:443")
        event = services.record(None, "test.badip", request=request)
        self.assertIsNone(ActivityEvent.objects.get(pk=event.pk).ip)
        self.assertEqual(services.verify_chain(), (True, None))
