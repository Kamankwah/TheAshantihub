from django.urls import path

from . import views

urlpatterns = [
    path("mine/", views.EventMineListView.as_view(), name="event-mine-list"),
    path("submit/", views.EventSubmitView.as_view(), name="event-submit"),
    path("pricing-tiers/", views.EventPricingTierListView.as_view(), name="event-pricing-tier-list"),
    path(
        "pricing-tiers/manage/",
        views.EventPricingTierManageListView.as_view(),
        name="event-pricing-tier-manage-list",
    ),
    path(
        "pricing-tiers/<int:pk>/propose/",
        views.EventPricingTierProposeView.as_view(),
        name="event-pricing-tier-propose",
    ),
    path(
        "pricing-tiers/<int:pk>/approve/",
        views.EventPricingTierApproveView.as_view(),
        name="event-pricing-tier-approve",
    ),
    path(
        "pricing-tiers/<int:pk>/reject/",
        views.EventPricingTierRejectView.as_view(),
        name="event-pricing-tier-reject",
    ),
    path("moderation/pending/", views.EventPendingQueueView.as_view(), name="event-moderation-pending"),
    path("moderation/<int:pk>/", views.EventModerationDetailView.as_view(), name="event-moderation-detail"),
    path(
        "moderation/<int:pk>/approve/", views.EventApproveView.as_view(), name="event-moderation-approve"
    ),
    path(
        "moderation/<int:pk>/re-review/",
        views.EventReReviewView.as_view(),
        name="event-moderation-re-review",
    ),
    path(
        "moderation/<int:pk>/reject/", views.EventRejectView.as_view(), name="event-moderation-reject"
    ),
    path("tickets/mine/", views.MyTicketsListView.as_view(), name="my-tickets"),
    path("tickets/escrow/", views.EscrowLedgerListView.as_view(), name="escrow-ledger"),
    path(
        "tickets/<int:ticket_id>/escrow/release/",
        views.EscrowReleaseView.as_view(),
        name="escrow-release",
    ),
    path(
        "tickets/<int:ticket_id>/escrow/hold/", views.EscrowHoldView.as_view(), name="escrow-hold"
    ),
    path(
        "tickets/<int:ticket_id>/escrow/refund/",
        views.EscrowRefundView.as_view(),
        name="escrow-refund",
    ),
    path("ticket-types/<int:type_id>/", views.EventTicketTypeUpdateView.as_view(), name="event-ticket-type-update"),
    path("", views.EventListView.as_view(), name="event-list"),
    path("<int:pk>/", views.EventDetailView.as_view(), name="event-detail"),
    path("<int:pk>/unlock/", views.EventUnlockView.as_view(), name="event-unlock"),
    path("<int:pk>/media/", views.EventMediaCreateView.as_view(), name="event-media-create"),
    path("<int:pk>/pay/", views.EventPayView.as_view(), name="event-pay"),
    path("<int:pk>/rsvp/", views.EventRSVPView.as_view(), name="event-rsvp"),
    path("<int:pk>/rsvps/", views.EventAttendeesListView.as_view(), name="event-rsvps"),
    path("<int:pk>/ticket-types/", views.EventTicketTypeListCreateView.as_view(), name="event-ticket-types"),
    path(
        "<int:pk>/ticket-types/mine/",
        views.EventTicketTypeMineListView.as_view(),
        name="event-ticket-types-mine",
    ),
    path("<int:pk>/tickets/purchase/", views.TicketPurchaseView.as_view(), name="event-ticket-purchase"),
    path(
        "<int:pk>/tickets/checkin-list/",
        views.EventCheckinListView.as_view(),
        name="event-checkin-list",
    ),
    path("<int:pk>/tickets/checkin/", views.EventCheckinView.as_view(), name="event-checkin"),
]
