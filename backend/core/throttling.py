"""Throttling that holds across server processes and never takes the API down with it.

DRF's stock ``ScopedRateThrottle`` counts in the process-local default cache, so with several gunicorn workers a limit
of 5/min is really 5/min *per worker* and resets on every restart. This subclass counts in the ``throttle`` cache
(Redis in production, see settings.CACHES) and **fails open**: if the cache is unreachable the request is allowed and a
warning is logged, because a cache outage must not become a full login/checkout outage. The caller's address comes
from DRF's ``NUM_PROXIES`` setting (the last ``X-Forwarded-For`` entry, which is the one nginx appends and a client
cannot forge), not from the whole client-supplied header.
"""
import logging

from django.core.cache import caches
from rest_framework.throttling import ScopedRateThrottle

logger = logging.getLogger(__name__)


class ClusterScopedRateThrottle(ScopedRateThrottle):
    cache = caches["throttle"]

    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)
        except Exception:  # a broken cache must not break sign-in; the miss is visible in the logs and Sentry
            logger.warning("throttle cache unavailable; allowing request", exc_info=True)
            return True
