"""Hubtel SMS provider (Marketing). Used only when MARKETING_SMS_PROVIDER=hubtel.

Hubtel endpoints used (Hubtel's SMS reference is behind its developer portal; what follows is from
Hubtel's published FAQ and its public client libraries, so the exact field names are UNVERIFIED until
exercised against a real account, the same caveat as payments/hubtel_client.py):

* Send:   POST https://smsc.hubtel.com/v1/messages/send   (Hubtel FAQ, "SMS API Management":
          smsc.hubtel.com/v1/messages/send replaces api.hubtel.com/v1/messages/send). HTTP Basic auth with
          the SMS client id and secret. JSON body {From, To, Content, RegisteredDelivery, DeliveryCallbackUrl?};
          the answer carries {MessageId, Status, Rate, NetworkId}. RegisteredDelivery=true asks for a receipt.
* Status: GET https://smsc.hubtel.com/v1/messages/{MessageId}  ("SMS Status Check" in Hubtel's business docs): returns
          the message's current status, taken from the network's delivery receipt, plus its rate. Used to
          reconcile texts whose callback never arrived.
* Callback: Hubtel documents no signature or shared secret for delivery receipts that we could find, so the
          callback URL itself carries an unguessable token (HUBTEL_SMS_CALLBACK_TOKEN) and is
          matched by MessageId. See views_hubtel.py.

Honesty rules: the client id and secret are never logged, put in an error, or returned by any endpoint.
A text is "sent" when Hubtel accepts it and "delivered" only when Hubtel reports a delivery receipt; any
status we do not recognise is stored as-is and counts as neither delivered nor failed."""
import logging
from decimal import Decimal, InvalidOperation

import requests
from django.conf import settings

from .base import CONNECTED, NOT_CONNECTED, Provider, SendResult

logger = logging.getLogger(__name__)

SEND_URL = "https://smsc.hubtel.com/v1/messages/send"
STATUS_URL = "https://smsc.hubtel.com/v1/messages/{message_id}"
TIMEOUT = 15

DELIVERED_WORDS = {"delivered", "delivrd"}
FAILED_WORDS = {"undeliverable", "undelivered", "failed", "rejected", "expired", "deleted", "unknown", "error"}


def http_request(method, url, **kwargs):
    """The one place that touches the network. Tests replace this; nothing else calls Hubtel."""
    return requests.request(method, url, timeout=TIMEOUT, **kwargs)


def classify(status_text):
    """'delivered', 'failed' or '' (still unknown / in flight) from the word Hubtel reported."""
    word = (status_text or "").strip().lower()
    if word in DELIVERED_WORDS:
        return "delivered"
    if word in FAILED_WORDS:
        return "failed"
    return ""


def _auth():
    return (settings.HUBTEL_SMS_CLIENT_ID, settings.HUBTEL_SMS_CLIENT_SECRET)


def to_msisdn(phone):
    """Hubtel wants the international number without a plus: 233241234567. '' when it is not a Ghana mobile."""
    from accounts.phones import phone_key

    key = phone_key(phone)
    return f"233{key}" if key else ""


def callback_url():
    base, token = settings.HUBTEL_SMS_CALLBACK_BASE_URL.rstrip("/"), settings.HUBTEL_SMS_CALLBACK_TOKEN
    return f"{base}/api/marketing/sms/hubtel/callback/{token}/" if base and token else ""


def sender_is_approved():
    """The configured sender ID must be recorded as Approved (on any network) in the Sender IDs register."""
    from ..models_campaigns import SenderId

    name = settings.HUBTEL_SMS_SENDER_ID
    return bool(name) and SenderId.objects.filter(name__iexact=name, status=SenderId.APPROVED).exists()


def _rate(value):
    try:
        return Decimal(str(value)) if value not in (None, "") else None
    except InvalidOperation:
        return None


class HubtelSmsProvider(Provider):
    channel, label, delivery_reports = "sms", "SMS", True

    def configured(self):
        return all([settings.HUBTEL_SMS_CLIENT_ID, settings.HUBTEL_SMS_CLIENT_SECRET, settings.HUBTEL_SMS_SENDER_ID])

    def status(self):
        return CONNECTED if self.configured() else NOT_CONNECTED

    def send(self, message):
        from .base import NotConnected

        if not self.configured():
            raise NotConnected("sms")
        if not sender_is_approved():
            return SendResult(state="failed", error="The sender ID is not recorded as approved, so nothing was sent.")
        to = to_msisdn(message.address)
        if not to:
            return SendResult(state="failed", error="Not a Ghana mobile number.")
        body = {"From": settings.HUBTEL_SMS_SENDER_ID, "To": to, "Content": message.body, "RegisteredDelivery": True}
        cb = callback_url()
        if cb:
            body["DeliveryCallbackUrl"] = cb
        try:
            resp = http_request("POST", SEND_URL, json=body, auth=_auth())
        except requests.RequestException as exc:
            logger.warning("Hubtel SMS request failed: %s", type(exc).__name__)
            return SendResult(state="failed", error="Could not reach Hubtel.")
        try:
            data = resp.json()
        except ValueError:
            data = {}
        if not isinstance(data, dict):
            data = {}
        mid = str(data.get("MessageId") or data.get("messageId") or "")
        code = data.get("Status", data.get("status"))
        if resp.status_code >= 400 or not mid or str(code) not in ("0", "Accepted", "accepted", "Submitted", "submitted", "Sent", "sent"):
            reason = str(data.get("Message") or data.get("message") or data.get("Reason") or "")[:120]
            return SendResult(state="failed", error=f"Hubtel refused it (HTTP {resp.status_code}{', ' + reason if reason else ''}).")
        # Accepted by Hubtel: "sent". Delivery is claimed only later, from a receipt.
        return SendResult(state="sent", ref=mid, cost=_rate(data.get("Rate", data.get("rate"))), provider_status="accepted")

    def fetch_status(self, message_id):
        """(status_word, rate) for a message from Hubtel's status check, or None when Hubtel could not be asked."""
        if not self.configured():
            return None
        try:
            resp = http_request("GET", STATUS_URL.format(message_id=message_id), auth=_auth())
            data = resp.json() if resp.status_code < 400 else {}
        except (requests.RequestException, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        word = str(data.get("status") or data.get("Status") or "")
        return (word, _rate(data.get("rate", data.get("Rate")))) if word else None
