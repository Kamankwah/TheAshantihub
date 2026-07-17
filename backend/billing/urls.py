from django.urls import path

from . import views

urlpatterns = [
    path("plans/", views.SubscriptionPlanListView.as_view(), name="subscription-plan-list"),
    path(
        "plans/manage/",
        views.SubscriptionPlanAdminListCreateView.as_view(),
        name="subscription-plan-admin-list-create",
    ),
    path(
        "plans/manage/<int:pk>/",
        views.SubscriptionPlanAdminUpdateView.as_view(),
        name="subscription-plan-admin-update",
    ),
    path(
        "plans/pending/",
        views.SubscriptionPlanPendingQueueView.as_view(),
        name="subscription-plan-pending-queue",
    ),
    path(
        "plans/<int:pk>/approve/",
        views.SubscriptionPlanApproveView.as_view(),
        name="subscription-plan-approve",
    ),
    path(
        "plans/<int:pk>/reject/",
        views.SubscriptionPlanRejectView.as_view(),
        name="subscription-plan-reject",
    ),
    path(
        "plans/<int:pk>/re-review/",
        views.SubscriptionPlanReReviewView.as_view(),
        name="subscription-plan-re-review",
    ),
    path("subscriptions/me/", views.SubscriptionMeView.as_view(), name="subscription-me"),
    path(
        "subscriptions/start-trial/",
        views.SubscriptionStartTrialView.as_view(),
        name="subscription-start-trial",
    ),
    path(
        "transactions/mine/",
        views.TransactionMineListCreateView.as_view(),
        name="transaction-mine-list-create",
    ),
    path("transactions/", views.TransactionReportListView.as_view(), name="transaction-report-list"),
    path("transactions/report/", views.TransactionReportView.as_view(), name="transaction-report-aggregate"),
]
