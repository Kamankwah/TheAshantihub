from django.urls import path

from . import views

urlpatterns = [
    path("opening/", views.OpeningView.as_view(), name="storefront-opening"),
    path("opening/delay/", views.DelayOpeningView.as_view(), name="storefront-opening-delay"),
    path("test-accounts/", views.TestAccountsView.as_view(), name="storefront-test-accounts"),
    path("notify-me/", views.NotifyMeView.as_view(), name="storefront-notify-me"),
    path("notify-me/stop/", views.NotifyStopView.as_view(), name="storefront-notify-stop"),
    path("deals/", views.DealsView.as_view(), name="storefront-deals"),
    path("search/", views.SearchView.as_view(), name="storefront-search"),
    path("home/", views.HomeFeedView.as_view(), name="storefront-home"),
]
