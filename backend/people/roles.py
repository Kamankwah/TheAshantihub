"""Roles & permissions (SA-4 screen 08): the role-level editor. Until now a role's
permissions were migration seeds; only a person's own grants and revokes could be
edited. Here Super Admin ticks a box per role and permission, sees exactly what the
save would change (who it reaches and which individual exceptions it touches), and
saves with the password; the audit event holds the before and after.

Guards, enforced on save (and shown on the screen):
* Super Admin's own role is locked: it always holds every permission.
* A few permissions are Super Admin's alone and cannot be handed to a role:
  changing roles, the approval rules, step-in and staff management.
* approvals.cosign belongs to the external co-signer alone, and the co-signer role
  holds nothing else, so the maker never signs and the co-signer never makes.
Permissions that a later phase has not created yet (payouts, campaigns, ...) are not
listed; they appear here when their phase adds them."""
from django.db import transaction
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Permission, Role, StaffUser
from accounts.permissions import HasRolePermission, RequiresSudo
from activity.services import record
from realtime.publish import force_disconnect_on_commit

from .common import ROLE_LABELS, ROLE_ORDER

SUPER_ADMIN_ONLY = {
    "roles.manage": "changing what roles can do",
    "approvals.manage_rules": "editing approval timers and money limits",
    "staff.view_as": "stepping into a team's workspace",
    "staff.manage": "inviting, suspending and changing staff",
    "commission.tax_ruling": "recording the ruling on scouts' tax status",
    "security.manage": "security settings, 2-step rules and the sign-in policy",
    "exports.schedule": "scheduling recurring exports",
    "announcements.send": "sending announcements to staff",
    "system.view": "the system and jobs view",
}
COSIGN = "approvals.cosign"


def individual_grant_refusal(role_name, codenames):
    """Why these per-person extra grants may not be made for someone in `role_name`,
    or None. The co-signer separation: only the external co-signer may hold
    approvals.cosign, and the co-signer holds nothing beyond its role."""
    codenames = set(codenames)
    if role_name == Role.COSIGNER and codenames:
        return "The co-signer approves large requests only and cannot be given anything else."
    if COSIGN in codenames and role_name != Role.COSIGNER:
        return "Only the external co-signer can co-sign; nobody who makes requests may."
    return None

GROUPS = [
    ("People and access", ("staff.", "leave.", "calendar.", "activity.", "roles.")),
    ("Approvals and reports", ("approvals.", "reports.")),
    ("Businesses and listings", ("kyc.", "listings.", "businesses.", "portfolio.", "fraud.", "scouts.", "users.", "zones.", "categories.")),
    ("Content and moderation", ("reviews.", "event.", "hero_media.", "site_settings.", "promotions.", "analytics.")),
    ("Orders, delivery and support", ("orders.", "delivery.", "calls.", "support.", "service_issues.", "messaging.", "contact_messages.", "disputes.")),
    ("Money", ("escrow.", "transactions.", "commission.", "subscription_plans.", "event_pricing.", "credit.", "targets.")),
]
OTHER = "Other"


def group_of(codename):
    for name, prefixes in GROUPS:
        if codename.startswith(prefixes):
            return name
    return OTHER


def _label(role_name):
    return ROLE_LABELS.get(role_name, role_name)


def _roles():
    roles = {r.name: r for r in Role.objects.prefetch_related("permissions")}
    return [roles[n] for n in ROLE_ORDER if n in roles] + [r for n, r in roles.items() if n not in ROLE_ORDER]


def refusal(role_name, codename, grant):
    """Why this change may not be made, or None."""
    if role_name == Role.SUPER_ADMIN:
        return "Super Admin always holds every permission."
    if grant and codename in SUPER_ADMIN_ONLY:
        return f"{codename} stays with Super Admin ({SUPER_ADMIN_ONLY[codename]})."
    if grant and codename == COSIGN and role_name != Role.COSIGNER:
        return "Only the external co-signer can co-sign; nobody who makes requests may."
    if grant and role_name == Role.COSIGNER and codename != COSIGN:
        return "The co-signer approves large requests only and holds nothing else."
    if not grant and role_name == Role.COSIGNER and codename == COSIGN:
        return "The co-signer role needs the co-sign permission to do its one job."
    return None


class RoleMatrixView(APIView):
    """GET /api/people/roles/ — every role, every real permission, and who holds it."""

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def get(self, request):
        roles = _roles()
        held = {r.name: {p.codename for p in r.permissions.all()} for r in roles}
        active = {}
        for staff in StaffUser.objects.filter(is_active=True).prefetch_related("extra_permissions", "revoked_permissions"):
            row = active.setdefault(staff.role_id, {"people": 0, "grants": 0, "revokes": 0})
            row["people"] += 1
            row["grants"] += staff.extra_permissions.count()
            row["revokes"] += staff.revoked_permissions.count()
        groups = {}
        for p in Permission.objects.order_by("codename"):
            groups.setdefault(group_of(p.codename), []).append({
                "codename": p.codename, "description": p.description,
                "roles": {r.name: p.codename in held[r.name] for r in roles},
                "locked_for": {r.name: refusal(r.name, p.codename, p.codename not in held[r.name]) for r in roles if refusal(r.name, p.codename, p.codename not in held[r.name])},
            })
        order = [n for n, _ in GROUPS] + [OTHER]
        return Response({
            "roles": [
                {"name": r.name, "label": _label(r.name), "locked": r.name == Role.SUPER_ADMIN, **active.get(r.pk, {"people": 0, "grants": 0, "revokes": 0})}
                for r in roles
            ],
            "groups": [{"name": n, "permissions": groups[n]} for n in order if n in groups],
            "permission_count": Permission.objects.count(),
        })


