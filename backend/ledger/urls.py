from django.urls import path

from . import views

urlpatterns = [
    path("fees/", views.FeeRulesView.as_view(), name="ledger-fees"),
    path("settings/", views.MoneySettingsView.as_view(), name="ledger-settings"),
]
