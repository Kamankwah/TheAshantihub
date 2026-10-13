from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import generics
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role, StaffUser
from accounts.permissions import HasRolePermission, IsStaff

from . import services
from .models import Announcement, AnnouncementReceipt

SEND = "announcements.send"
RECENT = timedelta(days=14)
ROLE_LABELS = dict(Role.NAME_CHOICES)


def _audience_text(announcement):
    parts = [ROLE_LABELS.get(r, r) for r in announcement.roles]
    if announcement.team_manager_id and announcement.team_manager:
        parts.append(f"{announcement.team_manager.full_name}'s team")
    return ", ".join(parts)


def _row(announcement, stats=None):
    stats = stats or {}
    opened, confirmed = stats.get("opened", 0), stats.get("confirmed", 0)
    return {
        "id": announcement.id, "title": announcement.title, "body": announcement.body, "status": announcement.status,
        "to": _audience_text(announcement), "roles": announcement.roles, "team_manager": announcement.team_manager_id,
        "require_confirm": announcement.require_confirm, "send_email": announcement.send_email,
        "send_at": announcement.send_at, "sent_at": announcement.sent_at, "created_at": announcement.created_at,
        "created_by": announcement.created_by.full_name if announcement.created_by else "",
        "recipients": announcement.recipient_count, "emailed": announcement.emailed_count,
        "opened": opened, "confirmed": confirmed, "not_opened": max(announcement.recipient_count - opened, 0),
        "last_reminded_at": announcement.last_reminded_at,
    }


def _stats(ids):
    rows = AnnouncementReceipt.objects.filter(announcement_id__in=ids).values("announcement_id").annotate(
        opened=Count("id", filter=Q(opened_at__isnull=False)), confirmed=Count("id", filter=Q(confirmed_at__isnull=False))
    )
    return {r["announcement_id"]: r for r in rows}


class AnnouncementListView(APIView):
    """GET announcements/ — what was composed (newest first) with read counts,
    plus what the composer needs: roles with head-counts, team leads, and which
    channels really exist. POST announcements/ — compose one: {title, body,
    roles?, team_manager?, require_confirm?, send_email?, when: now|schedule|draft,
    send_at?}."""

    def get_permissions(self):
        return [HasRolePermission(SEND)]

    def get(self, request):
        rows = list(Announcement.objects.select_related("created_by", "team_manager")[:100])
        stats = _stats([r.id for r in rows])
        people = dict(StaffUser.objects.filter(is_active=True, is_suspended=False).values_list("role__name").annotate(n=Count("id")))
        leads = (
            StaffUser.objects.filter(is_active=True)
            .annotate(n=Count("direct_reports", filter=Q(direct_reports__is_active=True, direct_reports__is_suspended=False)))
            .filter(n__gt=0).order_by("full_name")
        )
        return Response({
            "announcements": [_row(r, stats.get(r.id)) for r in rows],
            "roles": [{"name": n, "label": label, "people": people.get(n, 0)} for n, label in Role.NAME_CHOICES],
            "teams": [{"id": lead.id, "name": lead.full_name, "people": lead.n} for lead in leads],
            "channels": {"in_app": True, "email": services.email_configured(), "push": False, "sms": False, "whatsapp": False},
        })

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        title, body = str(data.get("title") or "").strip(), str(data.get("body") or "").strip()
        errors = {}
        if not title or len(title) > 150:
            errors["title"] = "Give it a title of up to 150 characters."
        if not body or len(body) > 2000:
            errors["body"] = "Write a message of up to 2,000 characters."
        valid_roles = {n for n, _ in Role.NAME_CHOICES}
        roles = data.get("roles") if isinstance(data.get("roles"), list) else []
        if any(r not in valid_roles for r in roles):
            errors["roles"] = "Unknown role."
        manager = None
        if data.get("team_manager"):
            manager = StaffUser.objects.filter(pk=data["team_manager"] if str(data["team_manager"]).isdecimal() else 0, is_active=True).first()
            if manager is None:
                errors["team_manager"] = "Pick a team lead from the list."
        if not roles and manager is None:
            errors["roles"] = "Pick who it is for: a role or a team."
        when = data.get("when", "now")
        send_at = None
        if when not in ("now", "schedule", "draft"):
            errors["when"] = "Send now, schedule it, or save a draft."
        if when == "schedule":
            send_at = parse_datetime(str(data.get("send_at") or ""))
            if send_at is None or send_at <= timezone.now():
                errors["send_at"] = "Pick a time in the future."
            elif timezone.is_naive(send_at):
                send_at = timezone.make_aware(send_at)
        if data.get("send_email") and not services.email_configured():
            errors["send_email"] = "E-mail is not connected on this server."
        if errors:
            raise ValidationError(errors)
        announcement = Announcement(
            title=title, body=body, roles=sorted(set(roles)), team_manager=manager, created_by=request.user,
            require_confirm=bool(data.get("require_confirm")), send_email=bool(data.get("send_email")),
            status=Announcement.SCHEDULED if when == "schedule" else Announcement.DRAFT, send_at=send_at,
        )
        if when != "draft" and not services.audience(announcement).exists():
            raise ValidationError({"roles": "Nobody is in that audience."})
        announcement.save()
        if when == "now":
            announcement = services.send(announcement, request=request)
        return Response(_row(Announcement.objects.select_related("created_by", "team_manager").get(pk=announcement.pk), _stats([announcement.pk]).get(announcement.pk)), status=201)


