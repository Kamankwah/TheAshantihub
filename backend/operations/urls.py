from django.urls import path

from . import views

urlpatterns = [
    path("scouts/", views.ScoutsView.as_view(), name="operations-scouts"),
    path("overview/", views.OverviewView.as_view(), name="operations-overview"),
    path("superadmin-overview/", views.SuperAdminOverviewView.as_view(), name="operations-superadmin-overview"),
    path("service-issues/", views.ServiceIssuesView.as_view(), name="operations-service-issues"),
    path("deliveries/", views.DeliveriesView.as_view(), name="operations-deliveries"),
    path("support-team/", views.SupportTeamView.as_view(), name="operations-support-team"),
    path("invites/", views.InvitesView.as_view(), name="operations-invites"),
]
