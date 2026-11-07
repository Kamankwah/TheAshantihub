from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from payments.models import WebhookEvent
from payments.tasks import alert_unprocessed_webhooks


class UnprocessedWebhookAlertTests(TestCase):
    def make(self, minutes_ago, **kw):
        event = WebhookEvent.objects.create(raw_payload={}, signature_valid=kw.pop("signature_valid", True), **kw)
        WebhookEvent.objects.filter(pk=event.pk).update(received_at=timezone.now() - timedelta(minutes=minutes_ago))
        return event

    def test_reports_signed_unapplied_events_in_the_window_once(self):
        self.make(30, hubtel_reference="AH-X", processing_note="Amount mismatch")
        with self.assertLogs("payments.tasks", level="ERROR") as logs:
            self.assertEqual(alert_unprocessed_webhooks(), 1)
        self.assertIn("AH-X", logs.output[0])

    def test_ignores_processed_unsigned_too_recent_and_too_old(self):
        self.make(30, processed=True)
        self.make(30, signature_valid=False)
        self.make(5)    # still inside the retry grace period
        self.make(120)  # an earlier run already reported it
        self.assertEqual(alert_unprocessed_webhooks(), 0)
