from django.urls import path

from . import views

urlpatterns = [
    path("checkout/", views.OrderCheckoutView.as_view(), name="order-checkout"),
    path("owner/", views.OwnerOrderListView.as_view(), name="order-owner-list"),
    path("owner/report/", views.OwnerSalesReportView.as_view(), name="order-owner-report"),
    path("owner/report/export/", views.OwnerSalesReportExportView.as_view(), name="order-owner-report-export"),
    path("staff/", views.OrderStaffListView.as_view(), name="order-staff-list"),
    # Door-to-door delivery (item 11) — before the "<int:pk>/" catch-alls.
    path("delivery/", views.DeliveryManagerOrderListView.as_view(), name="order-delivery-list"),
    path("dispatches/", views.DispatchListView.as_view(), name="order-dispatch-staff-list"),
    path("dispatch/", views.MyDeliveriesView.as_view(), name="order-my-deliveries"),
    path("delivery/<int:pk>/pickup/", views.DeliveryPickupView.as_view(), name="delivery-pickup"),
    path("delivery/<int:pk>/deliver/", views.DeliveryDeliverView.as_view(), name="delivery-deliver"),
    path("", views.OrderListView.as_view(), name="order-list"),
    path("<int:pk>/", views.OrderDetailView.as_view(), name="order-detail"),
    path(
        "<int:pk>/delivery-status/",
        views.OrderDeliveryStatusUpdateView.as_view(),
        name="order-delivery-status-update",
    ),
    path("<int:pk>/assign-dispatch/", views.AssignDispatchView.as_view(), name="order-assign-dispatch"),
    path("<int:pk>/confirm-receipt/", views.ConfirmReceiptView.as_view(), name="order-confirm-receipt"),
    path("<int:pk>/dispute/", views.OrderDisputeCreateView.as_view(), name="order-dispute-create"),
]
