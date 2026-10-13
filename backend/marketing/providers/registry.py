from django.conf import settings

from . import channels
from .base import CONNECTED, NOT_CONNECTED, SIMULATED


def get_provider(channel):
    if channel == "sms" and getattr(settings, "MARKETING_SMS_PROVIDER", "") == "hubtel":
        from .hubtel_sms import HubtelSmsProvider

        return HubtelSmsProvider()
    return {
        "sms": channels.SmsProvider, "whatsapp": channels.WhatsAppProvider, "email": channels.EmailProvider, "inapp": channels.InAppProvider,
    }[channel]()


def provider_status(channel):
    """{"status", "label", "note"} for the channel, worked out from settings. Reaches no provider."""
    provider = get_provider(channel)
    status = provider.status()
    notes = {
        CONNECTED: "Connected to Hubtel. Delivery is shown only where Hubtel reports it." if channel == "sms" and provider.delivery_reports else "",
        SIMULATED: "Simulated: nothing is sent to anyone. Messages are only recorded here.",
        NOT_CONNECTED: (f"{provider.label} is set to Hubtel but its keys or sender ID are missing, so nothing can be sent." if getattr(settings, "MARKETING_SMS_PROVIDER", "") == "hubtel" and channel == "sms" else f"{provider.label} is not connected, so nothing can be sent."),
    }
    return {"status": status, "label": provider.label, "note": notes[status], "delivery_reports": provider.delivery_reports}
