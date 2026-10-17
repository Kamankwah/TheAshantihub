"""Third-party riders withdraw through the Stage 3b engine (wallets Plan 5, Task 5; spec §2.2 step 5, §7, §8, §9): their
balance only (never the reserve), to an account in their own name once an approved Ghana Card is on file, confirmed with
a texted or emailed code. AshantiHub's own riders have no wallet. Review Focus 1, 4 and 6."""
from datetime import timedelta

from django.core.cache import cache
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from delivery.models import Rider, RiderDocument, RiderEmploymentPeriod
from ledger import posting, riders
from ledger.models import Account
from ledger.tests import rider_helpers
from notifications.models import Notification
from otp import senders
from otp.tests.helpers import last_sms_code
from wallets import destinations, names, payouts, withdrawals
from wallets.models import Withdrawal

from .helpers import destination

MOMO = {"rail": "momo", "institution": "MTN", "account_number": "0241234567"}


@override_settings(LEDGER_ENABLED=True)
class RiderEngineTests(TestCase):
    def setUp(self):
        self.swift = rider_helpers.rider()
        self.staff = self.swift.staff
        rider_helpers.ghana_card(self.swift)

    def fund(self, net=900, reserve=100):
        balance, held = riders.accounts_of(self.swift)
        lines = [posting.debit(posting.account_for(Account.PROVIDER_CLEARING), net + reserve), posting.credit(balance, net)]
        if reserve:
            lines.append(posting.credit(held, reserve))
        posting.post(key=f"fund-{net}-{reserve}", kind="test_fund", lines=lines)

    def hold(self, amount, request_id="req-rider-0001", holder=None):
        with transaction.atomic():
            return withdrawals.request(
                holder or self.staff, destination_id=self.dest.pk, amount_pesewas=amount, request_id=request_id,
            )

    def refused(self, code, **kwargs):
        with self.assertRaises(withdrawals.WithdrawalError) as caught:
            self.hold(**kwargs)
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    def test_review_focus_an_ashantihub_rider_has_no_wallet(self):
        own = rider_helpers.rider("own@example.com", third_party=False, phone="+233244000009")
        rider_helpers.ghana_card(own)
        with self.assertRaises(destinations.DestinationError) as caught:
            destinations.check(own.staff, MOMO)
        self.assertEqual((caught.exception.code, caught.exception.status_code), ("wallet_disabled", 409))
        self.dest = destination(own.staff, name="Kojo Mensah")
        self.refused("wallet_disabled", amount=100, holder=own.staff)
        self.assertEqual(names.verified_names(own.staff), [])
        self.assertEqual(names.verified_names(make_staff("accountant", "acc@example.com")), [])

    def test_review_focus_without_an_approved_ghana_card_no_destination(self):
        self.swift.documents.all().delete()
        cards = (None, {"expires_on": timezone.localdate() - timedelta(days=1)}, {"status": RiderDocument.UPLOADED})
        for card in cards:
            if card is not None:
                rider_helpers.ghana_card(self.swift, **card)
            with self.subTest(card=card), self.assertRaises(destinations.DestinationError) as caught:
                destinations.check(self.staff, MOMO)
            self.assertEqual((caught.exception.code, caught.exception.status_code), ("id_required", 409))
        self.assertEqual(names.verified_names(self.staff), [])

    def test_a_rider_adds_a_destination_in_their_own_name(self):
        self.assertEqual(names.verified_names(self.staff), ["Kojo Mensah"])
        checked = destinations.check(self.staff, MOMO)
        self.assertEqual(checked["matched_name"], "Kojo Mensah")
        with transaction.atomic():
            saved = destinations.save(self.staff, checked)
        self.assertEqual((saved.holder_type, saved.holder_id), ("staff", self.staff.pk))

    @override_settings(SIMULATED_ACCOUNT_NAMES={"+233241234567": "Ama Owusu"})
    def test_an_account_in_someone_elses_name_is_refused(self):
        with self.assertRaises(destinations.DestinationError) as caught:
            destinations.check(self.staff, MOMO)
        self.assertEqual(caught.exception.code, "name_mismatch")

    def test_review_focus_a_rider_withdraws_the_balance_never_the_reserve(self):
        self.fund(900, 100)
        self.dest = destination(self.staff, name="Kojo Mensah")
        self.refused("insufficient_funds", amount=1000)
        held = self.hold(900)
        self.assertEqual(held.source_kind, Account.RIDER_BALANCE)
        self.assertEqual(payouts.submit(held.pk).status, Withdrawal.SUCCEEDED)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.staff), 0)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, self.staff), 100)            # AshantiHub's, taken at day end
        self.assertTrue(Notification.objects.filter(staff=self.staff, kind="withdrawal").exists())

    def test_review_focus_a_negative_balance_blocks_withdrawal(self):
        balance, _ = riders.accounts_of(self.swift)
        posting.post(key="owed", kind="test", lines=[
            posting.debit(balance, 500), posting.credit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), 500),
        ], allow_negative={Account.RIDER_BALANCE})
        self.dest = destination(self.staff, name="Kojo Mensah")
        refusal = self.refused("negative_balance", amount=100)
        self.assertIn("next deliveries", refusal.message)

    def test_a_deactivated_rider_cannot_withdraw_or_add_a_destination(self):
        self.fund()
        self.dest = destination(self.staff, name="Kojo Mensah")
        self.staff.is_active = False
        self.staff.save(update_fields=["is_active"])
        self.refused("suspended", amount=100)
        with self.assertRaises(destinations.DestinationError) as caught:
            destinations.check(self.staff, MOMO)
        self.assertEqual(caught.exception.code, "suspended")

    def test_a_held_withdrawal_goes_back_if_the_rider_stops_being_third_party_before_it_is_sent(self):
        self.fund()
        self.dest = destination(self.staff, name="Kojo Mensah")
        held = self.hold(500)
        Rider.objects.filter(pk=self.swift.pk).update(employment=Rider.ASHANTIHUB, third_party_since=None)
        RiderEmploymentPeriod.objects.filter(rider=self.swift).update(ended_at=timezone.now())
        self.assertIsNone(payouts.claim(held.pk))
        held.refresh_from_db()
        self.assertEqual(held.status, Withdrawal.CANCELLED)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.staff), 900)


