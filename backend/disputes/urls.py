from django.urls import path

from . import views

urlpatterns = [
    path("", views.DisputeListView.as_view(), name="dispute-list"),
    path("<int:pk>/flag/", views.DisputeFlagView.as_view(), name="dispute-flag"),
    path("<int:pk>/resolve/", views.DisputeResolveView.as_view(), name="dispute-resolve"),
]
