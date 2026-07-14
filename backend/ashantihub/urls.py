from django.urls import include, path

urlpatterns = [
    path("api/", include("core.urls")),
    path("api/accounts/", include("accounts.urls")),
    path("api/listings/", include("listings.urls")),
    path("api/hero/", include("listings.hero_urls")),
    path("api/billing/", include("billing.urls")),
    path("api/credit/", include("credit.urls")),
]
