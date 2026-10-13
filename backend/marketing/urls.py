from django.urls import path

from . import views

urlpatterns = [
    path("overview/", views.OverviewView.as_view(), name="marketing-overview"),
    path("policy/", views.PolicyView.as_view(), name="marketing-policy"),
    path("", include("marketing.urls_banners")),
]
