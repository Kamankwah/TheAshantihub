from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role
from accounts.testing import make_staff, staff_token
from activity.models import ChainCheck
from core import integrations, jobs, system_health
from core.models import JobRun


class SettingsScreensBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")

    def as_staff(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")


class IntegrationsTests(SettingsScreensBase):
    def test_only_super_admin_reads_it_and_super_admin_holds_the_permission(self):
        self.as_staff(self.lead)
        self.assertEqual(self.client.get("/api/integrations/").status_code, 403)
        self.as_staff(self.boss)
        self.assertEqual(self.client.get("/api/integrations/").status_code, 200)
        self.assertTrue(Role.objects.get(name="super_admin").permissions.filter(codename="system.view").exists())

    @override_settings(HUBTEL_CLIENT_ID="", PAYMENTS_PROVIDER="simulated", SENTRY_DSN="", EMAIL_HOST="", EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend")
    def test_nothing_connected_says_what_is_missing(self):
        by_key = {i["key"]: i for i in integrations.statuses()}
        self.assertEqual(by_key["payments"]["status"], "simulated")
        self.assertIn("Hubtel client id", by_key["payments"]["missing"])
        for key in ("sms", "whatsapp", "push", "email", "errors", "routing"):
            self.assertEqual(by_key[key]["status"], "not_connected", key)
            self.assertTrue(by_key[key]["missing"], key)
        self.assertEqual(by_key["maps"]["status"], "connected")

    @override_settings(
        HUBTEL_CLIENT_ID="id-123", HUBTEL_CLIENT_SECRET="super-secret-value", HUBTEL_MERCHANT_ACCOUNT="m", HUBTEL_WEBHOOK_SECRET="hook-secret", HUBTEL_CALLBACK_URL="https://x.test/cb",
        PAYMENTS_PROVIDER="hubtel", SENTRY_DSN="https://key@sentry.example/1", EMAIL_HOST="mail.example", EMAIL_HOST_PASSWORD="mail-password",
        EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
    )
    def test_connected_services_never_reveal_a_key(self):
        self.as_staff(self.boss)
        response = self.client.get("/api/integrations/")
        by_key = {i["key"]: i for i in response.json()["items"]}
        for key in ("payments", "email", "errors"):
            self.assertEqual(by_key[key]["status"], "connected", key)
        text = response.content.decode()
        for secret in ("super-secret-value", "hook-secret", "mail-password", "key@sentry", "mail.example", "id-123"):
            self.assertNotIn(secret, text)


class JobHeartbeatTests(SettingsScreensBase):
    def test_a_scheduled_task_leaves_a_run_record_and_a_failure_is_kept(self):
        task = "approvals.tasks.escalate_due_approvals"
        t0 = timezone.now()
        jobs.mark_started(task, now=t0)
        jobs.mark_finished(task, ok=True, now=t0 + timedelta(seconds=2))
        run = JobRun.objects.get(task=task)
        self.assertEqual((run.last_status, run.last_duration_ms), ("ok", 2000))
        jobs.mark_started(task, now=t0 + timedelta(minutes=5))
        jobs.mark_finished(task, ok=False, error="ValueError: boom", now=t0 + timedelta(minutes=5, seconds=1))
        run.refresh_from_db()
        self.assertEqual((run.last_status, run.last_error), ("failed", "ValueError: boom"))

    def test_only_tasks_in_the_beat_schedule_are_tracked(self):
        self.assertTrue(jobs._tracked("approvals.tasks.escalate_due_approvals"))
        self.assertFalse(jobs._tracked("some.other.task"))

    def test_the_real_signal_records_a_run_of_a_scheduled_task(self):
        from approvals.tasks import escalate_due_approvals

        escalate_due_approvals.apply()
        run = JobRun.objects.get(task="approvals.tasks.escalate_due_approvals")
        self.assertEqual(run.last_status, "ok")
        self.assertIsNotNone(run.last_finished_at)


class SystemHealthTests(SettingsScreensBase):
    def get(self):
        self.as_staff(self.boss)
        return self.client.get("/api/system-health/")

    def test_permission_and_shape(self):
        self.as_staff(self.lead)
        self.assertEqual(self.client.get("/api/system-health/").status_code, 403)
        body = self.get().json()
        keys = [c["key"] for c in body["checks"]]
        self.assertEqual(keys, ["api", "database", "live", "jobs", "backups", "audit", "disk", "errors"])
        self.assertEqual(len(body["jobs"]), len(__import__("django.conf", fromlist=["settings"]).settings.CELERY_BEAT_SCHEDULE))
        self.assertTrue(body["not_reported"])

    def test_jobs_that_never_ran_say_so_and_none_gets_an_invented_time(self):
        rows = self.get().json()["jobs"]
        self.assertTrue(all(r["state"] == "not_run" and r["last_finished_at"] is None for r in rows))

    def test_job_states_ok_late_and_failed(self):
        now = timezone.now()
        jobs.mark_started("approvals.tasks.escalate_due_approvals", now=now - timedelta(minutes=1))
        jobs.mark_finished("approvals.tasks.escalate_due_approvals", ok=True, now=now - timedelta(minutes=1))
        jobs.mark_started("reports.tasks.purge_expired_exports", now=now - timedelta(days=4))
        jobs.mark_finished("reports.tasks.purge_expired_exports", ok=True, now=now - timedelta(days=4))
        jobs.mark_started("sessions-cleanup", now=now)
        jobs.mark_finished("accounts.tasks.cleanup_staff_sessions", ok=False, error="boom", now=now)
        states = {r["key"]: r["state"] for r in system_health.jobs(now)}
        self.assertEqual(states["approvals-escalate"], "ok")
        self.assertEqual(states["reports-purge-exports"], "late")
        self.assertEqual(states["sessions-cleanup"], "down")

    @override_settings(USE_REDIS=True)
    def test_background_work_reports_failed_jobs(self):
        jobs.mark_finished("accounts.tasks.cleanup_staff_sessions", ok=False, error="boom")
        check = system_health.background_work(system_health.jobs())
        self.assertEqual(check["state"], "down")
        self.assertIn("sessions-cleanup", check["note"])

    @override_settings(USE_REDIS=False)
    def test_without_a_worker_it_says_jobs_run_in_the_web_process(self):
        check = system_health.background_work(system_health.jobs())
        self.assertEqual(check["state"], "not_connected")

    def test_audit_chain_comes_from_the_nightly_check(self):
        self.assertEqual(system_health.audit_chain()["state"], "not_run")
        ChainCheck.objects.create(checked_at=timezone.now(), ok=True, events=42)
        self.assertEqual(system_health.audit_chain()["state"], "ok")
        ChainCheck.objects.create(checked_at=timezone.now(), ok=False, events=43, broken_at_id=7)
        self.assertEqual(system_health.audit_chain()["state"], "down")

    def test_backups_are_not_reported_unless_a_folder_is_readable(self):
        with mock.patch.dict("os.environ", {"BACKUP_DIR": ""}):
            self.assertEqual(system_health.backups()["state"], "not_reported")
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as folder, mock.patch.dict("os.environ", {"BACKUP_DIR": folder}):
            self.assertEqual(system_health.backups()["state"], "not_reported")
            open(os.path.join(folder, "production-20261012.sql.gz"), "w").close()
            self.assertEqual(system_health.backups()["state"], "ok")

    def test_database_is_measured_and_a_broken_one_reads_down(self):
        self.assertEqual(system_health.database()["state"], "ok")
        with mock.patch("core.system_health.connection.cursor", side_effect=Exception("down")):
            self.assertEqual(system_health.database()["state"], "down")

    def test_disk_is_read_when_readable(self):
        usage = mock.Mock(used=74, total=100)
        with mock.patch("core.system_health.shutil.disk_usage", return_value=usage):
            self.assertEqual(system_health.disk()["value"], "74% full")
        with mock.patch("core.system_health.shutil.disk_usage", side_effect=OSError):
            self.assertEqual(system_health.disk()["state"], "not_reported")


class PromotionPricesTests(SettingsScreensBase):
    def test_reads_the_prices_the_code_charges(self):
        from listings.views import PROMOTION_DAILY_RATES

        self.as_staff(self.boss)
        body = self.client.get("/api/promotion-prices/").json()
        self.assertTrue(body["set_in_code"])
        self.assertEqual({i["kind"] for i in body["items"]}, set(PROMOTION_DAILY_RATES))
        self.assertEqual({i["per_day"] for i in body["items"]}, {"5.00", "3.00"})


class PayoutsOverviewTests(SettingsScreensBase):
    def test_only_real_records_are_counted_and_the_rest_is_named_as_not_recorded(self):
        self.as_staff(self.boss)
        body = self.client.get("/api/payouts-overview/").json()
        self.assertEqual(body["commission"]["in_batch"]["count"], 0)
        self.assertEqual(body["tickets"]["released"], "0.00")
        self.assertIn("Payroll runs", [n["name"] for n in body["not_recorded"]])
        self.assertIn("first payout batch is blocked", body["payout_blocker"])
        self.assertTrue(body["simulated"])

    def test_ticket_money_is_split_by_escrow_state(self):
        from accounts.models import BusinessOwner, Customer
        from billing.models import Transaction
        from events.models import Event, EventTicketType, Ticket
        from listings.models import Category, Zone

        owner = BusinessOwner.objects.create(full_name="Org", login_phone="+233207662999", password_hash="x")
        buyer = Customer.objects.create(full_name="Ama Buyer", phone="+233200662999", password_hash="x")
        event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=Zone.objects.get(name="Manhyia"), submitted_by_business=owner, name="Fest",
            description="D.", address="Manhyia", event_date=timezone.now() + timedelta(days=5), visibility_days=14, status=Event.APPROVED,
        )
        kind = EventTicketType.objects.create(event=event, name="Regular", price="80.00", quantity_total=50, delivery_method="digital")

        def ticket(price, **extra):
            txn = Transaction.objects.create(customer=buyer, amount=price, purpose="Event ticket", reference=f"EVT-{Ticket.objects.count() + 1}")
            return Ticket.objects.create(ticket_type=kind, purchased_by=buyer, transaction=txn, delivery_method="digital", price=price, **extra)

        ticket("80.00")
        ticket("120.00", escrow_status=Ticket.RELEASED, escrow_released_at=timezone.now(), delivered_at=timezone.now())
        ticket("50.00", refunded_at=timezone.now(), refund_reason="Cancelled")
        self.as_staff(self.boss)
        body = self.client.get("/api/payouts-overview/").json()["tickets"]
        self.assertEqual((body["held"], body["released"], body["released_this_month"], body["refunded"]), ("80.00", "120.00", "120.00", "50.00"))
        self.as_staff(self.lead)
        self.assertEqual(self.client.get("/api/payouts-overview/").status_code, 403)
