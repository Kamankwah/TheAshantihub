from django.urls import path

from . import views

urlpatterns = [path("ticket/", views.RealtimeTicketView.as_view(), name="realtime-ticket")]
