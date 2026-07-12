from django.urls import path

from . import views

urlpatterns = [
    path("plans/", views.SubscriptionPlanListView.as_view(), name="subscription-plan-list"),
    path("subscriptions/me/", views.SubscriptionMeView.as_view(), name="subscription-me"),
    path(
        "transactions/mine/",
        views.TransactionMineListCreateView.as_view(),
        name="transaction-mine-list-create",
    ),
    path("transactions/", views.TransactionReportListView.as_view(), name="transaction-report-list"),
]
