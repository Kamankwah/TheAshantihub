from django.conf import settings

from . import channels
from .base import CONNECTED, NOT_CONNECTED, SIMULATED


def get_provider(channel):
    return {
        "sms": channels.SmsProvider, "whatsapp": channels.WhatsAppProvider, "email": channels.EmailProvider, "inapp": channels.InAppProvider,
    }[channel]()


def provider_status(channel):
    """{"status", "label", "note"} for the channel, worked out from settings. Reaches no provider."""
    provider = get_provider(channel)
    status = provider.status()
    notes = {
        CONNECTED: "",
        SIMULATED: "Simulated: nothing is sent to anyone. Messages are only recorded here.",
        NOT_CONNECTED: f"{provider.label} is not connected, so nothing can be sent.",
    }
    return {"status": status, "label": provider.label, "note": notes[status], "delivery_reports": provider.delivery_reports}
