from django.urls import path

from . import views_waivers as v

urlpatterns = [
    path("owner/delivery-promos/", v.OwnerDeliveryPromosView.as_view(), name="marketing-owner-delivery-promos"),
    path("owner/delivery-promos/<int:pk>/<str:action>/", v.OwnerDeliveryPromoActionView.as_view(), name="marketing-owner-delivery-promo-action"),
    path("delivery-promos/", v.StaffDeliveryPromosView.as_view(), name="marketing-delivery-promos"),
    path("delivery-promos/<int:pk>/<str:action>/", v.StaffDeliveryPromoActionView.as_view(), name="marketing-delivery-promo-action"),
]
