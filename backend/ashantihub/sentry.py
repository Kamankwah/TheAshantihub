"""What Sentry may see of an error (settings.py calls event_scrubber() only
when SENTRY_DSN is set, so it stays inert in dev and tests).

The SDK's default denylist plus the owner-claim secrets: a 500 inside the
claim or password forms must never ship the password confirmation, a raw
claim token or a claim link. Recursive, so a key is scrubbed however deep it
sits in the event."""
import re

from sentry_sdk.scrubber import DEFAULT_DENYLIST, EventScrubber

EXTRA_DENYLIST = ["password_confirm", "raw", "token", "claim_link"]


def event_scrubber():
    denylist = list(DEFAULT_DENYLIST)
    denylist += [key for key in EXTRA_DENYLIST if key not in denylist]
    return EventScrubber(denylist=denylist, recursive=True)


_TOKEN_PARAM = re.compile(r"((?:^|[?&])token=)[^&#]*")


def _redact_text(value):
    return _TOKEN_PARAM.sub(r"\1[Filtered]", value) if isinstance(value, str) else value


def redact_claim_token(event, hint=None):
    """before_send / before_send_transaction: the EventScrubber doesn't touch a
    request's URL or query string, so a claim link's ?token= is redacted here
    (string, list-of-pairs and dict query-string forms; missing keys tolerated)."""
    request = event.get("request") if isinstance(event, dict) else None
    if not isinstance(request, dict):
        return event
    if "url" in request:
        request["url"] = _redact_text(request["url"])
    query = request.get("query_string")
    if isinstance(query, str):
        request["query_string"] = _redact_text(query)
    elif isinstance(query, dict):
        request["query_string"] = {k: "[Filtered]" if k == "token" else v for k, v in query.items()}
    elif isinstance(query, list):
        request["query_string"] = [
            [item[0], "[Filtered]"] if isinstance(item, (list, tuple)) and item and item[0] == "token" else item
            for item in query
        ]
    return event
