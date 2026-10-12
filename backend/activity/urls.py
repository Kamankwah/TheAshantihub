from django.urls import path

from . import views

urlpatterns = [
    path("", views.ActivityListView.as_view(), name="activity-list"),
    path("export/", views.ActivityExportView.as_view(), name="activity-export"),
    path("people/", views.ActivityPeopleView.as_view(), name="activity-people"),
    path("chain-status/", views.ChainStatusView.as_view(), name="activity-chain-status"),
]
