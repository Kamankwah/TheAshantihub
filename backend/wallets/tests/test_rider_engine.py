"""Third-party riders withdraw through the Stage 3b engine (wallets Plan 5, Task 5; spec §2.2 step 5, §7, §8, §9): their
balance only (never the reserve), to an account in their own name once an approved Ghana Card is on file, confirmed with
a texted or emailed code. AshantiHub's own riders have no wallet. Review Focus 1, 4 and 6."""
from datetime import timedelta
from types import SimpleNamespace

from django.core.cache import cache
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Customer, Permission, Role
from accounts.testing import make_staff, staff_token
from delivery import employment
from delivery.models import Rider, RiderDocument, RiderEmploymentPeriod
from ledger import posting, riders
from ledger.models import Account
from ledger.tests import rider_helpers
from notifications.models import Notification
from otp import senders, step_up
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
        with self.captureOnCommitCallbacks(execute=True):
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

    def test_a_card_with_no_expiry_date_does_not_count(self):
        RiderDocument.objects.filter(rider=self.swift).update(expires_on=None)
        self.assertFalse(employment.id_verified(self.swift))
        self.assertEqual(names.verified_names(self.staff), [])

    def test_a_lapsed_card_answers_id_required_at_withdrawal_and_a_short_name_says_ask_the_manager(self):
        self.fund()
        self.dest = destination(self.staff, name="Kojo Mensah")
        RiderDocument.objects.filter(rider=self.swift).update(expires_on=timezone.localdate() - timedelta(days=1))
        self.refused("id_required", amount=100)
        RiderDocument.objects.filter(rider=self.swift).update(expires_on=timezone.localdate() + timedelta(days=30))
        self.staff.full_name = "Kojo"
        self.staff.save(update_fields=["full_name"])
        with self.assertRaises(destinations.DestinationError) as caught:
            destinations.check(self.staff, MOMO)
        self.assertEqual(caught.exception.code, "name_unusable")
        self.assertIn("delivery manager", caught.exception.message)
        self.assertNotIn("your profile", caught.exception.message)

    def test_office_staff_are_refused_at_destinations_and_withdrawals(self):
        accountant = make_staff("accountant", "acc@example.com")
        with self.assertRaises(destinations.DestinationError) as caught:
            destinations.check(accountant, MOMO)
        self.assertEqual((caught.exception.code, caught.exception.status_code), ("wallet_disabled", 409))
        self.dest = destination(accountant, name="Esi Mensah")
        self.refused("wallet_disabled", amount=100, holder=accountant)

    def test_a_re_roled_rider_loses_the_wallet_and_a_held_withdrawal_goes_back(self):
        self.fund()
        self.dest = destination(self.staff, name="Kojo Mensah")
        held = self.hold(500)
        self.staff.role = Role.objects.get(name="accountant")
        self.staff.save(update_fields=["role"])
        self.refused("wallet_disabled", amount=100, request_id="req-rider-0002")
        self.assertIsNone(payouts.claim(held.pk))
        held.refresh_from_db()
        self.assertEqual(held.status, Withdrawal.CANCELLED)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.staff), 900)

    def test_a_held_withdrawal_goes_back_once_if_the_rider_is_deactivated_or_the_card_lapses(self):
        self.fund()
        self.dest = destination(self.staff, name="Kojo Mensah")
        first = self.hold(300)
        self.staff.is_active = False
        self.staff.save(update_fields=["is_active"])
        self.assertIsNone(payouts.claim(first.pk))
        self.assertIsNone(payouts.claim(first.pk))                                              # never twice
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.staff), 900)
        self.staff.is_active = True
        self.staff.save(update_fields=["is_active"])
        second = self.hold(300, request_id="req-rider-0002")
        RiderDocument.objects.filter(rider=self.swift).update(expires_on=timezone.localdate() - timedelta(days=1))
        self.assertIsNone(payouts.claim(second.pk))
        second.refresh_from_db()
        self.assertEqual(second.status, Withdrawal.CANCELLED)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.staff), 900)

    def test_a_customer_and_a_rider_with_the_same_id_are_kept_apart(self):
        customer = Customer.objects.create(pk=self.staff.pk, full_name="Ama Owusu", phone="+233241234500", password_hash="x")
        theirs = destination(customer, name="Ama Owusu", number="0241234500")
        self.dest = theirs
        self.refused("unknown_destination", amount=100)                                         # the rider cannot use it
        self.dest = destination(self.staff, name="Kojo Mensah")
        self.fund()
        mine = self.hold(100)
        self.assertEqual(list(withdrawals.mine(customer)), [])
        self.assertEqual(list(withdrawals.mine(self.staff)), [mine])
        request = SimpleNamespace(META={}, auth={"jti": "j1"}, user=customer)
        raw = step_up.issue(customer, step_up.WITHDRAWAL, request)
        as_rider = SimpleNamespace(META={step_up.HEADER: raw}, auth={"jti": "j1"}, user=self.staff)
        with self.assertRaises(step_up.StepUpRequired):
            step_up.require(as_rider, step_up.WITHDRAWAL, force=True)


