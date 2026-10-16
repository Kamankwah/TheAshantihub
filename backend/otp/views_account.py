"""A signed-in person's own sign-in security (otp plan Task 10).

GET  me/                    -> {"channels": [{"channel", "hint", "verified"}], "authenticator" (null for staff),
                                "trusted_devices": [{"id", "label", "trusted_since", "last_code_at", "last_seen_at"}],
                                "switches": {"sign_in", "step_up", "sign_up"}, "customer_gap_days"}
POST devices/<id>/remove/   -> 204 (404 when it isn't yours or already ended)
POST devices/remove-all/    -> {"removed": n}"""
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from staffsecurity import policy

from . import audit, authenticator, devices, flags
from .identity import STAFF, contacts, hint, ref
from .models import OtpEvent, TrustedDevice, VerifiedContact


class SecurityOverviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        account = request.user
        account_type, account_id = ref(account)
        verified = set(
            VerifiedContact.objects.filter(account_type=account_type, account_id=account_id).values_list("channel", "destination")
        )
        return Response({
            "channels": [
                {"channel": channel, "hint": hint(channel, destination), "verified": (channel, destination) in verified}
                for channel, destination in contacts(account).items()
            ],
            "authenticator": None if account_type == STAFF else authenticator.status(account),
            "trusted_devices": [
                {"id": d.pk, "label": d.label, "trusted_since": d.created_at, "last_code_at": d.verified_at, "last_seen_at": d.last_seen_at}
                for d in devices.live(account)
            ],
            "switches": {"sign_in": flags.sign_in_enforced(), "step_up": flags.step_up_enforced(), "sign_up": flags.sign_up_enforced()},
            "customer_gap_days": policy.otp_customer_gap_days(),
        })


class TrustedDeviceRemoveView(APIView):
    permission_classes = [IsAuthenticated]
    activity_exempt = True

    def post(self, request, pk):
        account_type, account_id = ref(request.user)
        ended = TrustedDevice.objects.filter(
            pk=pk, account_type=account_type, account_id=account_id, revoked_at__isnull=True,
        ).update(revoked_at=timezone.now(), revoked_reason=TrustedDevice.REMOVED)
        if not ended:
            return Response({"detail": "Not found."}, status=404)
        audit.log(OtpEvent.DEVICE_REVOKED, account=request.user, note="1 device: removed", request=request)
        return Response(status=204)


class TrustedDeviceRemoveAllView(APIView):
    permission_classes = [IsAuthenticated]
    activity_exempt = True

    def post(self, request):
        return Response({"removed": devices.revoke_all(request.user, TrustedDevice.REMOVED_ALL, request=request)})
