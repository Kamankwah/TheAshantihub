from django.db import DatabaseError, connection, transaction
from django.test import TestCase

from ledger.models import Account, Journal, JournalLine, OrderRefund


class AccountBalanceTests(TestCase):
    def test_a_credit_normal_account_reads_net_credit(self):
        account = Account.objects.create(kind=Account.VENDOR_PENDING, owner_type="accounts.businessowner", owner_id="1", net_credit=500)
        self.assertEqual(account.balance, 500)

    def test_a_debit_normal_account_reads_the_negated_net_credit(self):
        account = Account.objects.create(kind=Account.PROVIDER_CLEARING, net_credit=-500)
        self.assertEqual(account.balance, 500)

    def test_one_account_per_kind_and_owner(self):
        Account.objects.create(kind=Account.VENDOR_PENDING, owner_type="accounts.businessowner", owner_id="1")
        with self.assertRaises(Exception), transaction.atomic():
            Account.objects.create(kind=Account.VENDOR_PENDING, owner_type="accounts.businessowner", owner_id="1")


class AppendOnlyTests(TestCase):
    def setUp(self):
        self.journal = Journal.objects.create(key="k1", kind="test")
        self.account = Account.objects.create(kind=Account.PROVIDER_CLEARING)
        self.line = JournalLine.objects.create(journal=self.journal, account=self.account, side=JournalLine.DEBIT, amount=100)

    def test_orm_save_of_an_existing_journal_is_refused(self):
        self.journal.memo = "changed"
        with self.assertRaises(RuntimeError):
            self.journal.save()

    def test_orm_delete_is_refused(self):
        with self.assertRaises(RuntimeError):
            self.line.delete()

    def test_raw_update_is_refused_by_the_database(self):
        with self.assertRaises(DatabaseError), transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("UPDATE ledger_journal SET memo = 'x'")

    def test_raw_delete_of_a_line_is_refused_by_the_database(self):
        with self.assertRaises(DatabaseError), transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM ledger_journalline")

    def test_a_line_must_have_a_positive_amount(self):
        with self.assertRaises(Exception), transaction.atomic():
            JournalLine.objects.create(journal=self.journal, account=self.account, side=JournalLine.CREDIT, amount=0)


class OrderRefundTests(TestCase):
    def test_wallet_pesewas_is_credit_after_kept_fee(self):
        refund = OrderRefund(amount_pesewas=11500, processing_pesewas=200, delivery_kept_pesewas=1500)
        self.assertEqual(refund.wallet_pesewas, 10200)
        self.assertEqual(OrderRefund(amount_pesewas=500, delivery_kept_pesewas=1500).wallet_pesewas, 0)    # a coupon left less than the fee
