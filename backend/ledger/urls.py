from django.urls import path

from . import views, views_bookings

urlpatterns = [
    path("fees/", views.FeeRulesView.as_view(), name="ledger-fees"),
    path("booking-terms/", views.BookingTermsView.as_view(), name="ledger-booking-terms"),
    path("settings/", views.MoneySettingsView.as_view(), name="ledger-settings"),
    path("orders/awaiting-verification/", views.AwaitingVerificationView.as_view(), name="ledger-awaiting-verification"),
    path("orders/<int:pk>/verification/", views.OrderVerificationView.as_view(), name="ledger-order-verification"),
    path("pickup/", views.PickupQueueView.as_view(), name="ledger-pickup"),
    path("pickup/<int:pk>/collected/", views.PickupCollectedView.as_view(), name="ledger-pickup-collected"),
    path("bookings/", views_bookings.BookingLookupView.as_view(), name="ledger-bookings-lookup"),
    path("bookings/awaiting-verification/", views_bookings.AwaitingBookingsView.as_view(), name="ledger-bookings-awaiting"),
    path("bookings/<int:pk>/verification/", views_bookings.BookingVerificationView.as_view(), name="ledger-booking-verification"),
    path("bookings/<int:pk>/report-problem/", views_bookings.BookingReportProblemView.as_view(), name="ledger-booking-report-problem"),
    path("bookings/<int:pk>/cancel/", views_bookings.BookingCancelView.as_view(), name="ledger-booking-cancel"),
]
