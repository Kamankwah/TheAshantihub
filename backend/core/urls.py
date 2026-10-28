from django.urls import path

from . import settings_views, views

urlpatterns = [
    path("health/", views.health_check, name="health-check"),
    path("core/site-settings/", views.SiteSettingsView.as_view(), name="site-settings"),
    path("core/site-settings/pickup-address/", views.PickupAddressView.as_view(), name="site-settings-pickup-address"),
    path("core/site-settings/history/", views.SiteSettingsHistoryView.as_view(), name="site-settings-history"),
    path("integrations/", settings_views.IntegrationsView.as_view(), name="integrations"),
    path("system-health/", settings_views.SystemHealthView.as_view(), name="system-health"),
    path("payouts-overview/", settings_views.PayoutsOverviewView.as_view(), name="payouts-overview"),
    path("promotion-prices/", settings_views.PromotionPricesView.as_view(), name="promotion-prices"),
    path("core/analytics/", views.AnalyticsOverviewView.as_view(), name="analytics-overview"),
]
