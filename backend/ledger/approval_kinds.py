"""Filled in by Task 6. Present now so LedgerConfig.ready() imports cleanly."""
from approvals.registry import ApprovalKind


def _unused(request):
    return {}


FEE_RULES = ApprovalKind(key="ledger.fee_rules", label="Change platform-fee rules", pool_permission="", current_state=_unused, apply=_unused)
MONEY_SETTING = ApprovalKind(key="ledger.setting", label="Change a money setting", pool_permission="", current_state=_unused, apply=_unused)
