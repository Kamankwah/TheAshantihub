"""Ghana Post GPS digital-address validation for business registration.

AshantiHub only admits businesses located in the **Ashanti Region**. A Ghana
Post GPS digital address looks like ``AK-039-5028`` — a 2-letter area code, a
3-4 character district code, and a 4-character unique code. The number groups
are not always digits: the owner's screenshot of the GhanaPostGPS app shows a
real Obuasi code, ``AO-T010-3560``, with a letter in the middle group and four
characters in it (``AO`` is Obuasi, ``AK`` Kumasi, ``AM`` Mampong). Whether the
last group ever holds a letter is unverified, so both groups accept letters or
digits rather than risk refusing a real code. The **first letter of the
area code is the region initial**, and Ashanti Region addresses always begin
with ``A`` (no other region uses an A-prefix), so that letter is how we enforce
"Ashanti Region only".

People type the code loosely (``ak 039 5028``, ``AK0395028``, ``ak_039.5028``),
so ``normalize_gps`` drops separators and case before reformatting. It never
replaces one character with another (no reading ``O`` as ``0``): letters are
legitimate in the number groups, so converting would corrupt real codes. A code
is never invented or looked up.

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

GPS_FORMAT = re.compile(r"^[A-Z]{2}-[A-Z0-9]{3,4}-[A-Z0-9]{4}$")
# Separators people type between the groups: whitespace, hyphens (plain, hyphen, en and em dash, minus), underscore,
# dot and slash.
_SEPARATORS = re.compile(r"[\s\-\u2010\u2013\u2014\u2212_./]")
_LOOSE_CODE = re.compile(r"^([A-Z]{2})([A-Z0-9]{7,8})$")
ASHANTI_REGION_LETTER = "A"
# The Ashanti Region as a generous box (a shop near the border must not be refused; a fix from Accra, Tamale or
# a desktop's IP location must). Used by every location-capture path.
ASHANTI_LAT = (5.5, 7.8)
ASHANTI_LNG = (-2.7, -0.5)
GHANA_API_VALIDATE_URL = "https://api.ghana-api.dev/api/v1/addresses/validate/{code}"


def normalize_gps(raw):
    """Return the canonical code (``AK-039-5028`` or ``AK-0395-0285``) when ``raw`` is a code typed loosely, else the
    trimmed upper-case text so the format check rejects it. Only separators and case change; no character is replaced.
    """
    text = str(raw or "").strip().upper()
    match = _LOOSE_CODE.match(_SEPARATORS.sub("", text))
    if not match:
        return text
    area, rest = match.groups()
    cut = 3 if len(rest) == 7 else 4
    return f"{area}-{rest[:cut]}-{rest[cut:]}"


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
    if raw is not None and not isinstance(raw, str):  # a number, list or object is a malformed code, not a crash
        raise serializers.ValidationError("Enter a valid Ghana Post GPS address, e.g. AK-039-5028.")
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
