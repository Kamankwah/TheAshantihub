"""More texts to a business about its money (wallet rulings 7D, Task 3): refunds, withdrawals, and negative or low
Available; none to a suspended business, whose in-app notices stay."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from ledger import posting, refunds
from ledger.models import Account, MoneySetting
from notifications.models import Notification
from otp import senders
from payments import providers
from wallets import payouts, vendor_texts, withdrawals
from wallets.models import PayoutDestination, VendorText, Withdrawal

from .helpers import destination, fund
from .vendor_helpers import VendorBase, paid_order, release


@override_settings(LEDGER_ENABLED=True)
class MoreTextTests(VendorBase):
    def texts(self, kind):
        return VendorText.objects.filter(kind=kind, business_owner=self.kofi.owner)

    def test_refund_text_queued_once(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        with self.captureOnCommitCallbacks(execute=True):
            refunds.refund_order(order, source="cancel")
        text = VendorText.objects.get(key=f"refund-{order.pk}-{self.kofi.owner.pk}")
        self.assertEqual((text.kind, text.business_owner_id, text.order_id), ("refund", self.kofi.owner.pk, order.pk))
        self.assertIn("GHS 120.00", text.body)
        self.assertTrue(vendor_texts.fits(text.body) and len(text.body) <= 160, len(text.body))
        self.assertNotIn("Ama Buyer", text.body)
        self.assertEqual(len(senders.sms_outbox), 1)
        vendor_texts.refund_text(order, self.kofi.owner, 12000)                    # a retry
        refunds.refund_order(order, source="cancel")                                 # the same refund again
        self.assertEqual(VendorText.objects.filter(kind="refund").count(), 1)

    def test_a_refund_after_release_says_what_came_off_available(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        release(order)
        refunds.refund_order(order, source="dispute-1")
        body = VendorText.objects.get(kind="refund").body
        self.assertIn("Available", body)
        self.assertIn("GHS 115.00", body)                                            # 120.00 less the 5.00 fee given back

    def withdrawal_for(self, request_id="req-00000001", amount=5000):
        owner = self.kofi.owner
        owner.kyc_status = owner.VERIFIED
        owner.save(update_fields=["kyc_status"])
        fund(Account.VENDOR_AVAILABLE, owner, 50000, f"fund-{request_id}")
        dest = PayoutDestination.objects.filter(holder_id=owner.pk).first() or destination(owner, name="Kofi Mensah")
        return withdrawals.request(owner, destination_id=dest.pk, amount_pesewas=amount, request_id=request_id)

    def test_withdrawal_states_each_text_once(self):
        with self.captureOnCommitCallbacks(execute=True):
            paid = self.withdrawal_for()
        self.assertTrue(VendorText.objects.filter(key=f"withdrawal-{paid.pk}-requested").exists())
        with self.captureOnCommitCallbacks(execute=True):
            payouts.submit(paid.pk)
        self.assertTrue(VendorText.objects.filter(key=f"withdrawal-{paid.pk}-paid").exists())
        failed = self.withdrawal_for("req-00000002")
        failed = payouts.claim(failed.pk) or failed
        with self.captureOnCommitCallbacks(execute=True):
            payouts.apply_result(failed.reference, providers.FAILED)
        self.assertTrue(VendorText.objects.filter(key=f"withdrawal-{failed.pk}-failed").exists())
        for state in ("requested", "paid"):
            vendor_texts.withdrawal_text(Withdrawal.objects.get(pk=paid.pk), state)  # retries
        self.assertEqual(self.texts("withdrawal").count(), 4)                        # requested+paid, requested+failed
        for text in self.texts("withdrawal"):
            self.assertTrue(vendor_texts.fits(text.body) and len(text.body) <= 160, text.body)
            self.assertNotIn("0241234567", text.body)
            self.assertNotIn("241234567", text.body)

    def test_negative_balance_text_once_per_day(self):
        owner = self.kofi.owner
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        release(order)                                                              # 115.00 Available
        posting.post(key="claw-1", kind="test", lines=[
            posting.debit(posting.account_for(Account.VENDOR_AVAILABLE, owner), 12000),
            posting.credit(posting.account_for(Account.PROVIDER_CLEARING), 12000),
        ])                                                                          # 115.00 -> -5.00: crosses zero
        texts = self.texts("balance_negative")
        self.assertEqual(texts.count(), 1)
        self.assertIn("below zero", texts.get().body)
        day = timezone.localdate()
        self.assertEqual(texts.get().key, f"balance-{owner.pk}-negative-{day}")
        vendor_texts.balance_text(owner, -500, "negative")                          # same day again
        self.assertEqual(self.texts("balance_negative").count(), 1)
        VendorText.objects.filter(kind="balance_negative").update(key="old-key")                              # yesterday's text
        vendor_texts.balance_text(owner, -500, "negative")
        self.assertEqual(self.texts("balance_negative").count(), 2)

    def test_low_balance_threshold_setting(self):
        owner = self.kofi.owner
        fund(Account.VENDOR_AVAILABLE, owner, 30000, "fund-a")                       # 300.00, default threshold 100.00
        def spend(key, pesewas):
            posting.post(key=key, kind="test", lines=[
                posting.debit(posting.account_for(Account.VENDOR_AVAILABLE, owner), pesewas),
                posting.credit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), pesewas),
            ])
        spend("s1", 15000)                                                           # 150.00: still above 100.00
        self.assertFalse(self.texts("balance_low").exists())
        spend("s2", 5000)                                                            # 100.00: at the threshold
        self.assertEqual(self.texts("balance_low").count(), 1)
        self.assertIn("GHS 100.00", self.texts("balance_low").get().body)
        MoneySetting.objects.create(key="vendor_low_balance_pesewas", value=2000, effective_from=timezone.now() - timedelta(days=1))
        fund(Account.VENDOR_AVAILABLE, owner, 20000, "fund-b")                       # 300.00
        VendorText.objects.all().delete()
        spend("s3", 25000)                                                           # 50.00: above the new 20.00
        self.assertFalse(self.texts("balance_low").exists())
        spend("s4", 3000)                                                            # 20.00
        self.assertEqual(self.texts("balance_low").count(), 1)

    def test_suspended_owner_gets_no_text_but_in_app_notice_kept(self):
        owner = self.kofi.owner
        processing = payouts.claim(self.withdrawal_for("req-0000000s").pk)           # in flight when the account is suspended
        VendorText.objects.all().delete()
        owner.is_suspended = True
        owner.save(update_fields=["is_suspended"])
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        with self.captureOnCommitCallbacks(execute=True):
            release(order)                                                          # suspended between order and release
            refunds.refund_order(order, source="dispute-9")
            vendor_texts.balance_text(owner, -500, "negative")
            vendor_texts.balance_text(owner, 500, "low")
            payouts.apply_result(processing.reference, providers.SUCCEEDED)
        self.assertFalse(VendorText.objects.exists())
        self.assertEqual(senders.sms_outbox, [])
        titles = list(Notification.objects.filter(business_owner=owner).values_list("title", flat=True))
        self.assertIn(f"Order #{order.pk} released", titles)                         # in-app copy kept
        self.assertIn("Your withdrawal was paid", titles)
        owner.is_suspended = False                                                  # unsuspended later: no backfill
        owner.save(update_fields=["is_suspended"])
        with self.captureOnCommitCallbacks(execute=True):
            vendor_texts.send_due()
        self.assertFalse(VendorText.objects.exists())
        self.assertEqual(senders.sms_outbox, [])
