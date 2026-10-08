"""The approvals engine (staff foundations F5). Domain code stages a change
with submit(); the inbox decides it with approve()/reject(); the maker may
cancel(); escalate_due() (Celery, every 5 minutes) reminds and moves requests
up the chain. The maker never decides their own request."""
import json
import logging
from datetime import timedelta

from django.core.exceptions import ObjectDoesNotExist
from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import Role, StaffUser
from accounts.permissions import staff_holding
from activity.services import record
from notifications.services import notify_staff

from .models import ApprovalRequest
from .registry import get_kind

logger = logging.getLogger(__name__)

VIEW_ALL = "approvals.view_all"
# Fixed namespace for the per-target advisory lock. record()'s chain lock uses
# the single-bigint form pg_advisory_xact_lock(key); Postgres keeps the one-int8
# and two-int4 forms in separate key spaces, so these can never collide.
TARGET_LOCK_NAMESPACE = 50117
REMIND_AT = 0.75
DEFAULT_RESPONSE_HOURS = 24
STALE_MESSAGE = "This changed since it was requested — ask for a fresh request."


class ApprovalError(Exception):
    status_code = 400

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class ApplyFailed(ApprovalError):
    status_code = 500


APPLY_FAILED_MESSAGE = "Couldn't apply this change, so nothing was changed. Try again, or tell a Super Admin."


class _ApplyCrashed(Exception):
    """Internal: carries a non-ApprovalError out of an atomic block so it rolls back."""


class MakerCannotDecide(ApprovalError):
    status_code = 403


class NotYourDecision(ApprovalError):
    status_code = 403


class StaleRequest(ApprovalError):
    status_code = 409


class NotPending(ApprovalError):
    pass


class NoteRequired(ApprovalError):
    pass


class UnknownKind(ApprovalError):
    pass


def _normalise(value):
    return json.loads(json.dumps(value, default=str, sort_keys=True))


def default_chain(approval):
    """Who decides, in order: the maker's manager, then anyone holding the
    kind's pool permission, then a Super Admin (spec F5)."""
    steps = []
    manager = approval.maker.manager
    if manager is not None and manager.is_active and not manager.is_suspended:
        steps.append((ApprovalRequest.MANAGER, manager))
    if approval.pool_permission:
        steps.append((ApprovalRequest.POOL, None))
    steps.append((ApprovalRequest.SUPER_ADMIN, None))
    return steps


def chain_for(approval):
    kind = get_kind(approval.kind)
    resolver = kind.resolve_approver if kind is not None and kind.resolve_approver else default_chain
    return resolver(approval)


def _next_step(approval):
    rank = ApprovalRequest.STAGE_ORDER.index(approval.stage)
    for stage, staff in chain_for(approval):
        if ApprovalRequest.STAGE_ORDER.index(stage) > rank:
            return stage, staff
    return None


def approvers_for(approval):
    """Who decides at the current stage (never the maker). approvals.view_all
    holders may also decide at any stage — see can_decide()."""
    if approval.stage == ApprovalRequest.MANAGER:
        approvers = StaffUser.objects.filter(pk=approval.assigned_to_id, is_active=True, is_suspended=False)
    elif approval.stage == ApprovalRequest.POOL:
        approvers = staff_holding(approval.pool_permission)
    else:
        approvers = staff_holding(VIEW_ALL)
    return approvers.exclude(pk=approval.maker_id)


def can_decide(approval, staff):
    if approval.status != ApprovalRequest.PENDING or staff.pk == approval.maker_id:
        return False
    if VIEW_ALL in staff.effective_permission_codenames():
        return True
    return approvers_for(approval).filter(pk=staff.pk).exists()


def waiting_for(staff):
    """Pending requests at a stage this staffer decides: the inbox's
    "Waiting for me" and the nav badge."""
    perms = staff.effective_permission_codenames()
    scope = Q(stage=ApprovalRequest.MANAGER, assigned_to=staff)
    if perms:
        scope |= Q(stage=ApprovalRequest.POOL, pool_permission__in=perms)
    if VIEW_ALL in perms:
        scope |= Q(stage=ApprovalRequest.SUPER_ADMIN)
    return ApprovalRequest.objects.filter(status=ApprovalRequest.PENDING).filter(scope).exclude(maker=staff)


def visible_to(staff):
    """Requests this staffer may open: their own, their direct reports',
    ones they decided or can decide now; everything for approvals.view_all."""
    if VIEW_ALL in staff.effective_permission_codenames():
        return ApprovalRequest.objects.all()
    return ApprovalRequest.objects.filter(
        Q(maker=staff) | Q(maker__manager=staff) | Q(decided_by=staff) | Q(pk__in=waiting_for(staff).values("pk"))
    )


