"""Approval kinds (staff foundations F5). Each app registers its kinds in its
AppConfig.ready(); tests register throwaway kinds and unregister them."""
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass(frozen=True)
class ApprovalKind:
    key: str                  # stored on every request, e.g. "business.kyc"
    label: str                # shown in the inbox
    pool_permission: str      # second level: anyone holding this may decide
    current_state: Callable   # (request) -> JSON-able snapshot of the target now
    apply: Callable           # (request) -> None; runs inside the decision's transaction
    response_hours: int = 24  # per level; reminder at 75%, move up at 100%
    resolve_approver: Optional[Callable] = None  # (request) -> [(stage, StaffUser | None), …]
    render_diff: Optional[Callable] = None       # (request) -> [{"field", "before", "after"}, …]
    validate: Optional[Callable] = None          # (request) -> None; raise ApprovalError(message) to refuse
    on_rejected: Optional[Callable] = None       # (request) -> None; runs when a decider returns it (the maker's follow-up task)
    consequences: Optional[Callable] = None      # (request) -> [str, …]; what approving does, shown beside the Approve button
    requires_sudo: bool = False                  # approving needs the password re-entered (money kinds)
    chain_note: str = ""                         # words for a custom chain on the rules screen, e.g. "Super Admin only"
    amount_of: Optional[Callable] = None         # (request) -> Decimal | None; GH₵ the request moves, stored on request.amount
    two_people: bool = False                     # never applied by one person: a Super Admin's own request waits for someone else too


_KINDS = {}


def register(kind):
    if kind.key in _KINDS:
        raise ValueError(f"Approval kind {kind.key!r} is already registered")
    _KINDS[kind.key] = kind
    return kind


def unregister(key):
    _KINDS.pop(key, None)


def get_kind(key):
    return _KINDS.get(key)


def all_kinds():
    return dict(_KINDS)
