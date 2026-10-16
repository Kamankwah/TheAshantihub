from django.urls import path

from . import views, views_staff

urlpatterns = [
    path("staff/wallets/", views_staff.StaffWalletsView.as_view(), name="wallet-staff-wallets"),
    path("", views.WalletView.as_view(), name="wallet"),
    path("transactions/", views.TransactionsView.as_view(), name="wallet-transactions"),
    path("processing/", views.ProcessingView.as_view(), name="wallet-processing"),
    path("top-up/", views.TopUpView.as_view(), name="wallet-top-up"),
]
