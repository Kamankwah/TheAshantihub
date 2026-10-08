import csv
import io
import tempfile
import zipfile
from datetime import datetime, time, timedelta
from unittest import mock

from django.db import connection
from django.template.loader import render_to_string
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import StaffUser
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from notifications.models import Notification
from reports import exports, services
from reports.models import ReportExport
from reports.tasks import build_report_export, purge_expired_exports

NASTY = '=HYPERLINK("http://evil.example","click")'
BOM = "﻿"


class ExportTests(TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        private = override_settings(PRIVATE_MEDIA_ROOT=directory.name)
        private.enable()
        self.addCleanup(private.disable)
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.other_scout = make_staff("scout", "efua@example.com", manager=self.lead)
        self.today = timezone.localdate()
        self.report = self.submitted(self.scout, achievements=NASTY)

    def submitted(self, staff, **data):
        report = services.save_draft(staff, "day", self.today, {"achievements": "Visited Bonwire", **data})
        return services.submit(report, now=timezone.make_aware(datetime.combine(self.today, time(18))))

    def as_(self, staff, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def long_range(self, fmt="csv"):
        start = self.today - timedelta(days=40)
        return self.client.get(f"/api/reports/export/?from={start}&to={self.today}&format={fmt}")

    def test_escape_cell(self):
        for raw in ("=1+1", "+233", "-5", "@SUM(A1)", "\tx", "\rx"):
            self.assertEqual(exports.escape_cell(raw), "'" + raw)
        self.assertEqual(exports.escape_cell("Kumasi"), "Kumasi")
        self.assertEqual(exports.escape_cell(None), "")

    def test_csv_has_a_bom_and_neutralises_formulas(self):
        self.as_(self.scout)
        response = self.client.get(f"/api/reports/{self.report.id}/export/?format=csv")
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment;", response["Content-Disposition"])
        body = b"".join(response.streaming_content).decode("utf-8")
        self.assertTrue(body.startswith(BOM))
        rows = list(csv.reader(io.StringIO(body.lstrip(BOM))))
        self.assertEqual(rows[1][rows[0].index("Achievements")], "'" + NASTY)

    def test_excel_and_pdf_open(self):
        self.as_(self.scout)
        xlsx = self.client.get(f"/api/reports/{self.report.id}/export/?format=xlsx")
        with zipfile.ZipFile(io.BytesIO(xlsx.content)) as book:
            sheet = book.read("xl/worksheets/sheet1.xml").decode()
        self.assertIn("HYPERLINK", sheet)
        self.assertNotIn("<f>", sheet)
        pdf = self.client.get(f"/api/reports/{self.report.id}/export/?format=pdf")
        self.assertEqual(pdf["Content-Type"], "application/pdf")
        self.assertTrue(pdf.content.startswith(b"%PDF"))

    def test_the_pdf_never_fetches_a_url_and_shows_markup_as_text(self):
        tag = '<img src="http://example.invalid/x.png">'
        report = self.submitted(self.other_scout, achievements=tag, blockers="<b>bold</b>")
        report = type(report).objects.select_related("staff__role", "reviewer__role").get(pk=report.pk)
        html = exports.pdf_html([report], "Title")
        self.assertIn("&lt;img src=", html)
        self.assertNotIn("<img", html)
        self.assertNotIn("<b>bold", html)
        with mock.patch("reports.exports.refuse_fetch", side_effect=AssertionError("fetched")) as fetch:
            data = exports.pdf_bytes([report], "Title")
        self.assertTrue(data.startswith(b"%PDF"))
        fetch.assert_not_called()

    def test_the_pdf_fetcher_refuses_everything(self):
        for url in ("http://example.invalid/x.png", "file:///etc/passwd", "data:text/plain,hi"):
            with self.assertRaises(ValueError):
                exports.refuse_fetch(url)

    def test_the_template_pulls_in_nothing_external(self):
        html = render_to_string("reports/report_export.html", {"title": "T", "generated_at": timezone.now(), "reports": []})
        for needle in ("http://", "https://", "<link", "@import", "<img", "src="):
            self.assertNotIn(needle, html.replace("http://www.w3.org/2000/svg", ""))

    def test_an_unknown_format_is_refused(self):
        self.as_(self.scout)
        self.assertEqual(self.client.get(f"/api/reports/{self.report.id}/export/?format=docx").status_code, 400)
        self.assertEqual(self.client.get(f"/api/reports/{self.report.id}/export/").status_code, 400)
        self.assertEqual(
            self.client.get(f"/api/reports/export/?from={self.today}&to={self.today}&format=docx").status_code, 400
        )

    def test_bad_input_is_a_clear_400_never_a_500(self):
        self.as_(self.lead, sudo=True)
        base = "/api/reports/export/?format=csv"
        today = self.today
        cases = [
            "",  # no dates
            f"&from={today}",
            f"&to={today}",
            "&from=nope&to=2026-01-01",
            f"&from={today}&to=nope",
            f"&from={today}&to={today - timedelta(days=1)}",
            f"&from={today}&to={today}&staff=abc",
            f"&from={today}&to={today}&staff=-3",
            f"&from={today}&to={today}&staff=99999999999999999999",
            f"&from={today}&to={today}&period=year",
        ]
        for query in cases:
            with self.subTest(query=query):
                response = self.client.get(base + query)
                self.assertEqual(response.status_code, 400, response.content)
        for query in ("&from=9999-12-31&to=9999-12-31", "&from=0001-01-01&to=0001-01-01"):
            with self.subTest(query=query):
                self.assertIn(self.client.get(base + query).status_code, (200, 202))
        # an absurd range is queued for the background, not run inline
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.get(base + "&from=0001-01-01&to=9999-12-31").status_code, 202)

    def test_a_scout_cannot_export_a_teammates_report(self):
        theirs = self.submitted(self.other_scout)
        self.as_(self.scout, sudo=True)
        self.assertEqual(self.client.get(f"/api/reports/{theirs.id}/export/?format=csv").status_code, 404)
        response = self.client.get(
            f"/api/reports/export/?from={self.today}&to={self.today}&format=csv&staff={self.other_scout.id}"
        )
        self.assertEqual(response.status_code, 403)

    def test_exporting_someone_elses_report_needs_a_recent_password(self):
        self.as_(self.lead)
        self.assertEqual(self.client.get(f"/api/reports/{self.report.id}/export/?format=csv").json()["code"], "sudo_required")
        self.as_(self.lead, sudo=True)
        self.assertEqual(self.client.get(f"/api/reports/{self.report.id}/export/?format=csv").status_code, 200)

    def test_every_export_is_recorded_with_its_filters(self):
        self.as_(self.scout)
        self.client.get(f"/api/reports/export/?from={self.today}&to={self.today}&format=csv")
        event = ActivityEvent.objects.filter(verb="report.exported").latest("id")
        self.assertEqual(event.after["filters"], {"from": str(self.today), "to": str(self.today)})
        self.assertEqual((event.after["format"], event.after["rows"]), ("csv", 1))

    def test_exports_do_not_query_per_row(self):
        self.as_(self.lead, sudo=True)
        url = f"/api/reports/export/?from={self.today}&to={self.today}&format=csv"

        def queries():
            with CaptureQueriesContext(connection) as ctx:
                b"".join(self.client.get(url).streaming_content)
            return len(ctx)

        before = queries()
        for index in range(4):
            self.submitted(make_staff("scout", f"extra{index}@example.com", manager=self.lead))
        self.assertEqual(queries(), before)

    def test_a_long_range_is_built_in_the_background_and_downloaded_once_ready(self):
        self.as_(self.scout)
        with self.captureOnCommitCallbacks(execute=True):
            queued = self.long_range()
        self.assertEqual(queued.status_code, 202)
        export = ReportExport.objects.get(pk=queued.json()["id"])
        self.assertEqual((export.status, export.row_count), ("ready", 1))
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="report_export_ready").exists())
        event = ActivityEvent.objects.filter(verb="report.exported").latest("id")
        self.assertEqual(event.after["export"], export.pk)
        listed = self.client.get("/api/reports/exports/").json()[0]
        download = self.client.get(listed["download_url"])
        self.assertEqual(download.status_code, 200)
        self.assertTrue(b"".join(download.streaming_content).startswith(BOM.encode()))
        self.assertEqual(self.client.get(f"/api/reports/exports/{export.id}/download/?sig=forged").status_code, 403)
        self.assertEqual(self.client.get(f"/api/reports/exports/{export.id}/download/").status_code, 403)
        with mock.patch("reports.exports.LINK_MAX_AGE", -1):
            self.assertEqual(self.client.get(listed["download_url"]).status_code, 403)
        self.as_(self.lead, sudo=True)
        self.assertEqual(self.client.get(listed["download_url"]).status_code, 404)

    def test_a_link_for_another_export_does_not_work(self):
        self.as_(self.scout)
        with self.captureOnCommitCallbacks(execute=True):
            first = self.long_range().json()["id"]
            second = self.long_range().json()["id"]
        link = exports.download_url(ReportExport.objects.get(pk=first))
        sig = link.split("sig=")[1]
        from urllib.parse import unquote
        self.assertEqual(
            self.client.get(f"/api/reports/exports/{second}/download/?sig={unquote(sig)}").status_code, 403
        )

    def test_a_missing_file_is_gone(self):
        self.as_(self.scout)
        with self.captureOnCommitCallbacks(execute=True):
            queued = self.long_range()
        export = ReportExport.objects.get(pk=queued.json()["id"])
        exports.export_path(export).unlink()
        link = self.client.get("/api/reports/exports/").json()[0]["download_url"]
        self.assertEqual(self.client.get(link).status_code, 410)

    def test_a_failed_job_serves_nothing_and_says_why(self):
        self.as_(self.scout)
        with mock.patch("reports.exports.write_export_file", side_effect=RuntimeError("disk full")):
            with self.captureOnCommitCallbacks(execute=True):
                queued = self.long_range("pdf")
        export = ReportExport.objects.get(pk=queued.json()["id"])
        self.assertEqual((export.status, export.error), ("failed", "disk full"))
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="report_export_failed").exists())
        self.assertEqual(list(exports.export_dir().glob("*")), [])
        self.assertIsNone(self.client.get("/api/reports/exports/").json()[0]["download_url"])

    def test_an_unavailable_queue_marks_the_export_failed(self):
        self.as_(self.scout)
        with mock.patch("reports.views.build_report_export.delay", side_effect=ConnectionError("redis down")):
            with self.captureOnCommitCallbacks(execute=True):
                queued = self.long_range()
        self.assertEqual(queued.status_code, 202)
        export = ReportExport.objects.get(pk=queued.json()["id"])
        self.assertEqual(export.status, "failed")
        self.assertEqual(
            export.error, "Background jobs are unavailable right now — try a range of 31 days or less."
        )
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="report_export_failed").exists())

    def test_scope_is_checked_again_when_the_job_runs(self):
        self.submitted(self.lead)
        self.as_(self.lead, sudo=True)
        queued = self.long_range()  # the job isn't run: no captureOnCommitCallbacks
        StaffUser.objects.filter(manager=self.lead).update(manager=None)
        build_report_export(queued.json()["id"])
        self.assertEqual(ReportExport.objects.get(pk=queued.json()["id"]).row_count, 1)

    def test_expired_files_are_purged(self):
        self.as_(self.scout)
        with self.captureOnCommitCallbacks(execute=True):
            queued = self.long_range()
        export = ReportExport.objects.get(pk=queued.json()["id"])
        ReportExport.objects.filter(pk=export.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(purge_expired_exports(), 1)
        export.refresh_from_db()
        self.assertEqual(export.status, "expired")
        self.assertFalse(exports.export_path(export).exists())
