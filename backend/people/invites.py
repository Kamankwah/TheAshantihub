"""Invites (SA-4 screen 07): every open and expired invite across all roles, who
sent it, and the people who accepted or were removed in the last 30 days. Sending,
resending and revoking reuse the existing invite endpoints. Whether an e-mail was
delivered is not tracked, so only Sent, Opened and Expired are shown."""
from datetime import timedelta
from statistics import median

from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role, RoleInviteRule, StaffUser
from accounts.permissions import HasRolePermission, can_lead_team
from accounts.serializers import INVITE_TOKEN_LIFETIME, invite_state
from activity.models import ActivityEvent

from .common import ROLE_LABELS, ROLE_ORDER

RECENT_DAYS = 30


def _who(staff):
    return {"id": staff.pk, "name": staff.full_name, "role": staff.role.name, "role_label": ROLE_LABELS.get(staff.role.name, staff.role.name)}


class InviteListView(APIView):
    """GET /api/people/invites/"""

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def get(self, request):
        now = timezone.now()
        people = StaffUser.objects.select_related("role", "manager__role", "invited_by__role").prefetch_related("areas")
        pending = people.filter(invite_token__isnull=False, is_active=True).order_by("invite_expires_at", "pk")
        open_rows, counts = [], {"open": 0, "opened_unfinished": 0, "expired": 0}
        by_role = {}
        for s in pending:
            state = invite_state(s)
            if state == "expired":
                counts["expired"] += 1
            else:
                counts["open"] += 1
                by_role[s.role.name] = by_role.get(s.role.name, 0) + 1
                if state == "opened":
                    counts["opened_unfinished"] += 1
            open_rows.append({
                "id": s.pk, "full_name": s.full_name, "email": s.email, "phone": s.phone,
                "role": s.role.name, "role_label": ROLE_LABELS.get(s.role.name, s.role.name),
                "manager": _who(s.manager) if s.manager_id else None,
                "invited_by": _who(s.invited_by) if s.invited_by_id else None,
                "sent_at": s.invite_sent_at or s.created_at, "expires_at": s.invite_expires_at, "opened_at": s.invite_opened_at,
                "state": state, "start_date": s.start_date, "areas": sorted(z.name for z in s.areas.all()),
            })
        since = now - timedelta(days=RECENT_DAYS)
        accepted = list(people.filter(invite_token__isnull=True, activated_at__gte=since, invited_by__isnull=False).order_by("-activated_at"))
        days = [(s.activated_at - (s.invite_sent_at or s.created_at)).total_seconds() / 86400 for s in accepted if s.activated_at >= (s.invite_sent_at or s.created_at)]
        recent = [
            {"state": "accepted", "name": s.full_name, "role": s.role.name, "role_label": ROLE_LABELS.get(s.role.name, s.role.name),
             "by": s.invited_by.full_name, "at": s.activated_at, "id": s.pk}
            for s in accepted
        ]
        for e in ActivityEvent.objects.filter(verb="staff.invite_cancelled", occurred_at__gte=since).order_by("-id"):
            before = e.before or {}
            recent.append({
                "state": "revoked", "name": before.get("full_name", e.target_label), "role": before.get("role", ""),
                "role_label": ROLE_LABELS.get(before.get("role", ""), before.get("role", "")), "by": e.actor_label, "at": e.occurred_at, "id": None,
            })
        recent.sort(key=lambda r: r["at"], reverse=True)
        rules = {}
        for rule in RoleInviteRule.objects.select_related("inviter_role", "invitee_role"):
            rules.setdefault(rule.inviter_role.name, []).append(rule.invitee_role.name)
        leads = [_who(s) for s in StaffUser.objects.filter(is_active=True, is_suspended=False).select_related("role").order_by("full_name") if can_lead_team(s)]
        roles = [name for name in ROLE_ORDER if Role.objects.filter(name=name).exists()]
        return Response({
            "link_days": INVITE_TOKEN_LIFETIME.days,
            "kpis": {
                **counts, "open_by_role": by_role, "accepted_30_days": len(accepted),
                "median_days_to_accept": round(median(days), 1) if days else None,
            },
            "invites": open_rows, "recent": recent,
            "roles": [{"name": n, "label": ROLE_LABELS.get(n, n)} for n in roles],
            "leads": leads,
            "who_can_invite": [
                {"who": "Super Admin", "can": "Any role"},
                *[{"who": ROLE_LABELS.get(inviter, inviter), "can": ", ".join(ROLE_LABELS.get(r, r) for r in sorted(invitees))} for inviter, invitees in sorted(rules.items())],
            ],
        })
