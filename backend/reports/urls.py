from django.urls import path

from . import views

urlpatterns = [
    path("", views.MyReportsView.as_view(), name="report-drafts"),
    path("current/", views.CurrentReportView.as_view(), name="report-current"),
    path("team/", views.TeamReportsView.as_view(), name="report-team"),
    path("export/", views.ReportRangeExportView.as_view(), name="report-range-export"),
    path("exports/", views.ReportExportListView.as_view(), name="report-export-list"),
    path("exports/<int:pk>/download/", views.ReportExportDownloadView.as_view(), name="report-export-download"),
    path("<int:pk>/export/", views.ReportExportView.as_view(), name="report-export"),
    path("<int:pk>/", views.ReportDetailView.as_view(), name="report-detail"),
    path("<int:pk>/submit/", views.ReportSubmitView.as_view(), name="report-submit"),
    path("<int:pk>/acknowledge/", views.ReportAcknowledgeView.as_view(), name="report-acknowledge"),
    path("<int:pk>/return/", views.ReportReturnView.as_view(), name="report-return"),
]
