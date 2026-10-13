import datetime as dt

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import generics
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import StaffUser
from accounts.permissions import IsStaff
from notifications.services import notify_staff

from .models import Task
from .serializers import TaskDueSerializer, TaskSerializer, _subscription_states
from .services import create_task
from activity import services as activity

MAX_ROWS = 200


def _end_of_today():
    today = timezone.localdate()
    return timezone.make_aware(dt.datetime.combine(today + dt.timedelta(days=1), dt.time.min))


class TaskListCreateView(generics.ListCreateAPIView):
    serializer_class = TaskSerializer
    pagination_class = None

    def get_permissions(self):
        return [IsStaff()]

    def get_queryset(self):
        # scope=team: the open or done tasks of the caller's direct reports
        # (nobody's, for someone who leads no one), never the caller's own.
        if self.request.query_params.get("scope") == "team":
            owners = Task.objects.filter(owner__manager=self.request.user, owner__is_active=True)
        else:
            owners = Task.objects.filter(owner=self.request.user)
        mine = owners.select_related("business_owner__profile", "created_by", "owner")
        view = self.request.query_params.get("view", "open")
        now = timezone.now()
        if view == "done":
            return mine.filter(status=Task.DONE).order_by("-done_at")[:MAX_ROWS]
        if view == "done_today":
            start = timezone.make_aware(dt.datetime.combine(timezone.localdate(), dt.time.min))
            return mine.filter(status=Task.DONE, done_at__gte=start).order_by("-done_at")[:MAX_ROWS]
        open_tasks = mine.filter(status=Task.OPEN)
        if view == "overdue":
            open_tasks = open_tasks.filter(due_at__lt=now)
        elif view == "due_today":
            # Due from now to midnight: Overdue and Today never overlap.
            open_tasks = open_tasks.filter(due_at__gte=now, due_at__lt=_end_of_today())
        elif view == "today":
            open_tasks = open_tasks.filter(due_at__lt=_end_of_today())
        elif view == "upcoming":
            open_tasks = open_tasks.filter(due_at__gte=_end_of_today())
        return open_tasks[:MAX_ROWS]

    def list(self, request, *args, **kwargs):
        from field.models import Prospect

        tasks = list(self.get_queryset())
        prospect_ids = [t.source_id for t in tasks if t.source_type == "field.prospect" and t.source_id.isdigit()]
        sub_ids = [t.source_id for t in tasks if t.source_type == "billing.subscription" and t.source_id.isdigit()]
        context = {
            **self.get_serializer_context(),
            "prospect_names": dict(Prospect.objects.filter(pk__in=prospect_ids).values_list("pk", "name")),
            "subscription_states": _subscription_states(sub_ids),
        }
        return Response(TaskSerializer(tasks, many=True, context=context).data)

    def perform_create(self, serializer):
        data = serializer.validated_data
        owner = self._owner(self.request.data.get("owner"))
        serializer.instance = create_task(
            owner, data["title"], data["due_at"], notes=data.get("notes", ""), created_by=self.request.user
        )
        if owner.pk != self.request.user.pk:
            notify_staff(
                owner, "task_assigned", f"{self.request.user.full_name} gave you a task",
                body=data["title"], link="tasks", icon="✅",
            )

    def _owner(self, value):
        """Who the task is for: the caller, or one of their direct reports."""
        if value in (None, "", self.request.user.pk):
            return self.request.user
        if not str(value).isdigit() or int(value) > 2**31 - 1:
            raise ValidationError({"owner": "Pick someone from your team."})
        owner = StaffUser.objects.filter(pk=int(value), manager=self.request.user, is_active=True).first()
        if owner is None:
            raise ValidationError({"owner": "You can give tasks only to yourself or your direct reports."})
        return owner


class TaskDetailView(APIView):
    """PATCH <id>/ — move a task's due date. The owner or the owner's manager
    (a lead) only; the change is recorded in the activity log."""

    def get_permissions(self):
        return [IsStaff()]

    def patch(self, request, pk):
        task = generics.get_object_or_404(
            Task.objects.select_related("owner", "business_owner__profile", "created_by"),
            Q(owner=request.user) | Q(owner__manager=request.user), pk=pk,
        )
        unknown = set(request.data) - {"due_at"}
        if unknown:
            raise ValidationError({"detail": "Only the due date can be changed."})
        serializer = TaskDueSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            task = Task.objects.select_for_update().get(pk=task.pk)
            if task.status != Task.OPEN:
                raise ValidationError({"detail": "Only an open task can be moved."})
            before = task.due_at
            task.due_at = serializer.validated_data["due_at"]
            task.save(update_fields=["due_at"])
            activity.record(
                request.user, "task.due_moved", target=task, method="PATCH",
                summary=f"Moved the due date of \"{task.title}\"",
                before={"due_at": before.isoformat()}, after={"due_at": task.due_at.isoformat()}, request=request,
            )
            if task.owner_id != request.user.pk:
                notify_staff(
                    task.owner, "task_moved", f"{request.user.full_name} moved a task's due date",
                    body=task.title, link="tasks", icon="✅",
                )
        return Response(TaskSerializer(task).data)


class _TaskStatusView(APIView):
    new_status = None

    def get_permissions(self):
        return [IsStaff()]

    def post(self, request, pk):
        # The owner, or the manager of the owner, may close it.
        task = generics.get_object_or_404(
            Task.objects.filter(Q(owner=request.user) | Q(owner__manager=request.user)), pk=pk
        )
        task.status = self.new_status
        task.done_at = timezone.now() if self.new_status == Task.DONE else None
        task.save(update_fields=["status", "done_at"])
        return Response(TaskSerializer(task).data)


class TaskDoneView(_TaskStatusView):
    new_status = Task.DONE


class TaskCancelView(_TaskStatusView):
    new_status = Task.CANCELLED


class TeamTaskSummaryView(APIView):
    """GET team-summary/ — for each direct report, how many open tasks are
    overdue and how old the oldest is (canvas screen 23's side list)."""

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        from targets.services import Calendar

        now = timezone.now()
        today = timezone.localdate(now)
        rows = []
        for member in StaffUser.objects.filter(manager=request.user, is_active=True, invite_token__isnull=True).select_related("role").order_by("full_name"):
            overdue = Task.objects.filter(owner=member, status=Task.OPEN, due_at__lt=now).order_by("due_at")
            first = overdue.first()
            rows.append({
                "id": member.pk, "name": member.full_name, "role": member.role.name, "overdue": overdue.count(),
                "oldest_days": (now - first.due_at).days if first else None,
                "state": Calendar(member, today, today).state(today),
            })
        rows.sort(key=lambda row: (-row["overdue"], row["name"]))
        return Response(rows)