@override_settings(LEDGER_ENABLED=True)
class RiderStepUpTests(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.swift = rider_helpers.rider()
        self.client = self.client_for(self.swift.staff)

    def client_for(self, staff):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
        return client

    def send(self, action, client=None):
        return (client or self.client).post("/api/otp/step-up/send/", {"action": action, "channel": "sms"}, format="json")

    def test_review_focus_a_third_party_rider_gets_codes_for_wallet_actions_only(self):
        for action in ("withdrawal", "payout_destination"):
            with self.subTest(action=action):
                self.assertEqual(self.send(action).status_code, 200)
                verified = self.client.post("/api/otp/step-up/verify/", {"action": action, "code": last_sms_code()}, format="json")
                self.assertEqual(verified.status_code, 200, verified.content)
                self.assertEqual(verified.json()["action"], action)
        for action in ("contact_change", "password_change"):                    # 4 sends in all: under otp_send's 5/min
            response = self.send(action)
            self.assertEqual((response.status_code, response.json()["code"]), (409, "otp_off"), action)

    def test_an_ashantihub_rider_and_office_staff_cannot_ask_for_codes(self):
        own = rider_helpers.rider("own@example.com", third_party=False, phone="+233244000009")
        for staff in (own.staff, make_staff("accountant", "acc@example.com")):
            self.assertEqual(self.send("withdrawal", self.client_for(staff)).status_code, 403)
        self.assertEqual(senders.sms_outbox, [])

    def test_with_the_ledger_off_a_rider_gets_no_code(self):
        with override_settings(LEDGER_ENABLED=False):
            response = self.send("withdrawal")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "otp_off"))
        self.assertEqual(senders.sms_outbox, [])
