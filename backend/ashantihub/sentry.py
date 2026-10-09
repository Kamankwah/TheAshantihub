"""What Sentry may see of an error (settings.py calls event_scrubber() only
when SENTRY_DSN is set, so it stays inert in dev and tests).

The SDK's default denylist plus the owner-claim secrets: a 500 inside the
claim or password forms must never ship the password confirmation, a raw
claim token or a claim link. Recursive, so a key is scrubbed however deep it
sits in the event."""
from sentry_sdk.scrubber import DEFAULT_DENYLIST, EventScrubber

EXTRA_DENYLIST = ["password_confirm", "raw", "token", "claim_link"]


def event_scrubber():
    denylist = list(DEFAULT_DENYLIST)
    denylist += [key for key in EXTRA_DENYLIST if key not in denylist]
    return EventScrubber(denylist=denylist, recursive=True)