def _lock_target(approval):
    """Serialise every decision that touches one target, so two requests on it
    can't both pass the stale check and apply. Held until the transaction ends."""
    if approval.target_id:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(%s, hashtext(%s))",
                [TARGET_LOCK_NAMESPACE, f"{approval.target_type}:{approval.target_id}"],
            )


def _run_apply(kind, approval):
    try:
        kind.apply(approval)
    except ApprovalError:
        raise
    except Exception as exc:
        raise _ApplyCrashed() from exc


def _apply_failed(crash):
    logger.exception("Approval apply failed", exc_info=crash.__cause__)
    return ApplyFailed(APPLY_FAILED_MESSAGE)


def _link(approval):
    return f"approvals/{approval.pk}"


def _notify_approvers(approval, kind, title):
    for staff in approvers_for(approval):
        notify_staff(staff, kind, title, body=approval.target_label, link=_link(approval), icon="🗳️")


def _response_time(approval):
    kind = get_kind(approval.kind)
    return timedelta(hours=kind.response_hours if kind is not None else DEFAULT_RESPONSE_HOURS)


def _enter_stage(approval, stage, staff, now):
    approval.stage = stage
    approval.assigned_to = staff if stage == ApprovalRequest.MANAGER else None
    approval.stage_started_at = now
    approval.due_at = now + _response_time(approval)
    approval.reminded_at = None


def submit(maker, kind_key, *, title, payload, target=None, target_type="", target_id="", target_label="",
           maker_note="", request=None):
    """Stage a change for approval. A Super Admin's own change applies at once
    (a sole owner can't be maker-checked) and the other Super Admins are told."""
    kind = get_kind(kind_key)
    if kind is None:
        raise UnknownKind(f"Unknown approval kind: {kind_key}")
    if target is not None:
        target_type, target_id, target_label = target._meta.label_lower, str(target.pk), str(target)
    now = timezone.now()
    try:
        return _submit(maker, kind, now, title, payload, target_type, target_id, target_label, maker_note, request)
    except _ApplyCrashed as crash:
        raise _apply_failed(crash)


def _submit(maker, kind, now, title, payload, target_type, target_id, target_label, maker_note, request):
    with transaction.atomic():
        approval = ApprovalRequest(
            kind=kind.key, title=title[:200], maker=maker, pool_permission=kind.pool_permission,
            target_type=target_type[:50], target_id=str(target_id)[:64], target_label=target_label[:200],
            payload=_normalise(payload), maker_note=maker_note, created_at=now,
        )
        if maker.role.name == Role.SUPER_ADMIN:
            _lock_target(approval)
        approval.before = _normalise(kind.current_state(approval))
        if maker.role.name == Role.SUPER_ADMIN:
            if kind.validate is not None:
                kind.validate(approval)
            approval.status = ApprovalRequest.APPROVED
            approval.decided_by = maker
            approval.decided_at = now
            approval.decision_note = "Applied directly: a Super Admin's own change."
            _enter_stage(approval, ApprovalRequest.SUPER_ADMIN, None, now)
            approval.save()
            _run_apply(kind, approval)
            for other in staff_holding(VIEW_ALL).filter(role__name=Role.SUPER_ADMIN).exclude(pk=maker.pk):
                notify_staff(
                    other, "approval_applied_directly", f"{maker.full_name} applied: {approval.title}",
                    body=approval.target_label, link=_link(approval), icon="🗳️",
                )
            record(maker, "approval.applied_directly", target=approval,
                   after={"kind": kind.key, "payload": approval.payload}, request=request)
            return approval
        stage, staff = chain_for(approval)[0]
        _enter_stage(approval, stage, staff, now)
        approval.save()
        _notify_approvers(approval, "approval_waiting", f"Waiting for you: {approval.title}")
        record(maker, "approval.requested", target=approval,
               after={"kind": kind.key, "payload": approval.payload}, request=request)
    return approval


def _lock(approval_id):
    return ApprovalRequest.objects.select_for_update(of=("self",)).select_related("maker").get(pk=approval_id)


def _check_decidable(approval, staff):
    if approval.status != ApprovalRequest.PENDING:
        raise NotPending("This request has already been decided.")
    if staff.pk == approval.maker_id:
        raise MakerCannotDecide("You can't approve your own request.")
    if not can_decide(approval, staff):
        raise NotYourDecision("This request is waiting for someone else.")


def _state_now(kind, approval):
    try:
        return _normalise(kind.current_state(approval))
    except ObjectDoesNotExist as exc:
        raise StaleRequest(STALE_MESSAGE) from exc


def is_stale(approval):
    kind = get_kind(approval.kind)
    if kind is None:
        return False
    try:
        return _state_now(kind, approval) != approval.before
    except StaleRequest:
        return True


def approve(approval_id, staff, note="", http_request=None):
    try:
        return _approve(approval_id, staff, note, http_request)
    except _ApplyCrashed as crash:
        raise _apply_failed(crash)


