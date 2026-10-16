"""Writes the OTP audit trail (otp.models.OtpEvent). Never pass a code, a token or a message body here."""
from django.utils import timezone

from activity.services import client_ip

from .identity import ref
from .models import OtpEvent


def log(kind, *, account=None, purpose="", action="", channel="", destination="", provider="", note="", request=None, now=None):
    account_type, account_id = ref(account) if account is not None else ("", None)
    django_request = getattr(request, "_request", request)
    return OtpEvent.objects.create(
        at=now or timezone.now(), kind=kind, account_type=account_type, account_id=account_id,
        purpose=purpose, action=(action or "")[:30], channel=channel or "", destination=(destination or "")[:254],
        provider=(provider or "")[:20], note=(note or "")[:200],
        ip=client_ip(django_request) if django_request is not None else None,
    )
