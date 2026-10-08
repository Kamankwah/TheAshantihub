from django.urls import path

from . import views

urlpatterns = [
    path("", views.MyReportsView.as_view(), name="report-drafts"),
    path("current/", views.CurrentReportView.as_view(), name="report-current"),
    path("team/", views.TeamReportsView.as_view(), name="report-team"),
    path("<int:pk>/", views.ReportDetailView.as_view(), name="report-detail"),
    path("<int:pk>/submit/", views.ReportSubmitView.as_view(), name="report-submit"),
    path("<int:pk>/acknowledge/", views.ReportAcknowledgeView.as_view(), name="report-acknowledge"),
    path("<int:pk>/return/", views.ReportReturnView.as_view(), name="report-return"),
]
