"""Final-fix wave F1, M5, M9: staff can ask the owner to confirm the registration again; Resend is offered only when
the backend would accept it; an owner is texted at most five times a day."""
import json
import re
from datetime import timedelta

from django.utils import timezone

from accounts.models import BusinessOwner
from accounts.testing import make_staff
from activity.models import ActivityEvent
from otp import senders
from portfolio import confirmations
from portfolio.models import ListingDraft, OwnerConfirmation
from portfolio.tests.change_fixtures import ChangeTestBase

TOKEN = re.compile(r"token=([\w-]+)")


class ReaskBase(ChangeTestBase):
    def setUp(self):
        super().setUp()
        senders.sms_outbox.clear()
        self.admin = make_staff("super_admin", "root@example.com")
        self.gm = make_staff("general_manager", "gm@example.com")
        with self.captureOnCommitCallbacks(execute=True):
            self.first = confirmations.request_confirmation(self.owner, self.scout, registration=True)

    def url(self, owner=None):
        return f"/api/portfolio/businesses/{(owner or self.owner).pk}/confirmation/registration/"

    def ask(self, staff=None):
        self.as_staff(staff or self.scout)
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(self.url(), {}, format="json")

    def lapse(self):
        OwnerConfirmation.objects.filter(pk=self.first.pk).update(expires_at=timezone.now() - timedelta(seconds=1))


class RegistrationReaskTests(ReaskBase):
    def test_a_lapsed_registration_link_can_be_asked_again(self):
        self.lapse()
        response = self.ask()
        self.assertEqual(response.status_code, 200, response.content)
        self.first.refresh_from_db()
        self.assertIsNotNone(self.first.revoked_at)
        row = OwnerConfirmation.objects.get(revoked_at__isnull=True)
        self.assertEqual(row.scope, OwnerConfirmation.REGISTRATION)
        confirmations.confirm(TOKEN.search(senders.sms_outbox[-1].body).group(1))
        self.assertTrue(confirmations.registration_confirmed(BusinessOwner.objects.get(pk=self.owner.pk)))

    def test_a_simulated_registration_link_can_be_asked_again(self):
        OwnerConfirmation.objects.filter(pk=self.first.pk).update(send_state=OwnerConfirmation.SIMULATED)
        response = self.ask()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(OwnerConfirmation.objects.filter(revoked_at__isnull=True).count(), 1)

    def test_a_declined_registration_can_be_asked_again(self):
        confirmations.decline(TOKEN.search(senders.sms_outbox[-1].body).group(1), "not me")
        self.assertFalse(confirmations.registration_confirmed(BusinessOwner.objects.get(pk=self.owner.pk)))
        response = self.ask()
        self.assertEqual(response.status_code, 200, response.content)
        confirmations.confirm(TOKEN.search(senders.sms_outbox[-1].body).group(1))
        self.assertTrue(confirmations.registration_confirmed(BusinessOwner.objects.get(pk=self.owner.pk)))

    def test_a_live_delivered_link_is_not_replaced(self):
        response = self.ask()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "still_open")
        self.assertEqual(OwnerConfirmation.objects.count(), 1)

    def test_a_confirmed_registration_answers_409(self):
        confirmations.confirm(TOKEN.search(senders.sms_outbox[-1].body).group(1))
        response = self.ask()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "already_confirmed")

    def test_an_owner_with_no_registration_row_is_refused_not_given_one(self):
        other = self.other_owner()
        self.as_staff(self.lead)
        response = self.client.post(self.url(other), {}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertFalse(OwnerConfirmation.objects.filter(business_owner=other).exists())

    def other_owner(self):
        from portfolio.tests.change_fixtures import make_business

        return make_business(self.scout, phone="+233244100999", name="Other House", gps="AK-039-5999")

    def test_a_scout_who_does_not_manage_the_business_is_refused(self):
        self.lapse()
        response = self.ask(self.other_scout)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(OwnerConfirmation.objects.count(), 1)

    def test_the_general_manager_may_ask_since_2026_10_30(self):
        self.lapse()
        self.assertEqual(self.ask(self.gm).status_code, 200)
        self.assertEqual(OwnerConfirmation.objects.count(), 2)

    def test_operations_and_super_admin_may_ask_for_any_business(self):
        self.lapse()
        self.assertEqual(self.ask(self.lead).status_code, 200)
        OwnerConfirmation.objects.filter(revoked_at__isnull=True).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.ask(self.admin).status_code, 200)

    def test_a_staff_members_number_is_still_never_texted(self):
        make_staff("scout", "ama2@example.com", phone="0244100200")
        self.lapse()
        response = self.ask()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["send_note"], confirmations.SEND_NOTES[OwnerConfirmation.BLOCKED])
        self.assertEqual(len(senders.sms_outbox), 1)  # only the first text

    def test_the_resend_limit_applies(self):
        for _ in range(3):
            OwnerConfirmation.objects.filter(revoked_at__isnull=True).update(expires_at=timezone.now() - timedelta(seconds=1))
            self.assertEqual(self.ask().status_code, 200)
        OwnerConfirmation.objects.filter(revoked_at__isnull=True).update(expires_at=timezone.now() - timedelta(seconds=1))
        response = self.ask()
        self.assertEqual(response.status_code, 429)

    def test_response_and_activity_carry_no_token_link_or_whole_number(self):
        self.lapse()
        response = self.ask()
        body = response.content.decode()
        raw = TOKEN.search(senders.sms_outbox[-1].body).group(1)
        self.assertNotIn(raw, body)
        self.assertNotIn("confirm#", body)
        self.assertNotIn("244100200", body.replace("*", ""))
        self.assertIn("owner_confirmation", " ".join(ActivityEvent.objects.values_list("verb", flat=True)))
        blob = json.dumps(list(ActivityEvent.objects.values("summary", "after", "before")), default=str)
        self.assertNotIn(raw, blob)

    def test_business_detail_says_whether_the_owner_can_be_asked_again(self):
        self.as_staff(self.lead)
        waiting = self.client.get(f"/api/portfolio/businesses/{self.owner.pk}/review/").json()["owner_confirmation"]
        self.assertEqual((waiting["state"], waiting["can_ask_again"]), ("waiting", False))
        self.lapse()
        lapsed = self.client.get(f"/api/portfolio/businesses/{self.owner.pk}/review/").json()["owner_confirmation"]
        self.assertEqual((lapsed["state"], lapsed["can_ask_again"]), ("lapsed", True))
        # the business page carries the same, for the people who can ask: the manager and Operations, not another scout
        for who, expected in ((self.scout, True), (self.lead, True), (self.other_scout, None)):
            self.as_staff(who)
            response = self.client.get(f"/api/portfolio/businesses/{self.owner.pk}/")
            if expected is None:
                self.assertEqual(response.status_code, 404)
                continue
            body = response.json()["owner_confirmation"]
            self.assertEqual((body["state"], body["can_ask_again"]), ("lapsed", expected))
        self.as_staff(self.gm)  # the General Manager can ask as Operations can (since 2026-10-30)
        self.assertTrue(self.client.get(f"/api/portfolio/businesses/{self.owner.pk}/review/").json()["owner_confirmation"]["can_ask_again"])


