from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path

urlpatterns = [
    path("api/", include("core.urls")),
    path("api/", include("contact.urls")),
    path("api/accounts/", include("accounts.urls")),
    path("api/activity/", include("activity.urls")),
    path("api/listings/", include("listings.urls")),
    path("api/hero/", include("listings.hero_urls")),
    path("api/billing/", include("billing.urls")),
    path("api/credit/", include("credit.urls")),
    path("api/cart/", include("cart.urls")),
    path("api/orders/", include("orders.urls")),
    path("api/services/", include("services.urls")),
    path("api/bookings/", include("bookings.urls")),
    path("api/events/", include("events.urls")),
    path("api/reviews/", include("reviews.urls")),
    path("api/qa/", include("qa.urls")),
    path("api/disputes/", include("disputes.urls")),
    path("api/messaging/", include("messaging.urls")),
    path("api/payments/", include("payments.urls")),
    path("api/notifications/", include("notifications.urls")),
    path("api/tasks/", include("staff_tasks.urls")),
    path("api/calls/", include("calls.urls")),
    path("api/approvals/", include("approvals.urls")),
    path("api/reports/", include("reports.urls")),
    path("api/fraud/", include("fraud.urls")),
    path("api/field/", include("field.urls")),
    path("api/targets/", include("targets.urls")),
    path("api/portfolio/", include("portfolio.urls")),
    path("api/realtime/", include("realtime.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
