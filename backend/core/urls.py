from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health_check, name="health-check"),
    path("core/site-settings/", views.SiteSettingsView.as_view(), name="site-settings"),
    path("core/site-settings/history/", views.SiteSettingsHistoryView.as_view(), name="site-settings-history"),
    path("core/analytics/", views.AnalyticsOverviewView.as_view(), name="analytics-overview"),
]
