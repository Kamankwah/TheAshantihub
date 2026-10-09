import datetime as dt

from django.utils import timezone
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsStaff

from .models import Task
from .serializers import TaskSerializer, _subscription_states
from .services import create_task

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
        mine = Task.objects.filter(owner=self.request.user).select_related(
            "business_owner__profile", "created_by"
        )
        view = self.request.query_params.get("view", "open")
        now = timezone.now()
        if view == "done":
            return mine.filter(status=Task.DONE).order_by("-done_at")[:MAX_ROWS]
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
        serializer.instance = create_task(
            self.request.user, data["title"], data["due_at"], notes=data.get("notes", ""), created_by=self.request.user
        )


class _TaskStatusView(APIView):
    new_status = None

    def get_permissions(self):
        return [IsStaff()]

    def post(self, request, pk):
        task = generics.get_object_or_404(Task, pk=pk, owner=request.user)
        task.status = self.new_status
        task.done_at = timezone.now() if self.new_status == Task.DONE else None
        task.save(update_fields=["status", "done_at"])
        return Response(TaskSerializer(task).data)


class TaskDoneView(_TaskStatusView):
    new_status = Task.DONE


class TaskCancelView(_TaskStatusView):
    new_status = Task.CANCELLED
