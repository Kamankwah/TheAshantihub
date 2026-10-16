"""The subscription switch. `settings.SUBSCRIPTIONS_ENABLED` (env, default on) turns subscriptions into a product
or pauses them: with it off nothing can be bought, renewed or trialled, plans are hidden, the billing clock stops,
and neither registration nor listing creation depends on a plan. The code and data stay so it can return."""
from django.conf import settings
from rest_framework.response import Response

PAUSED_MESSAGE = "Subscriptions are not being offered right now."


def subscriptions_enabled():
    return bool(settings.SUBSCRIPTIONS_ENABLED)


def paused_response():
    return Response({"detail": PAUSED_MESSAGE, "code": "subscriptions_paused"}, status=409)
