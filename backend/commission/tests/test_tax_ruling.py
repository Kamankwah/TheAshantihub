from datetime import timedelta

from django.utils import timezone

from activity.models import ActivityEvent
from commission import services
from commission.models import ScoutTaxRuling
from commission.tests.base import CommissionBase
from accounts.testing import staff_token

URL = "/api/commission/tax-ruling/"


class TaxRulingTests(CommissionBase):
    def sudo(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=True)}")

    def body(self, **extra):
        return {"status": "agent", "ruled_on": str(timezone.localdate() - timedelta(days=1)), "reference": "GRA letter 123", "note": "Independent agents", **extra}

    def test_until_a_ruling_is_recorded_the_payout_batch_is_blocked(self):
        self.assertIsNotNone(services.payout_blocker())
        with self.assertRaises(services.PayoutBlocked):
            services.assert_can_form_payout_batch()
        self.as_staff(self.boss)
        data = self.client.get(URL).json()
        self.assertTrue(data["payout_blocked"])
        self.assertIn("stays on hold", data["blocked_message"])
        self.assertIsNone(data["current"])
        self.assertTrue(data["can_record"])

    def test_recording_needs_the_password_the_permission_and_valid_fields(self):
        self.as_staff(self.boss)
        self.assertEqual(self.client.post(URL, self.body(), format="json").status_code, 403)
        self.sudo(self.accountant)
        self.assertEqual(self.client.post(URL, self.body(), format="json").status_code, 403)
        self.sudo(self.boss)
        for bad in ({"status": "other"}, {"reference": " "}, {"ruled_on": "nope"}, {"ruled_on": str(timezone.localdate() + timedelta(days=2))}):
            self.assertEqual(self.client.post(URL, self.body(**bad), format="json").status_code, 400, bad)
        self.assertEqual(ScoutTaxRuling.objects.count(), 0)

    def test_a_recorded_ruling_unblocks_the_batch_and_is_audited(self):
        self.sudo(self.boss)
        response = self.client.post(URL, self.body(), format="json")
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(services.payout_blocker())
        services.assert_can_form_payout_batch()
        event = ActivityEvent.objects.get(verb="commission.tax_ruling_recorded")
        self.assertEqual(event.after["status"], "agent")
        data = self.client.get(URL).json()
        self.assertFalse(data["payout_blocked"])
        self.assertEqual(data["current"]["reference"], "GRA letter 123")
        self.assertEqual(data["current"]["status_label"], "Independent agents (10% withholding tax)")

    def test_a_later_ruling_replaces_it_and_the_history_keeps_both(self):
        self.sudo(self.boss)
        self.client.post(URL, self.body(), format="json")
        self.client.post(URL, self.body(status="employee", reference="Accountant memo"), format="json")
        data = self.client.get(URL).json()
        self.assertEqual(data["current"]["status"], "employee")
        self.assertEqual(len(data["history"]), 2)
        event = ActivityEvent.objects.filter(verb="commission.tax_ruling_recorded").order_by("-id").first()
        self.assertEqual(event.before["status"], "agent")

    def test_accounting_can_read_but_not_record(self):
        self.as_staff(self.accountant)
        data = self.client.get(URL).json()
        self.assertFalse(data["can_record"])
