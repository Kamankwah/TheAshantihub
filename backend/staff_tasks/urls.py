from django.urls import path

from . import views

urlpatterns = [
    path("", views.TaskListCreateView.as_view(), name="task-list"),
    path("team-summary/", views.TeamTaskSummaryView.as_view(), name="task-team-summary"),
    path("<int:pk>/done/", views.TaskDoneView.as_view(), name="task-done"),
    path("<int:pk>/cancel/", views.TaskCancelView.as_view(), name="task-cancel"),
]
