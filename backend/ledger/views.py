"""Ledger staff API: the fee rules and money settings in force, and proposals to change them
(maker-checker through the approvals engine)."""
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import sessions
from accounts.permissions import HasAnyRolePermission, HasRolePermission
from approvals import services as approvals
from approvals.models import ApprovalRequest
from orders.models import Order

from . import cancellation, escrow, fees, sales, settings_store, verification
from .approval_kinds import (
    CATEGORY_LABELS, FEE_RULES_KEY, REDELIVERY_FEE_KEY, REDELIVERY_FEE_PERMISSION, SETTING_KEY, SETTING_KINDS, STOCK_SETTING_KEYS,
    bands_as_dicts, effective_time,
)
from .models import FeeRuleSet, Journal, MoneySetting
from .views_bookings import Pagination, ledger_off

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
        # Canonical payload: every band carries exactly the four keys, absent ones as null.
        bands = [{k: b.get(k) for k in ("lower", "upper", "percent_bp", "flat")} for b in data.get("bands") or []]
        if ApprovalRequest.objects.filter(kind=FEE_RULES_KEY, status=ApprovalRequest.PENDING, payload__category=category).exists():
            return Response({"detail": "A change to these fee rules is already waiting for approval."}, status=status.HTTP_409_CONFLICT)
        return _submit(
            request, FEE_RULES_KEY, title=f"Platform fees: {CATEGORY_LABELS[category]}",
            target_type="ledger.feeruleset", target_id=category, target_label=CATEGORY_LABELS[category],
            payload={"category": category, "bands": bands, "effective_from": data.get("effective_from")},
            maker_note=str(data.get("note") or ""),
        )


class MoneySettingsView(APIView):
    """GET settings/ — every setting with its value in force. POST settings/ {key, value, effective_from?, note?}.

    fees.view / fees.manage read and propose every setting (a ledger.setting approval, Super Admin decides). The
    re-delivery fee alone is also open to redelivery_fee.manage (Operations; Director ruling 1, 2026-10-20): its changes,
    whoever proposes them, are a ledger.redelivery_fee approval that Operations or a Super Admin decides, and a holder
    without fees.view reads only that one setting."""

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasAnyRolePermission(MANAGE, REDELIVERY_FEE_PERMISSION)]
        return [HasAnyRolePermission(VIEW, MANAGE, REDELIVERY_FEE_PERMISSION)]

    def get(self, request):
        now = timezone.now()
        held = request.user.effective_permission_codenames()
        keys = list(settings_store.DEFINITIONS) if held & {VIEW, MANAGE} else [settings_store.REDELIVERY_FEE]
        in_force = set(MoneySetting.objects.filter(effective_from__lte=now).values_list("key", flat=True))
        later = {}
        for row in MoneySetting.objects.filter(key__in=keys, effective_from__gt=now).order_by("effective_from", "id"):
            later.setdefault(row.key, []).append({"value": row.value, "effective_from": row.effective_from})
        rows = [
            {
                "key": key, "label": d.label, "value": settings_store.current(key, now), "nullable": d.nullable,
                "minimum": d.minimum, "maximum": d.maximum, "default": d.default,
                "is_default": key not in in_force,  # nobody has set it: the built-in value is running
                "scheduled": later.get(key, []),
            }
            for key, d in ((key, settings_store.DEFINITIONS[key]) for key in keys)
        ]
        pending = [
            {"id": r.pk, "key": r.payload.get("key"), "value": r.payload.get("value"), "maker": r.maker.full_name, "created_at": r.created_at}
            for r in ApprovalRequest.objects.filter(kind__in=SETTING_KINDS, status=ApprovalRequest.PENDING).select_related("maker").order_by("-pk")
            if r.payload.get("key") in keys
        ]
        history = [
            {"key": r.key, "value": r.value, "effective_from": r.effective_from}
            for r in MoneySetting.objects.filter(key__in=keys).order_by("-effective_from", "-id")[:20]
        ]
        return Response({"settings": rows, "pending": pending, "history": history})

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        key = data.get("key")
        redelivery = key == settings_store.REDELIVERY_FEE
        if not redelivery and MANAGE not in request.user.effective_permission_codenames():
            return Response({"detail": "You do not have permission to perform this action."}, status=status.HTTP_403_FORBIDDEN)
        try:
            settings_store.clean(key, data.get("value"))
        except settings_store.SettingError as exc:
            return Response({"detail": str(exc)}, status=400)
        try:
            effective_time(data.get("effective_from"))
        except approvals.ApprovalError as exc:
            return Response({"detail": exc.message}, status=400)
        if ApprovalRequest.objects.filter(kind__in=SETTING_KINDS, status=ApprovalRequest.PENDING, payload__key=key).exists():
            return Response({"detail": "A change to this setting is already waiting for approval."}, status=status.HTTP_409_CONFLICT)
        label = settings_store.DEFINITIONS[key].label
        return _submit(
            request, REDELIVERY_FEE_KEY if redelivery else SETTING_KEY,
            title=f"{'Stock' if key in STOCK_SETTING_KEYS else 'Money'} setting: {label}",
            target_type="ledger.moneysetting", target_id=key, target_label=label,
            payload={"key": key, "value": data.get("value"), "effective_from": data.get("effective_from")},
            maker_note=str(data.get("note") or ""),
        )