@override_settings(LEDGER_ENABLED=True)
class RiderCaseTests(TestCase):
    def test_a_fraud_case_about_a_riders_withdrawal_names_the_rider(self):
        from fraud.models import FraudFlag
        from wallets.tests.helpers import destination as make_destination

        swift = rider_helpers.rider()
        rider_helpers.ghana_card(swift)
        rider_helpers.earning(swift, gross=2000, at=timezone.now() - timedelta(days=1))
        to = make_destination(swift.staff, name="Kojo Mensah")
        with transaction.atomic():
            held = withdrawals.request(swift.staff, destination_id=to.pk, amount_pesewas=500, request_id="req-case-0001")
        with override_settings(SIMULATED_PAYOUT_OUTCOME="pending"):
            sent = payouts.submit(held.pk)
        from payments import providers

        payouts.apply_result(sent.reference, providers.SUCCEEDED, amount_pesewas=100)
        flag = FraudFlag.objects.get(dedupe_key=f"withdrawal-amount-{sent.reference}")
        self.assertEqual(flag.staff_subject, swift.staff)
        self.assertIsNone(flag.related_business_owner)


@override_settings(LEDGER_ENABLED=True, SIMULATED_PAYOUT_OUTCOME="pending")
class RiderSelfDealingTests(TestCase):
    def test_a_rider_holding_wallets_manage_cannot_fail_their_own_withdrawal(self):
        cache.clear()
        swift = rider_helpers.rider()
        rider_helpers.ghana_card(swift)
        staff = swift.staff
        staff.extra_permissions.add(Permission.objects.get(codename="wallets.manage"))
        balance, held = riders.accounts_of(swift)
        posting.post(key="fund-self", kind="test_fund", lines=[
            posting.debit(posting.account_for(Account.PROVIDER_CLEARING), 1000), posting.credit(balance, 1000),
        ])
        dest = destination(staff, name="Kojo Mensah")
        with transaction.atomic():
            w = withdrawals.request(staff, destination_id=dest.pk, amount_pesewas=500, request_id="req-self-0001")
        Withdrawal.objects.filter(pk=w.pk).update(created_at=timezone.now() - timedelta(minutes=20))
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=True)}")
        response = client.post(f"/api/wallet/staff/withdrawals/{w.pk}/fail/", {"reason": "mine"}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (403, "own_withdrawal"))
        w.refresh_from_db()
        self.assertEqual(w.status, Withdrawal.PENDING)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, staff), 500)


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

    def test_a_rider_without_the_dispatch_permission_gets_no_code(self):
        self.swift.staff.revoked_permissions.add(Permission.objects.get(codename="delivery.dispatch"))
        self.assertEqual(self.send("withdrawal").status_code, 403)
        self.assertEqual(senders.sms_outbox, [])

    def test_a_re_roled_third_party_rider_gets_no_code(self):
        self.swift.staff.role = Role.objects.get(name="accountant")
        self.swift.staff.save(update_fields=["role"])
        self.assertEqual(self.send("withdrawal").status_code, 403)
        self.assertEqual(senders.sms_outbox, [])
