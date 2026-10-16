"""How a code reaches a person. Email goes through Django's mail (real only where SMTP is configured, like every
other AshantiHub email). Texts go through settings.OTP_SMS_PROVIDER:

* "simulated" (the default): sends nothing to anyone and keeps nothing; the audit row says "simulated".
* "hubtel": Hubtel SMS through marketing.providers.hubtel_sms (the HUBTEL_SMS_* keys and an Approved Sender ID).
  That client is UNVERIFIED against a live account (see its docstring); only it talks to Hubtel.
* "locmem": keeps each text in `sms_outbox` (settings forces it under `manage.py test`).

A message body holds a code or a reset link, so it is never logged: a failure logs only the provider and the
error type, never with a traceback (a frame's local `body` holds the live code).

deliver() never raises: an unexpected error anywhere below it (a provider bug, a mistyped OTP_SMS_PROVIDER - which
the otp.checks system check also stops at start-up - or an unknown channel) is a failed Delivery, so the caller
counts it (OtpEvent SEND_FAILED) and answers it like any other failed send."""
import logging
from dataclasses import dataclass

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail import send_mail

from .models import EMAIL, SMS

logger = logging.getLogger(__name__)

PROVIDERS = {"locmem", "simulated", "hubtel"}

sms_outbox = []


@dataclass
class Text:
    to: str
    body: str


@dataclass
class Delivery:
    ok: bool
    provider: str
    ref: str = ""


def sms_provider():
    provider = getattr(settings, "OTP_SMS_PROVIDER", "simulated") or "simulated"
    if provider not in PROVIDERS:
        raise ImproperlyConfigured(
            f"OTP_SMS_PROVIDER is {provider!r}; it must be one of {', '.join(sorted(PROVIDERS))}. "
            "Refusing to guess, so no text is sent."
        )
    return provider


def send_sms(to, body):
    provider = sms_provider()
    if provider == "locmem":
        sms_outbox.append(Text(to=to, body=body))
        return Delivery(ok=True, provider="locmem")
    if provider == "hubtel":
        from marketing.providers.base import Message, NotConnected
        from marketing.providers.hubtel_sms import HubtelSmsProvider

        try:
            result = HubtelSmsProvider().send(Message(channel="sms", address=to, body=body))
        except NotConnected:
            logger.warning("OTP text not sent: the Hubtel SMS keys or sender ID are missing")
            return Delivery(ok=False, provider="hubtel")
        if result.state != "sent":
            logger.warning("OTP text not sent: Hubtel answered %s", result.state)
            return Delivery(ok=False, provider="hubtel")
        return Delivery(ok=True, provider="hubtel", ref=result.ref)
    return Delivery(ok=True, provider="simulated")


def send_email(to, subject, body):
    try:
        send_mail(subject=subject, message=body, from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[to], fail_silently=False)
    except Exception as exc:  # the mail server refused or could not be reached
        logger.warning("OTP email not sent: %s", type(exc).__name__)
        return Delivery(ok=False, provider="email")
    return Delivery(ok=True, provider="email")


def _provider_for(channel):
    """The provider name an audit row records for a failed delivery on `channel` ("" when unknown)."""
    if channel == EMAIL:
        return "email"
    if channel == SMS:
        provider = getattr(settings, "OTP_SMS_PROVIDER", "simulated") or "simulated"
        return provider if provider in PROVIDERS else ""
    return ""


def deliver(channel, to, subject, body):
    """Send `body` to `to`; a Delivery whatever happens (never raises - see the module text)."""
    try:
        if channel == SMS:
            return send_sms(to, body)
        if channel == EMAIL:
            return send_email(to, subject, body)
        raise ValueError("unknown channel")
    except Exception as exc:  # noqa: BLE001 - every failure is a counted failed send; only its type is logged
        logger.error("OTP message not sent: %s", type(exc).__name__)
        return Delivery(ok=False, provider=_provider_for(channel))
