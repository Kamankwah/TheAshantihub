from django.urls import path

from . import views

urlpatterns = [
    path("flags/", views.FraudFlagListCreateView.as_view(), name="fraud-flag-list"),
    path("flags/counts/", views.FraudFlagCountsView.as_view(), name="fraud-flag-counts"),
    path("flags/<int:pk>/confirm/", views.FraudFlagConfirmView.as_view(), name="fraud-flag-confirm"),
    path("flags/<int:pk>/dismiss/", views.FraudFlagDismissView.as_view(), name="fraud-flag-dismiss"),
]
