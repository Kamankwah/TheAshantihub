from django.urls import path

from . import views

urlpatterns = [
    path("", views.CartMeView.as_view(), name="cart-me"),
    path("items/", views.CartItemCreateView.as_view(), name="cart-item-create"),
    path("items/bulk/", views.CartItemBulkAddView.as_view(), name="cart-item-bulk"),
    path("guard/", views.CartGuardView.as_view(), name="cart-guard"),
    path("items/<int:pk>/", views.CartItemUpdateDeleteView.as_view(), name="cart-item-detail"),
]
