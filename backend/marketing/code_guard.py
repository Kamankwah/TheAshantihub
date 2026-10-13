"""Failed coupon lookups are counted per signed-in customer and per address; past the limit the
quote and checkout answer 429 before looking the code up at all, so a code cannot be guessed."""
from django.core.cache import cache

from activity.services import client_ip

LIMIT = 10
WINDOW = 10 * 60


def _keys(request):
    ip = client_ip(request) or "unknown"
    return [f"mk-code-fail-user-{request.user.pk}", f"mk-code-fail-ip-{ip}"]


def blocked(request):
    return any(cache.get(k, 0) >= LIMIT for k in _keys(request))


def record_failure(request):
    for k in _keys(request):
        cache.add(k, 0, WINDOW)
        try:
            cache.incr(k)
        except ValueError:
            cache.set(k, 1, WINDOW)


TOO_MANY = "Too many codes tried. Wait a few minutes and try again."
