from django.urls import path

from . import views

urlpatterns = [
    path("", views.DisputeListView.as_view(), name="dispute-list"),
    path("counts/", views.DisputeCountsView.as_view(), name="dispute-counts"),
    path("log/", views.DisputeLogView.as_view(), name="dispute-log"),
    path("<int:pk>/", views.DisputeDetailView.as_view(), name="dispute-detail"),
    path("<int:pk>/intake/", views.DisputeIntakeView.as_view(), name="dispute-intake"),
    path("<int:pk>/evidence/", views.DisputeEvidenceAddView.as_view(), name="dispute-evidence-add"),
    path("<int:pk>/flag/", views.DisputeFlagView.as_view(), name="dispute-flag"),
    path("<int:pk>/resolve/", views.DisputeResolveView.as_view(), name="dispute-resolve"),
    path("<int:pk>/re-review/", views.DisputeReReviewView.as_view(), name="dispute-re-review"),
]