def _approve(approval_id, staff, note, http_request):
    with transaction.atomic():
        approval = _lock(approval_id)
        _check_decidable(approval, staff)
        kind = get_kind(approval.kind)
        if kind is None:
            raise UnknownKind("This kind of request can no longer be decided.")
        _lock_target(approval)
        if _state_now(kind, approval) != approval.before:
            raise StaleRequest(STALE_MESSAGE)
        if kind.validate is not None:
            kind.validate(approval)  # e.g. "approve the business's KYC first" — raises ApprovalError
        _run_apply(kind, approval)
        approval.status = ApprovalRequest.APPROVED
        approval.decided_by = staff
        approval.decided_at = timezone.now()
        approval.decision_note = (note or "").strip()
        approval.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
        notify_staff(approval.maker, "approval_decided", f"Approved: {approval.title}",
                     body=approval.decision_note, link=_link(approval), icon="✅")
        record(staff, "approval.approved", target=approval, after={"note": approval.decision_note}, request=http_request)
    return approval


def reject(approval_id, staff, note, http_request=None):
    note = (note or "").strip()
    with transaction.atomic():
        approval = _lock(approval_id)
        _check_decidable(approval, staff)
        if not note:
            raise NoteRequired("Write a note so the maker knows what to change.")
        approval.status = ApprovalRequest.REJECTED
        approval.decided_by = staff
        approval.decided_at = timezone.now()
        approval.decision_note = note
        approval.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
        notify_staff(approval.maker, "approval_decided", f"Returned: {approval.title}",
                     body=note, link=_link(approval), icon="↩️")
        record(staff, "approval.rejected", target=approval, after={"note": note}, request=http_request)
    return approval


def cancel(approval_id, staff, http_request=None):
    with transaction.atomic():
        approval = _lock(approval_id)
        if approval.status != ApprovalRequest.PENDING:
            raise NotPending("This request has already been decided.")
        if staff.pk != approval.maker_id:
            raise NotYourDecision("Only the person who made a request can cancel it.")
        approval.status = ApprovalRequest.CANCELLED
        approval.decided_by = staff
        approval.decided_at = timezone.now()
        approval.save(update_fields=["status", "decided_by", "decided_at"])
        record(staff, "approval.cancelled", target=approval, request=http_request)
    return approval


def _remind_at(approval):
    return approval.stage_started_at + (approval.due_at - approval.stage_started_at) * REMIND_AT


def _assignee_gone(approval):
    assignee = approval.assigned_to
    return approval.stage == ApprovalRequest.MANAGER and (
        assignee is None or not assignee.is_active or assignee.is_suspended
    )


def _escalate_one(pk, now):
    moved = 0
    with transaction.atomic():
        approval = (
            ApprovalRequest.objects.select_for_update(skip_locked=True, of=("self",))
            .select_related("maker", "assigned_to")
            .filter(pk=pk, status=ApprovalRequest.PENDING)
            .first()
        )
        if approval is None:
            return 0
        if _assignee_gone(approval) or now >= approval.due_at:
            step = _next_step(approval)
            if step is None:
                _enter_stage(approval, approval.stage, approval.assigned_to, now)
                approval.save()
                _notify_approvers(approval, "approval_reminder", f"Overdue: {approval.title}")
                return 0
            _enter_stage(approval, step[0], step[1], now)
            approval.escalation_level += 1
            approval.save()
            _notify_approvers(approval, "approval_escalated", f"Moved to you: {approval.title}")
            record(None, "approval.escalated", target=approval,
                   after={"stage": approval.stage, "level": approval.escalation_level})
            moved = 1
        elif approval.reminded_at is None and now >= _remind_at(approval):
            approval.reminded_at = now
            approval.save(update_fields=["reminded_at"])
            _notify_approvers(approval, "approval_reminder", f"Due soon: {approval.title}")
    return moved



def escalate_due(now=None):
    """Remind at 75% of the response time; at 100% — or straight away if the
    assigned manager has left or is suspended — move one level up. The last
    level (Super Admin) is reminded again each time its time runs out.
    Returns how many requests moved up."""
    now = now or timezone.now()
    moved = 0
    pending = list(ApprovalRequest.objects.filter(status=ApprovalRequest.PENDING).values_list("pk", flat=True))
    for pk in pending:
        try:
            moved += _escalate_one(pk, now)
        except Exception:
            logger.exception("Escalating approval %s failed", pk)
    return moved


def diff_rows(approval):
    kind = get_kind(approval.kind)
    if kind is not None and kind.render_diff:
        return kind.render_diff(approval)
    if isinstance(approval.payload, dict):
        before = approval.before if isinstance(approval.before, dict) else {}
        return [{"field": key, "before": before.get(key), "after": value} for key, value in approval.payload.items()]
    return [{"field": "", "before": approval.before, "after": approval.payload}]
