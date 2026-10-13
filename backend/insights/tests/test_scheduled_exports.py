import tempfile
from datetime import time, timedelta
from unittest import mock

from django.core import mail
from django.test import override_settings
from django.utils import timezone

from accounts.models import Permission, Role
from activity.models import ActivityEvent
from insights import scheduling
from insights.models import ScheduledExport, ScheduledExportFile, ScheduledExportRun
from insights.tests.base import InsightsBase
from notifications.models import Notification


class ScheduledExportBase(InsightsBase):
    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        private = override_settings(PRIVATE_MEDIA_ROOT=directory.name)
        private.enable()
        self.addCleanup(private.disable)
        self.as_staff(self.boss)

    def body(self, **extra):
        return {
            "name": "Weekly sales", "kind": "revenue", "filters": {"period": "last_week"}, "format": "xlsx",
            "frequency": "weekly", "weekday": 1, "run_time": "07:00", "recipients": [self.accountant.pk], **extra,
        }

    def create(self, **extra):
        return self.client.post("/api/insights/exports/", self.body(**extra), format="json")


class ScheduleTests(ScheduledExportBase):
    def test_the_permission_is_seeded_for_super_admin_only(self):
        permission = Permission.objects.get(codename="exports.schedule")
        self.assertEqual(list(Role.objects.filter(permissions=permission).values_list("name", flat=True)), ["super_admin"])
        self.as_staff(self.accountant)
        self.assertEqual(self.client.get("/api/insights/exports/").status_code, 403)

    def test_create_validates_and_works_out_the_next_run(self):
        response = self.create()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertFalse(body["personal_data"])
        self.assertEqual((body["status"], body["run_time"], body["recipients"][0]["full_name"]), ("active", "07:00", "Kofi"))
        nxt = timezone.localtime(ScheduledExport.objects.get().next_run_at)
        self.assertEqual((nxt.weekday(), nxt.hour), (1, 7))
        self.assertGreater(nxt, timezone.now())
        for bad in ({"format": "docx"}, {"run_time": "25:00"}, {"weekday": 9}, {"kind": "reconciliation"}, {"recipients": []}, {"name": " "}):
            self.assertEqual(self.create(**bad).status_code, 400, bad)
        self.assertEqual(self.create(frequency="monthly", day_of_month=31).status_code, 400)

    def test_a_recipient_must_be_allowed_to_see_that_export(self):
        response = self.create(kind="reports", filters={"period": "last_week"}, recipients=[self.scout.pk])
        self.assertEqual(response.status_code, 400)
        self.assertIn("Kwame", response.json()["recipients"])

    def test_personal_data_needs_the_password_when_scheduled_and_when_edited(self):
        personal = self.body(name="Statements", kind="commission_statements", filters={}, recipients=[self.scout.pk], frequency="monthly", day_of_month=2)
        denied = self.client.post("/api/insights/exports/", personal, format="json")
        self.assertEqual((denied.status_code, denied.json()["code"]), (403, "sudo_required"))
        self.assertFalse(ScheduledExport.objects.exists())
        self.as_staff(self.boss, sudo=True)
        created = self.client.post("/api/insights/exports/", personal, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertTrue(created.json()["personal_data"])
        self.assertIsNotNone(created.json()["password_confirmed_at"])
        schedule_id = created.json()["id"]
        self.as_staff(self.boss)
        self.assertEqual(self.client.patch(f"/api/insights/exports/{schedule_id}/", {"run_time": "10:00"}, format="json").json()["code"], "sudo_required")
        self.as_staff(self.boss, sudo=True)
        self.assertEqual(self.client.patch(f"/api/insights/exports/{schedule_id}/", {"run_time": "10:00"}, format="json").json()["run_time"], "10:00")

    def test_pause_and_resume(self):
        sid = self.create().json()["id"]
        paused = self.client.post(f"/api/insights/exports/{sid}/pause/").json()
        self.assertEqual((paused["status"], paused["paused_by"], paused["next_run_at"]), ("paused", "Boss", None))
        self.assertEqual(self.client.post(f"/api/insights/exports/{sid}/resume/").json()["status"], "active")
        listing = self.client.get("/api/insights/exports/").json()
        self.assertEqual((listing["kpis"]["active"], listing["kpis"]["paused"]), (1, 0))
        self.assertEqual([k["key"] for k in listing["kinds"]], ["revenue", "analytics", "growth_funnel", "refunds", "commission_statements", "reports"])


class RunTests(ScheduledExportBase):
    def due_schedule(self, **extra):
        sid = self.create(**extra).json()["id"]
        ScheduledExport.objects.filter(pk=sid).update(next_run_at=timezone.now() - timedelta(minutes=1))
        return ScheduledExport.objects.get(pk=sid)

    def test_a_due_schedule_makes_a_file_tells_the_recipient_and_is_logged(self):
        schedule = self.due_schedule(recipients=[self.accountant.pk, self.boss.pk])
        self.sale("100.00")
        self.assertEqual(scheduling.dispatch_due(), 1)
        run = ScheduledExportRun.objects.get()
        self.assertEqual((run.status, run.schedule), ("ok", schedule))
        self.assertEqual(ScheduledExportFile.objects.filter(run=run).exclude(file_name="").count(), 2)
        self.assertEqual(Notification.objects.filter(kind="scheduled_export_ready").count(), 2)
        self.assertEqual(len(mail.outbox), 2)
        self.assertNotIn("attach", str(mail.outbox[0].attachments))
        self.assertEqual(mail.outbox[0].attachments, [])
        events = ActivityEvent.objects.filter(verb="report.exported", after__source="scheduled")
        self.assertEqual(events.count(), 2)
        self.assertEqual(events[0].after["export"], "revenue")
        schedule.refresh_from_db()
        self.assertGreater(schedule.next_run_at, timezone.now())
        self.assertIsNotNone(schedule.last_run_at)

    def test_it_does_not_run_twice_nor_while_paused(self):
        schedule = self.due_schedule()
        self.assertEqual(scheduling.dispatch_due(), 1)
        self.assertEqual(scheduling.dispatch_due(), 0)
        ScheduledExport.objects.filter(pk=schedule.pk).update(next_run_at=timezone.now() - timedelta(minutes=1), paused_at=timezone.now())
        self.assertEqual(scheduling.dispatch_due(), 0)
        self.assertEqual(ScheduledExportRun.objects.count(), 1)

    def test_a_stale_claim_is_not_run_by_a_second_worker(self):
        schedule = self.due_schedule()
        ScheduledExport.objects.filter(pk=schedule.pk).update(next_run_at=timezone.now() + timedelta(days=3))
        with mock.patch.object(scheduling, "run_schedule") as run:
            self.assertEqual(scheduling.dispatch_due(), 0)
        run.assert_not_called()

    def test_each_scout_receives_only_their_own_commission_lines(self):
        from commission.models import CommissionAccrual, CommissionPolicy
        from accounts.models import BusinessOwner
        from decimal import Decimal

        other = __import__("accounts.testing", fromlist=["make_staff"]).make_staff("scout", "efua@example.com", manager=self.lead)
        policy = CommissionPolicy.objects.create(kind="registration", amount=Decimal("50.00"), effective_from=timezone.localdate(), proposed_by=self.accountant, approved_by=self.boss)
        for i, staff in enumerate([self.scout, other]):
            owner = BusinessOwner.objects.create(full_name=f"O{i}", login_phone=f"+2332000000{i}0", password_hash="x")
            CommissionAccrual.objects.create(staff=staff, business_owner=owner, kind="registration", amount=Decimal("50.00"), policy=policy, earned_at=timezone.now(), hold_until=timezone.now())
        self.as_staff(self.boss, sudo=True)
        sid = self.client.post("/api/insights/exports/", self.body(name="Statements", kind="commission_statements", filters={}, format="csv", recipients=[self.scout.pk, other.pk]), format="json").json()["id"]
        ScheduledExport.objects.filter(pk=sid).update(next_run_at=timezone.now() - timedelta(minutes=1))
        scheduling.dispatch_due()
        for staff, name in ((self.scout, "Kwame"), (other, "Efua")):
            file = ScheduledExportFile.objects.get(recipient=staff)
            text = (scheduling.directory() / file.file_name).read_text(encoding="utf-8-sig")
            self.assertIn(name, text)
            self.assertNotIn("Efua" if name == "Kwame" else "Kwame", text)

    def test_a_recipient_who_lost_access_is_skipped_and_the_run_says_so(self):
        schedule = self.due_schedule(recipients=[self.accountant.pk, self.boss.pk])
        self.accountant.is_suspended = True
        self.accountant.save()
        scheduling.dispatch_due()
        run = ScheduledExportRun.objects.get()
        self.assertEqual(run.status, "partial")
        self.assertIn("1 of 2", run.error)
        self.assertEqual(ScheduledExportFile.objects.exclude(error="").get().recipient, self.accountant)
        self.assertTrue(ActivityEvent.objects.filter(verb="export.scheduled_run_problem").exists())

    def test_one_failing_recipient_does_not_stop_the_others(self):
        self.due_schedule(recipients=[self.accountant.pk, self.boss.pk])
        real = scheduling.tabular.render
        calls = []

        def flaky(doc, fmt):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("boom")
            return real(doc, fmt)

        with mock.patch.object(scheduling.tabular, "render", flaky):
            scheduling.dispatch_due()
        run = ScheduledExportRun.objects.get()
        self.assertEqual(run.status, "partial")
        self.assertEqual(ScheduledExportFile.objects.exclude(file_name="").count(), 1)
        self.assertNotIn("boom", ScheduledExportFile.objects.exclude(error="").get().error)


class CreatorGuardTests(ScheduledExportBase):
    def due_schedule(self, **extra):
        sid = self.create(**extra).json()["id"]
        ScheduledExport.objects.filter(pk=sid).update(next_run_at=timezone.now() - timedelta(minutes=1))
        return ScheduledExport.objects.get(pk=sid)

    def test_a_suspended_creator_makes_the_schedule_skip_and_pause(self):
        schedule = self.due_schedule()
        self.boss.is_suspended = True
        self.boss.save()
        scheduling.dispatch_due()
        run = ScheduledExportRun.objects.get()
        self.assertEqual(run.status, "failed")
        self.assertIn("no longer has an active account", run.error)
        self.assertFalse(ScheduledExportFile.objects.exists())
        schedule.refresh_from_db()
        self.assertIsNotNone(schedule.paused_at)
        self.assertTrue(ActivityEvent.objects.filter(verb="export.scheduled_run_skipped").exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_a_creator_without_the_permission_is_skipped(self):
        schedule = self.due_schedule()
        schedule.created_by.revoked_permissions.add(Permission.objects.get(codename="exports.schedule"))
        scheduling.dispatch_due()
        run = ScheduledExportRun.objects.get()
        self.assertEqual(run.status, "failed")
        self.assertIn("can no longer schedule", run.error)
        self.assertFalse(ScheduledExportFile.objects.exists())


class DownloadTests(ScheduledExportBase):
    def make_file(self):
        sid = self.create(recipients=[self.accountant.pk]).json()["id"]
        ScheduledExport.objects.filter(pk=sid).update(next_run_at=timezone.now() - timedelta(minutes=1))
        scheduling.dispatch_due()
        return ScheduledExportFile.objects.get()

    def test_only_the_named_person_signed_in_can_download_within_24_hours(self):
        file = self.make_file()
        self.as_staff(self.accountant)
        mine = self.client.get("/api/insights/exports/files/mine/").json()
        self.assertEqual(len(mine), 1)
        response = self.client.get(mine[0]["download_url"])
        self.assertEqual(response.status_code, 200)
        self.assertTrue(b"".join(response.streaming_content).startswith(b"PK"))
        file.refresh_from_db()
        self.assertIsNotNone(file.first_opened_at)
        self.as_staff(self.boss)
        self.assertEqual(self.client.get(mine[0]["download_url"]).status_code, 404)
        self.assertEqual(self.client.get(f"/api/insights/exports/files/{file.pk}/download/?sig=forged").status_code, 404)
        self.as_staff(self.accountant)
        self.assertEqual(self.client.get(f"/api/insights/exports/files/{file.pk}/download/?sig=forged").status_code, 403)
        self.client.credentials()
        self.assertEqual(self.client.get(mine[0]["download_url"]).status_code, 401)

    def test_a_download_is_audited_without_contents_and_rechecks_access(self):
        file = self.make_file()
        self.as_staff(self.accountant)
        url = self.client.get("/api/insights/exports/files/mine/").json()[0]["download_url"]
        self.assertEqual(self.client.get(url).status_code, 200)
        event = ActivityEvent.objects.get(verb="export.downloaded")
        self.assertEqual(event.actor_id, self.accountant.pk)
        self.assertIn("personal_data", event.after)
        self.assertEqual(event.after["export"], "revenue")
        self.assertNotIn("content", str(event.after).lower())
        # Access lost since the file was made: refused, and no second event.
        self.accountant.revoked_permissions.add(*Permission.objects.filter(codename="transactions.report"))
        from insights import generators

        self.assertFalse(generators.allowed("revenue", self.accountant))
        self.assertEqual(self.client.get(url).status_code, 403)
        self.assertEqual(ActivityEvent.objects.filter(verb="export.downloaded").count(), 1)

    def test_a_link_stops_working_after_24_hours_and_the_file_is_deleted(self):
        file = self.make_file()
        path = scheduling.directory() / file.file_name
        self.assertTrue(path.exists())
        ScheduledExportFile.objects.filter(pk=file.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.as_staff(self.accountant)
        self.assertEqual(self.client.get(scheduling.link_for(file)).status_code, 410)
        self.assertEqual(self.client.get("/api/insights/exports/files/mine/").json(), [])
        self.assertEqual(scheduling.purge_expired(), 1)
        self.assertFalse(path.exists())

    def test_the_beat_job_is_registered(self):
        from django.conf import settings
        from ashantihub.celery import app

        app.loader.import_default_modules()
        self.assertIn(settings.CELERY_BEAT_SCHEDULE["insights-scheduled-exports"]["task"], app.tasks)
