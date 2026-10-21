import re
from datetime import timedelta
from unittest import mock

from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.claims import ClaimError, hash_token
from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff
from activity.models import ActivityEvent
from notifications.models import Notification
from otp import senders, spend
from otp.models import OtpEvent
from portfolio import confirmations, tasks
from portfolio.models import ListingDraft, OwnerConfirmation
from wallets import vendor_texts

TOKEN = re.compile(r"token=([\w-]+)")


def make_owner(phone="024 111 0001", *, name="Akosua Mensah", business_name="Akosua's Kitchen", **extra):
    owner = BusinessOwner.objects.create(full_name=name, login_phone=phone, password_hash="x", **extra)
    BusinessOwnerProfile.objects.create(business_owner=owner, business_name=business_name)
    return owner


class Base(TestCase):
    def setUp(self):
        senders.sms_outbox.clear()
        self.scout = make_staff("scout", "kwame@example.com")
        self.owner = make_owner()

    def draft(self, owner=None, name="Jollof rice", **extra):
        return ListingDraft.objects.create(
            business_owner=owner or self.owner, kind="product", created_by=self.scout,
            payload={"name": name, "price_amount": "25.00"}, **extra,
        )

    def ask(self, **kwargs):
        if "drafts" not in kwargs:
            kwargs["drafts"] = [self.draft()]
        with self.captureOnCommitCallbacks(execute=True):
            row = confirmations.request_confirmation(self.owner, self.scout, **kwargs)
        return row

    def raw(self):
        return TOKEN.search(senders.sms_outbox[-1].body).group(1)

    def at(self, moment):
        return mock.patch("django.utils.timezone.now", return_value=moment)


