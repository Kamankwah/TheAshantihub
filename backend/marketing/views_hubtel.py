"""Hubtel SMS delivery-receipt callback. Public (Hubtel is not a signed-in user), so it is guarded by an unguessable
token in the URL (settings.HUBTEL_SMS_CALLBACK_TOKEN), compared in constant time, and throttled. Hubtel documents
no signature for these receipts that we could find; if it publishes one, verify it here as well.

The payload field names are UNVERIFIED: MessageId / Status / Rate are read in a few spellings, and a body we cannot
read is answered 200 with nothing changed (so Hubtel does not retry forever) but is never treated as delivered."""
import hmac

from django.conf import settings
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import sms_receipts
from .providers.hubtel_sms import _rate


def _pick(data, *names):
    for n in names:
        if isinstance(data, dict) and data.get(n) not in (None, ""):
            return data[n]
    return ""


class HubtelSmsCallbackView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_scope = "hubtel_sms_callback"
    activity_exempt = True

    def post(self, request, token):
        expected = settings.HUBTEL_SMS_CALLBACK_TOKEN
        if getattr(settings, "MARKETING_SMS_PROVIDER", "") != "hubtel" or not expected or not hmac.compare_digest(str(token), str(expected)):
            return Response({"detail": "Not found."}, status=404)
        data = request.data if isinstance(request.data, dict) else {}
        data = data.get("Data") if isinstance(data.get("Data"), dict) else data     # some Hubtel callbacks wrap the body
        result = sms_receipts.apply_receipt(
            str(_pick(data, "MessageId", "messageId", "message_id")), str(_pick(data, "Status", "status", "DeliveryStatus")),
            _rate(_pick(data, "Rate", "rate")),
        )
        return Response({"result": result})
