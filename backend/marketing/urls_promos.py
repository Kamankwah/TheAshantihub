from django.urls import path

from . import views_promos as v

urlpatterns = [
    path("flash-sales/", v.FlashSaleListCreateView.as_view(), name="marketing-flash-sales"),
    path("flash-sales/eligible/", v.FlashSaleEligibleView.as_view(), name="marketing-flash-eligible"),
    path("flash-sales/<int:pk>/", v.FlashSaleDetailView.as_view(), name="marketing-flash-sale"),
    path("flash-sales/<int:pk>/listings/", v.FlashSaleListingsView.as_view(), name="marketing-flash-sale-listings"),
    path("flash-sales/<int:pk>/listings/<int:listing_id>/", v.FlashSaleListingsView.as_view(), name="marketing-flash-sale-listing"),
    path("flash-sales/<int:pk>/ask/", v.FlashSaleAskView.as_view(), name="marketing-flash-sale-ask"),
    path("flash-sales/<int:pk>/end/", v.FlashSaleEndView.as_view(), name="marketing-flash-sale-end"),
    path("flash-sales/<int:pk>/cancel/", v.FlashSaleCancelView.as_view(), name="marketing-flash-sale-cancel"),
    path("owner/flash-sales/", v.OwnerFlashInvitationsView.as_view(), name="marketing-owner-flash-sales"),
    path("owner/flash-sales/<int:pk>/respond/", v.OwnerFlashRespondView.as_view(), name="marketing-owner-flash-respond"),
    path("coupons/", v.CouponListCreateView.as_view(), name="marketing-coupons"),
    path("coupons/<int:pk>/", v.CouponDetailView.as_view(), name="marketing-coupon"),
    path("coupons/<int:pk>/<str:action>/", v.CouponActionView.as_view(), name="marketing-coupon-action"),
    path("promos/public/", v.PublicPromosView.as_view(), name="marketing-promos-public"),
    path("cart/quote/", v.CartQuoteView.as_view(), name="marketing-cart-quote"),
]