class ResendHonestyTests(ReaskBase):
    def draft(self):
        return ListingDraft.objects.create(
            business_owner=self.owner, kind="product", created_by=self.scout, payload={"name": "Jollof", "price_amount": "25"},
        )

    def test_a_simulated_text_can_be_resent_and_says_so(self):
        draft = self.draft()
        with self.captureOnCommitCallbacks(execute=True):
            row = confirmations.request_confirmation(self.owner, self.scout, drafts=[draft])
        OwnerConfirmation.objects.filter(pk=row.pk).update(send_state=OwnerConfirmation.SIMULATED)
        draft = ListingDraft.objects.select_related("confirmation", "approval").get(pk=draft.pk)
        self.assertTrue(confirmations.state_of(draft)["can_resend"])
        with self.captureOnCommitCallbacks(execute=True):
            confirmations.resend([draft.pk], self.scout)

    def test_a_fresh_queued_text_says_it_is_on_its_way_not_sent_and_valid(self):
        draft = self.draft()
        from unittest import mock

        with mock.patch.object(confirmations, "_send_after_commit"):
            row = self.ask_drafts(draft)
        self.assertEqual(row.send_state, OwnerConfirmation.QUEUED)
        draft = ListingDraft.objects.select_related("confirmation", "approval").get(pk=draft.pk)
        self.assertFalse(confirmations.state_of(draft)["can_resend"])
        with self.assertRaises(Exception) as caught:
            confirmations.resend([draft.pk], self.scout)
        self.assertEqual(caught.exception.message, confirmations.STILL_SENDING)
        self.assertNotIn("was sent", caught.exception.message)

    def ask_drafts(self, draft):
        with self.captureOnCommitCallbacks(execute=True):
            return confirmations.request_confirmation(self.owner, self.scout, drafts=[draft])

    def test_a_delivered_live_link_cannot_be_resent_and_the_state_says_so(self):
        draft = self.draft()
        self.ask_drafts(draft)
        draft = ListingDraft.objects.select_related("confirmation", "approval").get(pk=draft.pk)
        state = confirmations.state_of(draft)
        self.assertFalse(state["can_resend"])

    def test_a_failed_text_and_a_lapsed_link_can_be_resent(self):
        draft = self.draft()
        row = self.ask_drafts(draft)
        OwnerConfirmation.objects.filter(pk=row.pk).update(send_state=OwnerConfirmation.FAILED)
        draft = ListingDraft.objects.select_related("confirmation", "approval").get(pk=draft.pk)
        self.assertTrue(confirmations.state_of(draft)["can_resend"])
        OwnerConfirmation.objects.filter(pk=row.pk).update(
            send_state=OwnerConfirmation.SENT, expires_at=timezone.now() - timedelta(seconds=1),
        )
        draft = ListingDraft.objects.select_related("confirmation", "approval").get(pk=draft.pk)
        self.assertTrue(confirmations.state_of(draft)["can_resend"])


