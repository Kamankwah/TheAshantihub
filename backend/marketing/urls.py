from django.urls import include, path

from . import views

urlpatterns = [
    path("overview/", views.OverviewView.as_view(), name="marketing-overview"),
    path("policy/", views.PolicyView.as_view(), name="marketing-policy"),
    path("", include("marketing.urls_insights")),
    path("", include("marketing.urls_consent")),
    path("", include("marketing.urls_banners")),
    path("", include("marketing.urls_promos")),
    path("", include("marketing.urls_campaigns")),
    path("", include("marketing.urls_setup")),
]
