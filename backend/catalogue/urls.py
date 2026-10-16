from django.urls import path

from . import views

urlpatterns = [
    path("mine/<int:listing_id>/", views.MineGroupingView.as_view(), name="catalogue-mine"),
    path("mine/<int:listing_id>/requests/", views.MineRequestView.as_view(), name="catalogue-mine-request"),
    path("mine/requests/<int:pk>/withdraw/", views.MineWithdrawView.as_view(), name="catalogue-mine-withdraw"),
]
