"""The payment provider behind AshantiHub's money movements (spec §2.3).

Hubtel (or a bank) holds the money; AshantiHub keeps the ledger and instructs the provider. Of the spec's four
operations, two already exist and are not touched here:
- collect is `payments.services.process_payment` (it branches simulated/Hubtel and is the only way a customer pays,
  for an order or a wallet top-up);
- handle_webhook is `payments.views.HubtelWebhookView` (logged raw first, signature-verified, idempotent on the
  reference, amount-verified, monotonic).
This module adds the rest: the collection and payout charges, the account-name lookup a payout destination needs,
payout and payout status (Plan 3b adds the daily statement used by the reconciliation).

`get_provider()` follows `settings.PAYMENTS_PROVIDER`. The simulated provider moves no money and asks no network:
everything it answers comes from settings, so tests and staging can steer it. The Hubtel provider knows only its
collection charge (`HUBTEL_COLLECTION_CHARGE_BP`); `payments/hubtel_client.py` has no payout, status or name-lookup
call, so those raise NotConnected until Plan 7 builds them against Hubtel's real API."""
from dataclasses import dataclass, field

from django.conf import settings

MOMO, BANK = "momo", "bank"
RAILS = (MOMO, BANK)
SUCCEEDED, FAILED, PROCESSING = "succeeded", "failed", "processing"
_OUTCOMES = {"succeed": SUCCEEDED, "fail": FAILED, "pending": PROCESSING}


class ProviderError(Exception):
    pass


class NotConnected(ProviderError):
    """The provider cannot do this yet. Callers refuse the action cleanly; it is never a failed money movement."""


@dataclass(frozen=True)
class PayoutResult:
    status: str  # SUCCEEDED, FAILED or PROCESSING
    provider_reference: str = ""
    message: str = field(default="", repr=False)  # the provider's own words: never stored, shown or logged (they may hold an account number)
    amount_pesewas: object = None  # what the provider says reached the destination (pesewas), when it says


def basis_points(amount_pesewas, bp):
    """`bp` basis points of an amount in pesewas, half up (100 bp = 1%), never below 0."""
    return max(0, (int(amount_pesewas) * int(bp) + 5000) // 10000)  # a mistyped negative rate must never pay the customer


class PaymentProvider:
    name = ""

    def collection_charge(self, amount_pesewas):
        """What the customer pays on top of `amount_pesewas` for a MoMo payment or a top-up ("payment processing")."""
        raise NotImplementedError

    def payouts_available(self):
        return False

    def payout_charge(self, amount_pesewas, rail):
        """What the provider keeps from a withdrawal of `amount_pesewas` to a `rail` destination (the holder bears it)."""
        raise NotConnected(f"{self.name} cannot price payouts yet")

    def lookup_account_name(self, rail, institution, account_number, *, holder_name=""):
        """The name the network or bank holds for this account, or None when it has none. `holder_name` is used only by
        the simulated provider, which has no network to ask."""
        raise NotConnected(f"{self.name} cannot look up account names yet")

    def payout(self, *, reference, rail, institution, account_number, amount_pesewas):
        """Instruct a payout of `amount_pesewas` (what reaches the destination) under our `reference`.

        Contract: raise NotConnected ONLY when no request has left the server. Any other failure after a request may
        have been sent must raise another exception or return PROCESSING - the engine treats other exceptions as an
        unknown outcome and never returns the hold."""
        raise NotConnected(f"{self.name} cannot make payouts yet")

    def status(self, reference):
        raise NotConnected(f"{self.name} cannot report payout status yet")


class SimulatedProvider(PaymentProvider):
    """No money moves and no network is asked. Charges are SIMULATED_COLLECTION_CHARGE_BP and
    SIMULATED_PAYOUT_CHARGE_PESEWAS (both 0 unless set: no real rate is known). Payouts end as
    SIMULATED_PAYOUT_OUTCOME says (succeed, fail or pending; anything else waits, so a typo never pays). The name lookup
    answers SIMULATED_ACCOUNT_NAMES[account_number] when listed, else the holder's own name."""

    name = "simulated"

    def collection_charge(self, amount_pesewas):
        return basis_points(amount_pesewas, settings.SIMULATED_COLLECTION_CHARGE_BP)

    def payouts_available(self):
        return True

    def payout_charge(self, amount_pesewas, rail):
        return int(settings.SIMULATED_PAYOUT_CHARGE_PESEWAS)

    def lookup_account_name(self, rail, institution, account_number, *, holder_name=""):
        return settings.SIMULATED_ACCOUNT_NAMES.get(account_number, holder_name) or None

    def payout(self, *, reference, rail, institution, account_number, amount_pesewas):
        answer = self.status(reference)
        return PayoutResult(answer.status, provider_reference=answer.provider_reference, amount_pesewas=amount_pesewas)

    def status(self, reference):
        outcome = _OUTCOMES.get(settings.SIMULATED_PAYOUT_OUTCOME, PROCESSING)
        return PayoutResult(outcome, provider_reference=f"SIM-{reference}")


class HubtelProvider(PaymentProvider):
    """Collections are the existing Hubtel Checkout path (process_payment + HubtelWebhookView). Only the collection
    charge is known here (HUBTEL_COLLECTION_CHARGE_BP, 0 until the contracted rate is set); payouts, their status, their
    charge and account-name lookups are Plan 7."""

    name = "hubtel"

    def collection_charge(self, amount_pesewas):
        return basis_points(amount_pesewas, settings.HUBTEL_COLLECTION_CHARGE_BP)


_PROVIDERS = {SimulatedProvider.name: SimulatedProvider, HubtelProvider.name: HubtelProvider}


def get_provider(name=None):
    """The provider called `name` (a withdrawal remembers whose it was), else the one PAYMENTS_PROVIDER names."""
    key = name or settings.PAYMENTS_PROVIDER
    try:
        return _PROVIDERS[key]()
    except KeyError:
        raise ProviderError(f"Unknown payment provider {key!r}") from None
