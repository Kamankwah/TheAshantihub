from django.urls import path

from . import views

urlpatterns = [
    path("mine/", views.EventMineListView.as_view(), name="event-mine-list"),
    path("submit/", views.EventSubmitView.as_view(), name="event-submit"),
    path("moderation/pending/", views.EventPendingQueueView.as_view(), name="event-moderation-pending"),
    path("moderation/<int:pk>/", views.EventModerationDetailView.as_view(), name="event-moderation-detail"),
    path(
        "moderation/<int:pk>/approve/", views.EventApproveView.as_view(), name="event-moderation-approve"
    ),
    path(
        "moderation/<int:pk>/reject/", views.EventRejectView.as_view(), name="event-moderation-reject"
    ),
    path("", views.EventListView.as_view(), name="event-list"),
    path("<int:pk>/", views.EventDetailView.as_view(), name="event-detail"),
    path("<int:pk>/unlock/", views.EventUnlockView.as_view(), name="event-unlock"),
    path("<int:pk>/media/", views.EventMediaCreateView.as_view(), name="event-media-create"),
    path("<int:pk>/pay/", views.EventPayView.as_view(), name="event-pay"),
]
