from django.urls import path

from . import views, views_payouts, views_staff

urlpatterns = [
    path("staff/wallets/", views_staff.StaffWalletsView.as_view(), name="wallet-staff-wallets"),
    path("", views.WalletView.as_view(), name="wallet"),
    path("transactions/", views.TransactionsView.as_view(), name="wallet-transactions"),
    path("processing/", views.ProcessingView.as_view(), name="wallet-processing"),
    path("top-up/", views.TopUpView.as_view(), name="wallet-top-up"),
    path("destinations/", views_payouts.DestinationsView.as_view(), name="wallet-destinations"),
    path("destinations/<int:pk>/remove/", views_payouts.DestinationRemoveView.as_view(), name="wallet-destination-remove"),
    path("withdrawals/", views_payouts.WithdrawalsView.as_view(), name="wallet-withdrawals"),
    path("withdrawals/<int:pk>/cancel/", views_payouts.WithdrawalCancelView.as_view(), name="wallet-withdrawal-cancel"),
]
