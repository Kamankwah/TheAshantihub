from django.urls import path

from . import views, views_payouts, views_staff, views_vendor

urlpatterns = [
    path("staff/wallets/", views_staff.StaffWalletsView.as_view(), name="wallet-staff-wallets"),
    path("staff/withdrawals/", views_staff.StaffWithdrawalsView.as_view(), name="wallet-staff-withdrawals"),
    path("staff/withdrawals/<int:pk>/fail/", views_staff.StaffWithdrawalFailView.as_view(), name="wallet-staff-withdrawal-fail"),
    path("staff/reconciliation/", views_staff.StaffReconciliationView.as_view(), name="wallet-staff-reconciliation"),
    path("vendor/", views_vendor.VendorOverviewView.as_view(), name="wallet-vendor"),
    path("vendor/sales/", views_vendor.VendorSalesView.as_view(), name="wallet-vendor-sales"),
    path("vendor/daily/", views_vendor.VendorDailyView.as_view(), name="wallet-vendor-daily"),
    path("", views.WalletView.as_view(), name="wallet"),
    path("transactions/", views.TransactionsView.as_view(), name="wallet-transactions"),
    path("processing/", views.ProcessingView.as_view(), name="wallet-processing"),
    path("top-up/", views.TopUpView.as_view(), name="wallet-top-up"),
    path("destinations/", views_payouts.DestinationsView.as_view(), name="wallet-destinations"),
    path("destinations/<int:pk>/remove/", views_payouts.DestinationRemoveView.as_view(), name="wallet-destination-remove"),
    path("withdrawals/", views_payouts.WithdrawalsView.as_view(), name="wallet-withdrawals"),
    path("withdrawals/<int:pk>/cancel/", views_payouts.WithdrawalCancelView.as_view(), name="wallet-withdrawal-cancel"),
]