class DailyCapTests(ReaskBase):
    def draft(self):
        return ListingDraft.objects.create(
            business_owner=self.owner, kind="product", created_by=self.scout, payload={"name": "Jollof", "price_amount": "25"},
        )

    def test_a_sixth_text_in_a_day_is_refused_with_429(self):
        from accounts.claims import ClaimError

        # the registration ask in setUp was the first text of the day; four more are allowed
        for _ in range(4):
            with self.captureOnCommitCallbacks(execute=True):
                confirmations.request_confirmation(self.owner, self.scout, drafts=[self.draft()])
        self.assertEqual(OwnerConfirmation.objects.count(), 5)
        before = len(senders.sms_outbox)
        with self.assertRaises(ClaimError) as caught:
            confirmations.request_confirmation(self.owner, self.scout, drafts=[self.draft()])
        self.assertEqual((caught.exception.code, caught.exception.status_code), ("daily_cap", 429))
        self.assertEqual(OwnerConfirmation.objects.count(), 5)
        self.assertEqual(len(senders.sms_outbox), before)

    def test_the_cap_is_per_owner_and_resets_next_day(self):
        from unittest import mock

        from accounts.claims import ClaimError

        for _ in range(4):
            with self.captureOnCommitCallbacks(execute=True):
                confirmations.request_confirmation(self.owner, self.scout, drafts=[self.draft()])
        other = self.other_owner_with_phone()
        with self.captureOnCommitCallbacks(execute=True):
            confirmations.request_confirmation(other, self.scout, drafts=[self.other_draft(other)])
        with self.assertRaises(ClaimError):
            confirmations.request_confirmation(self.owner, self.scout, drafts=[self.draft()])
        tomorrow = timezone.now() + timedelta(days=1)
        with mock.patch("django.utils.timezone.now", return_value=tomorrow), self.captureOnCommitCallbacks(execute=True):
            confirmations.request_confirmation(self.owner, self.scout, drafts=[self.draft()])

    def other_owner_with_phone(self):
        from portfolio.tests.change_fixtures import make_business

        return make_business(self.scout, phone="+233244100998", name="Third House", gps="AK-039-5998")

    def other_draft(self, owner):
        return ListingDraft.objects.create(
            business_owner=owner, kind="product", created_by=self.scout, payload={"name": "X", "price_amount": "25"},
        )

    def test_the_endpoint_answers_429_with_an_honest_message(self):
        for _ in range(4):
            with self.captureOnCommitCallbacks(execute=True):
                confirmations.request_confirmation(self.owner, self.scout, drafts=[self.draft()])
        OwnerConfirmation.objects.filter(revoked_at__isnull=True).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.as_staff(self.scout)
        response = self.client.post(self.url(), {}, format="json")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["detail"], confirmations.DAILY_CAPPED)
