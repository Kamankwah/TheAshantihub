"""The owner's public confirmation endpoints and the KYC gate (plan M3, Task 6)."""
import json
import re
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from approvals import services as approvals
from otp import senders
from portfolio import confirmations
from portfolio.models import ListingDraft, OwnerConfirmation
from portfolio.testing import confirm_registration

TOKEN = re.compile(r"token=([\w-]+)")
PREVIEW, CONFIRM, DECLINE = "/api/portfolio/confirm/preview/", "/api/portfolio/confirm/", "/api/portfolio/confirm/decline/"


class Base(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.boss = make_staff("super_admin", "boss@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.owner = self.make_owner("024 111 0001", "Akosua Mensah", "Akosua's Kitchen")
        self.other = self.make_owner("024 222 0002", "Yaw Boateng", "Yaw's Hardware")

    def make_owner(self, phone, name, business, **extra):
        owner = BusinessOwner.objects.create(
            full_name=name, login_phone=phone, password_hash="x", email=f"{name.split()[0].lower()}@example.com",
            registration_channel=BusinessOwner.SCOUT, registered_by=self.scout, account_manager=self.scout, **extra,
        )
        BusinessOwnerProfile.objects.create(
            business_owner=owner, business_name=business, gps_address="AK-039-5028",
            address_verified=True, address_verified_by=self.lead, address_verified_at=timezone.now(),
        )
        return owner

    def draft(self, owner=None, name="Jollof rice"):
        return ListingDraft.objects.create(
            business_owner=owner or self.owner, kind="product", created_by=self.scout,
            payload={"name": name, "price_amount": "25.00"},
        )

    def ask(self, owner=None, drafts=(), registration=False):
        with self.captureOnCommitCallbacks(execute=True):
            row = confirmations.request_confirmation(
                owner or self.owner, self.scout, drafts=list(drafts), registration=registration,
            )
        return row, TOKEN.search(senders.sms_outbox[-1].body).group(1)

    def post(self, url, **body):
        return self.client.post(url, body, format="json")


class PublicEndpointTests(Base):
    def test_preview_shows_items_without_phone_or_email(self):
        self.draft(self.other, "Hammer")
        _row, raw = self.ask(drafts=[self.draft(), self.draft(name="Banku")], registration=True)
        response = self.post(PREVIEW, token=raw)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["business_name"], "Akosua's Kitchen")
        self.assertEqual(body["owner_name_first"], "Akosua")
        self.assertTrue(body["registration"])
        self.assertEqual([item["name"] for item in body["items"]], ["Jollof rice", "Banku"])
        text = response.content.decode()
        for phone in ("0241110001", "024 111 0001", "+233241110001", "233241110001", "241110001", "1110001"):
            self.assertNotIn(phone, text)
        self.assertNotIn("akosua@example.com", text)
        self.assertNotIn("Yaw's Hardware", text)
        self.assertNotIn("Hammer", text)
        self.assertNotIn(raw, text)
        # a preview does not use the link up
        self.assertEqual(self.post(PREVIEW, token=raw).status_code, 200)

    def test_there_is_no_get_that_takes_the_token(self):
        _row, raw = self.ask(drafts=[self.draft()])
        for url in (PREVIEW, CONFIRM, DECLINE):
            self.assertEqual(self.client.get(url, {"token": raw}).status_code, 405, url)

    def test_headers_forbid_referrer_and_caching(self):
        _row, raw = self.ask(drafts=[self.draft()])
        for url, body in ((PREVIEW, {"token": raw}), (DECLINE, {"token": "nope"}), (CONFIRM, {"token": raw})):
            response = self.client.post(url, body, format="json")
            self.assertEqual(response["Referrer-Policy"], "no-referrer", url)
            self.assertEqual(response["Cache-Control"], "no-store", url)

    def test_confirm_ok_then_replay_is_used(self):
        draft = self.draft()
        _row, raw = self.ask(drafts=[draft], registration=True)
        response = self.post(CONFIRM, token=raw)
        self.assertEqual((response.status_code, response.json()), (200, {"confirmed": True}))
        draft.refresh_from_db()
        self.assertEqual(draft.status, ListingDraft.OWNER_CONFIRMED)
        self.assertTrue(confirmations.registration_confirmed(self.owner))
        for url in (CONFIRM, PREVIEW, DECLINE):
            again = self.post(url, token=raw)
            self.assertEqual(again.status_code, 409, url)
            self.assertEqual(again.json()["code"], "used")

    def test_expired_is_expired_with_resend_hint(self):
        row, raw = self.ask(drafts=[self.draft()])
        OwnerConfirmation.objects.filter(pk=row.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        for url in (CONFIRM, PREVIEW, DECLINE):
            response = self.post(url, token=raw)
            self.assertEqual(response.status_code, 410, url)
            self.assertEqual(response.json()["code"], "expired")
            self.assertIn("Ask AshantiHub to send a new one", response.json()["detail"])
        self.assertEqual(ListingDraft.objects.get().status, ListingDraft.AWAITING_OWNER)

    def test_garbage_token_invalid(self):
        for body in ({"token": "garbage"}, {"token": ""}, {}, {"token": 12}):
            response = self.client.post(CONFIRM, body, format="json")
            self.assertEqual(response.status_code, 400, body)
            self.assertEqual(response.json()["code"], "invalid")
        self.assertEqual(self.client.post(CONFIRM, "[]", content_type="application/json").status_code, 400)

    def test_decline_marks_items_declined_and_tells_the_maker(self):
        draft = self.draft()
        _row, raw = self.ask(drafts=[draft])
        response = self.post(DECLINE, token=raw, reason="Not my menu")
        self.assertEqual((response.status_code, response.json()), (200, {"declined": True}))
        draft.refresh_from_db()
        self.assertEqual(draft.status, ListingDraft.OWNER_DECLINED)
        self.assertEqual(self.post(CONFIRM, token=raw).json()["code"], "used")

    def test_confirm_throttled_after_n_bad_tokens(self):
        for _ in range(10):
            self.assertEqual(self.post(CONFIRM, token="bad").status_code, 400)
        response = self.post(CONFIRM, token="bad")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response["Referrer-Policy"], "no-referrer")

    def test_a_bad_staff_header_changes_nothing(self):
        _row, raw = self.ask(drafts=[self.draft()])
        self.client.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
        self.assertEqual(self.post(PREVIEW, token=raw).status_code, 200)

    def test_activity_events_contain_no_token(self):
        draft = self.draft()
        _row, raw = self.ask(drafts=[draft], registration=True)
        self.post(PREVIEW, token=raw)
        self.post(CONFIRM, token=raw)
        verbs = list(ActivityEvent.objects.order_by("id").values_list("verb", flat=True))
        self.assertIn("business.registration_confirmed", verbs)
        self.assertIn("listing_draft.owner_confirmed", verbs)
        for event in ActivityEvent.objects.filter(verb__in=["business.registration_confirmed", "listing_draft.owner_confirmed"]):
            self.assertEqual((event.actor_type, event.actor_id), (ActivityEvent.BUSINESS_OWNER, self.owner.pk))
        # nothing the middleware logged for the public posts either
        self.assertEqual(ActivityEvent.objects.filter(verb__icontains="confirm/").count(), 0)
        dump = json.dumps(
            list(ActivityEvent.objects.values("verb", "summary", "before", "after", "target_label", "user_agent")),
            default=str,
        )
        for forbidden in (raw, "/business/confirm", "token", "1110001", "0241110001"):
            self.assertNotIn(forbidden, dump)

    def test_decline_activity_has_no_token_or_reason(self):
        _row, raw = self.ask(drafts=[self.draft()])
        self.post(DECLINE, token=raw, reason="private reason 123")
        events = ActivityEvent.objects.filter(verb="listing_draft.owner_declined")
        self.assertEqual(events.count(), 1)
        dump = json.dumps(list(ActivityEvent.objects.values("summary", "before", "after")), default=str)
        self.assertNotIn(raw, dump)
        self.assertNotIn("private reason", dump)


class KycGateTests(Base):
    def register(self, owner):
        """A staff-registered owner with its registration text out and a business.kyc request waiting."""
        self.ask(owner=owner, registration=True)
        return approvals.submit(
            self.scout, "business.kyc", target=owner, title=f"New business: {owner.display_name}",
            payload={"business_owner_id": owner.pk},
        )

    def as_(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def test_kyc_approval_blocked_until_registration_confirmed(self):
        approval = self.register(self.owner)
        self.as_(self.lead)
        blocked = self.client.post(f"/api/approvals/{approval.id}/approve/", {}, format="json")
        self.assertEqual(blocked.status_code, 409, blocked.content)
        self.assertEqual(blocked.json()["code"], "confirmation_missing")
        self.assertEqual(blocked.json()["detail"], "The owner has not confirmed this registration yet.")
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.kyc_status, BusinessOwner.PENDING)
        confirm_registration(self.owner)
        ok = self.client.post(f"/api/approvals/{approval.id}/approve/", {}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.kyc_status, BusinessOwner.VERIFIED)

    def test_the_service_door_refuses_too_even_for_a_super_admin_direct_apply(self):
        approval = self.register(self.owner)
        with self.assertRaises(approvals.ApprovalError) as caught:
            approvals.approve(approval.id, self.lead)
        self.assertEqual((caught.exception.status_code, caught.exception.code), (409, "confirmation_missing"))

    def test_kyc_queue_blocked_until_registration_confirmed(self):
        self.register(self.owner)
        self.as_(self.lead)
        blocked = self.client.post(f"/api/accounts/kyc/{self.owner.id}/approve/", {}, format="json")
        self.assertEqual(blocked.status_code, 409, blocked.content)
        self.assertEqual(blocked.json()["code"], "confirmation_missing")
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.kyc_status, BusinessOwner.PENDING)
        confirm_registration(self.owner)
        ok = self.client.post(f"/api/accounts/kyc/{self.owner.id}/approve/", {}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()["kyc_status"], "verified")

    def test_an_owner_with_no_registration_request_is_unaffected(self):
        self.as_(self.lead)
        response = self.client.post(f"/api/accounts/kyc/{self.owner.id}/approve/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def test_a_declined_registration_stays_blocked(self):
        approval = self.register(self.owner)
        raw = TOKEN.search(senders.sms_outbox[-1].body).group(1)
        self.post(DECLINE, token=raw, reason="no")
        self.as_(self.lead)
        self.assertEqual(self.client.post(f"/api/approvals/{approval.id}/approve/", {}, format="json").status_code, 409)

    def test_kyc_review_shows_masked_number_and_state(self):
        approval = self.register(self.owner)
        self.as_(self.lead)
        row = OwnerConfirmation.objects.get(business_owner=self.owner)
        detail = self.client.get(f"/api/approvals/{approval.id}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        text = detail.content.decode()
        rows = {item["field"]: item["after"] for item in detail.json()["diff"]}
        line = rows["Owner confirmation"]
        self.assertTrue(line.startswith("Waiting — text sent to 024 *** 0001 on "), line)
        self.assertIn("expires", line)
        self.assertIn(f"{timezone.localtime(row.expires_at):%-d %b %Y}", line)
        self.assertNotIn("1110001", text)
        self.assertNotIn(TOKEN.search(senders.sms_outbox[-1].body).group(1), text)
        sheet = self.client.get(f"/api/portfolio/businesses/{self.owner.id}/review/")
        self.assertEqual(sheet.status_code, 200, sheet.content)
        self.assertEqual(sheet.json()["owner_confirmation"], {"confirmed": False, "line": line})
        confirm_registration(self.owner)
        done = self.client.get(f"/api/approvals/{approval.id}/").json()
        self.assertTrue({i["field"]: i["after"] for i in done["diff"]}["Owner confirmation"].startswith("Confirmed "))

    def test_review_line_is_honest_when_texts_are_simulated(self):
        self.register(self.owner)
        OwnerConfirmation.objects.update(send_state=OwnerConfirmation.SIMULATED, sent_at=None)
        line = confirmations.registration_line(self.owner)
        self.assertTrue(line.startswith("Waiting — not sent: texts are simulated (024 *** 0001), expires "), line)

    def test_registration_confirmation_does_not_verify_kyc(self):
        self.register(self.owner)
        raw = TOKEN.search(senders.sms_outbox[-1].body).group(1)
        self.assertEqual(self.post(CONFIRM, token=raw).status_code, 200)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.kyc_status, BusinessOwner.PENDING)
        self.assertIsNone(self.owner.reviewed_by)
