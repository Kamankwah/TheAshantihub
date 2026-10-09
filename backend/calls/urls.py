from django.urls import path

from . import views

urlpatterns = [
    path("", views.CallLogListCreateView.as_view(), name="call-list"),
    path("purposes/", views.CallPurposesView.as_view(), name="call-purposes"),
    path("counterparts/", views.CallCounterpartsView.as_view(), name="call-counterparts"),
    path("<int:pk>/", views.CallLogDetailView.as_view(), name="call-detail"),
]
