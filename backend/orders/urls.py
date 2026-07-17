from django.urls import path

from . import views

urlpatterns = [
    path("checkout/", views.OrderCheckoutView.as_view(), name="order-checkout"),
    path("owner/", views.OwnerOrderListView.as_view(), name="order-owner-list"),
    path("staff/", views.OrderStaffListView.as_view(), name="order-staff-list"),
    path("", views.OrderListView.as_view(), name="order-list"),
    path("<int:pk>/", views.OrderDetailView.as_view(), name="order-detail"),
    path(
        "<int:pk>/delivery-status/",
        views.OrderDeliveryStatusUpdateView.as_view(),
        name="order-delivery-status-update",
    ),
    path("<int:pk>/dispute/", views.OrderDisputeCreateView.as_view(), name="order-dispute-create"),
]
