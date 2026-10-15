"""Money helpers for the ledger. Ledger amounts are integer pesewas (1 GH₵ = 100);
Decimal GH₵ exists only at the edges (the rest of the codebase stores Decimal(10, 2))."""
from decimal import ROUND_HALF_UP, Decimal

PESEWA = Decimal("0.01")


def to_pesewas(value):
    """Integer pesewas from a GH₵ amount. A fraction of a pesewa is a bug upstream, so it raises."""
    amount = Decimal(str(value))
    if amount != amount.quantize(PESEWA):
        raise ValueError(f"{value!r} is not a whole number of pesewas")
    return int((amount * 100).to_integral_value(rounding=ROUND_HALF_UP))


def from_pesewas(pesewas):
    return (Decimal(pesewas) / 100).quantize(PESEWA)
