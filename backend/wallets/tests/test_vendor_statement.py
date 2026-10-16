"""The business's statement as a CSV (vendor plan 4, Task 3): each sale with the platform fee shown separately and its
status, and each withdrawal. Review Focus 1 (its own rows, no customer detail, no free text) and 4 (ranges)."""
import csv
import io
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from ledger import refunds
from ledger.models import Account
from orders.models import Order
from wallets import vendor
from wallets.models import PayoutDestination, Withdrawal

from .helpers import destination
from .vendor_helpers import VendorBase, paid_order, release, signed_in

EXPORT = "/api/wallet/vendor/statement/export/"


def csv_rows(response):
    return list(csv.reader(io.StringIO(response.content.decode("utf-8"))))


def withdrawal(shop, request_id, amount, charge, status):
    """A withdrawal made directly (the engine is tested in 3b), to the business's one payout destination (made once: a
    holder has at most one live destination per number)."""
    payee = (
        PayoutDestination.objects.filter(holder_type="business_owner", holder_id=shop.owner.pk).first()
        or destination(shop.owner, name=shop.owner.full_name)
    )
    return Withdrawal.objects.create(
        holder_type="business_owner", holder_id=shop.owner.pk, source_kind=Account.VENDOR_AVAILABLE,
        destination=payee, request_id=request_id,
        amount_pesewas=amount, charge_pesewas=charge, net_pesewas=amount - charge, status=status, provider="simulated",
    )


class LedgerOffTests(VendorBase):
    def test_review_focus_the_export_says_ledger_off(self):
        response = self.kofi.get(EXPORT)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))


@override_settings(LEDGER_ENABLED=True)
class StatementExportTests(VendorBase):
    def test_sales_in_every_state_and_withdrawals_oldest_first(self):
        waiting = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        released = paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])
        release(released)
        refunded = paid_order(self.buyer, [(self.kofi.listing("50.00"), 1)])
        refunds.refund_order(refunded, source="cancel")
        paid_out = withdrawal(self.kofi, "req-0001", 5000, 100, Withdrawal.SUCCEEDED)
        returned = withdrawal(self.kofi, "req-0002", 2000, 0, Withdrawal.FAILED)
        response = self.kofi.get(EXPORT)
        self.assertEqual((response.status_code, response["Content-Type"]), (200, "text/csv"))
        today = timezone.localdate()
        self.assertIn(
            f'filename="ashantihub-statement-{(today - timedelta(days=29)).isoformat()}-to-{today.isoformat()}.csv"',
            response["Content-Disposition"],
        )
        rows = csv_rows(response)
        self.assertEqual(rows[0], vendor.STATEMENT_HEADER)
        day = today.isoformat()
        self.assertEqual(rows[1:], [
            [day, "Sale", f"Order #{waiting.pk}", "120.00", "5.00", "0.00", "0.00", "", "115.00", "Pending"],
            [day, "Sale", f"Order #{released.pk}", "600.00", "6.00", "0.00", "0.00", "", "594.00", "Available"],
            [day, "Sale", f"Order #{refunded.pk}", "50.00", "0.00", "0.00", "50.00", "", "0.00", "Refunded"],
            [day, "Withdrawal", paid_out.reference, "50.00", "", "", "", "1.00", "49.00", "Withdrawn"],
            [day, "Withdrawal", returned.reference, "20.00", "", "", "", "0.00", "20.00", "Returned to Available"],
        ])

    def test_review_focus_only_the_businesss_own_rows_and_no_free_text(self):
        shared = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1), (self.esi.listing("600.00"), 1)])
        withdrawal(self.esi, "req-esi-1", 5000, 100, Withdrawal.SUCCEEDED)
        response = self.kofi.get(EXPORT)
        self.assertEqual([row[2] for row in csv_rows(response)[1:]], [f"Order #{shared.pk}"])
        text = response.content.decode("utf-8")
        for detail in ("Ama Buyer", "241110001", "Kejetia", "item 1", "600.00", "AH-WD-"):
            self.assertNotIn(detail, text)

    def test_the_range_picks_sales_by_purchase_day_and_withdrawals_by_request_day(self):
        old = paid_order(self.buyer, [(self.kofi.listing("80.00"), 1)])
        Order.objects.filter(pk=old.pk).update(placed_at=timezone.now() - timedelta(days=40))
        old_withdrawal = withdrawal(self.kofi, "req-old", 3000, 0, Withdrawal.SUCCEEDED)
        Withdrawal.objects.filter(pk=old_withdrawal.pk).update(created_at=timezone.now() - timedelta(days=40))
        new = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        self.assertEqual([row[2] for row in csv_rows(self.kofi.get(EXPORT))[1:]], [f"Order #{new.pk}"])
        then = (timezone.localdate() - timedelta(days=40)).isoformat()
        rows = csv_rows(self.kofi.get(EXPORT, {"date_from": then, "date_to": then}))[1:]
        self.assertEqual([row[2] for row in rows], [f"Order #{old.pk}", old_withdrawal.reference])

    def test_review_focus_bad_ranges_are_refused(self):
        for params in (
            {"date_from": "2025-01-01", "date_to": "2026-10-16"}, {"date_to": "16-10-2026"},
            {"date_from": "2026-10-10", "date_to": "2026-10-01"},
            {"date_to": "0001-01-05"}, {"date_from": "9999-12-30", "date_to": "9999-12-31"},
        ):
            self.assertEqual(self.kofi.get(EXPORT, params).status_code, 400, params)

    def test_a_customer_with_the_same_id_gets_no_statement(self):
        paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        self.assertEqual(signed_in(self.twin(), "customer").get(EXPORT).status_code, 403)
