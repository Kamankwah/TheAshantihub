"""The one-time-code numbers Super Admin can change (otp plan Task 2): how long a customer's trusted device skips
the code, and how many texts a day raise the spend alert."""
from activity.models import ActivityEvent
from staffsecurity import policy
from staffsecurity.models import SecurityPolicy

from .base import SecurityBase

URL = "/api/staff-security/policy/"


class OtpPolicyTests(SecurityBase):
    def test_defaults_hold_before_anyone_saves_a_policy(self):
        self.assertFalse(SecurityPolicy.objects.exists())
        self.assertEqual((policy.otp_customer_gap_days(), policy.otp_sms_daily_alert()), (30, 500))

    def test_the_screen_reads_them(self):
        self.as_staff(self.boss)
        self.assertEqual(self.client.get(URL).json()["otp"], {"otp_customer_gap_days": 30, "otp_sms_daily_alert": 500})

    def test_changing_them_needs_the_password(self):
        self.as_staff(self.boss)
        response = self.client.patch(URL, {"otp_customer_gap_days": 14}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (403, "sudo_required"))
        self.assertEqual(policy.otp_customer_gap_days(), 30)

    def test_a_change_is_saved_and_audited_without_touching_the_two_step_roles(self):
        policy.set_roles({"support"}, self.boss)
        self.as_staff(self.boss, sudo=True)
        response = self.client.patch(URL, {"otp_customer_gap_days": 14, "otp_sms_daily_alert": 800}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["otp"], {"otp_customer_gap_days": 14, "otp_sms_daily_alert": 800})
        self.assertEqual((policy.otp_customer_gap_days(), policy.otp_sms_daily_alert()), (14, 800))
        self.assertTrue(policy.requires_two_factor("support"))
        event = ActivityEvent.objects.get(verb="security.otp_policy_changed")
        # activity.services.redact blanks any key containing "otp", so the event drops the prefix.
        self.assertEqual(event.before, {"customer_gap_days": 30, "sms_daily_alert": 500})
        self.assertEqual(event.after, {"customer_gap_days": 14, "sms_daily_alert": 800})
        self.assertFalse(ActivityEvent.objects.filter(verb="security.policy_changed").exists())

    def test_another_super_admin_is_told_of_an_otp_change(self):
        from accounts.testing import make_staff
        from notifications.models import Notification

        second = make_staff("super_admin", "second@example.com")
        self.as_staff(self.boss, sudo=True)
        self.client.patch(URL, {"otp_customer_gap_days": 14}, format="json")
        self.assertIn("Days a trusted customer device", Notification.objects.get(staff=second, kind="security_policy_changed").body)
        self.assertFalse(Notification.objects.filter(staff=self.boss, kind="security_policy_changed").exists())

    def test_saving_the_same_value_records_nothing(self):
        self.as_staff(self.boss, sudo=True)
        self.assertEqual(self.client.patch(URL, {"otp_customer_gap_days": 30}, format="json").status_code, 200)
        self.assertFalse(ActivityEvent.objects.filter(verb="security.otp_policy_changed").exists())

    def test_bad_values_are_refused_and_nothing_changes(self):
        self.as_staff(self.boss, sudo=True)
        cases = [
            ("otp_customer_gap_days", 0), ("otp_customer_gap_days", 366), ("otp_customer_gap_days", "30"),
            ("otp_customer_gap_days", True), ("otp_customer_gap_days", None),
            ("otp_sms_daily_alert", 0), ("otp_sms_daily_alert", 1.5),
        ]
        for key, bad in cases:
            response = self.client.patch(URL, {key: bad}, format="json")
            self.assertEqual(response.status_code, 400, (key, bad))
            self.assertIn(key, response.json())
        self.assertEqual((policy.otp_customer_gap_days(), policy.otp_sms_daily_alert()), (30, 500))

    def test_an_empty_change_is_still_refused(self):
        self.as_staff(self.boss, sudo=True)
        response = self.client.patch(URL, {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("two_factor_roles", response.json())