class IssueTests(Base):
    def test_link_valid_seven_days(self):
        row = self.ask()
        raw = self.raw()
        self.assertEqual(row.expires_at - row.created_at < timedelta(days=7, seconds=5), True)
        self.assertGreaterEqual(row.expires_at - row.created_at, timedelta(days=7) - timedelta(seconds=5))
        with self.at(row.created_at + timedelta(days=6)):
            self.assertEqual(confirmations.owner_view(raw)["business_name"], "Akosua's Kitchen")
        with self.at(row.expires_at + timedelta(seconds=1)):
            with self.assertRaises(ClaimError) as caught:
                confirmations.owner_view(raw)
            self.assertEqual(caught.exception.code, "expired")
            with self.assertRaises(ClaimError) as caught:
                confirmations.confirm(raw)
            self.assertEqual(caught.exception.code, "expired")
        self.assertEqual(ListingDraft.objects.get().status, ListingDraft.AWAITING_OWNER)

    def test_token_stored_hashed_and_never_returned(self):
        draft = self.draft()
        row = self.ask(drafts=[draft])
        raw = self.raw()
        self.assertNotEqual(row.token_hash, raw)
        self.assertEqual(row.token_hash, hash_token(raw))
        state = confirmations.state_of(ListingDraft.objects.get(pk=draft.pk))
        self.assertEqual(set(state), {"state", "sent_to_masked", "sent_at", "expires_at", "send_note"})
        self.assertNotIn(raw, repr(state))
        self.assertNotIn(row.token_hash, repr(state))
        self.assertNotIn("/business/confirm", repr(state))
        self.assertNotIn("1110001", repr(state))
        # the raw token appears only in the one text
        self.assertEqual(len(senders.sms_outbox), 1)
        for event in ActivityEvent.objects.all():
            self.assertNotIn(raw, repr(event.__dict__))
            self.assertNotIn("/business/confirm", repr(event.__dict__))
        for notice in Notification.objects.all():
            self.assertNotIn(raw, repr(notice.__dict__))
        for field in OwnerConfirmation._meta.fields:
            if field.name != "token_hash":
                self.assertNotIn(raw, str(getattr(row, field.name)))
        self.assertNotIn(row.token_hash, str(row))
        self.assertTrue(ActivityEvent.objects.filter(verb="owner_confirmation.sent").exists())

    def test_text_goes_to_owner_login_phone_normalized(self):
        self.ask()
        self.assertEqual(senders.sms_outbox[-1].to, "+233241110001")
        self.assertEqual(OwnerConfirmation.objects.get().sent_to, "+233241110001")
        state = confirmations.state_of(ListingDraft.objects.get())
        self.assertEqual(state["sent_to_masked"], "024 *** 0001")
        self.assertEqual(OwnerConfirmation.objects.get().send_state, OwnerConfirmation.SENT)
        self.assertIsNotNone(OwnerConfirmation.objects.get().sent_at)
        self.assertEqual(state["send_note"], "Text sent")

    def test_body_fits_gsm7_and_306(self):
        self.ask(drafts=[self.draft(), self.draft(name="Banku")])
        body = senders.sms_outbox[-1].body
        link = confirmations.confirm_link(self.raw())
        self.assertIn(link, body)
        self.assertTrue(body.startswith("AshantiHub: Kwame asks you to confirm 2 items for Akosua's Kitchen. Open "))
        self.assertTrue(body.endswith("Valid 7 days."))
        self.assertLessEqual(len(body), 306)
        self.assertTrue(vendor_texts.fits(body))

    @override_settings(FRONTEND_BASE_URL="https://" + "a" * 100 + ".example.com")
    def test_a_very_long_business_name_is_truncated_so_the_body_fits(self):
        name = ("Nana Yaa's Wonderful \u00c9clair \u2019 Kitchen " * 4)[:150]
        owner = make_owner("024 111 0002", business_name=name)
        with self.captureOnCommitCallbacks(execute=True):
            confirmations.request_confirmation(owner, self.scout, drafts=[self.draft(owner)])
        body = senders.sms_outbox[-1].body
        link = confirmations.confirm_link(self.raw())
        self.assertLessEqual(len(body), 306)
        self.assertTrue(vendor_texts.fits(body))
        self.assertIn("..", body)

    def test_no_phone_sends_nothing_and_says_so(self):
        owner = make_owner("not a phone")
        with self.captureOnCommitCallbacks(execute=True):
            row = confirmations.request_confirmation(owner, self.scout, drafts=[self.draft(owner)])
        self.assertEqual(senders.sms_outbox, [])
        self.assertEqual(row.send_state, OwnerConfirmation.NO_PHONE)
        state = confirmations.state_of(ListingDraft.objects.get(business_owner=owner))
        self.assertEqual(state["send_note"], "Not sent: no phone number on file")
        self.assertEqual(state["sent_to_masked"], "")

    @override_settings(OTP_SMS_PROVIDER="simulated")
    def test_simulated_provider_sets_send_state_simulated(self):
        row = self.ask()
        row.refresh_from_db()
        self.assertEqual(row.send_state, OwnerConfirmation.SIMULATED)
        self.assertIsNone(row.sent_at)
        state = confirmations.state_of(ListingDraft.objects.get())
        self.assertEqual(state["send_note"], "Not sent: texts are simulated")
        self.assertIsNone(state["sent_at"])

    def test_provider_failure_or_crash_is_recorded_and_never_raises(self):
        with mock.patch("otp.senders.deliver", return_value=senders.Delivery(ok=False, provider="hubtel")):
            row = self.ask()
        row.refresh_from_db()
        self.assertEqual(row.send_state, OwnerConfirmation.FAILED)
        other = make_owner("024 111 0003")
        with mock.patch("otp.senders.deliver", side_effect=RuntimeError("boom")):
            with self.captureOnCommitCallbacks(execute=True):
                row = confirmations.request_confirmation(other, self.scout, drafts=[self.draft(other)])
        row.refresh_from_db()
        self.assertEqual(row.send_state, OwnerConfirmation.FAILED)

    def test_a_staff_members_number_is_blocked_and_nothing_is_sent(self):
        make_staff("scout", "ama@example.com", phone="+233 24 111 0001")  # same number as the owner's, written differently
        draft = self.draft()
        row = self.ask(drafts=[draft])
        self.assertEqual(senders.sms_outbox, [])
        self.assertEqual(row.send_state, OwnerConfirmation.BLOCKED)
        self.assertEqual(confirmations.state_of(ListingDraft.objects.get(pk=draft.pk))["send_note"],
                         "Not sent: that number belongs to a staff account")
        self.assertEqual(spend.owner_confirmation_texts_sent_on(timezone.localdate()), 0)
        # a resend is blocked the same way
        OwnerConfirmation.objects.filter(pk=row.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        with self.captureOnCommitCallbacks(execute=True):
            again = confirmations.resend([draft.pk], self.scout)
        self.assertEqual((again.send_state, senders.sms_outbox), (OwnerConfirmation.BLOCKED, []))

    def test_an_inactive_staff_number_or_a_different_number_is_not_blocked(self):
        make_staff("scout", "old@example.com", phone="0241110001", is_active=False)
        make_staff("scout", "other@example.com", phone="0241119999")
        row = self.ask()
        row.refresh_from_db()
        self.assertEqual(row.send_state, OwnerConfirmation.SENT)
        self.assertEqual(len(senders.sms_outbox), 1)

    def test_no_provider_call_inside_the_transaction(self):
        with mock.patch("otp.senders.deliver") as deliver:
            confirmations.request_confirmation(self.owner, self.scout, drafts=[self.draft()])
            deliver.assert_not_called()  # the TestCase transaction never commits, so the send is still pending

    def test_the_text_is_counted_by_spend_and_is_never_an_otp_event(self):
        self.ask()
        day = timezone.localdate()
        self.assertEqual(spend.owner_confirmation_texts_sent_on(day), 1)
        self.assertEqual(spend.texts_sent_on(day), 1)
        self.assertEqual(OtpEvent.objects.count(), 0)

    def test_nothing_to_confirm_is_refused(self):
        with self.assertRaises(ClaimError) as caught:
            confirmations.request_confirmation(self.owner, self.scout)
        self.assertEqual(caught.exception.code, "nothing_to_confirm")

    def test_needs_owner_text_is_true_today(self):
        self.assertTrue(confirmations.needs_owner_text(self.owner))

    def test_str_has_no_hash(self):
        row = self.ask()
        self.assertNotIn(row.token_hash, str(row))
        self.assertNotIn(row.token_hash, str(ListingDraft.objects.get()))


class RevokeAndTakeoverTests(Base):
    def test_resend_revokes_old_link_and_old_token_fails_used(self):
        draft = self.draft()
        first = self.ask(drafts=[draft])
        old = self.raw()
        OwnerConfirmation.objects.filter(pk=first.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        with self.captureOnCommitCallbacks(execute=True):
            second = confirmations.resend([draft.pk], self.scout)
        new = self.raw()
        self.assertNotEqual(old, new)
        first.refresh_from_db()
        self.assertIsNotNone(first.revoked_at)
        for call in (lambda: confirmations.confirm(old), lambda: confirmations.owner_view(old),
                     lambda: confirmations.decline(old, "no")):
            with self.assertRaises(ClaimError) as caught:
                call()
            self.assertEqual(caught.exception.code, "used")
        self.assertEqual(second.resend_count, 1)
        self.assertEqual(ListingDraft.objects.get().confirmation_id, second.pk)
        self.assertTrue(ActivityEvent.objects.filter(verb="owner_confirmation.resent").exists())
        confirmations.confirm(new)
        self.assertEqual(ListingDraft.objects.get().status, ListingDraft.OWNER_CONFIRMED)

    def test_a_new_link_takes_over_drafts_and_registration_from_the_revoked_one(self):
        scout_owner = make_owner("024 111 0004", registration_channel=BusinessOwner.SCOUT, registered_by=self.scout)
        first_draft = ListingDraft.objects.create(
            business_owner=scout_owner, kind="service", created_by=self.scout, payload={"name": "Braids"},
        )
        with self.captureOnCommitCallbacks(execute=True):
            first = confirmations.request_confirmation(scout_owner, self.scout, drafts=[first_draft], registration=True)
        self.assertEqual(first.scope, OwnerConfirmation.REGISTRATION)
        second_draft = ListingDraft.objects.create(
            business_owner=scout_owner, kind="service", created_by=self.scout, payload={"name": "Wigs"},
        )
        with self.captureOnCommitCallbacks(execute=True):
            second = confirmations.request_confirmation(scout_owner, self.scout, drafts=[second_draft])
        first.refresh_from_db()
        self.assertIsNotNone(first.revoked_at)
        self.assertEqual(second.scope, OwnerConfirmation.REGISTRATION)  # it took the registration over
        self.assertEqual(
            set(ListingDraft.objects.filter(confirmation=second).values_list("pk", flat=True)),
            {first_draft.pk, second_draft.pk},
        )
        self.assertEqual(OwnerConfirmation.objects.filter(business_owner=scout_owner, revoked_at__isnull=True).count(), 1)
        self.assertIn("3 items", senders.sms_outbox[-1].body)

    def test_only_one_open_link_per_owner_in_the_database(self):
        self.ask()
        with self.assertRaises(IntegrityError), transaction.atomic():
            OwnerConfirmation.objects.create(
                business_owner=self.owner, scope="listings", token_hash="x" * 64,
                expires_at=timezone.now(), created_by=self.scout,
            )

    def test_other_owners_are_untouched(self):
        other = make_owner("024 111 0005")
        mine = self.ask()
        with self.captureOnCommitCallbacks(execute=True):
            theirs = confirmations.request_confirmation(other, self.scout, drafts=[self.draft(other)])
        mine.refresh_from_db()
        self.assertIsNone(mine.revoked_at)
        self.assertIsNone(theirs.revoked_at)


class AnswerTests(Base):
    def test_single_use_second_confirm_fails_used(self):
        self.ask()
        raw = self.raw()
        confirmations.confirm(raw)
        with self.assertRaises(ClaimError) as caught:
            confirmations.confirm(raw)
        self.assertEqual(caught.exception.code, "used")

    def test_unknown_token_is_invalid(self):
        for raw in ("nope", "", None):
            with self.assertRaises(ClaimError) as caught:
                confirmations.confirm(raw)
            self.assertEqual(caught.exception.code, "invalid")

    def test_confirm_moves_drafts_to_owner_confirmed_and_registration_confirmed(self):
        owner = make_owner("024 111 0006", registration_channel=BusinessOwner.SCOUT, registered_by=self.scout)
        draft = ListingDraft.objects.create(
            business_owner=owner, kind="product", created_by=self.scout, payload={"name": "Shea butter"},
        )
        withdrawn = ListingDraft.objects.create(
            business_owner=owner, kind="product", created_by=self.scout, status=ListingDraft.WITHDRAWN,
        )
        with self.captureOnCommitCallbacks(execute=True):
            confirmations.request_confirmation(owner, self.scout, drafts=[draft], registration=True)
        self.assertFalse(confirmations.registration_confirmed(owner))
        with mock.patch.object(confirmations, "_after_owner_confirmed") as seam:
            row = confirmations.confirm(self.raw())
        seam.assert_called_once()
        self.assertEqual([d.pk for d in seam.call_args.args[0]], [draft.pk])
        draft.refresh_from_db()
        withdrawn.refresh_from_db()
        self.assertEqual(draft.status, ListingDraft.OWNER_CONFIRMED)
        self.assertEqual(withdrawn.status, ListingDraft.WITHDRAWN)
        self.assertIsNotNone(row.confirmed_at)
        self.assertTrue(confirmations.registration_confirmed(owner))
        # nothing is approved or published by confirming alone
        self.assertIsNone(draft.approval_id)

    def test_a_listings_only_link_does_not_confirm_the_registration(self):
        owner = make_owner("024 111 0007", registration_channel=BusinessOwner.SCOUT, registered_by=self.scout)
        with self.captureOnCommitCallbacks(execute=True):
            confirmations.request_confirmation(owner, self.scout, registration=True)
        confirmations.confirm(self.raw())
        other = make_owner("024 111 0008", registration_channel=BusinessOwner.SCOUT, registered_by=self.scout)
        with self.captureOnCommitCallbacks(execute=True):
            confirmations.request_confirmation(other, self.scout, registration=True)
        with self.captureOnCommitCallbacks(execute=True):
            row = confirmations.request_confirmation(other, self.scout, drafts=[self.draft(other)])
        self.assertEqual(row.scope, OwnerConfirmation.REGISTRATION)

    def test_decline_marks_owner_declined_and_notifies_creator(self):
        draft = self.draft()
        self.ask(drafts=[draft])
        raw = self.raw()
        with self.captureOnCommitCallbacks(execute=True):
            row = confirmations.decline(raw, "Wrong prices")
        draft.refresh_from_db()
        self.assertEqual(draft.status, ListingDraft.OWNER_DECLINED)
        self.assertIsNotNone(row.declined_at)
        notice = Notification.objects.get(kind="owner_declined")
        self.assertEqual(notice.staff_id, self.scout.pk)
        self.assertIn("Wrong prices", notice.body)
        self.assertNotIn(raw, notice.body)
        with self.assertRaises(ClaimError) as caught:
            confirmations.confirm(raw)
        self.assertEqual(caught.exception.code, "used")

    def test_owner_view_shows_only_what_the_owner_may_see(self):
        other = make_owner("024 111 0009", business_name="Other Shop")
        self.draft(other, name="Secret item")
        self.ask(drafts=[self.draft(name="Jollof rice")])
        view = confirmations.owner_view(self.raw())
        self.assertEqual(set(view), {"business_name", "owner_name_first", "registration", "items", "expires_at"})
        self.assertEqual(view["owner_name_first"], "Akosua")
        self.assertFalse(view["registration"])
        self.assertEqual(view["items"], [{"kind": "product", "name": "Jollof rice", "price": "25.00"}])
        self.assertNotIn("0001", repr(view))
        self.assertNotIn("Secret", repr(view))


class StateTests(Base):
    def test_lapsed_draft_reads_lapsed_then_resend_revives_it(self):
        draft = self.draft()
        row = self.ask(drafts=[draft])
        self.assertEqual(confirmations.state_of(ListingDraft.objects.get())["state"], "awaiting_owner")
        OwnerConfirmation.objects.filter(pk=row.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        draft = ListingDraft.objects.get()
        self.assertEqual(confirmations.state_of(draft)["state"], "lapsed")
        with self.captureOnCommitCallbacks(execute=True):
            confirmations.resend([draft.pk], self.scout)
        self.assertEqual(confirmations.state_of(ListingDraft.objects.get())["state"], "awaiting_owner")

    def test_a_draft_not_yet_sent_reads_its_status(self):
        state = confirmations.state_of(self.draft())
        self.assertEqual(state["state"], "draft")
        self.assertEqual(state["send_note"], "Not sent to the owner yet")

    def test_resend_is_refused_while_the_link_is_live_and_sent(self):
        draft = self.draft()
        self.ask(drafts=[draft])
        with self.assertRaises(ClaimError) as caught:
            confirmations.resend([draft.pk], self.scout)
        self.assertEqual(caught.exception.code, "still_open")

    def test_resend_after_a_failed_send_is_allowed(self):
        draft = self.draft()
        with mock.patch("otp.senders.deliver", return_value=senders.Delivery(ok=False, provider="hubtel")):
            first = self.ask(drafts=[draft])
        first.refresh_from_db()
        self.assertEqual(first.send_state, OwnerConfirmation.FAILED)
        with self.captureOnCommitCallbacks(execute=True):
            second = confirmations.resend(first, self.scout)
        second.refresh_from_db()
        self.assertEqual(second.send_state, OwnerConfirmation.SENT)

    def test_resend_is_refused_for_confirmed_and_submitted_drafts(self):
        for status in (ListingDraft.OWNER_CONFIRMED, ListingDraft.SUBMITTED, ListingDraft.OWNER_DECLINED):
            draft = self.draft(status=status)
            with self.assertRaises(ClaimError) as caught:
                confirmations.resend([draft.pk], self.scout)
            self.assertEqual(caught.exception.code, "used")
        fresh = self.draft()
        with self.assertRaises(ClaimError) as caught:
            confirmations.resend([fresh.pk], self.scout)
        self.assertEqual(caught.exception.code, "not_sent")

    def test_resend_rate_limit_three_per_day(self):
        draft = self.draft()
        self.ask(drafts=[draft])
        for _ in range(3):
            OwnerConfirmation.objects.filter(business_owner=self.owner, revoked_at__isnull=True).update(
                expires_at=timezone.now() - timedelta(seconds=1),
            )
            with self.captureOnCommitCallbacks(execute=True):
                confirmations.resend([draft.pk], self.scout)
        OwnerConfirmation.objects.filter(business_owner=self.owner, revoked_at__isnull=True).update(
            expires_at=timezone.now() - timedelta(seconds=1),
        )
        before = OwnerConfirmation.objects.count()
        with self.assertRaises(ClaimError) as caught:
            confirmations.resend([draft.pk], self.scout)
        self.assertEqual(caught.exception.code, "rate_limited")
        self.assertEqual(OwnerConfirmation.objects.count(), before)
        # the next Accra day starts again
        tomorrow = timezone.now() + timedelta(days=1)
        with self.at(tomorrow), self.captureOnCommitCallbacks(execute=True):
            confirmations.resend([draft.pk], self.scout)
        self.assertEqual(ListingDraft.objects.get().resends_today, 1)

    def test_resend_of_mixed_businesses_is_refused(self):
        other = make_owner("024 111 0010")
        a, b = self.draft(), self.draft(other)
        with self.assertRaises(ClaimError) as caught:
            confirmations.resend([a.pk, b.pk], self.scout)
        self.assertEqual(caught.exception.code, "mixed_owners")


class RegistrationConfirmedTests(Base):
    def test_registration_confirmed_grandfathers_existing_owner(self):
        scout_owner = make_owner("024 111 0011", registration_channel=BusinessOwner.SCOUT, registered_by=self.scout)
        # online owner: always confirmed
        self.assertTrue(confirmations.registration_confirmed(self.owner))
        scout_without_registrar = make_owner(
            "024 111 0012", registration_channel=BusinessOwner.SCOUT, registered_by=None,
        )
        self.assertTrue(confirmations.registration_confirmed(scout_without_registrar))
        # (c) staff-registered with no registration row at all: grandfathered
        self.assertTrue(confirmations.registration_confirmed(scout_owner))
        # unconfirmed, expired and revoked rows only: not confirmed
        with self.captureOnCommitCallbacks(execute=True):
            first = confirmations.request_confirmation(scout_owner, self.scout, registration=True)
        self.assertFalse(confirmations.registration_confirmed(scout_owner))
        OwnerConfirmation.objects.filter(pk=first.pk).update(expires_at=timezone.now() - timedelta(days=1))
        self.assertFalse(confirmations.registration_confirmed(scout_owner))
        OwnerConfirmation.objects.filter(pk=first.pk).update(revoked_at=timezone.now())
        self.assertFalse(confirmations.registration_confirmed(scout_owner))
        # (b) a confirmed registration row
        with self.captureOnCommitCallbacks(execute=True):
            confirmations.request_confirmation(scout_owner, self.scout, registration=True)
        confirmations.confirm(self.raw())
        self.assertTrue(confirmations.registration_confirmed(scout_owner))


class LapseTaskTests(Base):
    def test_creator_is_told_once_when_a_link_lapses(self):
        other_scout = make_staff("scout", "ama@example.com")
        mine = self.draft()
        theirs = ListingDraft.objects.create(
            business_owner=self.owner, kind="product", created_by=other_scout, payload={"name": "x"},
        )
        row = self.ask(drafts=[mine, theirs])
        self.assertEqual(tasks.notify_lapsed_confirmations(), 0)
        OwnerConfirmation.objects.filter(pk=row.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(tasks.notify_lapsed_confirmations(), 1)
        self.assertEqual(tasks.notify_lapsed_confirmations(), 0)  # once
        recipients = set(Notification.objects.filter(kind="owner_link_lapsed").values_list("staff_id", flat=True))
        self.assertEqual(recipients, {self.scout.pk, other_scout.pk})
        for notice in Notification.objects.all():
            self.assertNotIn("token", notice.body)

    def test_answered_links_are_not_announced(self):
        self.ask()
        confirmations.confirm(self.raw())
        OwnerConfirmation.objects.update(expires_at=timezone.now() - timedelta(days=1))
        self.assertEqual(tasks.notify_lapsed_confirmations(), 0)

    def test_the_task_is_scheduled_hourly(self):
        from django.conf import settings

        entry = settings.CELERY_BEAT_SCHEDULE["portfolio-notify-lapsed-confirmations"]
        self.assertEqual(entry["task"], "portfolio.tasks.notify_lapsed_confirmations")
