from django.urls import path

from . import views

urlpatterns = [
    path("webhook/hubtel/", views.HubtelWebhookView.as_view(), name="hubtel-webhook"),
    path(
        "checkout-sessions/<str:reference>/",
        views.CheckoutSessionStatusView.as_view(),
        name="checkout-session-status",
    ),
]
