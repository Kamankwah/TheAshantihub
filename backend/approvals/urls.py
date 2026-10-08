from django.urls import path

from . import views

urlpatterns = [
    path("", views.ApprovalListView.as_view(), name="approval-list"),
    path("counts/", views.ApprovalCountsView.as_view(), name="approval-counts"),
    path("<int:pk>/", views.ApprovalDetailView.as_view(), name="approval-detail"),
    path("<int:pk>/approve/", views.ApprovalApproveView.as_view(), name="approval-approve"),
    path("<int:pk>/reject/", views.ApprovalRejectView.as_view(), name="approval-reject"),
    path("<int:pk>/cancel/", views.ApprovalCancelView.as_view(), name="approval-cancel"),
]
