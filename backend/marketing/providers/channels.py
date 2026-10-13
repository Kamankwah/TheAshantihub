import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

from .base import CONNECTED, NOT_CONNECTED, SIMULATED, Provider, SendResult

logger = logging.getLogger(__name__)


class _OutboundOnly(Provider):
    """SMS and WhatsApp: no real provider exists. The only thing that can be switched on is the simulated backend."""

    setting = ""

    def status(self):
        return SIMULATED if getattr(settings, self.setting, "") == "simulated" else NOT_CONNECTED

    def send(self, message):
        from .base import NotConnected

        if self.status() != SIMULATED:
            raise NotConnected(self.channel)
        # Simulated: no network call, no delivery claimed.
        return SendResult(state="simulated")


class SmsProvider(_OutboundOnly):
    channel, label, setting = "sms", "SMS", "MARKETING_SMS_PROVIDER"


class WhatsAppProvider(_OutboundOnly):
    channel, label, setting = "whatsapp", "WhatsApp", "MARKETING_WHATSAPP_PROVIDER"


class EmailProvider(Provider):
    channel, label = "email", "Email"

    def status(self):
        real = settings.EMAIL_BACKEND.endswith("smtp.EmailBackend") and bool(settings.EMAIL_HOST)
        return CONNECTED if real else SIMULATED     # otherwise mail is only written to the server log

    def send(self, message):
        text = f"{message.body}\n\n--\nAshantiHub. Stop these emails: {message.unsubscribe_url}\n"
        mail = EmailMultiAlternatives(message.subject or "News from AshantiHub", text, settings.DEFAULT_FROM_EMAIL, [message.address])
        if message.unsubscribe_url:
            mail.extra_headers["List-Unsubscribe"] = f"<{message.unsubscribe_url}>"
            mail.extra_headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
        try:
            mail.send(fail_silently=False)
        except Exception as exc:      # the mail server refused or could not be reached
            logger.warning("Marketing email failed: %s", exc)
            return SendResult(state="failed", error=str(exc)[:200])
        return SendResult(state="sent" if self.status() == CONNECTED else "simulated")


class InAppProvider(Provider):
    channel, label = "inapp", "In-app"

    def status(self):
        return CONNECTED

    def send(self, message):
        from accounts.models import Customer
        from notifications.services import notify_business_owner, notify_customer

        notify = notify_customer if isinstance(message.recipient, Customer) else notify_business_owner
        row = notify(message.recipient, "marketing_offer", message.subject or "From AshantiHub", body=message.body, link="/my-account", icon="🎁")
        if row is None:
            return SendResult(state="failed", error="Could not create the notice.")
        return SendResult(state="sent", ref=str(row.pk))
