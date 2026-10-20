"""Two people end a stuck withdrawal by hand (wallet rulings 7C, Task 4; spec §13 (xxxv), (xxxvi)): staff ask through
POST staff/withdrawals/<id>/resolve/ (or the older fail/ door, outcome "failed"), another holder of wallets.manage
approves in the approvals inbox with the password again, and the provider is asked again at approval. Review Focus:
staff A cannot approve their own request; a provider that flips to paid after a hand fail was asked for refuses it."""
from contextlib import contextmanager
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Customer
from accounts.testing import make_staff, staff_token
from activity.models import ActivityEvent
from approvals.models import ApprovalRequest
from fraud.models import FraudFlag
from ledger import posting
from ledger.models import Account, Journal
from payments import providers
from wallets import approval_kinds, payouts, withdrawals
from wallets.models import Withdrawal

from .helpers import destination, fund

URL = "/api/wallet/staff/withdrawals/"
EVIDENCE = "Hubtel statement 18 Oct: ref HT-0241234567 never left"


@contextmanager
def provider_not_wired():
    """The provider cannot report (Hubtel until Plan 7): staff's evidence stands for either outcome."""
    with mock.patch.object(providers.SimulatedProvider, "status", side_effect=providers.NotConnected("not wired")):
        yield


@contextmanager
def provider_says(outcome):
    with mock.patch.object(providers.SimulatedProvider, "status", return_value=providers.PayoutResult(outcome)):
        yield


