"""Ashanti Direct's listing tools at /api/direct/listings/: the owner `mine/` views mounted a second time.

Same path suffixes and methods as /api/listings/mine/..., with `scope="direct"`: the owner is always the company
(accounts.direct.ashanti_direct()), the caller is staff holding `direct.operate`, and a listing of any other business
is a 404. `<pk>/promote/` mirrors /api/listings/<pk>/promote/."""
from django.urls import path

from . import views, views_discounts, views_media, views_revisions

D = {"scope": "direct"}

urlpatterns = [
    path("", views.OwnerListingCreateListView.as_view(**D), name="direct-listing-list-create"),
    path("<int:pk>/", views.OwnerListingUpdateView.as_view(**D), name="direct-listing-update"),
    path("<int:pk>/submit/", views.ListingSubmitView.as_view(**D), name="direct-listing-submit"),
    path("<int:pk>/drop/", views.ListingDropView.as_view(**D), name="direct-listing-drop"),
    path("<int:pk>/restore/", views.ListingRestoreView.as_view(**D), name="direct-listing-restore"),
    path("<int:pk>/discontinue/", views.ListingDiscontinueView.as_view(**D), name="direct-listing-discontinue"),
    path("<int:pk>/restock/", views.ListingRestockView.as_view(**D), name="direct-listing-restock"),
    path("<int:pk>/manage/", views.ListingManageView.as_view(**D), name="direct-listing-manage"),
    path("<int:pk>/variants/", views.ListingVariantListCreateView.as_view(**D), name="direct-listing-variants"),
    path("<int:pk>/variants/<int:vid>/", views.ListingVariantDetailView.as_view(**D), name="direct-listing-variant-detail"),
    path(
        "<int:pk>/variants/<int:vid>/live/", views.ListingVariantLiveView.as_view(**D), name="direct-listing-variant-live",
    ),
    path("<int:pk>/discounts/", views_discounts.ListingDiscountsView.as_view(**D), name="direct-listing-discounts"),
    path(
        "<int:pk>/discounts/end/", views_discounts.ListingDiscountEndView.as_view(**D), name="direct-listing-discount-end",
    ),
    path("<int:pk>/revision/", views_revisions.ListingRevisionView.as_view(**D), name="direct-listing-revision"),
    path(
        "<int:pk>/revision/submit/", views_revisions.ListingRevisionSubmitView.as_view(**D),
        name="direct-listing-revision-submit",
    ),
    path("<int:pk>/photos/", views_media.ListingPhotoCreateView.as_view(**D), name="direct-listing-photo-create"),
    path(
        "<int:pk>/photos/<int:photo_id>/", views_media.ListingPhotoDeleteView.as_view(**D),
        name="direct-listing-photo-delete",
    ),
    path("<int:pk>/videos/", views_media.ListingVideoCreateView.as_view(**D), name="direct-listing-video-create"),
    path(
        "<int:pk>/videos/<int:video_id>/", views_media.ListingVideoDeleteView.as_view(**D),
        name="direct-listing-video-delete",
    ),
    path("<int:pk>/promote/", views.ListingPromoteView.as_view(**D), name="direct-listing-promote"),
]
