from django.urls import path

from . import views

urlpatterns = [
    path("", views.ReviewSubmitView.as_view(), name="review-submit"),
    path("eligibility/", views.ReviewEligibilityView.as_view(), name="review-eligibility"),
    path("listing/<int:pk>/", views.ListingReviewListView.as_view(), name="review-list-listing"),
    path("event/<int:pk>/", views.EventReviewListView.as_view(), name="review-list-event"),
    path("seller/<int:pk>/", views.SellerReviewListView.as_view(), name="review-list-seller"),
    path(
        "organizer/business/<int:pk>/",
        views.OrganizerBusinessReviewListView.as_view(),
        name="review-list-organizer-business",
    ),
    path(
        "organizer/customer/<int:pk>/",
        views.OrganizerCustomerReviewListView.as_view(),
        name="review-list-organizer-customer",
    ),
    path("moderation/", views.ReviewModerationListView.as_view(), name="review-moderation-list"),
    path("moderation/<int:pk>/hide/", views.ReviewHideView.as_view(), name="review-hide"),
    path("moderation/<int:pk>/unhide/", views.ReviewUnhideView.as_view(), name="review-unhide"),
]
