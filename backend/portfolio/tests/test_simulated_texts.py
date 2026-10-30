"""Final-fix wave F2: simulated texts must not freeze KYC silently. The 409 says no link went out, and a management
command prints a fresh link, only where texts are simulated."""
import io
import json
import re

from django.core.cache import cache
from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.kyc import confirmation_missing_message
from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from approvals import services as approvals
from otp import senders
from portfolio import confirmations
from portfolio.models import ListingDraft, OwnerConfirmation
from rest_framework.test import APIClient

TOKEN = re.compile(r"token=([\w-]+)")
NOTE = "Texts are simulated on this server, so no link went out."


@override_settings(OTP_SMS_PROVIDER="simulated")
class Base(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.owner = BusinessOwner.objects.create(
            full_name="Akosua Mensah", login_phone="024 111 0001", password_hash="x", email="a@example.com",
            registration_channel=BusinessOwner.SCOUT, registered_by=self.scout, account_manager=self.scout,
        )
        BusinessOwnerProfile.objects.create(
            business_owner=self.owner, business_name="Akosua's Kitchen", gps_address="AK-039-5028", lat="6.688500", lng="-1.624400",
            address_verified=True, address_verified_by=self.lead, address_verified_at=timezone.now(),
        )
        with self.captureOnCommitCallbacks(execute=True):
            self.row = confirmations.request_confirmation(self.owner, self.scout, registration=True)
        self.approval = approvals.submit(
            self.scout, "business.kyc", target=self.owner, title="New business", payload={"business_owner_id": self.owner.pk},
        )

    def approve_door(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.lead)}")
        return self.client.post(f"/api/approvals/{self.approval.id}/approve/", {}, format="json")

    def queue_door(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.lead)}")
        return self.client.post(f"/api/accounts/kyc/{self.owner.id}/approve/", {}, format="json")


class SimulatedNoteTests(Base):
    def test_both_doors_say_no_link_went_out_when_the_text_was_simulated(self):
        self.assertEqual(OwnerConfirmation.objects.get().send_state, OwnerConfirmation.SIMULATED)
        for response in (self.approve_door(), self.queue_door()):
            self.assertEqual(response.status_code, 409, response.content)
            self.assertEqual(response.json()["code"], "confirmation_missing")
            self.assertIn(NOTE, response.json()["detail"])

    def test_a_text_that_really_went_does_not_claim_it_was_simulated(self):
        OwnerConfirmation.objects.filter(pk=self.row.pk).update(send_state=OwnerConfirmation.SENT)
        for response in (self.approve_door(), self.queue_door()):
            self.assertEqual(response.status_code, 409)
            self.assertNotIn("simulated", response.json()["detail"])
        self.assertNotIn("simulated", confirmation_missing_message(self.owner))


class LinkCommandTests(Base):
    def run_command(self, *args):
        out = io.StringIO()
        call_command("owner_confirmation_link", *args, stdout=out)
        return out.getvalue().strip()

    def test_refuses_on_a_live_provider_and_issues_nothing(self):
        before = OwnerConfirmation.objects.count()
        with override_settings(OTP_SMS_PROVIDER="hubtel"):
            with self.assertRaises(CommandError):
                self.run_command(str(self.owner.pk), "--staff", self.lead.email)
        self.assertEqual(OwnerConfirmation.objects.count(), before)

    def test_the_service_itself_refuses_on_a_live_provider(self):
        from accounts.claims import ClaimError

        with override_settings(OTP_SMS_PROVIDER="hubtel"), self.assertRaises(ClaimError):
            confirmations.link_for_simulated_environment(self.owner, self.lead)

    def test_prints_a_link_that_works_once_and_confirms_the_registration(self):
        link = self.run_command(str(self.owner.pk), "--staff", self.lead.email)
        raw = TOKEN.search(link).group(1)
        self.assertTrue(link.startswith("http"))
        self.assertEqual(OwnerConfirmation.objects.filter(revoked_at__isnull=True).count(), 1)
        self.assertNotEqual(OwnerConfirmation.objects.get(revoked_at__isnull=True).pk, self.row.pk)
        confirmations.confirm(raw)
        self.assertTrue(confirmations.registration_confirmed(BusinessOwner.objects.get(pk=self.owner.pk)))
        from accounts.claims import ClaimError

        with self.assertRaises(ClaimError):
            confirmations.confirm(raw)
        # the 409 is gone: KYC now passes
        self.assertEqual(self.queue_door().status_code, 200)

    def test_covers_waiting_drafts_too_and_stores_only_the_hash(self):
        draft = ListingDraft.objects.create(
            business_owner=self.owner, kind="product", created_by=self.scout, payload={"name": "Jollof", "price_amount": "25"},
        )
        with self.captureOnCommitCallbacks(execute=True):
            confirmations.request_confirmation(self.owner, self.scout, drafts=[draft])
        link = self.run_command(str(self.owner.pk), "--staff", self.lead.email)
        raw = TOKEN.search(link).group(1)
        self.assertEqual(OwnerConfirmation.objects.get(revoked_at__isnull=True).drafts.get().pk, draft.pk)
        confirmations.confirm(raw)
        self.assertEqual(ListingDraft.objects.get(pk=draft.pk).status, ListingDraft.OWNER_CONFIRMED)
        dump = json.dumps(list(ActivityEvent.objects.values("summary", "before", "after")), default=str)
        self.assertNotIn(raw, dump)
        self.assertFalse(OwnerConfirmation.objects.filter(token_hash=raw).exists())

    def test_needs_a_real_staff_member(self):
        with self.assertRaises(CommandError):
            self.run_command(str(self.owner.pk), "--staff", "nobody@example.com")
        with self.assertRaises(CommandError):
            call_command("owner_confirmation_link", str(self.owner.pk))
