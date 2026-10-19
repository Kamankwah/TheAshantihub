"""Staff edits of a holder's payout name or contact need a second person (wallet rulings 7C, Task 5; spec §13 (xxxiv)):
the staff PATCH doors submit wallets.holder_details_edit instead of writing while the ledger is on; approving writes the
change, restarts the payout cooling period and logs it masked. Review Focus: no raw number in the log; ledger off is as before."""
import hmac
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.db import transaction
from django.test.utils import CaptureQueriesContext
from django.db import connection
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from approvals.models import ApprovalRequest
from ledger import settings_store
from notifications.models import Notification
from otp import senders
from wallets import holder_details
from wallets.models import PayoutDestination

from .helpers import destination

NEW_PHONE = "+233549998877"


@override_settings(LEDGER_ENABLED=True)
class StaffDestinationEditTests(TestCase):
    def setUp(self):
        cache.clear()
        self.kofi = make_staff("operations", "kofi@example.com")
        self.yaw = make_staff("operations", "yaw@example.com")
        self.boss = make_staff("super_admin", "boss@example.com")
        self.customer = Customer.objects.create(
            full_name="Ama Owusu", phone="+233241234567", email="ama@example.com", address="1 Road", password_hash="x",
        )
        self.dest = destination(self.customer)

    def client_for(self, staff, sudo=True):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")
        return client

    def patch(self, body, staff=None, sudo=True, customer=None):
        return self.client_for(staff or self.kofi, sudo=sudo).patch(
            f"/api/accounts/customers/{(customer or self.customer).pk}/", body, format="json",
        )

    def approve(self, approval_id, staff=None):
        return self.client_for(staff or self.yaw).post(f"/api/approvals/{approval_id}/approve/", {"note": ""}, format="json")

    def test_staff_edit_creates_request_not_change(self):
        response = self.patch({"phone": NEW_PHONE})
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["status"], ApprovalRequest.PENDING)
        self.assertNotIn("233549998877", response.content.decode())
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.phone, "+233241234567")
        approval = ApprovalRequest.objects.get(pk=body["approval_id"])
        self.assertEqual(approval.kind, holder_details.KEY)
        self.assertEqual(
            {k: approval.payload[k] for k in ("holder_type", "holder_id", "field", "attribute")},
            {"holder_type": "customer", "holder_id": self.customer.pk, "field": "recovery_contact", "attribute": "phone"},
        )
        self.assertNotIn("5499", approval.title + approval.maker_note)

    def test_unprotected_fields_still_write_directly(self):
        response = self.patch({"address": "2 Lane", "full_name": "Ama K Owusu"})
        self.assertEqual(response.status_code, 201, response.content)
        self.customer.refresh_from_db()
        self.assertEqual((self.customer.address, self.customer.full_name), ("2 Lane", "Ama Owusu"))
        plain = self.patch({"address": "3 Lane"})
        self.assertEqual(plain.status_code, 200, plain.content)

    def test_needs_the_password_again(self):
        response = self.patch({"phone": NEW_PHONE}, sudo=False)
        self.assertEqual((response.status_code, response.json()["code"]), (403, "sudo_required"))
        self.assertEqual(ApprovalRequest.objects.filter(kind=holder_details.KEY).count(), 0)

    def test_approval_applies_change_and_starts_cooling(self):
        approval_id = self.patch({"full_name": "Ama Kyei Owusu"}).json()["approval_id"]
        before = timezone.now()
        response = self.approve(approval_id)
        self.assertEqual(response.status_code, 200, response.content)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.full_name, "Ama Kyei Owusu")
        self.dest.refresh_from_db()
        hours = settings_store.current("payout_cooling_hours", before)
        self.assertGreaterEqual(self.dest.usable_from, before + timedelta(hours=hours))

    def test_contact_change_logs_masked_and_cools(self):
        approval_id = self.patch({"phone": NEW_PHONE}).json()["approval_id"]
        self.assertEqual(self.approve(approval_id).status_code, 200)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.phone, NEW_PHONE)
        self.dest.refresh_from_db()
        self.assertGreater(self.dest.usable_from, timezone.now() + timedelta(hours=1))
        event = ActivityEvent.objects.get(verb="wallets.holder_details_changed")
        text = f"{event.summary}{event.before}{event.after}"
        self.assertNotIn("0241234567", text)
        self.assertNotIn("549998877", text)
        self.assertIn("877", text)
        for stored in ActivityEvent.objects.all():
            self.assertNotIn("549998877", f"{stored.summary}{stored.before}{stored.after}")

    def test_self_approval_refused(self):
        approval_id = self.patch({"phone": NEW_PHONE}).json()["approval_id"]
        self.assertEqual(self.approve(approval_id, staff=self.kofi).status_code, 403)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.phone, "+233241234567")

    def test_a_super_admins_own_request_waits_for_someone_else(self):
        response = self.patch({"phone": NEW_PHONE}, staff=self.boss)
        self.assertEqual((response.status_code, response.json()["status"]), (201, ApprovalRequest.PENDING))
        self.assertEqual(self.approve(response.json()["approval_id"], staff=self.boss).status_code, 403)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.phone, "+233241234567")
        self.assertEqual(self.approve(response.json()["approval_id"], staff=self.yaw).status_code, 200)

    def test_no_op_and_invalid_values_refused(self):
        same = self.patch({"phone": "+233241234567"})
        self.assertEqual((same.status_code, same.json()["code"]), (400, "no_change"))
        invalid = self.patch({"email": "not-an-email"})
        self.assertEqual(invalid.status_code, 400)
        blank = self.patch({"full_name": ""})
        self.assertEqual(blank.status_code, 400)
        masked = self.patch({"phone": "•••••34567"})
        self.assertEqual(masked.status_code, 400)
        self.assertEqual(ApprovalRequest.objects.filter(kind=holder_details.KEY).count(), 0)

    def test_second_request_for_same_column_refused_while_pending(self):
        self.assertEqual(self.patch({"phone": NEW_PHONE}).status_code, 201)
        again = self.patch({"phone": "+233200000001"})
        self.assertEqual((again.status_code, again.json()["code"]), (409, "change_pending"))

    def test_apply_revalidates(self):
        approval_id = self.patch({"phone": NEW_PHONE}).json()["approval_id"]
        Customer.objects.create(full_name="Other Person", phone=NEW_PHONE, password_hash="x")
        response = self.approve(approval_id)
        self.assertGreaterEqual(response.status_code, 400)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.phone, "+233241234567")

    def test_business_owner_name_change(self):
        owner = BusinessOwner.objects.create(full_name="Kwame Trader", login_phone="+233201112233", password_hash="x")
        response = self.client_for(self.kofi).patch(
            f"/api/accounts/business-owners/{owner.pk}/", {"full_name": "Kwame K Trader"}, format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        owner.refresh_from_db()
        self.assertEqual(owner.full_name, "Kwame Trader")
        self.assertEqual(self.approve(response.json()["approval_id"]).status_code, 200)
        owner.refresh_from_db()
        self.assertEqual(owner.full_name, "Kwame K Trader")

    def test_newer_holder_edit_of_same_masked_email_makes_request_stale(self):
        Customer.objects.filter(pk=self.customer.pk).update(email="ama@x.com")
        approval_id = self.patch({"email": "staff.set@x.com"}).json()["approval_id"]
        Customer.objects.filter(pk=self.customer.pk).update(email="am.new@x.com")  # masks the same: am\u2022\u2022\u2022@x.com
        detail = self.client_for(self.yaw).get(f"/api/approvals/{approval_id}/").json()
        self.assertTrue(detail["stale"])
        self.assertGreaterEqual(self.approve(approval_id).status_code, 400)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.email, "am.new@x.com")

    def test_newer_holder_edit_of_same_masked_phone_makes_request_stale(self):
        approval_id = self.patch({"phone": NEW_PHONE}).json()["approval_id"]
        Customer.objects.filter(pk=self.customer.pk).update(phone="+233245554567")  # same first 3 and last 4 shown
        self.assertGreaterEqual(self.approve(approval_id).status_code, 400)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.phone, "+233245554567")

    def test_apply_compares_the_digest_in_constant_time(self):
        approval_id = self.patch({"full_name": "Ama Kyei Owusu"}).json()["approval_id"]
        with mock.patch.object(holder_details.hmac, "compare_digest", wraps=hmac.compare_digest) as compare:
            self.assertEqual(self.approve(approval_id).status_code, 200)
        self.assertTrue(compare.called)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.full_name, "Ama Kyei Owusu")

    def test_ask_locks_the_holder_row_before_checking_for_a_pending_request(self):
        with transaction.atomic(), CaptureQueriesContext(connection) as queries:
            holder_details.ask(self.kofi, self.customer, "phone", NEW_PHONE)
        sql = [query["sql"] for query in queries]
        lock = next(i for i, text in enumerate(sql) if "FOR UPDATE" in text and "accounts_customer" in text)
        check = next(i for i, text in enumerate(sql) if "approvals_approvalrequest" in text and "SELECT" in text)
        self.assertLess(lock, check)
        with self.assertRaises(holder_details.Refused) as second:
            holder_details.ask(self.yaw, self.customer, "phone", "+233200000001")
        self.assertEqual(second.exception.code, "change_pending")

    @override_settings(OTP_SMS_PROVIDER="locmem")
    def test_holder_told_of_staff_change(self):
        senders.sms_outbox.clear()
        approval_id = self.patch({"full_name": "Ama Kyei Owusu"}).json()["approval_id"]
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.approve(approval_id).status_code, 200)
        told = Notification.objects.filter(customer=self.customer)
        self.assertEqual(told.count(), 1)
        self.assertIn("payout name on AshantiHub was changed by our staff", told.get().body)
        self.assertEqual(len(senders.sms_outbox), 0)  # a name change texts nobody

    @override_settings(OTP_SMS_PROVIDER="locmem")
    def test_old_contact_receives_notice_once(self):
        senders.sms_outbox.clear()
        approval_id = self.patch({"phone": NEW_PHONE}).json()["approval_id"]
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.approve(approval_id).status_code, 200)
        texts = [text for text in senders.sms_outbox if "changed by our staff" in text.body]
        self.assertEqual(len(texts), 1)
        self.assertIn("233241234567", texts[0].to.replace("+", ""))
        self.assertIn("Your phone on AshantiHub was changed by our staff", texts[0].body)
        self.assertNotIn("549998877", texts[0].body)
        self.assertEqual(Notification.objects.filter(customer=self.customer).count(), 1)

    @override_settings(OTP_SMS_PROVIDER="locmem")
    def test_a_rolled_back_apply_sends_nothing(self):
        senders.sms_outbox.clear()
        approval_id = self.patch({"phone": NEW_PHONE}).json()["approval_id"]
        approval = ApprovalRequest.objects.get(pk=approval_id)
        approval.before = {"digest": holder_details.digest(self.customer, "phone")}
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            try:
                with transaction.atomic():
                    holder_details.apply(approval)
                    raise RuntimeError("roll back")
            except RuntimeError:
                pass
        self.assertEqual(callbacks, [])
        self.assertEqual(len(senders.sms_outbox), 0)
        self.assertEqual(Notification.objects.filter(customer=self.customer).count(), 0)

    def test_a_patch_without_a_protected_field_records_one_activity_event(self):
        response = self.patch({"address": "9 New Road"})
        self.assertEqual(response.status_code, 200, response.content)
        events = ActivityEvent.objects.all()
        self.assertEqual(events.count(), 1, list(events.values_list("verb", flat=True)))

    def test_holder_own_edit_unchanged(self):
        from .helpers import Holder

        holder = Holder(self.customer, "customer")
        before = PayoutDestination.objects.get(pk=self.dest.pk).usable_from
        response = holder.client.patch("/api/accounts/customers/me/profile/", {"full_name": "Ama K Owusu"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(ApprovalRequest.objects.filter(kind=holder_details.KEY).count(), 0)
        self.assertEqual(PayoutDestination.objects.get(pk=self.dest.pk).usable_from, before)


class LedgerOffTests(TestCase):
    def test_ledger_off_writes_directly(self):
        kofi = make_staff("operations", "kofi@example.com")
        customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(kofi)}")
        response = client.patch(f"/api/accounts/customers/{customer.pk}/", {"phone": NEW_PHONE}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        customer.refresh_from_db()
        self.assertEqual(customer.phone, NEW_PHONE)
        self.assertEqual(ApprovalRequest.objects.filter(kind=holder_details.KEY).count(), 0)
