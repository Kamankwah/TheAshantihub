"""What Sentry may see of an error (settings.py calls event_scrubber() only
when SENTRY_DSN is set, so it stays inert in dev and tests).

The SDK's default denylist plus the owner-claim secrets: a 500 inside the
claim or password forms must never ship the password confirmation, a raw
claim token or a claim link. Recursive, so a key is scrubbed however deep it
sits in the event."""
import re

from sentry_sdk.scrubber import DEFAULT_DENYLIST, EventScrubber

EXTRA_DENYLIST = [
    "password_confirm", "raw", "token", "claim_link",
    # One-time codes (otp app): request bodies and the step-up header.
    "code", "mfa_token", "recovery_code", "device_token", "step_up_token", "otpauth_uri",
    "x-step-up-token", "x_step_up_token",
    # ...and the local variables that hold them inside otp (frame vars): a message body with the live code
    # (otp.senders), new recovery codes, the authenticator URI and a typed recovery code (otp.authenticator).
    "body", "codes", "uri", "recovery", "normalised",
    # Payout destinations (wallets): a whole MoMo or bank account number in a request body or a frame.
    "account_number",
    # Business money texts (wallets.vendor_texts): the business's whole number in a frame. `to` is deliberately NOT
    # listed: the daily summary's response uses a "to" key (the range end), and scrubbing it would hide a harmless date.
    "phone",
    # Query parameters, in case a failing query's values (the same whole number, as a lookup value) are attached under a
    # key of this name. Not verified: that `params` is the key Sentry's SQL integration uses is an assumption, so this
    # is a best-effort guard, not a guarantee.
    "params",
]


def event_scrubber():
    denylist = list(DEFAULT_DENYLIST)
    denylist += [key for key in EXTRA_DENYLIST if key not in denylist]
    return EventScrubber(denylist=denylist, recursive=True)


_TOKEN_PARAM = re.compile(r"((?:^|[?&])token=)[^&#\s'\"<>]*")
_MAX_VAR_DEPTH = 6


def _redact_text(value):
    return _TOKEN_PARAM.sub(r"\1[Filtered]", value) if isinstance(value, str) else value


def _redact_value(value, depth=0):
    if isinstance(value, str):
        return _redact_text(value)
    if depth >= _MAX_VAR_DEPTH:
        return value
    if isinstance(value, dict):
        return {k: _redact_value(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact_value(v, depth + 1) for v in value]
    return value


def _redact_frame_vars(event):
    """Stack-frame variables (include_local_variables) hold request reprs with
    the full path, ?token= included."""
    for group in ("exception", "threads"):
        try:
            for item in event[group]["values"]:
                try:
                    for frame in item["stacktrace"]["frames"]:
                        try:
                            frame["vars"] = _redact_value(frame["vars"])
                        except Exception:  # noqa: BLE001 — never break error reporting
                            continue
                except Exception:  # noqa: BLE001
                    continue
        except Exception:  # noqa: BLE001
            continue


def redact_claim_token(event, hint=None):
    """before_send / before_send_transaction: the EventScrubber doesn't touch a
    request's URL or query string, so a claim link's ?token= is redacted here
    (string, list-of-pairs and dict query-string forms; missing keys tolerated)."""
    if not isinstance(event, dict):
        return event
    _redact_frame_vars(event)
    request = event.get("request")
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
