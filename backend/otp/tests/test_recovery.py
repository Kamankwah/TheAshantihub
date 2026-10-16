"""Staff-assisted recovery (otp.recovery approval kind, otp plan Task 11). Review Focus 8 (the reset token never
reaches the activity log)."""
import pyotp
from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, PasswordResetToken
from accounts.testing import make_staff, staff_token
from accounts.two_factor import encrypt_secret
from activity.models import ActivityEvent
from approvals import services as approvals
from approvals.models import ApprovalRequest
from otp import authenticator, devices, senders, service
from otp.models import AccountAuthenticator, OtpEvent, TrustedDevice

from .helpers import make_customer, make_owner

URL = "/api/otp/recovery/"


class RecoveryTests(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.support = make_staff("support", "esi@example.com")
        self.customer = make_customer()
        self.raw_device = devices.trust(self.customer, None)
        AccountAuthenticator.objects.create(
            account_type="customer", account_id=self.customer.pk,
            secret_encrypted=encrypt_secret(pyotp.random_base32()), confirmed_at=timezone.now(),
        )

    def as_staff(self, staff, sudo=False):
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def ask(self, **overrides):
        body = {
            "account_type": "customer", "account_id": self.customer.pk, "send_to": "email",
            "reason": "Called her back on the number on her orders; she confirmed her last order.",
        }
        body.update(overrides)
        return self.client.post(URL, body, format="json")

    def test_support_asks_and_nothing_changes_until_a_super_admin_approves(self):
        self.as_staff(self.support)
        response = self.ask()
        self.assertEqual(response.status_code, 201, response.content)
        approval = ApprovalRequest.objects.get(pk=response.json()["approval_id"])
        self.assertEqual((approval.kind, approval.status), ("otp.recovery", ApprovalRequest.PENDING))
        self.assertTrue(authenticator.is_enabled(self.customer))
        self.assertTrue(devices.is_trusted(self.customer, self.raw_device))

    def test_approving_clears_devices_authenticator_and_lock_and_emails_a_reset_link(self):
        for _ in range(5):
            OtpEvent.objects.create(kind=OtpEvent.FAILED, account_type="customer", account_id=self.customer.pk)
        self.assertTrue(service.is_locked(self.customer))
        self.as_staff(self.support)
        approval_id = self.ask().json()["approval_id"]
        with self.captureOnCommitCallbacks(execute=True):
            approvals.approve(approval_id, self.boss)
        self.assertFalse(authenticator.is_enabled(self.customer))
        self.assertFalse(devices.is_trusted(self.customer, self.raw_device))
        self.assertEqual(TrustedDevice.objects.get().revoked_reason, TrustedDevice.STAFF_RECOVERY)
        self.assertFalse(service.is_locked(self.customer))
        reset = PasswordResetToken.objects.get(account_type="customer", account_id=self.customer.pk)
        self.assertEqual(mail.outbox[-1].to, ["ama@example.com"])
        self.assertIn(reset.token, mail.outbox[-1].body)
        event = ActivityEvent.objects.get(verb="otp.recovered")
        self.assertEqual(event.actor_id, self.boss.pk)
        self.assertNotIn(reset.token, str(event.after))
        self.assertNotIn(reset.token, event.summary)

    def test_a_link_by_text_goes_to_the_phone(self):
        self.as_staff(self.support)
        approval_id = self.ask(send_to="sms").json()["approval_id"]
        with self.captureOnCommitCallbacks(execute=True):
            approvals.approve(approval_id, self.boss)
        reset = PasswordResetToken.objects.get()
        self.assertEqual(senders.sms_outbox[-1].to, "+233241234567")
        self.assertIn(reset.token, senders.sms_outbox[-1].body)
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.SENT, purpose="recovery").exists())

    def test_only_otp_recovery_holders_may_ask(self):
        self.as_staff(make_staff("operations", "ama@example.com"))
        self.assertEqual(self.ask().status_code, 403)

    def test_bad_requests_queue_nothing(self):
        self.as_staff(self.support)
        staff_target = make_staff("marketing", "abena@example.com")
        unclaimed = make_owner(registration_channel=BusinessOwner.SCOUT)
        for overrides in (
            {"reason": ""},
            {"account_type": "staff", "account_id": staff_target.pk},
            {"account_id": "1"},
            {"account_id": True},
            {"account_type": "business_owner", "account_id": unclaimed.pk},
            {"send_to": "whatsapp"},
            {"send_to": ["email"]},
        ):
            self.assertEqual(self.ask(**overrides).status_code, 400, overrides)
        self.assertEqual(self.ask(account_id=999999).status_code, 404)
        self.assertEqual(ApprovalRequest.objects.count(), 0)

    def test_a_contact_changed_since_the_request_makes_it_stale(self):
        self.as_staff(self.support)
        approval_id = self.ask().json()["approval_id"]
        self.customer.email = "new@example.com"
        self.customer.save(update_fields=["email"])
        with self.assertRaises(approvals.StaleRequest):
            approvals.approve(approval_id, self.boss)
        self.assertTrue(authenticator.is_enabled(self.customer))

    def test_a_contact_swapped_for_one_with_the_same_mask_still_makes_it_stale(self):
        self.as_staff(self.support)
        approval_id = self.ask().json()["approval_id"]
        local, domain = self.customer.email.split("@")
        self.customer.email = f"{local[:2]}zzz{local[-1:]}@{domain}"  # the shown hint is unchanged; the real address is not
        self.customer.save(update_fields=["email"])
        with self.assertRaises(approvals.StaleRequest):
            approvals.approve(approval_id, self.boss)

    def test_a_super_admin_request_needs_the_password_and_applies_at_once(self):
        self.as_staff(self.boss)
        self.assertEqual(self.ask().json()["code"], "sudo_required")
        self.as_staff(self.boss, sudo=True)
        response = self.ask()
        self.assertEqual(response.json()["status"], ApprovalRequest.APPROVED)
        self.assertFalse(authenticator.is_enabled(self.customer))


