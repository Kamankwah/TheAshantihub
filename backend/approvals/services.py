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

from . import rules
from .models import ApprovalDecision, ApprovalRequest
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
    code = ""  # a machine-readable reason the API answers beside the message, when a kind gives one

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


def logged_payload(kind, approval):
    """The payload as the append-only activity log and the inbox show it: the kind's masked copy when it has one."""
    return approval.payload if kind.public_payload is None else _normalise(kind.public_payload(approval))


def _normalise(value):
    return json.loads(json.dumps(value, default=str, sort_keys=True))


def default_chain(approval):
    """Who decides, in order: the maker's manager, then anyone holding the
    kind's pool permission, then a Super Admin (spec F5)."""
    steps = []
    manager = approval.maker.manager
    if (manager is not None and manager.is_active and not manager.is_suspended
            and not rules.barred(approval.kind, manager)):  # a General Manager as manager never holds a money request
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


def _decisions(approval):
    """Approvals given so far (prefetch-friendly), oldest first."""
    return [d for d in approval.decisions.all() if d.decision == ApprovalDecision.APPROVED]


def slot_filled(approval, slot):
    return any(d.slot == slot for d in _decisions(approval))


def waiting_on(approval):
    """What a pending request still needs: "approver" (the ordinary chain),
    "cosigner" (the approver has signed; a co-signer must too) or None."""
    if approval.status != ApprovalRequest.PENDING:
        return None
    if not slot_filled(approval, ApprovalDecision.APPROVER):
        return "approver"
    if approval.required_approvals > 1 and not slot_filled(approval, ApprovalDecision.COSIGNER):
        return "cosigner"
    return None


def _already_decided(approval, staff):
    return any(d.staff_id == staff.pk for d in approval.decisions.all())


def _regular_approvers(approval):
    if approval.stage == ApprovalRequest.MANAGER:
        approvers = StaffUser.objects.filter(pk=approval.assigned_to_id, is_active=True, is_suspended=False)
    elif approval.stage == ApprovalRequest.POOL:
        approvers = staff_holding(approval.pool_permission)
    else:
        approvers = staff_holding(VIEW_ALL)
    kind = get_kind(approval.kind)
    if kind is not None and kind.money:
        approvers = approvers.exclude(role__name=Role.GENERAL_MANAGER)
    return approvers.exclude(pk=approval.maker_id)


def approvers_for(approval):
    """Who may decide now (never the maker, never someone who already has): the
    ordinary approvers of the current stage while the approver slot is open, and,
    on a request needing two, the co-signers while their slot is open."""
    waiting = waiting_on(approval)
    pks = set()
    if waiting == "approver":
        pks |= set(_regular_approvers(approval).values_list("pk", flat=True))
    if approval.required_approvals > 1 and waiting is not None and not slot_filled(approval, ApprovalDecision.COSIGNER):
        pks |= set(rules.cosigners().values_list("pk", flat=True))
    done = [d.staff_id for d in approval.decisions.all()]
    people = StaffUser.objects.filter(pk__in=pks).exclude(pk__in=done).exclude(pk=approval.maker_id)
    kind = get_kind(approval.kind)
    return people.exclude(role__name=Role.GENERAL_MANAGER) if kind is not None and kind.money else people


def was_eligible(approval, staff):
    """Whether this person was ever an approver of the request (even if it is decided now), so a
    loser of a race hears "already decided" instead of a 404."""
    if rules.barred(approval.kind, staff):
        return False
    return _regular_approvers(approval).filter(pk=staff.pk).exists() or (
        approval.required_approvals > 1 and rules.can_cosign(staff)
    )