def parse_changes(data):
    """[(Role, Permission, grant)] from the body, or (None, error). Later entries for the
    same role and permission win; entries that change nothing are dropped."""
    items = data.get("changes") if isinstance(data, dict) else None
    if not isinstance(items, list) or not items:
        return None, "Tick or untick at least one permission."
    if len(items) > 400:
        return None, "That is too many changes at once."
    wanted = {}
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("grant"), bool):
            return None, "Each change needs a role, a permission and grant true or false."
        wanted[(item.get("role"), item.get("permission"))] = item["grant"]
    roles = {r.name: r for r in Role.objects.prefetch_related("permissions")}
    permissions = {p.codename: p for p in Permission.objects.filter(codename__in={p for _, p in wanted})}
    out = []
    for (role_name, codename), grant in wanted.items():
        if role_name not in roles:
            return None, f"Unknown role: {role_name}."
        if codename not in permissions:
            return None, f"Unknown permission: {codename}."
        why = refusal(role_name, codename, grant)
        if why:
            return None, why
        has = roles[role_name].permissions.filter(codename=codename).exists()
        if has != grant:
            out.append((roles[role_name], permissions[codename], grant))
    return out, None


def describe(role, permission, grant):
    """What one change does, from the role's people and their individual exceptions."""
    staff = list(
        StaffUser.objects.filter(role=role, is_active=True)
        .prefetch_related("extra_permissions", "revoked_permissions").order_by("full_name")
    )
    granted_by_hand = [s.full_name for s in staff if any(p.pk == permission.pk for p in s.extra_permissions.all())]
    revoked_by_hand = [s.full_name for s in staff if any(p.pk == permission.pk for p in s.revoked_permissions.all())]
    label = _label(role.name)
    if grant:
        effect = f"{label} people can now: {permission.description}."
        if granted_by_hand:
            effect += f" {', '.join(granted_by_hand)} already had this as an individual grant; it becomes part of the role."
        if revoked_by_hand:
            effect += f" {', '.join(revoked_by_hand)} had it taken away individually and still do not have it."
    else:
        effect = f"{label} people can no longer: {permission.description}."
        if granted_by_hand:
            effect += f" {', '.join(granted_by_hand)} hold it as an individual grant and keep it."
    exceptions = [{"name": n, "kind": "granted individually"} for n in granted_by_hand] + [{"name": n, "kind": "taken away individually"} for n in revoked_by_hand]
    return {
        "role": role.name, "role_label": label, "permission": permission.codename, "description": permission.description,
        "grant": grant, "people": len(staff), "effect": effect, "exceptions": exceptions, "staff_ids": [s.pk for s in staff],
    }


class RolePreviewView(APIView):
    """POST /api/people/roles/preview/ {changes: [{role, permission, grant}]} — nothing is saved."""

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def post(self, request):
        changes, error = parse_changes(request.data)
        if error:
            return Response({"detail": error}, status=400)
        rows = [describe(*c) for c in changes]
        reached = {i for r in rows for i in r["staff_ids"]}
        for r in rows:
            del r["staff_ids"]
        return Response({
            "changes": rows, "count": len(rows), "people_affected": len(reached),
            "exceptions": sum(len(r["exceptions"]) for r in rows),
        })


class RoleSaveView(APIView):
    """POST /api/people/roles/ {changes: [...]} — apply them (password again). The
    effective permission set is read on every request, so it takes effect at once;
    the people affected are reconnected so their screens catch up."""

    def get_permissions(self):
        return [HasRolePermission("roles.manage"), RequiresSudo()]

    def post(self, request):
        changes, error = parse_changes(request.data)
        if error:
            return Response({"detail": error}, status=400)
        if not changes:
            return Response({"detail": "Nothing to save: those roles already work that way."}, status=400)
        before, after, summary = {}, {}, []
        with transaction.atomic():
            affected = set()
            for role, permission, grant in changes:
                affected.update(StaffUser.objects.filter(role=role, is_active=True).values_list("pk", flat=True))
                before.setdefault(role.name, {})[permission.codename] = "no" if grant else "yes"
                after.setdefault(role.name, {})[permission.codename] = "yes" if grant else "no"
                (role.permissions.add if grant else role.permissions.remove)(permission)
                summary.append(f"{_label(role.name)} {'+' if grant else '-'} {permission.codename}")
            record(
                request.user, "role.permissions_changed", target_type="accounts.role", target_id="matrix", target_label="Roles & permissions",
                summary=("Changed role permissions: " + "; ".join(summary))[:300],
                before=before, after=after, request=request,
            )
            for pk in sorted(affected):
                force_disconnect_on_commit(f"staff.{pk}")
        return Response({"saved": len(changes), "people_affected": len(affected)})
