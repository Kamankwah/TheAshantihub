from django.urls import path

from . import views

urlpatterns = [
    path("opening/", views.OpeningView.as_view(), name="storefront-opening"),
    path("opening/delay/", views.DelayOpeningView.as_view(), name="storefront-opening-delay"),
    path("test-accounts/", views.TestAccountsView.as_view(), name="storefront-test-accounts"),
]
