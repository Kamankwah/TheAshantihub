"""Per-account sign-in lockout (OWASP ASVS 2.2.1).

The IP throttle (core.throttling) slows one address; this stops a *distributed* guess against one account. After
``MAX_FAILURES`` wrong passwords for the same identifier inside ``WINDOW_SECONDS`` the account refuses further sign-ins
for the rest of that window with HTTP 429, whatever the password. A correct sign-in clears the count.

Trade-off, accepted: a stranger who knows an identifier can lock it for up to 15 minutes. The owner can still reset the
password by email or use the code sign-in, so a lockout is an inconvenience, not a takeover. The count lives in the
shared ``throttle`` cache and fails open if that cache is down, so an outage never blocks every sign-in.
"""
import hashlib
import logging

from django.core.cache import caches
from rest_framework.exceptions import Throttled

logger = logging.getLogger(__name__)

MAX_FAILURES = 10
WINDOW_SECONDS = 15 * 60


def _key(kind, identifier):
    digest = hashlib.sha256((identifier or "").strip().lower().encode()).hexdigest()[:32]
    return f"signin-fail:{kind}:{digest}"


def check(kind, identifier):
    """Raise ``Throttled`` if this identifier is currently locked."""
    try:
        failures = caches["throttle"].get(_key(kind, identifier), 0)
    except Exception:
        logger.warning("lockout cache unavailable; not enforcing", exc_info=True)
        return
    if failures >= MAX_FAILURES:
        raise Throttled(wait=WINDOW_SECONDS, detail="Too many failed sign-in attempts. Try again in 15 minutes or reset your password.")


def record_failure(kind, identifier):
    cache = caches["throttle"]
    key = _key(kind, identifier)
    try:
        cache.add(key, 0, WINDOW_SECONDS)  # starts the window only on the first failure
        cache.incr(key)
    except Exception:
        logger.warning("lockout cache unavailable; failure not counted", exc_info=True)


def clear(kind, identifier):
    try:
        caches["throttle"].delete(_key(kind, identifier))
    except Exception:
        logger.warning("lockout cache unavailable; count not cleared", exc_info=True)