def slot_for(approval, staff):
    """Which sign-off this person would give on this request now, or None.
    "approver": the ordinary chain (approvals.view_all holders decide at any
    stage); "cosigner": a co-signer on a request needing two. Maker and anyone
    who has already signed get nothing: no one counts twice."""
    if approval.status != ApprovalRequest.PENDING or staff.pk == approval.maker_id or _already_decided(approval, staff):
        return None
    if rules.barred(approval.kind, staff):
        return None
    waiting = waiting_on(approval)
    if waiting == "approver" and (
        VIEW_ALL in staff.effective_permission_codenames() or _regular_approvers(approval).filter(pk=staff.pk).exists()
    ):
        return ApprovalDecision.APPROVER
    if approval.required_approvals > 1 and waiting is not None and rules.can_cosign(staff):
        return ApprovalDecision.COSIGNER
    return None


def can_decide(approval, staff):
    return slot_for(approval, staff) is not None


def waiting_for(staff):
    """Pending requests at a stage this staffer decides: the inbox's
    "Waiting for me" and the nav badge."""
    perms = staff.effective_permission_codenames()
    approver_open = ~Q(pk__in=ApprovalDecision.objects.filter(
        slot=ApprovalDecision.APPROVER, decision=ApprovalDecision.APPROVED).values("request_id"))
    scope = Q(stage=ApprovalRequest.MANAGER, assigned_to=staff)
    if perms:
        scope |= Q(stage=ApprovalRequest.POOL, pool_permission__in=perms)
    if VIEW_ALL in perms:
        scope |= Q(stage=ApprovalRequest.SUPER_ADMIN)
    scope = scope & approver_open
    if rules.can_cosign(staff):
        # A co-signer's whole inbox: requests needing a second approval whose co-sign slot is open.
        scope |= Q(required_approvals__gt=1) & ~Q(pk__in=ApprovalDecision.objects.filter(
            slot=ApprovalDecision.COSIGNER, decision=ApprovalDecision.APPROVED).values("request_id"))
    return (
        ApprovalRequest.objects.filter(status=ApprovalRequest.PENDING).filter(scope)
        .exclude(kind__in=rules.barred_kind_keys(staff)).exclude(maker=staff).exclude(pk__in=ApprovalDecision.objects.filter(staff=staff).values("request_id"))
    )


def visible_to(staff):
    """Requests this staffer may open: their own, their direct reports',
    ones they decided or can decide now; everything for approvals.view_all."""
    if VIEW_ALL in staff.effective_permission_codenames():
        return ApprovalRequest.objects.all()
    return ApprovalRequest.objects.filter(
        Q(maker=staff) | Q(maker__manager=staff) | Q(decided_by=staff) | Q(pk__in=waiting_for(staff).values("pk"))
        | Q(pk__in=ApprovalDecision.objects.filter(staff=staff).values("request_id"))
    )


def _lock_target_key(target_type, target_id):
    """Serialise every decision that touches one target, so two requests on it
    can't both pass the stale check and apply. Held until the transaction ends."""
    if target_id:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(%s, hashtext(%s))",
                [TARGET_LOCK_NAMESPACE, f"{target_type}:{target_id}"],
            )


def lock_target(target_type, target_id):
    """The same per-target advisory lock, for a caller that locks a target's own row before submitting: take this FIRST
    (approve() holds approval row -> this lock -> the target's rows). Re-taking it in the same transaction, as submit()
    may, is safe: Postgres advisory transaction locks are re-entrant for the session that holds them."""
    _lock_target_key(target_type, str(target_id))


def _lock_target(approval):
    _lock_target_key(approval.target_type, approval.target_id)


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


def _after_rejected(approval):
    """The kind's on_rejected hook (e.g. a follow-up task for the maker). A
    failing hook is logged and never blocks the decision."""
    _run_hook(approval, "on_rejected")


def _after_cancelled(approval):
    """The kind's on_cancelled hook (e.g. close the record that waited on the
    approval). A failing hook is logged and never blocks the cancel."""
    _run_hook(approval, "on_cancelled")


def _run_hook(approval, name):
    kind = get_kind(approval.kind)
    hook = getattr(kind, name, None) if kind is not None else None
    if hook is None:
        return
    try:
        with transaction.atomic():
            hook(approval)
    except Exception:
        logger.exception("%s hook failed for approval %s", name, approval.pk)


