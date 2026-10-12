from django.urls import path

from . import views

urlpatterns = [
    path("scouts/", views.ScoutsView.as_view(), name="operations-scouts"),
    path("overview/", views.OverviewView.as_view(), name="operations-overview"),
    path("invites/", views.InvitesView.as_view(), name="operations-invites"),
]
