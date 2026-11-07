from django.db import IntegrityError, connection, transaction
from django.test import TestCase

from fraud.models import FraudFlag
from ledger import integrity, posting, tasks
from ledger.models import Account, Journal, JournalLine


def post_sale(key="k1", amount=1000):
    wallet = posting.account_for(Account.CUSTOMER_WALLET, None)
    pending = posting.account_for(Account.VENDOR_PENDING, None)
    # a customer_wallet cannot go below zero, so fund it first from provider clearing
    clearing = posting.account_for(Account.PROVIDER_CLEARING, None)
    posting.post(key=f"fund-{key}", kind="topup", lines=[posting.debit(clearing, amount), posting.credit(wallet, amount)])
    return posting.post(key=key, kind="sale", lines=[posting.debit(wallet, amount), posting.credit(pending, amount)])


class IntegrityReportTests(TestCase):
    def test_a_sound_ledger_has_no_problems(self):
        post_sale()
        report = integrity.find_problems()
        self.assertEqual(report["problems"], {})
        self.assertEqual((report["journals"], report["lines"]), (2, 4))

    def test_an_empty_ledger_is_sound(self):
        self.assertEqual(integrity.find_problems()["problems"], {})

    def test_a_cached_balance_that_drifted_is_reported(self):
        post_sale()
        account = Account.objects.get(kind=Account.VENDOR_PENDING)
        Account.objects.filter(pk=account.pk).update(net_credit=account.net_credit + 5)
        problems = integrity.find_problems()["problems"]
        self.assertEqual(problems["account_cache_differs"]["examples"], [account.pk])
        self.assertNotIn("unbalanced_journals", problems)

    def test_an_unbalanced_journal_and_the_trial_balance_are_reported(self):
        # Bypass the application and the commit-time trigger the way a bad restore (or someone with ownership) would.
        with connection.cursor() as cursor:
            cursor.execute("ALTER TABLE ledger_journalline DISABLE TRIGGER ledger_journal_balanced")
        journal = post_sale()
        JournalLine.objects.bulk_create([JournalLine(journal=journal, account=Account.objects.first(), side="credit", amount=7)])
        problems = integrity.find_problems()["problems"]
        self.assertEqual(problems["unbalanced_journals"]["examples"], [journal.pk])
        self.assertEqual(problems["trial_balance"]["net_pesewas"], 7)

    def test_a_journal_with_no_lines_is_reported(self):
        empty = Journal.objects.create(key="empty", kind="x")
        self.assertEqual(integrity.find_problems()["problems"]["journals_without_lines"]["examples"], [empty.pk])


class BalancedJournalTriggerTests(TestCase):
    """Ledger migration 0015: the database refuses a journal that does not balance, at commit."""

    def test_a_balanced_posting_commits(self):
        post_sale()
        connection.check_constraints()  # runs the deferred trigger now, as COMMIT would

    def test_an_unbalanced_insert_is_refused_at_commit(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():  # the savepoint rolls the bad rows back, so the test's own teardown check passes
                journal = Journal.objects.create(key="bad", kind="x")
                account = posting.account_for(Account.CUSTOMER_WALLET, None)
                JournalLine.objects.create(journal=journal, account=account, side="credit", amount=10)
                connection.check_constraints()

    def test_the_balanced_set_may_be_inserted_one_line_at_a_time(self):
        journal = Journal.objects.create(key="ok", kind="x")
        a = posting.account_for(Account.CUSTOMER_WALLET, None)
        b = posting.account_for(Account.VENDOR_PENDING, None)
        JournalLine.objects.create(journal=journal, account=a, side="credit", amount=10)  # unbalanced for a moment
        JournalLine.objects.create(journal=journal, account=b, side="debit", amount=10)
        connection.check_constraints()


class NightlyTaskTests(TestCase):
    def test_a_sound_ledger_returns_ok_and_raises_nothing(self):
        post_sale()
        self.assertEqual(tasks.verify_ledger_integrity(), {"journals": 2, "lines": 4, "accounts": 3, "ok": True})
        self.assertFalse(FraudFlag.objects.exists())

    def test_a_difference_opens_one_case_logs_an_error_and_corrects_nothing(self):
        post_sale()
        account = Account.objects.get(kind=Account.VENDOR_PENDING)
        Account.objects.filter(pk=account.pk).update(net_credit=0)
        with self.assertLogs("ledger.tasks", level="ERROR") as logs:
            first = tasks.verify_ledger_integrity()
            tasks.verify_ledger_integrity()
        self.assertEqual((first["ok"], first["problems"]), (False, ["account_cache_differs"]))
        self.assertIn("LEDGER INTEGRITY FAILED", logs.output[0])
        self.assertEqual(FraudFlag.objects.count(), 1)  # one case per day, however often it runs
        account.refresh_from_db()
        self.assertEqual(account.net_credit, 0)  # not "fixed"