def _link(approval):
    return f"approvals/{approval.pk}"


def _notify_approvers(approval, kind, title):
    for staff in approvers_for(approval):
        notify_staff(staff, kind, title, body=approval.target_label, link=_link(approval), icon="🗳️")


def _response_time(approval):
    return timedelta(hours=rules.response_hours(approval.kind))


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
        # A two_people kind (a hand-resolved withdrawal) is never applied by its maker alone, Super Admin or not.
        direct = maker.role.name == Role.SUPER_ADMIN and not kind.two_people
        if direct:
            _lock_target(approval)
        approval.before = _normalise(kind.current_state(approval))
        if kind.amount_of is not None:
            approval.amount = kind.amount_of(approval)
        # A Super Admin's own change applies at once whatever the amount (below), so only
        # staged requests carry the second-approval requirement. This is the canvas rule
        # ("a Super Admin's own changes apply at once and are recorded"), decided on purpose:
        # the co-signer constrains requests staged by others, not a Super Admin's own. Also
        # note wallets.withdrawal_resolution defines amount_of, so the co-sign threshold is live for it (above GHS 20,000).
        approval.required_approvals = 1 if direct else rules.required_approvals_for(approval.amount)
        if direct:
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
                   after={"kind": kind.key, "payload": logged_payload(kind, approval)}, request=request)
            return approval
        stage, staff = chain_for(approval)[0]
        _enter_stage(approval, stage, staff, now)
        approval.save()
        _notify_approvers(approval, "approval_waiting", f"Waiting for you: {approval.title}")
        record(maker, "approval.requested", target=approval,
               after={"kind": kind.key, "payload": logged_payload(kind, approval)}, request=request)
    return approval


def _lock(approval_id):
    return ApprovalRequest.objects.select_for_update(of=("self",)).select_related("maker").get(pk=approval_id)


def _check_decidable(approval, staff):
    """Returns the slot the person signs in; raises when they may not decide."""
    if approval.status != ApprovalRequest.PENDING:
        raise NotPending("This request has already been decided.")
    if staff.pk == approval.maker_id:
        raise MakerCannotDecide("You can't approve your own request.")
    if _already_decided(approval, staff):
        raise NotYourDecision("You have already signed this request. A second approval has to come from someone else.")
    slot = slot_for(approval, staff)
    if slot is None:
        raise NotYourDecision("This request is waiting for someone else.")
    return slot


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
        slot = _check_decidable(approval, staff)
        kind = get_kind(approval.kind)
        if kind is None:
            raise UnknownKind("This kind of request can no longer be decided.")
        _lock_target(approval)
        if _state_now(kind, approval) != approval.before:
            raise StaleRequest(STALE_MESSAGE)
        if kind.validate is not None:
            kind.validate(approval)  # e.g. "approve the business's KYC first" — raises ApprovalError
        now = timezone.now()
        note = (note or "").strip()
        ApprovalDecision.objects.create(request=approval, staff=staff, slot=slot, decision=ApprovalDecision.APPROVED, note=note, decided_at=now)
        approval.__dict__.pop("_prefetched_objects_cache", None)
        if approval.required_approvals > 1 and waiting_on(approval) is not None:
            return _first_of_two(approval, staff, slot, note, now, http_request)
        # apply may need the decider (business.kyc stamps the owner's reviewed_by
        # with it), so it is set first; a failed apply rolls the whole block back.
        # On a two-approval request that is the approver, not the co-signer.
        approver = next((d.staff for d in _decisions(approval) if d.slot == ApprovalDecision.APPROVER), staff)
        approval.decided_by = approver
        approval.decided_at = now
        _run_apply(kind, approval)
        approval.status = ApprovalRequest.APPROVED
        approval.decision_note = note
        approval.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
        notify_staff(approval.maker, "approval_decided", f"Approved: {approval.title}",
                     body=approval.decision_note, link=_link(approval), icon="✅")
        record(staff, "approval.approved", target=approval, after={"note": approval.decision_note}, request=http_request)
    return approval


