from django.test import TestCase

from accounts.models import BusinessOwner
from ledger import posting
from ledger.models import Account, Journal, JournalLine


class PostingTests(TestCase):
    def setUp(self):
        self.owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207000001", password_hash="x")
        self.clearing = posting.account_for(Account.PROVIDER_CLEARING)
        self.pending = posting.account_for(Account.VENDOR_PENDING, self.owner)

    def test_a_balanced_posting_moves_both_balances(self):
        posting.post(key="a", kind="t", lines=[posting.debit(self.clearing, 1000), posting.credit(self.pending, 1000)])
        self.clearing.refresh_from_db()
        self.pending.refresh_from_db()
        self.assertEqual(self.clearing.balance, 1000)
        self.assertEqual(self.pending.balance, 1000)
        self.assertEqual(JournalLine.objects.count(), 2)

    def test_an_unbalanced_posting_is_refused_and_writes_nothing(self):
        with self.assertRaises(posting.PostingError):
            posting.post(key="b", kind="t", lines=[posting.debit(self.clearing, 1000), posting.credit(self.pending, 900)])
        self.assertFalse(Journal.objects.exists())
        self.clearing.refresh_from_db()
        self.assertEqual(self.clearing.balance, 0)

    def test_zero_negative_and_non_integer_amounts_are_refused(self):
        for bad in (0, -5, 1.5, True):
            with self.assertRaises(posting.PostingError, msg=repr(bad)):
                posting.post(key=f"bad{bad}", kind="t", lines=[posting.debit(self.clearing, bad), posting.credit(self.pending, bad)])

    def test_fewer_than_two_lines_is_refused(self):
        with self.assertRaises(posting.PostingError):
            posting.post(key="c", kind="t", lines=[posting.debit(self.clearing, 5)])

    def test_the_same_key_posts_once(self):
        lines = [posting.debit(self.clearing, 1000), posting.credit(self.pending, 1000)]
        first = posting.post(key="dup", kind="t", lines=lines)
        again = posting.post(key="dup", kind="t", lines=lines)
        self.assertEqual(first.pk, again.pk)
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.balance, 1000)
        self.assertEqual(Journal.objects.count(), 1)

    def test_a_pending_balance_cannot_be_overdrawn(self):
        posting.post(key="in", kind="t", lines=[posting.debit(self.clearing, 500), posting.credit(self.pending, 500)])
        income = posting.account_for(Account.PLATFORM_FEE_INCOME)
        with self.assertRaises(posting.PostingError):
            posting.post(key="out", kind="t", lines=[posting.debit(self.pending, 600), posting.credit(income, 600)])
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.balance, 500)

    def test_vendor_available_may_go_negative(self):
        available = posting.account_for(Account.VENDOR_AVAILABLE, self.owner)
        income = posting.account_for(Account.PLATFORM_FEE_INCOME)
        posting.post(key="neg", kind="t", lines=[posting.debit(available, 200), posting.credit(income, 200)])
        available.refresh_from_db()
        self.assertEqual(available.balance, -200)

    def test_account_for_is_get_or_create(self):
        self.assertEqual(posting.account_for(Account.VENDOR_PENDING, self.owner).pk, self.pending.pk)
        self.assertEqual(Account.objects.filter(kind=Account.VENDOR_PENDING).count(), 1)
