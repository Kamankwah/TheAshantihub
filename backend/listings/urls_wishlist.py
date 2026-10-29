from django.urls import path

from . import views_wishlist

urlpatterns = [
    path("", views_wishlist.WishlistView.as_view(), name="wishlist"),
    path("<int:listing_id>/", views_wishlist.WishlistItemView.as_view(), name="wishlist-item"),
]
