"""The dispatch queue (permission ``delivery.manage``) and the rider's offers (``delivery.dispatch``)."""
from datetime import timedelta

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from orders.models import DeliveryAssignment, Order
from routing import service as routing_service

from . import board, config, dispatching, payloads, services, tracking
from .models import DeliverySettings, DeliveryZone, Offer, QueueHold, Rider
from .views_live import ManageView
from .views_rider import RiderView


def _queue_row(order, now, rules, limits, zones=None):
    row = board.queue_row(order, now, zones)
    deadline = dispatching.deadline_for(order, limits=limits)
    live = dispatching.live_offer(order)
    hold = getattr(order, "queue_hold", None)
    row.update({
        "deadline_at": row["deadline_at"] or deadline,
        "minutes_to_spare": int((deadline - now).total_seconds() // 60) if deadline else None,
        "offer": {"id": live.pk, "rider": live.rider.staff.full_name, "expires_at": live.expires_at, "seconds_left": max(0, int((live.expires_at - now).total_seconds()))} if live else None,
        "held_until": hold.release_at if hold and hold.release_at > now else None,
        "refusals": order.offers.filter(status__in=(Offer.DECLINED, Offer.EXPIRED)).count(),
    })
    return row


class QueueView(ManageView):
    """GET queue/ — waiting orders most urgent first (least time to spare; no deadline set sorts by waiting time),
    the best rider the engine would pick for each, the switch, and what was assigned in the last 30 minutes."""

    def get(self, request):
        now = timezone.now()
        rules, limits = config.effective_rules(), config.effective_limits()
        rows = []
        zones = list(DeliveryZone.objects.filter(active=True, boundary__isnull=False))
        for order in board.waiting_orders().select_related("queue_hold").prefetch_related("offers")[:100]:
            row = _queue_row(order, now, rules, limits, zones)
            ranked = dispatching.rank(order, rules, now)
            best = ranked["eligible"][0] if ranked["eligible"] else None
            row["suggested"] = {"rider_id": best["rider_id"], "full_name": best["full_name"], "total": best["total"], "km": best["km"]} if best else None
            row["eligible"] = len(ranked["eligible"])
            row["pickup_located"] = ranked["pickup_located"]
            rows.append(row)
        rows.sort(key=lambda r: (r["minutes_to_spare"] is None, r["minutes_to_spare"] if r["minutes_to_spare"] is not None else 0, -r["waiting_minutes"]))
        recent = DeliveryAssignment.objects.filter(assigned_at__gte=now - timedelta(minutes=30)).select_related("dispatch").order_by("-assigned_at")[:20]
        settings_row = DeliverySettings.get()
        return Response({
            "results": rows, "total": len(rows),
            "auto_assign": {"on": settings_row.auto_assign_on, "rules": {"source": rules["source"], "version": rules["version"]}, "updated_at": settings_row.updated_at if settings_row.pk else None},
            "recent": [{"order_id": a.order_id, "rider": a.dispatch.full_name if a.dispatch_id else None, "mode": a.assignment_mode, "mode_label": a.get_assignment_mode_display(), "at": a.assigned_at} for a in recent],
            "deadlines": "set" if limits else "none",
            "routing": board.routing_block(estimate_figures=True),
        })


class RankingView(ManageView):
    """GET queue/<order_id>/ranking/ — the engine's ranking for one order: score breakdown per eligible rider and
    the riders left out with the reason."""

    def get(self, request, order_id):
        order = get_object_or_404(board.waiting_orders(), pk=order_id)
        return Response(dispatching.rank(order))


class QueueMapView(ManageView):
    """GET queue/<order_id>/map/ — pickup, drop, trip and the on-shift riders for one waiting order."""

    def get(self, request, order_id):
        order = get_object_or_404(board.waiting_orders(), pk=order_id)
        return Response(tracking.queue_map(order))


class OfferSerializer(serializers.Serializer):
    rider = serializers.IntegerField()


class OfferToRiderView(ManageView):
    def post(self, request, order_id):
        data = OfferSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        order = get_object_or_404(board.waiting_orders(), pk=order_id)
        rider = get_object_or_404(Rider.objects.select_related("staff"), pk=data.validated_data["rider"], staff__is_active=True, staff__is_suspended=False)
        offer = dispatching.make_offer(order, rider, source=Offer.MANAGER, by=request.user)
        return Response({"offer_id": offer.pk, "expires_at": offer.expires_at}, status=201)


class ForceAssignView(ManageView):
    """POST queue/<order_id>/force-assign/ {rider} — give the order to a rider now, without asking them first."""

    def post(self, request, order_id):
        data = OfferSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        order = get_object_or_404(board.waiting_orders(), pk=order_id)
        rider = get_object_or_404(Rider.objects.select_related("staff"), pk=data.validated_data["rider"], staff__is_active=True, staff__is_suspended=False)
        try:
            assignment = dispatching.force_assign(order, rider, request.user)
        except services.DeliveryError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response({"assignment_id": assignment.pk, "mode": assignment.assignment_mode}, status=201)


class ScheduleView(ManageView):
    """POST queue/<order_id>/schedule/ {release_at | null} — keep an order out of the queue until a time (or release it)."""

    def post(self, request, order_id):
        order = get_object_or_404(board.waiting_orders(), pk=order_id)
        raw = request.data.get("release_at")
        if not raw:
            QueueHold.objects.filter(order=order).delete()
            return Response({"held_until": None})
        try:
            when = serializers.DateTimeField().run_validation(raw)
        except serializers.ValidationError:
            return Response({"detail": "Enter a date and time."}, status=400)
        if when <= timezone.now():
            return Response({"detail": "Choose a time in the future."}, status=400)
        QueueHold.objects.update_or_create(order=order, defaults={"release_at": when, "by": request.user})
        return Response({"held_until": when})


class SwitchView(APIView):
    """POST auto-assign/switch/ {on} — turn the engine on or off. Applies at once, is logged by the activity log, and
    tells every Super Admin (permission ``delivery.rates``)."""

    def get_permissions(self):
        return [HasRolePermission("delivery.rates")]

    def post(self, request):
        from accounts.models import Role, StaffUser
        from notifications.services import notify_staff

        on = bool(request.data.get("on"))
        row = DeliverySettings.objects.filter(pk=1).first() or DeliverySettings(pk=1)
        if row.auto_assign_on == on and row.pk and DeliverySettings.objects.filter(pk=1).exists():
            return Response({"on": on})
        row.auto_assign_on, row.updated_by = on, request.user
        row.save()
        for admin in StaffUser.objects.filter(role__name=Role.SUPER_ADMIN, is_active=True).exclude(pk=request.user.pk):
            notify_staff(admin, "delivery_alert", f"Auto-assign switched {'on' if on else 'off'} by {request.user.full_name}", link="/staff/auto-assign-rules", icon="⚙️")
        return Response({"on": on})


# ── Rider side ─────────────────────────────────────────────────────────────────────────────────
def offer_payload(offer, now=None):
    from . import stops

    now = now or timezone.now()
    order = offer.order
    # A job offered again after a failed attempt keeps its saved stops (a job from before multi-stop delivery: its one
    # first-item shop); only an order never given to a rider reads its plan.
    assignment = getattr(order, "delivery_assignment", None)
    if assignment is not None:
        saved = stops.stops_for_next_rider(assignment)
        first = saved[0] if saved else None
        plat, plng, name = (first.lat, first.lng, stops.stop_name(first)) if first else (None, None, "")
        stop_count = len(saved)
    else:
        plat, plng, name = services.pickup_stop(order)
        stop_count = len(stops.sequence_for_order(order))
    dlat, dlng = services.drop_stop(order)
    shift = services.open_shift(offer.rider)
    leg_to_pickup = routing_service.leg((shift.last_lat, shift.last_lng), (plat, plng)) if shift and shift.last_lat is not None and plat is not None else None
    leg_trip = routing_service.leg((plat, plng), (dlat, dlng)) if plat is not None and dlat is not None else None
    to_pickup = leg_to_pickup["distance_km"] if leg_to_pickup else None
    trip = leg_trip["distance_km"] if leg_trip else None
    present = [leg for leg in (leg_to_pickup, leg_trip) if leg]
    # Road only when every distance shown is a road route; any estimate makes the label the estimate.
    basis = routing_service.BASIS_ROAD if present and all(leg["basis"] == routing_service.BASIS_ROAD for leg in present) else routing_service.BASIS_ESTIMATE
    from . import config as cfg
    from .rates import rider_pay

    card = cfg.live(cfg.RateCard)
    pay = rider_pay(card, trip) if card and trip is not None else None
    return {
        "id": offer.pk, "order_id": order.pk, "expires_at": offer.expires_at, "seconds_left": max(0, int((offer.expires_at - now).total_seconds())),
        "pickup": {"business_name": name, "lat": plat, "lng": plng}, "delivery_address": order.delivery_address, "delivery_lat": dlat, "delivery_lng": dlng,
        "to_pickup_km": to_pickup, "trip_km": trip, "distance_basis": basis, "payment": payloads.payment_label(order),
        "deadline_at": dispatching.deadline_for(order), "pay": pay, "items": order.items.count(),
        "stop_count": stop_count, "route_km": (order.route_plan or {}).get("total_km"),
    }


class MyOffersView(RiderView):
    """GET rider/offers/ — the offer waiting for this rider now (if any). Reading it never changes anything; an offer
    past its time is shown as closed by the engine's next pass."""

    def get(self, request):
        rider = self.rider(request)
        now = timezone.now()
        offers = Offer.objects.filter(rider=rider, status=Offer.OFFERED, expires_at__gt=now).select_related("order", "order__delivery_assignment", "rider").prefetch_related(
            "order__items__listing__business_owner__profile", "order__items__listing__category",
        )
        since = now - timedelta(days=30)
        history = Offer.objects.filter(rider=rider, offered_at__gte=since)
        answered = history.exclude(status__in=(Offer.OFFERED, Offer.WITHDRAWN)).count()
        return Response({
            "results": [offer_payload(o, now) for o in offers],
            "acceptance_30d": {"accepted": history.filter(status=Offer.ACCEPTED).count(), "of": answered},
        })


class OfferAcceptView(RiderView):
    def post(self, request, pk):
        try:
            assignment = dispatching.accept_offer(pk, request.user)
        except Offer.DoesNotExist:
            return Response({"detail": "Offer not found."}, status=404)
        except services.DeliveryError as exc:
            return self.refused(exc)
        return Response(payloads.rider_job(DeliveryAssignment.objects.prefetch_related("events", "calls", "photos", "order__items__listing__business_owner__profile").get(pk=assignment.pk)))


class OfferDeclineView(RiderView):
    def post(self, request, pk):
        try:
            dispatching.decline_offer(pk, request.user, str(request.data.get("reason", "")))
        except Offer.DoesNotExist:
            return Response({"detail": "Offer not found."}, status=404)
        except services.DeliveryError as exc:
            return self.refused(exc)
        return Response({"ok": True})
