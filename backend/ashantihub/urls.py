from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path

urlpatterns = [
    path("api/", include("core.urls")),
    path("api/", include("contact.urls")),
    path("api/accounts/", include("accounts.urls")),
    path("api/listings/", include("listings.urls")),
    path("api/hero/", include("listings.hero_urls")),
    path("api/billing/", include("billing.urls")),
    path("api/credit/", include("credit.urls")),
    path("api/cart/", include("cart.urls")),
    path("api/orders/", include("orders.urls")),
    path("api/events/", include("events.urls")),
    path("api/reviews/", include("reviews.urls")),
    path("api/qa/", include("qa.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