def _first_of_two(approval, staff, slot, note, now, http_request):
    """One of the two approvals is in: the request stays pending, waiting for the other
    person, with a fresh response time. Nothing is applied."""
    other = "a co-signer" if slot == ApprovalDecision.APPROVER else "the approver"
    _enter_stage(approval, approval.stage, approval.assigned_to, now)
    approval.save(update_fields=["stage_started_at", "due_at", "reminded_at"])
    _notify_approvers(approval, "approval_waiting", f"Waiting for {other}: {approval.title}")
    notify_staff(approval.maker, "approval_progress", f"First approval given: {approval.title}",
                 body=f"Waiting for {other}.", link=_link(approval), icon="🗳️")
    record(staff, "approval.signed", target=approval,
           after={"slot": slot, "note": note, "required_approvals": approval.required_approvals}, request=http_request)
    return approval


def reject(approval_id, staff, note, http_request=None):
    note = (note or "").strip()
    with transaction.atomic():
        approval = _lock(approval_id)
        slot = _check_decidable(approval, staff)
        if not note:
            raise NoteRequired("Write a note so the maker knows what to change.")
        ApprovalDecision.objects.create(request=approval, staff=staff, slot=slot, decision=ApprovalDecision.RETURNED, note=note)
        approval.status = ApprovalRequest.REJECTED
        approval.decided_by = staff
        approval.decided_at = timezone.now()
        approval.decision_note = note
        approval.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
        notify_staff(approval.maker, "approval_decided", f"Returned: {approval.title}",
                     body=note, link=_link(approval), icon="↩️")
        _after_rejected(approval)
        record(staff, "approval.rejected", target=approval, after={"note": note}, request=http_request)
    return approval


def close_pending_for_target(kind_key, *, target_type, target_id, staff, approved, note):
    """Settle the pending requests of one kind on one target that were decided
    somewhere else — the KYC queue settling a pending business.kyc request.
    Locks the requests (oldest first) and refuses a maker before taking the
    target lock, so the lock order matches approve(): approval rows, then the
    target. Doesn't run apply and doesn't record(): the caller makes the change
    itself and records last. Returns the requests it closed."""
    note = (note or "").strip()
    target_id = str(target_id)
    with transaction.atomic():
        pending = list(
            ApprovalRequest.objects.select_for_update(of=("self",)).select_related("maker")
            .filter(kind=kind_key, target_type=target_type, target_id=target_id, status=ApprovalRequest.PENDING)
            .order_by("pk")
        )
        if any(approval.maker_id == staff.pk for approval in pending):
            raise MakerCannotDecide("You can't approve your own request.")
        _lock_target_key(target_type, target_id)
        now = timezone.now()
        for approval in pending:
            approval.status = ApprovalRequest.APPROVED if approved else ApprovalRequest.REJECTED
            approval.decided_by = staff
            approval.decided_at = now
            approval.decision_note = note
            approval.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
            if approved:
                notify_staff(approval.maker, "approval_decided", f"Approved: {approval.title}",
                             body=note, link=_link(approval), icon="✅")
            else:
                notify_staff(approval.maker, "approval_decided", f"Returned: {approval.title}",
                             body=note, link=_link(approval), icon="↩️")
                _after_rejected(approval)
    return pending


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
        _after_cancelled(approval)
        record(staff, "approval.cancelled", target=approval, request=http_request)
    return approval


def _remind_at(approval):
    return approval.stage_started_at + (approval.due_at - approval.stage_started_at) * float(rules.get_settings().remind_fraction)


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
        if waiting_on(approval) == "cosigner":
            # The approver has signed; only a co-signer is missing, so there is no one higher to
            # move it to: remind the co-signers each time the response time runs out.
            if now >= approval.due_at:
                _enter_stage(approval, approval.stage, approval.assigned_to, now)
                approval.save()
                _notify_approvers(approval, "approval_reminder", f"Overdue, waiting for a co-signer: {approval.title}")
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


