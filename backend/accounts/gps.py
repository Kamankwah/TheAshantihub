"""Ghana Post GPS digital-address validation for business registration.

AshantiHub only admits businesses located in the **Ashanti Region**. A Ghana
Post GPS digital address looks like ``AK-039-5028`` — a 2-letter area code, a
3-4 digit district code, and a 4-digit unique code. The **first letter of the
area code is the region initial**, and Ashanti Region addresses always begin
with ``A`` (no other region uses an A-prefix), so that letter is how we enforce
"Ashanti Region only".

An optional best-effort call to the public ghana-api.dev validator can also
confirm the code is a *real* Ghana Post address (not just well-formed); it is
gated behind ``settings.GPS_REMOTE_VALIDATION`` (default off) so a flaky/slow
third-party service can never block a legitimate registration, and so the test
suite never makes network calls. The remote validator only returns a validity
boolean — it does NOT return a region — which is why the region rule is the
deterministic first-letter check above.
"""

import re

from django.conf import settings
from rest_framework import serializers

GPS_FORMAT = re.compile(r"^[A-Z]{2}-\d{3,4}-\d{4}$")
ASHANTI_REGION_LETTER = "A"
GHANA_API_VALIDATE_URL = "https://api.ghana-api.dev/api/v1/addresses/validate/{code}"


def normalize_gps(raw):
    return (raw or "").strip().upper()


def remote_is_real(code):
    """Best-effort ghana-api.dev validity check. Returns True/False, or None
    when it couldn't be determined (network error / non-200) — callers must
    treat None as "can't tell, don't block".
    """
    try:
        import requests

        resp = requests.get(GHANA_API_VALIDATE_URL.format(code=code), timeout=4)
        if resp.status_code == 200:
            return bool(resp.json().get("isValid"))
    except Exception:
        return None
    return None


def validate_ashanti_gps(raw):
    """Return the normalized Ghana Post code, or raise
    serializers.ValidationError if it isn't a valid Ashanti Region address.
    """
    code = normalize_gps(raw)
    if not code:
        raise serializers.ValidationError("A Ghana Post GPS address is required.")
    if not GPS_FORMAT.match(code):
        raise serializers.ValidationError(
            "Enter a valid Ghana Post GPS address, e.g. AK-039-5028."
        )
    if code[0] != ASHANTI_REGION_LETTER:
        raise serializers.ValidationError(
            "AshantiHub currently only admits businesses in the Ashanti Region. "
            "Your Ghana Post address must be an Ashanti Region address "
            "(it begins with “A”, e.g. AK-039-5028)."
        )
    if getattr(settings, "GPS_REMOTE_VALIDATION", False):
        real = remote_is_real(code)
        if real is False:
            raise serializers.ValidationError(
                "That Ghana Post GPS address could not be found. "
                "Please check it and re-enter."
            )
    return code
