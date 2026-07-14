from django.urls import path

from . import views

urlpatterns = [
    path("mine/", views.OwnerListingCreateListView.as_view(), name="listing-mine-list-create"),
    path("mine/<int:pk>/", views.OwnerListingUpdateView.as_view(), name="listing-mine-update"),
    path("mine/<int:pk>/submit/", views.ListingSubmitView.as_view(), name="listing-submit"),
    path("mine/<int:pk>/photos/", views.ListingPhotoCreateView.as_view(), name="listing-photo-create"),
    path(
        "mine/<int:pk>/photos/<int:photo_id>/",
        views.ListingPhotoDeleteView.as_view(),
        name="listing-photo-delete",
    ),
    path("moderation/pending/", views.ModerationPendingQueueView.as_view(), name="moderation-pending"),
    path("moderation/<int:pk>/", views.ModerationListingDetailView.as_view(), name="moderation-detail"),
    path("moderation/<int:pk>/approve/", views.ModerationApproveView.as_view(), name="moderation-approve"),
    path("moderation/<int:pk>/reject/", views.ModerationRejectView.as_view(), name="moderation-reject"),
    path("hero/pending/", views.HeroPendingQueueView.as_view(), name="hero-moderation-pending"),
    path("hero/<int:pk>/", views.HeroMediaDetailView.as_view(), name="hero-moderation-detail"),
    path("hero/<int:pk>/approve/", views.HeroApproveView.as_view(), name="hero-moderation-approve"),
    path("hero/<int:pk>/reject/", views.HeroRejectView.as_view(), name="hero-moderation-reject"),
    path("categories/", views.CategoryListView.as_view(), name="category-list"),
    path("zones/", views.ZoneListView.as_view(), name="zone-list"),
    path("", views.PublicListingListView.as_view(), name="listing-list"),
    path("<int:pk>/", views.PublicListingDetailView.as_view(), name="listing-detail"),
    path("<int:pk>/related/", views.RelatedListingsView.as_view(), name="listing-related"),
]