def pool_label(approval):
    """Who the pool stage is, in words: the non-Super-Admin roles holding the
    kind's permission ("Operations"), else "anyone who can approve this"."""
    if not approval.pool_permission:
        return "anyone who can approve this"
    roles = Role.objects.filter(permissions__codename=approval.pool_permission).exclude(name=Role.SUPER_ADMIN)
    kind = get_kind(approval.kind)
    if kind is not None and kind.money:
        roles = roles.exclude(name=Role.GENERAL_MANAGER)
    names = list(roles.order_by("name").values_list("name", flat=True))
    if not names:
        return "anyone who can approve this"
    return " or ".join(f"any {Role(name=n).get_name_display()}" for n in names)


def _stage_label(approval, stage, staff):
    if stage == ApprovalRequest.MANAGER:
        return staff.full_name if staff is not None else "their manager"
    if stage == ApprovalRequest.POOL:
        return pool_label(approval)
    return "a Super Admin"


def upcoming_moves(approval):
    """What happens next to a pending request if nobody decides: the reminder,
    then each later level, at the times the engine will act. A projection from
    due_at and the kind's response time; the real moves are made by escalate_due()."""
    if approval.status != ApprovalRequest.PENDING:
        return []
    moves = []
    reminder_at = approval.reminded_at or _remind_at(approval)
    if waiting_on(approval) == "cosigner":
        moves.append({"at": approval.due_at, "what": "Reminder to the co-signer", "done": False, "kind": "reminder"})
        return moves
    moves.append({"at": reminder_at, "what": "Reminder to the person deciding", "done": approval.reminded_at is not None, "kind": "reminder"})
    rank = ApprovalRequest.STAGE_ORDER.index(approval.stage)
    at = approval.due_at
    step = _response_time(approval)
    for stage, staff in chain_for(approval):
        if ApprovalRequest.STAGE_ORDER.index(stage) <= rank:
            continue
        moves.append({"at": at, "what": f"Moves to {_stage_label(approval, stage, staff)}", "done": False, "kind": "move", "stage": stage})
        at = at + step
    return moves


def timeline(approval):
    """Oldest first: sent, what the engine has already done, what comes next, or the decision."""
    rows = [{"at": approval.created_at, "what": f"Sent by {approval.maker.full_name}", "done": True, "kind": "sent"}]
    if approval.escalation_level:
        rows.append({
            "at": approval.stage_started_at, "what": f"Moved up to level {approval.escalation_level + 1} after no decision", "done": True, "kind": "escalated",
        })
    if approval.required_approvals > 1:
        for d in _decisions(approval):
            label = "approver" if d.slot == ApprovalDecision.APPROVER else "co-signer"
            rows.append({"at": d.decided_at, "what": f"Approved by {d.staff.full_name} as {label}", "done": True, "kind": "signed"})
    if approval.status == ApprovalRequest.PENDING:
        rows.extend(upcoming_moves(approval))
    elif approval.decided_at is not None and approval.status != ApprovalRequest.APPROVED or (
        approval.decided_at is not None and approval.required_approvals <= 1
    ):
        verb = {"approved": "Approved", "rejected": "Returned", "cancelled": "Cancelled"}.get(approval.status, approval.get_status_display())
        who = approval.decided_by.full_name if approval.decided_by_id else "someone"
        rows.append({"at": approval.decided_at, "what": f"{verb} by {who}", "done": True, "kind": "decided"})
    return rows


def next_move(approval):
    """The first projected level change of a pending request: {stage, label, at}."""
    for move in upcoming_moves(approval):
        if move["kind"] == "move":
            return {"stage": move["stage"], "label": move["what"].removeprefix("Moves to "), "at": move["at"]}
    return None
