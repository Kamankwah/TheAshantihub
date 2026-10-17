from django.urls import path

from . import views, views_staff

urlpatterns = [
    path("mine/<int:listing_id>/", views.MineGroupingView.as_view(), name="catalogue-mine"),
    path("mine/<int:listing_id>/requests/", views.MineRequestView.as_view(), name="catalogue-mine-request"),
    path("mine/requests/<int:pk>/withdraw/", views.MineWithdrawView.as_view(), name="catalogue-mine-withdraw"),
    path("staff/requests/pending/", views_staff.RequestQueueView.as_view(), name="catalogue-staff-queue"),
    path("staff/requests/<int:pk>/", views_staff.RequestDetailView.as_view(), name="catalogue-staff-request"),
    path("staff/requests/<int:pk>/approve/", views_staff.RequestApproveView.as_view(), name="catalogue-staff-approve"),
    path("staff/requests/<int:pk>/reject/", views_staff.RequestRejectView.as_view(), name="catalogue-staff-reject"),
    path("staff/requests/<int:pk>/re-review/", views_staff.RequestReReviewView.as_view(), name="catalogue-staff-re-review"),
    path("staff/listings/<int:pk>/detach/", views_staff.ListingDetachView.as_view(), name="catalogue-staff-detach"),
    path("listings/<int:listing_id>/other-sellers/", views.OtherSellersView.as_view(), name="catalogue-other-sellers"),
]
