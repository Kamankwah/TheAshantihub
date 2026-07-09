from django.urls import path

from . import views

urlpatterns = [
    path("mine/<int:pk>/photos/", views.ListingPhotoCreateView.as_view(), name="listing-photo-create"),
    path(
        "mine/<int:pk>/photos/<int:photo_id>/",
        views.ListingPhotoDeleteView.as_view(),
        name="listing-photo-delete",
    ),
]
