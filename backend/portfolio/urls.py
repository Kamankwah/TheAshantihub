from django.urls import path

from . import views

urlpatterns = [
    path("register/check/", views.RegisterCheckView.as_view(), name="portfolio-register-check"),
    path("register/", views.RegisterBusinessView.as_view(), name="portfolio-register"),
    path("businesses/<int:pk>/kyc/", views.KycResubmitView.as_view(), name="portfolio-kyc-resubmit"),
    path("businesses/<int:pk>/handover/", views.HandoverView.as_view(), name="portfolio-handover"),
    path("businesses/<int:pk>/claim-link/", views.ClaimLinkView.as_view(), name="portfolio-claim-link"),
    path("businesses/", views.PortfolioListView.as_view(), name="portfolio-business-list"),
    path("businesses/<int:pk>/", views.PortfolioBusinessDetailView.as_view(), name="portfolio-business-detail"),
    path("businesses/<int:pk>/orders/", views.BusinessOrdersView.as_view(), name="portfolio-business-orders"),
    path(
        "businesses/<int:pk>/orders/<int:order_id>/delivery-problem/",
        views.DeliveryProblemView.as_view(), name="portfolio-delivery-problem",
    ),
    path("businesses/<int:pk>/review/", views.BusinessReviewView.as_view(), name="portfolio-business-review"),
    path("businesses/<int:pk>/reassign/", views.ReassignBusinessView.as_view(), name="portfolio-reassign"),
    path("businesses/<int:pk>/follow-up/", views.BusinessFollowUpView.as_view(), name="portfolio-follow-up"),
    path("leaderboard/", views.LeaderboardView.as_view(), name="portfolio-leaderboard"),
    path("subscriptions-due/", views.SubscriptionsDueView.as_view(), name="portfolio-subscriptions-due"),
    path("businesses/<int:pk>/photos/", views.PhotoStageView.as_view(), name="portfolio-photo-stage"),
    path("businesses/<int:pk>/changes/", views.ProposeChangeView.as_view(), name="portfolio-propose-change"),
    path("businesses/<int:pk>/listings/", views.ProposeListingView.as_view(), name="portfolio-propose-listing"),
    path("listings/<int:pk>/photos/", views.ProposeListingPhotosView.as_view(), name="portfolio-propose-photos"),
    path("meta/listing-form/", views.ListingFormMetaView.as_view(), name="portfolio-listing-form-meta"),
    path("owner/changes/", views.OwnerChangeListView.as_view(), name="portfolio-owner-changes"),
    path("owner/changes/<int:pk>/undo/", views.OwnerChangeUndoView.as_view(), name="portfolio-owner-change-undo"),
]
