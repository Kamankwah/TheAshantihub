from django.urls import path

from . import customers, disputes, events, listings, orders

urlpatterns = [
    path("customers/", customers.CustomerListView.as_view(), name="marketplace-customers"),
    path("customers/counts/", customers.CustomerCountsView.as_view(), name="marketplace-customer-counts"),
    path("customers/export/", customers.CustomerExportView.as_view(), name="marketplace-customer-export"),
    path("customers/<int:pk>/", customers.CustomerDetailView.as_view(), name="marketplace-customer"),
    path("customers/<int:pk>/reveal-phone/", customers.CustomerRevealPhoneView.as_view(), name="marketplace-customer-reveal-phone"),
    path("listings/", listings.ListingListView.as_view(), name="marketplace-listings"),
    path("listings/counts/", listings.ListingCountsView.as_view(), name="marketplace-listing-counts"),
    path("listings/export/", listings.ListingExportView.as_view(), name="marketplace-listing-export"),
    path("listings/<int:pk>/history/", listings.ListingHistoryView.as_view(), name="marketplace-listing-history"),
    path("orders/", orders.OrderListView.as_view(), name="marketplace-orders"),
    path("orders/counts/", orders.OrderCountsView.as_view(), name="marketplace-order-counts"),
    path("orders/export/", orders.OrderExportView.as_view(), name="marketplace-order-export"),
    path("orders/<int:pk>/", orders.OrderDetailView.as_view(), name="marketplace-order"),
    path("events/", events.EventListView.as_view(), name="marketplace-events"),
    path("events/counts/", events.EventCountsView.as_view(), name="marketplace-event-counts"),
    path("events/export/", events.EventExportView.as_view(), name="marketplace-event-export"),
    path("disputes/", disputes.DisputeListView.as_view(), name="marketplace-disputes"),
    path("disputes/counts/", disputes.DisputeCountsView.as_view(), name="marketplace-dispute-counts"),
    path("disputes/export/", disputes.DisputeExportView.as_view(), name="marketplace-dispute-export"),
]
