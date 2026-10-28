from django.urls import path

from . import oversight, views, views_confirm

urlpatterns = [
    # The owner's side of a texted confirmation link. Public; POST only so the token never lands in an access log.
    path("confirm/preview/", views_confirm.ConfirmPreviewView.as_view(), name="portfolio-confirm-preview"),
    path("confirm/decline/", views_confirm.ConfirmDeclineView.as_view(), name="portfolio-confirm-decline"),
    path("confirm/", views_confirm.ConfirmView.as_view(), name="portfolio-confirm"),
    path("register/check/", views.RegisterCheckView.as_view(), name="portfolio-register-check"),
    path("register/", views.RegisterBusinessView.as_view(), name="portfolio-register"),
    path("businesses/<int:pk>/kyc/", views.KycResubmitView.as_view(), name="portfolio-kyc-resubmit"),
    path("businesses/<int:pk>/handover/", views.HandoverView.as_view(), name="portfolio-handover"),
    path("businesses/<int:pk>/claim-link/", views.ClaimLinkView.as_view(), name="portfolio-claim-link"),
    path("businesses/", views.PortfolioListView.as_view(), name="portfolio-business-list"),
    path("businesses/counts/", oversight.BusinessCountsView.as_view(), name="portfolio-business-counts"),
    path("businesses/export/", oversight.BusinessExportView.as_view(), name="portfolio-business-export"),
    path("businesses/<int:pk>/oversight/", oversight.BusinessOversightView.as_view(), name="portfolio-business-oversight"),
    path("businesses/<int:pk>/", views.PortfolioBusinessDetailView.as_view(), name="portfolio-business-detail"),
    path("businesses/<int:pk>/hours/", views.BusinessHoursStaffView.as_view(), name="portfolio-business-hours"),
    path("businesses/<int:pk>/orders/", views.BusinessOrdersView.as_view(), name="portfolio-business-orders"),
    path(
        "businesses/<int:pk>/orders/<int:order_id>/delivery-problem/",
        views.DeliveryProblemView.as_view(), name="portfolio-delivery-problem",
    ),
    path("businesses/<int:pk>/reveal-phone/", views.RevealOwnerPhoneView.as_view(), name="portfolio-business-reveal-phone"),
    path("businesses/<int:pk>/review/", views.BusinessReviewView.as_view(), name="portfolio-business-review"),
    path("businesses/<int:pk>/reassign/", views.ReassignBusinessView.as_view(), name="portfolio-reassign"),
    path("businesses/<int:pk>/follow-up/", views.BusinessFollowUpView.as_view(), name="portfolio-follow-up"),
    path("leaderboard/", views.LeaderboardView.as_view(), name="portfolio-leaderboard"),
    path("subscriptions-due/", views.SubscriptionsDueView.as_view(), name="portfolio-subscriptions-due"),
    path("businesses/<int:pk>/drafts/", views.DraftListCreateView.as_view(), name="portfolio-drafts"),
    path("businesses/<int:pk>/drafts/send/", views.DraftSendView.as_view(), name="portfolio-drafts-send"),
    path("businesses/<int:pk>/drafts/<int:draft_id>/", views.DraftDetailView.as_view(), name="portfolio-draft-detail"),
    path(
        "businesses/<int:pk>/drafts/<int:draft_id>/resend/", views.DraftResendView.as_view(),
        name="portfolio-draft-resend",
    ),
    path(
        "businesses/<int:pk>/drafts/<int:draft_id>/submit/", views.DraftSubmitView.as_view(),
        name="portfolio-draft-submit",
    ),
    path(
        "businesses/<int:pk>/confirmation/registration/", views.RegistrationConfirmationView.as_view(),
        name="portfolio-registration-confirmation",
    ),
    path("businesses/<int:pk>/photos/", views.PhotoStageView.as_view(), name="portfolio-photo-stage"),
    path("businesses/<int:pk>/changes/", views.ProposeChangeView.as_view(), name="portfolio-propose-change"),
    path("businesses/<int:pk>/listings/", views.ProposeListingView.as_view(), name="portfolio-propose-listing"),
    path("listings/<int:pk>/photos/", views.ProposeListingPhotosView.as_view(), name="portfolio-propose-photos"),
    path("meta/listing-form/", views.ListingFormMetaView.as_view(), name="portfolio-listing-form-meta"),
    path("owner/changes/", views.OwnerChangeListView.as_view(), name="portfolio-owner-changes"),
    path("detail-changes/", views.DetailChangeListView.as_view(), name="portfolio-detail-changes"),
    path("detail-changes/mine/", views.MyDetailChangesView.as_view(), name="portfolio-detail-changes-mine"),
    path(
        "detail-changes/<int:pk>/assign/", views.DetailChangeAssignView.as_view(), name="portfolio-detail-change-assign",
    ),
    path(
        "detail-changes/<int:pk>/verify/", views.DetailChangeVerifyView.as_view(), name="portfolio-detail-change-verify",
    ),
    path("owner/changes/<int:pk>/undo/", views.OwnerChangeUndoView.as_view(), name="portfolio-owner-change-undo"),
]
