"""Ledger staff API: the fee rules and money settings in force, and proposals to change them
(maker-checker through the approvals engine)."""
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasAnyRolePermission, HasRolePermission
from approvals import services as approvals
from approvals.models import ApprovalRequest
from orders.models import Order

from . import escrow, fees, settings_store, verification
from .approval_kinds import CATEGORY_LABELS, FEE_RULES_KEY, SETTING_KEY, bands_as_dicts, effective_time
from .models import FeeRuleSet, Journal, MoneySetting

VIEW, MANAGE = "fees.view", "fees.manage"


def _submit(request, kind_key, **kwargs):
    try:
        approval = approvals.submit(request.user, kind_key, request=request, **kwargs)
    except approvals.ApprovalError as exc:
        return Response({"detail": exc.message}, status=exc.status_code)
    return Response({"approval_id": approval.pk, "status": approval.status}, status=status.HTTP_201_CREATED)


class FeeRulesView(APIView):
    """GET fees/ — the rules in force per category, the proposals waiting and recent history.
    POST fees/ {category, bands, effective_from?, note?} — propose a new ladder."""

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission(MANAGE)]
        return [HasAnyRolePermission(VIEW, MANAGE)]

    def get(self, request):
        current = []
        for category, label in FeeRuleSet.CATEGORY_CHOICES:
            rule_set = fees.rule_set_in_force(category)
            current.append({
                "category": category, "label": label, "bands": bands_as_dicts(rule_set),
                "effective_from": rule_set.effective_from if rule_set else None,
            })
        pending = [
            {"id": r.pk, "category": r.payload.get("category"), "bands": r.payload.get("bands"),
             "effective_from": r.payload.get("effective_from"), "maker": r.maker.full_name, "created_at": r.created_at}
            for r in ApprovalRequest.objects.filter(kind=FEE_RULES_KEY, status=ApprovalRequest.PENDING).select_related("maker").order_by("-pk")
        ]
        history = [
            {"category": r.category, "effective_from": r.effective_from, "approved_by": r.created_by.full_name if r.created_by else None}
            for r in FeeRuleSet.objects.select_related("created_by").order_by("-effective_from", "-id")[:20]
        ]
        return Response({"current": current, "pending": pending, "history": history})

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        category = data.get("category")
        if not isinstance(category, str) or category not in CATEGORY_LABELS:
            return Response({"detail": "Pick products, services or events."}, status=400)
        # submit() validates only a Super Admin's own change; refuse a bad ladder before anything is queued.
        try:
            fees.validate_bands(data.get("bands") if data.get("bands") is not None else [])
            effective_time(data.get("effective_from"))
        except (fees.FeeError, approvals.ApprovalError) as exc:
            return Response({"detail": getattr(exc, "message", str(exc))}, status=400)
        if ApprovalRequest.objects.filter(kind=FEE_RULES_KEY, status=ApprovalRequest.PENDING, payload__category=category).exists():
            return Response({"detail": "A change to these fee rules is already waiting for approval."}, status=status.HTTP_409_CONFLICT)
        return _submit(
            request, FEE_RULES_KEY, title=f"Platform fees: {CATEGORY_LABELS[category]}",
            target_type="ledger.feeruleset", target_id=category, target_label=CATEGORY_LABELS[category],
            payload={"category": category, "bands": data.get("bands"), "effective_from": data.get("effective_from")},
            maker_note=str(data.get("note") or ""),
        )


class MoneySettingsView(APIView):
    """GET settings/ — every setting with its value in force. POST settings/ {key, value, effective_from?, note?}."""

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasRolePermission(MANAGE)]
        return [HasAnyRolePermission(VIEW, MANAGE)]

    def get(self, request):
        rows = [
            {"key": key, "label": d.label, "value": settings_store.current(key), "nullable": d.nullable, "minimum": d.minimum, "maximum": d.maximum}
            for key, d in settings_store.DEFINITIONS.items()
        ]
        pending = [
            {"id": r.pk, "key": r.payload.get("key"), "value": r.payload.get("value"), "maker": r.maker.full_name, "created_at": r.created_at}
            for r in ApprovalRequest.objects.filter(kind=SETTING_KEY, status=ApprovalRequest.PENDING).select_related("maker").order_by("-pk")
        ]
        history = [{"key": r.key, "value": r.value, "effective_from": r.effective_from} for r in MoneySetting.objects.order_by("-effective_from", "-id")[:20]]
        return Response({"settings": rows, "pending": pending, "history": history})

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        key = data.get("key")
        try:
            settings_store.clean(key, data.get("value"))
        except settings_store.SettingError as exc:
            return Response({"detail": str(exc)}, status=400)
        try:
            effective_time(data.get("effective_from"))
        except approvals.ApprovalError as exc:
            return Response({"detail": exc.message}, status=400)
        if ApprovalRequest.objects.filter(kind=SETTING_KEY, status=ApprovalRequest.PENDING, payload__key=key).exists():
            return Response({"detail": "A change to this setting is already waiting for approval."}, status=status.HTTP_409_CONFLICT)
        label = settings_store.DEFINITIONS[key].label
        return _submit(
            request, SETTING_KEY, title=f"Money setting: {label}",
            target_type="ledger.moneysetting", target_id=key, target_label=label,
            payload={"key": key, "value": data.get("value"), "effective_from": data.get("effective_from")},
            maker_note=str(data.get("note") or ""),
        )


class AwaitingVerificationView(APIView):
    """GET orders/awaiting-verification/ — delivered or collected orders waiting for Support's verification call."""

    def get_permissions(self):
        return [HasRolePermission("orders.verify")]

    def get(self, request):
        return Response({"results": verification.awaiting()})


class OrderVerificationView(APIView):
    """POST orders/<id>/verification/ {outcome: matches|does_not_match|unreachable, note?, customer_confirmed_by_phone?}.
    A positive outcome releases the order's money at once."""

    def get_permissions(self):
        return [HasRolePermission("orders.verify")]

    def post(self, request, pk):
        order = get_object_or_404(Order, pk=pk)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            check = verification.record(
                order, request.user, data.get("outcome"), note=data.get("note"),
                customer_confirmed_by_phone=data.get("customer_confirmed_by_phone") is True,
            )
        except verification.VerificationError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response({
            "order": order.pk, "outcome": check.outcome, "dispute_id": check.dispute_id,
            "released": Journal.objects.filter(key=escrow.release_key(order)).exists(),
        })
