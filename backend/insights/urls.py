from django.urls import path

from . import views

urlpatterns = [
    path("revenue/", views.RevenueView.as_view(), name="insights-revenue"),
    path("analytics/", views.AnalyticsView.as_view(), name="insights-analytics"),
    path("funnel/", views.FunnelView.as_view(), name="insights-funnel"),
    path("reports-hub/", views.ReportsHubView.as_view(), name="insights-reports-hub"),
    path("refunds/", views.RefundsView.as_view(), name="insights-refunds"),
    path("commissions/", views.CommissionsView.as_view(), name="insights-commissions"),
    path("commissions/statement/", views.CommissionStatementView.as_view(), name="insights-commission-statement"),
    path("accounting-overview/", views.AccountingOverviewView.as_view(), name="insights-accounting-overview"),
    path("collections/", views.CollectionsView.as_view(), name="insights-collections"),
    path("money-alerts/", views.MoneyAlertsView.as_view(), name="insights-money-alerts"),
    path("exports/", views.ScheduledExportsView.as_view(), name="insights-exports"),
    path("exports/files/mine/", views.MyExportFilesView.as_view(), name="insights-export-files"),
    path("exports/files/<int:pk>/download/", views.ExportFileDownloadView.as_view(), name="insights-export-download"),
    path("exports/<int:pk>/", views.ScheduledExportDetailView.as_view(), name="insights-export-detail"),
    path("exports/<int:pk>/pause/", views.SchedulePauseView.as_view(), name="insights-export-pause"),
    path("exports/<int:pk>/resume/", views.ScheduleResumeView.as_view(), name="insights-export-resume"),
    path("exports/<int:pk>/runs/", views.ScheduledExportRunsView.as_view(), name="insights-export-runs"),
]