@override_settings(LEDGER_ENABLED=True, SIMULATED_PAYOUT_OUTCOME="pending")
class WithdrawalResolutionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.kofi = make_staff("accountant", "kofi@example.com")
        self.yaw = make_staff("accountant", "yaw@example.com")
        self.boss = make_staff("super_admin", "boss@example.com")
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.dest = destination(self.customer)
        fund(Account.CUSTOMER_WALLET, self.customer, 20000, "fund-1")

    def client_for(self, staff, sudo=True):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")
        return client

    def sent(self, request_id="req-res-0001", minutes=31):
        withdrawal = payouts.submit(
            withdrawals.request(self.customer, destination_id=self.dest.pk, amount_pesewas=5000, request_id=request_id).pk,
        )
        Withdrawal.objects.filter(pk=withdrawal.pk).update(submitted_at=timezone.now() - timedelta(minutes=minutes))
        withdrawal.refresh_from_db()
        return withdrawal

    def propose(self, withdrawal, outcome="failed", evidence=EVIDENCE, staff=None):
        return self.client_for(staff or self.kofi).post(
            f"{URL}{withdrawal.pk}/resolve/", {"outcome": outcome, "evidence": evidence}, format="json",
        )

    def approve(self, approval_id, staff=None, sudo=True):
        return self.client_for(staff or self.yaw, sudo=sudo).post(f"/api/approvals/{approval_id}/approve/", {"note": ""}, format="json")

    def wallet(self):
        return posting.balance_of(Account.CUSTOMER_WALLET, self.customer)

    def reversed_journals(self, withdrawal):
        return Journal.objects.filter(key=f"withdrawal-reversed-{withdrawal.reference}").count()

    def paid_journals(self, withdrawal):
        return Journal.objects.filter(key=f"withdrawal-paid-{withdrawal.reference}").count()

    def test_the_rules_screen_words_the_chain_with_the_cosign_setting_key(self):
        response = self.client_for(self.boss).get("/api/approvals/rules/")
        self.assertEqual(response.status_code, 200, response.content)
        text = response.content.decode()
        self.assertIn("one approval from another holder of wallets.manage, or a super admin", text.lower())
        self.assertIn("two approvals above the co-sign limit", text)
        self.assertIn("cosign_threshold", text)

    def test_the_resolve_door_locks_the_withdrawal_before_the_duplicate_check(self):
        withdrawal = self.sent()
        with provider_not_wired(), CaptureQueriesContext(connection) as queries:
            self.assertEqual(self.propose(withdrawal).status_code, 201)
        sql = [query["sql"] for query in queries]
        advisory = next(i for i, text in enumerate(sql) if "pg_advisory_xact_lock" in text)
        lock = next(i for i, text in enumerate(sql) if "FOR UPDATE" in text and "wallets_withdrawal" in text and i > advisory)
        self.assertLess(advisory, lock)  # advisory target lock, then the row, as a decision takes them
        self.assertFalse(any("approvals_approvalrequest" in text and "SELECT" in text for text in sql[:lock]))
        with provider_not_wired():
            again = self.propose(withdrawal, staff=self.yaw)
        self.assertEqual((again.status_code, again.json()["code"]), (409, "resolution_pending"))

    def test_proposer_cannot_approve_own(self):
        withdrawal = self.sent()
        with provider_not_wired():
            response = self.propose(withdrawal)
            self.assertEqual(response.status_code, 201, response.content)
            self.assertEqual(response.json()["status"], ApprovalRequest.PENDING)
            refused = self.approve(response.json()["approval_id"], staff=self.kofi)
        self.assertEqual(refused.status_code, 403, refused.content)
        withdrawal.refresh_from_db()
        self.assertEqual((withdrawal.status, self.wallet(), self.reversed_journals(withdrawal)), (Withdrawal.PROCESSING, 15000, 0))

    def test_a_super_admins_own_request_waits_for_someone_else(self):
        withdrawal = self.sent()
        with provider_not_wired():
            response = self.propose(withdrawal, staff=self.boss)
            self.assertEqual((response.status_code, response.json()["status"]), (201, ApprovalRequest.PENDING), response.content)
            self.assertEqual(self.approve(response.json()["approval_id"], staff=self.boss).status_code, 403)
            withdrawal.refresh_from_db()
            self.assertEqual((withdrawal.status, self.wallet()), (Withdrawal.PROCESSING, 15000))
            self.assertEqual(self.approve(response.json()["approval_id"], staff=self.kofi).status_code, 200)
        withdrawal.refresh_from_db()
        self.assertEqual((withdrawal.status, self.wallet()), (Withdrawal.FAILED, 20000))

    def test_second_staff_approves_and_funds_return(self):
        withdrawal = self.sent()
        with provider_not_wired():
            approval_id = self.propose(withdrawal).json()["approval_id"]
            self.assertEqual(self.approve(approval_id, sudo=False).json()["code"], "sudo_required")
            response = self.approve(approval_id)
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(self.approve(approval_id).status_code, 400)                       # already decided
        withdrawal.refresh_from_db()
        self.assertEqual((withdrawal.status, withdrawal.failure_reason), (Withdrawal.FAILED, approval_kinds.STAFF_FAILED_REASON))
        self.assertEqual((self.wallet(), self.reversed_journals(withdrawal)), (20000, 1))
        self.assertEqual(posting.balance_of(Account.WITHDRAWAL_IN_TRANSIT), 0)
        approval = ApprovalRequest.objects.get(pk=approval_id)
        self.assertEqual((approval.kind, approval.amount, approval.decided_by), (approval_kinds.KEY, 50, self.yaw))
        event = ActivityEvent.objects.get(verb="wallets.withdrawal_failed")
        self.assertEqual((event.after["status"], event.after["proposed_by"], event.actor_id), ("failed", self.kofi.pk, self.yaw.pk))
        for text in (event.summary, str(event.after), str(approval.payload), approval.maker_note):
            self.assertNotIn("0241234567", text)                                                 # the evidence is kept masked
        self.assertIn("*******567", event.after["evidence"])

    def test_paid_outcome_posts_paid_journal_once(self):
        withdrawal = self.sent()
        with provider_not_wired():
            approval_id = self.propose(withdrawal, outcome="paid", evidence="Hubtel statement shows HT-77 paid").json()["approval_id"]
            self.assertEqual(self.approve(approval_id).status_code, 200)
        withdrawal.refresh_from_db()
        self.assertEqual((withdrawal.status, self.paid_journals(withdrawal), self.reversed_journals(withdrawal)), (Withdrawal.SUCCEEDED, 1, 0))
        self.assertEqual(self.wallet(), 15000)                                                    # paid out, never credited back
        payouts.apply_result(withdrawal.reference, providers.SUCCEEDED, amount_pesewas=withdrawal.net_pesewas)  # the webhook, late
        self.assertEqual(self.paid_journals(withdrawal), 1)
        self.assertFalse(FraudFlag.objects.filter(dedupe_key__contains=withdrawal.reference).exists())
        self.assertTrue(ActivityEvent.objects.filter(verb="wallets.withdrawal_paid", target_id=str(withdrawal.pk)).exists())

    def test_provider_says_paid_so_failed_refused(self):
        withdrawal = self.sent()
        with provider_not_wired():
            approval_id = self.propose(withdrawal).json()["approval_id"]
        with override_settings(SIMULATED_PAYOUT_OUTCOME="succeed"):                               # it paid after all
            response = self.approve(approval_id)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "provider_changed"), response.content)
        withdrawal.refresh_from_db()
        self.assertEqual((withdrawal.status, self.wallet(), self.reversed_journals(withdrawal)), (Withdrawal.PROCESSING, 15000, 0))
        self.assertEqual(ApprovalRequest.objects.get(pk=approval_id).status, ApprovalRequest.PENDING)
        self.assertFalse(ActivityEvent.objects.filter(verb="wallets.withdrawal_failed").exists())
        with provider_says(providers.PROCESSING):                                                 # still in progress: never failed
            response = self.approve(approval_id)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "provider_processing"))
        self.assertEqual(self.wallet(), 15000)

    def test_provider_says_failed_so_paid_refused(self):
        withdrawal = self.sent()
        with provider_not_wired():
            approval_id = self.propose(withdrawal, outcome="paid").json()["approval_id"]
        with override_settings(SIMULATED_PAYOUT_OUTCOME="fail"):
            response = self.approve(approval_id)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "provider_changed"))
        withdrawal.refresh_from_db()
        self.assertEqual((withdrawal.status, self.paid_journals(withdrawal)), (Withdrawal.PROCESSING, 0))

    def test_an_agreeing_provider_answer_settles_it_as_its_own_report(self):
        withdrawal = self.sent()
        with provider_not_wired():
            approval_id = self.propose(withdrawal).json()["approval_id"]
        with override_settings(SIMULATED_PAYOUT_OUTCOME="fail"):
            self.assertEqual(self.approve(approval_id).status_code, 200)
        withdrawal.refresh_from_db()
        self.assertEqual((withdrawal.status, withdrawal.failure_reason), (Withdrawal.FAILED, payouts.FAILED_REASON))
        self.assertEqual((self.wallet(), self.reversed_journals(withdrawal)), (20000, 1))
        self.assertTrue(ActivityEvent.objects.get(verb="wallets.withdrawal_failed").after["provider_confirmed"])

    def test_processing_forever_resolved_with_evidence_by_two_people(self):
        # The provider keeps saying PROCESSING a month on: it cannot be failed, but its statement can settle it as paid.
        withdrawal = self.sent(minutes=60 * 24 * 30)
        with provider_says(providers.PROCESSING):
            response = self.propose(withdrawal, outcome="failed")
            self.assertEqual((response.status_code, response.json()["code"]), (409, "provider_processing"))
            response = self.propose(withdrawal, outcome="paid", evidence="Hubtel statement 18 Oct shows HT-91 paid")
            self.assertEqual(response.status_code, 201, response.content)
            self.assertEqual(self.approve(response.json()["approval_id"]).status_code, 200)
        withdrawal.refresh_from_db()
        self.assertEqual((withdrawal.status, self.paid_journals(withdrawal), self.wallet()), (Withdrawal.SUCCEEDED, 1, 15000))
        # A provider that cannot report at all leaves the evidence standing: two people fail it and the money returns.
        other = self.sent(request_id="req-res-0002", minutes=60 * 24 * 30)
        with provider_not_wired():
            approval_id = self.propose(other).json()["approval_id"]
            self.assertEqual(self.approve(approval_id).status_code, 200)
        other.refresh_from_db()
        self.assertEqual((other.status, self.reversed_journals(other), self.wallet()), (Withdrawal.FAILED, 1, 15000))

    def test_missing_evidence_400(self):
        withdrawal = self.sent()
        for evidence in ("", "   ", "short note", " 123456789 "):                                 # under 10 after strip
            with self.subTest(evidence=evidence):
                response = self.propose(withdrawal, evidence=evidence)
                if len(evidence.strip()) >= 10:
                    continue
                self.assertEqual((response.status_code, response.json()["code"]), (400, "evidence_required"))
        response = self.client_for(self.kofi).post(f"{URL}{withdrawal.pk}/fail/", {"reason": "too short"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.propose(withdrawal, outcome="lost").status_code, 400)
        self.assertFalse(ApprovalRequest.objects.exists())

    def test_not_stuck_refused(self):
        withdrawal = self.sent(minutes=5)
        with mock.patch.object(providers.SimulatedProvider, "status") as ask:
            response = self.propose(withdrawal)
            ask.assert_not_called()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "not_stuck"))
        self.assertFalse(ApprovalRequest.objects.exists())

    def test_settled_before_approval_is_stale(self):
        withdrawal = self.sent()
        with provider_not_wired():
            approval_id = self.propose(withdrawal).json()["approval_id"]
        payouts.apply_result(withdrawal.reference, providers.SUCCEEDED, amount_pesewas=withdrawal.net_pesewas)  # the poll settled it
        response = self.approve(approval_id)
        self.assertEqual(response.status_code, 409)
        self.assertEqual((self.wallet(), self.reversed_journals(withdrawal)), (15000, 0))

    def test_the_fail_door_submits_a_failed_request_for_any_amount(self):
        withdrawal = self.sent()
        with provider_not_wired():
            response = self.client_for(self.kofi).post(f"{URL}{withdrawal.pk}/fail/", {"reason": EVIDENCE}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        approval = ApprovalRequest.objects.get(pk=response.json()["approval_id"])
        self.assertEqual((approval.kind, approval.payload["outcome"], approval.required_approvals), (approval_kinds.KEY, "failed", 1))
        withdrawal.refresh_from_db()
        self.assertEqual((withdrawal.status, self.wallet()), (Withdrawal.PROCESSING, 15000))     # nothing ends until approved
        with provider_not_wired():
            again = self.client_for(self.kofi).post(f"{URL}{withdrawal.pk}/fail/", {"reason": EVIDENCE}, format="json")
        self.assertEqual((again.status_code, again.json()["code"]), (409, "resolution_pending"))

    def test_a_held_one_never_sent_cannot_be_settled_as_paid(self):
        withdrawal = withdrawals.request(self.customer, destination_id=self.dest.pk, amount_pesewas=5000, request_id="req-held-0001")
        Withdrawal.objects.filter(pk=withdrawal.pk).update(created_at=timezone.now() - timedelta(minutes=11))
        response = self.propose(withdrawal, outcome="paid")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "never_sent"))
        with mock.patch.object(providers.SimulatedProvider, "status") as ask:
            approval_id = self.propose(withdrawal).json()["approval_id"]
            self.assertEqual(self.approve(approval_id).status_code, 200)
            ask.assert_not_called()
        self.assertEqual(self.wallet(), 20000)


    def approved_event(self, outcome, request_id="req-res-0001"):
        withdrawal = self.sent(request_id)
        with provider_not_wired():
            approval_id = self.propose(withdrawal, outcome=outcome).json()["approval_id"]
            self.assertEqual(self.approve(approval_id).status_code, 200)
        verb = "wallets.withdrawal_paid" if outcome == "paid" else "wallets.withdrawal_failed"
        return ActivityEvent.objects.get(verb=verb, target_id=str(withdrawal.pk))

    def test_staff_paid_approval_event_carries_amount(self):
        event = self.approved_event("paid")
        self.assertEqual((event.after["amount"], event.after["amount_label"]), ("50.00", "GH₵ 50.00"))

    def test_staff_fail_approval_event_carries_amount(self):
        event = self.approved_event("failed")
        self.assertEqual((event.after["amount"], event.after["amount_label"]), ("50.00", "GH₵ 50.00"))

    def test_approval_events_never_contain_payout_number(self):
        from .helpers import MOMO_NUMBER
        for outcome, request_id in (("paid", "req-res-0011"), ("failed", "req-res-0012")):
            event = self.approved_event(outcome, request_id)
            blob = repr((event.summary, event.before, event.after))
            self.assertNotIn(MOMO_NUMBER, blob)
            self.assertNotIn(MOMO_NUMBER[-9:], blob)
