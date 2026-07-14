from django.urls import path

from . import views

urlpatterns = [
    path("checkout/", views.OrderCheckoutView.as_view(), name="order-checkout"),
    path("", views.OrderListView.as_view(), name="order-list"),
    path("<int:pk>/", views.OrderDetailView.as_view(), name="order-detail"),
]