class RecoveryChainAndNoticeTests(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("support", "lead@example.com")
        self.support = make_staff("support", "esi@example.com", manager=self.lead)
        self.customer = make_customer()
        AccountAuthenticator.objects.create(
            account_type="customer", account_id=self.customer.pk,
            secret_encrypted=encrypt_secret(pyotp.random_base32()), confirmed_at=timezone.now(),
        )

    def as_staff(self, staff, sudo=False):
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def ask(self, **overrides):
        body = {"account_type": "customer", "account_id": self.customer.pk, "send_to": "email", "reason": "Confirmed by phone."}
        body.update(overrides)
        return self.client.post(URL, body, format="json")

    def queue(self, **overrides):
        self.as_staff(self.support)
        return self.ask(**overrides).json()["approval_id"]

    def approve_url(self, approval_id):
        return f"/api/approvals/{approval_id}/approve/"

    def test_super_admin_approves_over_http_only_with_the_password(self):
        approval_id = self.queue()
        self.as_staff(self.boss)
        self.assertEqual(self.client.post(self.approve_url(approval_id), {}, format="json").json()["code"], "sudo_required")
        self.assertTrue(authenticator.is_enabled(self.customer))
        self.as_staff(self.boss, sudo=True)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.approve_url(approval_id), {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(authenticator.is_enabled(self.customer))

    def test_the_maker_their_manager_and_other_staff_cannot_approve(self):
        approval_id = self.queue()
        for who in (self.support, self.lead, make_staff("operations", "ops@example.com"), make_staff("support", "other@example.com")):
            self.as_staff(who, sudo=True)
            response = self.client.post(self.approve_url(approval_id), {}, format="json")
            # the maker and their manager are refused outright; unrelated staff can't even see the request
            self.assertIn(response.status_code, (403, 404) if who not in (self.support, self.lead) else (403,), (who.email, response.content))
            self.assertNotEqual(response.status_code, 200)
        self.assertTrue(authenticator.is_enabled(self.customer))

    def test_other_roles_cannot_ask(self):
        for role in ("operations", "accountant", "pickup_desk"):
            self.as_staff(make_staff(role, f"{role}@example.com"))
            self.assertEqual(self.ask().status_code, 403, role)
        self.assertEqual(ApprovalRequest.objects.count(), 0)

    def test_a_business_owner_can_be_recovered(self):
        owner = make_owner()
        AccountAuthenticator.objects.create(
            account_type="business_owner", account_id=owner.pk,
            secret_encrypted=encrypt_secret(pyotp.random_base32()), confirmed_at=timezone.now(),
        )
        approval_id = self.queue(account_type="business_owner", account_id=owner.pk)
        with self.captureOnCommitCallbacks(execute=True):
            approvals.approve(approval_id, self.boss)
        self.assertFalse(authenticator.is_enabled(owner))
        self.assertEqual(mail.outbox[-1].to, ["kwame@example.com"])
        self.assertTrue(PasswordResetToken.objects.filter(account_type="business_owner", account_id=owner.pk).exists())

    def test_the_link_message_is_a_recovery_message_not_a_reset_you_can_ignore(self):
        approval_id = self.queue()
        with self.captureOnCommitCallbacks(execute=True):
            approvals.approve(approval_id, self.boss)
        body = mail.outbox[-1].body
        self.assertNotIn("safely ignore", body)
        self.assertIn("contact AshantiHub Support immediately", body)

    def test_the_other_contact_gets_a_notice_without_the_link(self):
        approval_id = self.queue()
        with self.captureOnCommitCallbacks(execute=True):
            approvals.approve(approval_id, self.boss)
        reset = PasswordResetToken.objects.get()
        notice = senders.sms_outbox[-1]
        self.assertEqual(notice.to, "+233241234567")
        self.assertIn("removed your authenticator", notice.body)
        self.assertNotIn(reset.token, notice.body)
        self.assertNotIn("http", notice.body)
        self.assertNotIn("ama@example.com", notice.body)

    def test_a_failed_send_is_recorded_as_failed(self):
        approval_id = self.queue(send_to="sms")
        from unittest import mock

        with mock.patch.object(senders, "deliver", side_effect=RuntimeError("boom")):
            with self.captureOnCommitCallbacks(execute=True):
                approvals.approve(approval_id, self.boss)
        self.assertFalse(authenticator.is_enabled(self.customer))
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.SEND_FAILED, purpose="recovery").count(), 2)
        self.assertFalse(OtpEvent.objects.filter(kind=OtpEvent.SENT, purpose="recovery").exists())

    def test_a_failed_email_is_not_logged_as_sent(self):
        approval_id = self.queue()
        from unittest import mock

        with mock.patch.object(senders, "send_mail", side_effect=OSError("down")):
            with self.captureOnCommitCallbacks(execute=True):
                approvals.approve(approval_id, self.boss)
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.SEND_FAILED, channel="email", purpose="recovery").exists())
        self.assertFalse(OtpEvent.objects.filter(kind=OtpEvent.SENT, channel="email", purpose="recovery").exists())

    def test_one_contact_means_no_notice(self):
        self.customer.email = ""
        self.customer.save(update_fields=["email"])
        approval_id = self.queue(send_to="sms")
        with self.captureOnCommitCallbacks(execute=True):
            approvals.approve(approval_id, self.boss)
        self.assertEqual(len(senders.sms_outbox), 1)
        self.assertEqual(mail.outbox, [])
        self.assertFalse(authenticator.is_enabled(self.customer))

    def test_apply_itself_refuses_contacts_changed_since_the_request(self):
        from approvals.services import StaleRequest
        from otp.approval_kinds import apply

        approval = ApprovalRequest.objects.get(pk=self.queue())
        self.customer.email = "other@example.com"
        self.customer.save(update_fields=["email"])
        with self.assertRaises(StaleRequest):
            apply(approval)
        self.assertTrue(authenticator.is_enabled(self.customer))
