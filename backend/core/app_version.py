"""Minimum supported mobile app version (review MOB-01).

A mobile build cannot be hot-fixed on demand (store review takes hours to days), so the server can refuse builds that
are too old. The app sends `X-Client: mobile` and `X-App-Version: <semver>`; when `MOBILE_MIN_VERSION` is set, a mobile
request below it gets `426 {"code": "upgrade_required", "min_supported_version", "store_url"}` and the app shows an
"update required" screen. A build that sends no version predates this check and counts as 0.0.0, so setting the minimum
also retires those builds. Unset (the default) disables the gate. Web, staff and webhook traffic is never touched.
"""
import re

from django.conf import settings
from django.http import JsonResponse

CLIENT_HEADER = "HTTP_X_CLIENT"
VERSION_HEADER = "HTTP_X_APP_VERSION"
# The service must keep answering for uptime checks and so a blocked app can still learn what to do.
EXEMPT_PREFIXES = ("/health", "/api/core/health", "/api/payments/webhooks/", "/static/", "/media/")


def parse_version(value):
    """(major, minor, patch) from '1.2.3' or '1.2' (extra suffixes such as '-rc1' ignored); None when unreadable."""
    match = re.match(r"^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?", value or "")
    if not match:
        return None
    return tuple(int(part or 0) for part in match.groups())


def is_too_old(version_header, minimum):
    """True when `version_header` is below `minimum`; a missing or unreadable version counts as 0.0.0."""
    floor = parse_version(minimum)
    if floor is None:
        return False
    return (parse_version(version_header) or (0, 0, 0)) < floor


class MobileMinVersionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        minimum = getattr(settings, "MOBILE_MIN_VERSION", "")
        if (
            minimum
            and request.META.get(CLIENT_HEADER, "").lower() == "mobile"
            and not request.path.startswith(EXEMPT_PREFIXES)
            and is_too_old(request.META.get(VERSION_HEADER, ""), minimum)
        ):
            return JsonResponse(
                {
                    "code": "upgrade_required",
                    "detail": "This version of the AshantiHub app is no longer supported. Please update to continue.",
                    "min_supported_version": minimum,
                    "store_url": getattr(settings, "MOBILE_STORE_URL", ""),
                },
                status=426,
            )
        return self.get_response(request)
