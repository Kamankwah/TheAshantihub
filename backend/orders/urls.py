from django.urls import path

from delivery import views_redelivery

from . import support, views

urlpatterns = [
    path("delivery-preview/", views.DeliveryPreviewView.as_view(), name="order-delivery-preview"),
    path("checkout/", views.OrderCheckoutView.as_view(), name="order-checkout"),
    path("owner/", views.OwnerOrderListView.as_view(), name="order-owner-list"),
    path("owner/<int:pk>/tracking/", views.OwnerOrderTrackingView.as_view(), name="owner-order-tracking"),
    path("owner/report/", views.OwnerSalesReportView.as_view(), name="order-owner-report"),
    path("owner/report/export/", views.OwnerSalesReportExportView.as_view(), name="order-owner-report-export"),
    path("staff/", views.OrderStaffListView.as_view(), name="order-staff-list"),
    # Door-to-door delivery (item 11) — before the "<int:pk>/" catch-alls.
    path("delivery/", views.DeliveryManagerOrderListView.as_view(), name="order-delivery-list"),
    path("dispatches/", views.DispatchListView.as_view(), name="order-dispatch-staff-list"),
    path("dispatch/", views.MyDeliveriesView.as_view(), name="order-my-deliveries"),
    path("dispatch/<int:pk>/map/", views.DispatchMapView.as_view(), name="orders-dispatch-map"),
    path("delivery/<int:pk>/pickup/", views.DeliveryPickupView.as_view(), name="delivery-pickup"),
    path("delivery/<int:pk>/deliver/", views.DeliveryDeliverView.as_view(), name="delivery-deliver"),
    path("support/", support.SupportOrderSearchView.as_view(), name="order-support-search"),
    path("support/<int:pk>/", support.SupportOrderDetailView.as_view(), name="order-support-detail"),
    path("<int:pk>/support-status/", support.SupportOrderStatusView.as_view(), name="order-support-status"),
    path("", views.OrderListView.as_view(), name="order-list"),
    path("<int:pk>/", views.OrderDetailView.as_view(), name="order-detail"),
    path("<int:pk>/tracking/", views.OrderTrackingView.as_view(), name="order-tracking"),
    # The customer pays a re-delivery fee (Plan 7F-E Task 7; the view lives with the rules in delivery).
    path("<int:pk>/redelivery/pay/", views_redelivery.RedeliveryPayView.as_view(), name="order-redelivery-pay"),
    path(
        "<int:pk>/delivery-status/",
        views.OrderDeliveryStatusUpdateView.as_view(),
        name="order-delivery-status-update",
    ),
    path("<int:pk>/assign-dispatch/", views.AssignDispatchView.as_view(), name="order-assign-dispatch"),
    path("<int:pk>/confirm-receipt/", views.ConfirmReceiptView.as_view(), name="order-confirm-receipt"),
    path("<int:pk>/dispute/", views.OrderDisputeCreateView.as_view(), name="order-dispute-create"),
]
