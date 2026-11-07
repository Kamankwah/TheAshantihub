"""Ledger integrity (review DB-06). The balance on `Account.net_credit` is a cache; the journal lines are the truth. This
re-derives every figure from the lines and reports what disagrees. Read-only: it never posts or corrects anything - a
difference is a person's problem to investigate, never something a job quietly fixes.

Checked, all in pesewas:
* every journal's credits equal its debits (`unbalanced_journals`), and every journal has lines (`journals_without_lines`);
* every account's cached `net_credit` equals credits minus debits over its lines (`account_cache_differs`);
* the whole ledger nets to zero (`trial_balance`), i.e. no money was created or lost.

The database also refuses an unbalanced journal at commit (ledger migration 0015); this is the independent check that would
notice if that, the cache, or a restore ever went wrong."""
from django.db.models import BigIntegerField, Case, F, Sum, Value, When
from django.db.models.functions import Coalesce

from .models import Account, Journal, JournalLine

SIGNED = Case(
    When(side=JournalLine.CREDIT, then=F("amount")), default=-F("amount"), output_field=BigIntegerField(),
)


# The same figure seen from an Account, through its `lines`.
SIGNED_VIA_ACCOUNT = Case(
    When(lines__side=JournalLine.CREDIT, then=F("lines__amount")), default=-F("lines__amount"), output_field=BigIntegerField(),
)


def find_problems(limit=20):
    """{"journals": n, "lines": n, "accounts": n, "problems": {...}}: counts checked, and each kind of problem as
    {"count": n, "examples": [ids...]} (only the kinds that occurred). An empty "problems" means the ledger is sound."""
    problems = {}

    unbalanced = list(
        JournalLine.objects.values("journal_id").annotate(net=Sum(SIGNED)).exclude(net=0).order_by("journal_id")
    )
    if unbalanced:
        problems["unbalanced_journals"] = {"count": len(unbalanced), "examples": [row["journal_id"] for row in unbalanced[:limit]]}

    empty = Journal.objects.filter(lines__isnull=True)
    if empty.exists():
        problems["journals_without_lines"] = {"count": empty.count(), "examples": list(empty.values_list("pk", flat=True)[:limit])}

    differs = list(
        Account.objects.annotate(computed=Coalesce(Sum(SIGNED_VIA_ACCOUNT), Value(0), output_field=BigIntegerField()))
        .exclude(computed=F("net_credit")).order_by("pk").values_list("pk", flat=True)
    )
    if differs:
        problems["account_cache_differs"] = {"count": len(differs), "examples": differs[:limit]}

    trial = JournalLine.objects.aggregate(net=Coalesce(Sum(SIGNED), Value(0), output_field=BigIntegerField()))["net"]
    if trial != 0:
        problems["trial_balance"] = {"count": 1, "net_pesewas": trial}

    return {
        "journals": Journal.objects.count(), "lines": JournalLine.objects.count(), "accounts": Account.objects.count(),
        "problems": problems,
    }
