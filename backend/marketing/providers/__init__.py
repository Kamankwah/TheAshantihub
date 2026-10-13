"""Outbound message providers (Marketing M3).

One interface, four channels. No SMS or WhatsApp provider is connected: those channels answer "not
connected" and a campaign on them cannot be sent. Setting MARKETING_SMS_PROVIDER=simulated (or
MARKETING_WHATSAPP_PROVIDER=simulated) switches on a clearly-labelled simulated backend that sends
NOTHING to anyone and reports state "simulated", never "delivered". Email goes through Django's mail
(real only when an SMTP server is configured; otherwise it is the log, reported as simulated). In-app
creates a notification in the person's own account."""
from .base import Message, NotConnected, Provider, SendResult  # noqa: F401
from .registry import get_provider, provider_status  # noqa: F401
