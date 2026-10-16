from django.urls import path

from . import views, views_bookings

urlpatterns = [
    path("fees/", views.FeeRulesView.as_view(), name="ledger-fees"),
    path("settings/", views.MoneySettingsView.as_view(), name="ledger-settings"),
    path("orders/awaiting-verification/", views.AwaitingVerificationView.as_view(), name="ledger-awaiting-verification"),
    path("orders/<int:pk>/verification/", views.OrderVerificationView.as_view(), name="ledger-order-verification"),
    path("pickup/", views.PickupQueueView.as_view(), name="ledger-pickup"),
    path("pickup/<int:pk>/collected/", views.PickupCollectedView.as_view(), name="ledger-pickup-collected"),
    path("bookings/awaiting-verification/", views_bookings.AwaitingBookingsView.as_view(), name="ledger-bookings-awaiting"),
    path("bookings/<int:pk>/verification/", views_bookings.BookingVerificationView.as_view(), name="ledger-booking-verification"),
]
