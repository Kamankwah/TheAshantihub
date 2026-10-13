"""The editable side of the engine (Super Admin's "Approval rules & timers"):
response-time overrides per kind and the money limits. Defaults equal what was
hard-coded before (the kind's response_hours, 75% reminder, GH₵ 20,000 co-sign
limit), so nothing changes until Super Admin edits them."""
from decimal import Decimal

from accounts.models import Role
from accounts.permissions import staff_holding

from .models import ApprovalRule, ApprovalSettings
from .registry import get_kind

COSIGN = "approvals.cosign"
MANAGE_RULES = "approvals.manage_rules"
VIEW_ALL = "approvals.view_all"
REMIND_CHOICES = (Decimal("0.50"), Decimal("0.75"))
MAX_RESPONSE_HOURS = 24 * 30
DEFAULT_RESPONSE_HOURS = 24


def get_settings():
    """The settings row, or its unsaved defaults until Super Admin first saves
    one (the rules PATCH saves it): a read never writes, so a Super Admin's
    read-only step-in stays read-only (accounts/tests/test_view_as_sweep.py)."""
    return ApprovalSettings.objects.filter(pk=1).first() or ApprovalSettings(pk=1)


def response_hours(kind_key):
    """Hours per level: Super Admin's override if there is one, else the kind's own."""
    override = ApprovalRule.objects.filter(kind=kind_key).values_list("response_hours", flat=True).first()
    if override:
        return override
    kind = get_kind(kind_key)
    return kind.response_hours if kind is not None else DEFAULT_RESPONSE_HOURS


def required_approvals_for(amount):
    """2 when the amount is strictly above the co-sign limit; no amount never needs two."""
    if amount is None:
        return 1
    return 2 if Decimal(amount) > get_settings().cosign_threshold else 1


def cosigners():
    """Active people who can give the second approval: hold approvals.cosign but are
    not approvers themselves (a Super Admin approves in the ordinary slot)."""
    return (
        staff_holding(COSIGN).exclude(pk__in=staff_holding(VIEW_ALL).values("pk"))
        .filter(invite_token__isnull=True)  # an invite not yet accepted is not a named co-signer
    )


def cosigner_named():
    return cosigners().exists()


def can_cosign(staff):
    codenames = staff.effective_permission_codenames()
    return COSIGN in codenames and VIEW_ALL not in codenames