class AwaitingVerificationView(APIView):
    """GET orders/awaiting-verification/ — delivered or collected orders waiting for Support's verification call."""

    def get_permissions(self):
        return [HasRolePermission("orders.verify")]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        now = timezone.now()
        paginator = Pagination()
        page = paginator.paginate_queryset(verification.awaiting_queryset(now), request, view=self)
        limit = verification._overdue_limit(now)
        return paginator.get_paginated_response([verification.awaiting_row(order, now, limit) for order in page])


class OrderVerificationView(APIView):
    """POST orders/<id>/verification/ {outcome: matches|does_not_match|unreachable, note?, customer_confirmed_by_phone?}.
    A positive outcome releases the order's money at once, and needs the password re-entered (RequiresSudo)."""

    def get_permissions(self):
        return [HasRolePermission("orders.verify")]

    def post(self, request, pk):
        order = get_object_or_404(Order, pk=pk)
        data = request.data if isinstance(request.data, dict) else {}
        if data.get("outcome") == "matches":
            sessions.require_sudo(request)  # a positive call releases money by hand: the password is asked again
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


class PickupQueueView(APIView):
    """GET pickup/?q= — store-pickup orders paid through the ledger and waiting at the office, with the time each must be
    collected by, 20 a page. `q` is an order number or part of a customer's name."""

    def get_permissions(self):
        return [HasRolePermission("pickup.confirm")]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        now = timezone.now()
        paginator = Pagination()
        page = paginator.paginate_queryset(verification.pickup_queryset(now, request.query_params.get("q", "")), request, view=self)
        window = verification._pickup_window(now)
        return paginator.get_paginated_response([verification.pickup_row(order, now, window) for order in page])


class PickupCollectedView(APIView):
    """POST pickup/<order id>/collected/ — the desk hands the order to the customer."""

    def get_permissions(self):
        return [HasRolePermission("pickup.confirm")]

    def post(self, request, pk):
        order = get_object_or_404(Order, pk=pk)
        try:
            check = verification.mark_collected(order, request.user)
        except verification.VerificationError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response({"order": order.pk, "collected_at": check.collected_at})


class BookingTermsView(APIView):
    """GET booking-terms/ — public. What a customer is told before paying for a stay or ticket: the hours that govern
    when the money is released (read at this moment from the money settings), the stay check-in time, and the
    cancellation policies a vendor can choose from, so no screen carries its own copy of these numbers.
    With the ledger off no sale is recorded, nothing refunds itself and nothing releases on a timer, so `enabled` is
    false and the hours are left out (customer screens then say nothing); the policies are still listed because choosing
    one only stores a choice."""

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        policies = {
            name: {"label": cancellation.POLICIES[name]["label"], "tiers": cancellation.POLICIES[name]["tiers"], "text": cancellation.POLICIES[name]["text"]}
            for name, _ in cancellation.CHOICES
        }
        if not escrow.enabled():
            return Response({"enabled": False, "policies": policies})
        now = timezone.now()
        return Response({
            "enabled": True,
            "service_auto_accept_hours": settings_store.current("service_auto_accept_hours", now),
            "stay_issue_window_hours": settings_store.current("stay_issue_window_hours", now),
            "event_release_delay_hours": settings_store.current("event_release_delay_hours", now),
            "stay_check_in_time": sales.STAY_CHECK_IN_TIME.strftime("%H:%M"),
            "policies": policies,
        })
