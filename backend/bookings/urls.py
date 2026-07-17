from django.urls import path

from . import views

urlpatterns = [
    path("", views.BookingCreateView.as_view(), name="booking-create"),
    path("availability/", views.BookingAvailabilityView.as_view(), name="booking-availability"),
    path("mine/", views.MyBookingsView.as_view(), name="booking-mine"),
    path("incoming/", views.IncomingBookingsView.as_view(), name="booking-incoming"),
    path("<int:pk>/cancel/", views.BookingCancelView.as_view(), name="booking-cancel"),
    path("<int:pk>/check-in/", views.BookingCheckInView.as_view(), name="booking-check-in"),
    path("<int:pk>/check-out/", views.BookingCheckOutView.as_view(), name="booking-check-out"),
]