class AnnouncementDetailView(APIView):
    """GET announcements/<id>/ — one announcement and who opened and confirmed it."""

    def get_permissions(self):
        return [HasRolePermission(SEND)]

    def get(self, request, pk):
        announcement = generics.get_object_or_404(Announcement.objects.select_related("created_by", "team_manager"), pk=pk)
        receipts = announcement.receipts.select_related("staff__role").order_by("confirmed_at", "opened_at", "staff__full_name")
        return Response({
            **_row(announcement, _stats([pk]).get(pk)),
            "people": [
                {"id": r.staff_id, "name": r.staff.full_name, "role": r.staff.role.name, "opened_at": r.opened_at, "confirmed_at": r.confirmed_at}
                for r in receipts
            ],
        })


class AnnouncementCancelView(APIView):
    def get_permissions(self):
        return [HasRolePermission(SEND)]

    def post(self, request, pk):
        # Lock the row so a send that lands between the check and the save cannot be overwritten.
        with transaction.atomic():
            announcement = generics.get_object_or_404(Announcement.objects.select_for_update(), pk=pk)
            if announcement.status not in (Announcement.DRAFT, Announcement.SCHEDULED):
                raise ValidationError({"detail": "Only a draft or a scheduled announcement can be cancelled; a sent one cannot be taken back."})
            announcement.status = Announcement.CANCELLED
            announcement.save(update_fields=["status"])
        return Response(_row(announcement))


class AnnouncementRemindView(APIView):
    def get_permissions(self):
        return [HasRolePermission(SEND)]

    def post(self, request, pk):
        # The row is locked for the whole check-and-send, so a double click sends one reminder.
        with transaction.atomic():
            announcement = generics.get_object_or_404(Announcement.objects.select_for_update(), pk=pk)
            count = services.remind(announcement)
        if count == -1:
            raise ValidationError({"detail": "You already sent a reminder in the last hour."})
        if announcement.status != Announcement.SENT:
            raise ValidationError({"detail": "Only a sent announcement can be reminded."})
        return Response({"reminded": count})


def _mine(user):
    return AnnouncementReceipt.objects.filter(
        staff=user, announcement__status=Announcement.SENT, announcement__sent_at__gte=timezone.now() - RECENT,
    ).select_related("announcement__created_by")


class MineView(APIView):
    """GET announcements/mine/ — the notices still waiting for this person: ones
    that ask to be confirmed and are not, and others they have not opened. The
    staff app shows them at the top of every screen."""

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        waiting = _mine(request.user).filter(
            Q(announcement__require_confirm=True, confirmed_at__isnull=True) | Q(announcement__require_confirm=False, opened_at__isnull=True)
        ).order_by("-announcement__sent_at")[:5]
        return Response([
            {
                "id": r.announcement_id, "title": r.announcement.title, "body": r.announcement.body, "sent_at": r.announcement.sent_at,
                "from": r.announcement.created_by.full_name if r.announcement.created_by else "AshantiHub",
                "require_confirm": r.announcement.require_confirm,
            }
            for r in waiting
        ])


class MineOpenView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def post(self, request, pk):
        receipt = generics.get_object_or_404(_mine(request.user), announcement_id=pk)
        if receipt.opened_at is None:
            receipt.opened_at = timezone.now()
            receipt.save(update_fields=["opened_at"])
        return Response(status=204)


class MineConfirmView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def post(self, request, pk):
        receipt = generics.get_object_or_404(_mine(request.user), announcement_id=pk)
        now = timezone.now()
        update = []
        if receipt.opened_at is None:
            receipt.opened_at = now
            update.append("opened_at")
        if receipt.confirmed_at is None:
            receipt.confirmed_at = now
            update.append("confirmed_at")
        if update:
            receipt.save(update_fields=update)
        return Response(status=204)
