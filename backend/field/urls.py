from django.urls import path

from . import views

urlpatterns = [
    path("visit-targets/", views.VisitTargetsView.as_view(), name="field-visit-targets"),
    path("visits/open/", views.OpenVisitView.as_view(), name="field-visit-open"),
    path("visits/", views.VisitListCreateView.as_view(), name="field-visits"),
    path("visits/<int:pk>/", views.VisitDetailView.as_view(), name="field-visit-detail"),
    path("visits/<int:pk>/check-out/", views.VisitCheckOutView.as_view(), name="field-visit-check-out"),
    path("visits/<int:pk>/photos/", views.VisitPhotoView.as_view(), name="field-visit-photos"),
    path("prospects/", views.ProspectListCreateView.as_view(), name="field-prospects"),
    path("prospects/<int:pk>/", views.ProspectDetailView.as_view(), name="field-prospect-detail"),
]
