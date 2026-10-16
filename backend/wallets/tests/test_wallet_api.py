"""The holder's wallet API (wallets plan 3a, Task 4): top-up, balances, statement, processing quote. Review Focus 6 (a
duplicate webhook credits once) and 7 (ledger off)."""
import hashlib
import hmac
import json
from decimal import Decimal
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from billing.models import Transaction
from ledger import posting
from ledger.models import Account, Journal
from payments.models import CheckoutSession
from wallets.services import record_top_up

SECRET = "test-webhook-secret"


def client_for(account, kind):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")
    return client


class WalletApiBase(TestCase):
    def setUp(self):
        cache.clear()
        self.customer = Customer.objects.create(full_name="Ama Owusu", phone="+233241234567", password_hash="x")
        self.owner = BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone="+233201112233", password_hash="x")
        self.client = client_for(self.customer, "customer")

    def wallet(self):
        return posting.balance_of(Account.CUSTOMER_WALLET, self.customer)

    def top_up(self, amount):
        return self.client.post("/api/wallet/top-up/", {"amount": amount}, format="json")


class LedgerOffTests(WalletApiBase):
    def test_review_focus_every_wallet_endpoint_says_ledger_off_and_opens_nothing(self):
        for response in (
            self.client.get("/api/wallet/"), self.client.get("/api/wallet/transactions/"),
            self.client.get("/api/wallet/processing/?amount=10"), self.top_up("10"),
        ):
            self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        self.assertFalse(Account.objects.exists())
        self.assertFalse(CheckoutSession.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class TopUpTests(WalletApiBase):
    def test_a_simulated_top_up_credits_the_wallet_at_once(self):
        response = self.top_up("50.00")
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(
            (body["mode"], body["amount"], body["payment_processing"], body["you_pay"], body["balance"]),
            ("immediate", "50.00", "0.00", "50.00", "50.00"),
        )
        session = CheckoutSession.objects.get(reference=body["reference"])
        self.assertEqual((session.kind, session.status, session.amount), (CheckoutSession.WALLET_TOPUP, CheckoutSession.SUCCESS, Decimal("50.00")))
        self.assertEqual((session.metadata["credit_pesewas"], session.metadata["ledger"]), (5000, True))
        self.assertTrue(Journal.objects.filter(key=f"wallet-topup-{session.reference}").exists())
        self.assertEqual(self.wallet(), 5000)
        self.assertEqual(posting.balance_of(Account.PROVIDER_CLEARING), 5000)

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=200)
    def test_the_customer_pays_the_processing_charge_and_the_wallet_gets_the_amount(self):
        body = self.top_up("50.00").json()
        self.assertEqual((body["payment_processing"], body["you_pay"], body["balance"]), ("1.00", "51.00", "50.00"))
        session = CheckoutSession.objects.get(reference=body["reference"])
        self.assertEqual((session.amount, session.processing_fee), (Decimal("51.00"), Decimal("1.00")))
        self.assertEqual(Transaction.objects.get(reference=session.reference).amount, Decimal("51.00"))
        self.assertEqual(posting.balance_of(Account.PROVIDER_CLEARING), 5000)               # the provider kept GH₵ 1.00

    def test_bad_amounts_are_refused(self):
        for raw in ("0", "-5", "1.005", "abc", "", None, True, "NaN", "100000000", "1e30", "1_000", "1E+2", "１２", "5.", ".5", " 1.2.3"):
            with self.subTest(raw=raw):
                response = self.top_up(raw)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("amount", response.json())
        self.assertFalse(CheckoutSession.objects.exists())

    @override_settings(SIMULATED_COLLECTION_CHARGE_BP=-500)
    def test_a_negative_charge_setting_never_over_credits(self):
        body = self.top_up("50.00").json()
        self.assertEqual((body["payment_processing"], body["you_pay"], body["balance"]), ("0.00", "50.00", "50.00"))

    def test_a_session_whose_credit_disagrees_with_its_amount_credits_nothing(self):
        from ledger import posting as lp
        session = CheckoutSession.objects.create(
            customer=self.customer, kind=CheckoutSession.WALLET_TOPUP, amount="10.00", processing_fee="0.00",
            metadata={"credit_pesewas": 99999, "ledger": True},
        )
        with self.assertRaises(lp.PostingError):
            record_top_up(session)
        self.assertEqual(self.wallet(), 0)
        self.assertFalse(Journal.objects.exists())

    def test_business_owners_cannot_top_up(self):
        response = client_for(self.owner, "business_owner").post("/api/wallet/top-up/", {"amount": "10"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(CheckoutSession.objects.exists())


@override_settings(LEDGER_ENABLED=True, PAYMENTS_PROVIDER="hubtel", HUBTEL_WEBHOOK_SECRET=SECRET)
class HubtelTopUpTests(WalletApiBase):
    def webhook(self, payload):
        raw = json.dumps(payload).encode("utf-8")
        signature = hmac.new(SECRET.encode("utf-8"), raw, hashlib.sha256).hexdigest()
        return APIClient().generic(
            "POST", "/api/payments/webhook/hubtel/", data=raw, content_type="application/json", HTTP_X_HUBTEL_SIGNATURE=signature,
        )

    @patch("payments.services.hubtel_client.create_checkout", return_value={"checkout_url": "https://checkout.example/x", "checkout_id": "hb-1"})
    def test_review_focus_the_wallet_is_credited_once_when_hubtel_confirms(self, _create):
        response = self.top_up("20.00")
        self.assertEqual((response.status_code, response.json()["mode"]), (200, "redirect"), response.content)
        self.assertEqual(response.json()["checkout_url"], "https://checkout.example/x")
        reference = response.json()["reference"]
        self.assertEqual(self.wallet(), 0)                                                   # nothing until Hubtel confirms
        payload = {"ClientReference": reference, "Status": "Success", "Amount": "20.00"}
        self.assertEqual(self.webhook(payload).status_code, 200)
        self.assertEqual(self.webhook(payload).status_code, 200)                              # Hubtel retries
        self.assertEqual(self.wallet(), 2000)
        self.assertEqual(Journal.objects.filter(kind="wallet_top_up").count(), 1)


@override_settings(LEDGER_ENABLED=True)
class BalanceAndStatementTests(WalletApiBase):
    def test_a_customer_sees_their_wallet_and_its_lines_newest_first(self):
        self.top_up("30.00")
        self.top_up("5.50")
        self.assertEqual(self.client.get("/api/wallet/").json(), {"kind": "customer", "balance": "35.50"})
        page = self.client.get("/api/wallet/transactions/").json()
        self.assertEqual(page["count"], 2)
        first = page["results"][0]
        self.assertEqual(
            (first["label"], first["direction"], first["amount"], first["account"], first["order"]),
            ("Top-up", "in", "5.50", "wallet", None),
        )
        self.assertTrue(first["reference"].startswith("AH-WALLET_TOPUP-"))

    def test_a_vendor_sees_pending_and_available_and_reading_opens_no_account(self):
        owner_client = client_for(self.owner, "business_owner")
        self.assertEqual(owner_client.get("/api/wallet/").json(), {"kind": "vendor", "pending": "0.00", "available": "0.00"})
        self.assertEqual(owner_client.get("/api/wallet/transactions/").json()["count"], 0)
        self.assertFalse(Account.objects.exists())

    def test_the_processing_quote(self):
        with override_settings(SIMULATED_COLLECTION_CHARGE_BP=195):
            body = self.client.get("/api/wallet/processing/?amount=100").json()
        self.assertEqual(
            (body["amount"], body["payment_processing"], body["you_pay"], body["provider"]), ("100.00", "1.95", "101.95", "simulated"),
        )
        self.assertEqual(self.client.get("/api/wallet/processing/?amount=1.234").status_code, 400)

    def test_another_holders_lines_are_never_shown(self):
        other = Customer.objects.create(full_name="Kojo", phone="+233241234568", password_hash="x")
        client_for(other, "customer").post("/api/wallet/top-up/", {"amount": "9.00"}, format="json")
        self.assertEqual(self.client.get("/api/wallet/transactions/").json()["count"], 0)
        self.assertEqual(self.client.get("/api/wallet/").json()["balance"], "0.00")
