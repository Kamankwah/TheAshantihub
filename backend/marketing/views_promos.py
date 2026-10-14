"""Staff, owner and public endpoints for flash sales and coupons."""
from datetime import datetime

from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from accounts.views import IsBusinessOwner, IsCustomer
from cart.models import Cart
from listings.models import Listing
from orders.models import Order, OrderItem

from . import code_guard
from . import checkout as promo_checkout
from . import coupons as coupon_rules
from . import flash_sales as flash
from . import policy as policy_rules
from .models_promos import Coupon, FlashSale, FlashSaleListing
from .promos import OFF_NOTICE, enabled, money

FLASH_PERM = "site_promo.manage"
COUPON_PERM = "coupons.manage"


def _err(exc):
    return Response({"detail": exc.message}, status=exc.status_code)


# ─── flash sales (staff) ─────────────────────────────────────────────────────
def _sold(sale):
    return OrderItem.objects.filter(flash_sale=sale).exclude(order__status=Order.CANCELLED).aggregate(n=Sum("quantity"))["n"] or 0


def serialize_sale(sale, detail=False):
    rows = list(sale.listings.select_related("listing", "listing__business_owner", "listing__business_owner__profile"))
    owners = {r.listing.business_owner_id for r in rows}
    agreed_owners = {o for o in owners if all(r.agreed_at for r in rows if r.listing.business_owner_id == o and not r.declined_at) and any(r.agreed_at for r in rows if r.listing.business_owner_id == o)}
    pending = sum(1 for r in rows if not r.agreed_at and not r.declined_at)
    out = {
        "id": sale.pk, "name": sale.name, "starts_at": sale.starts_at, "ends_at": sale.ends_at, "discount_pct": sale.discount_pct,
        "stock_cap": sale.stock_cap, "per_customer_limit": sale.per_customer_limit, "payer": sale.payer, "status": sale.status,
        "sold": _sold(sale), "listing_count": len([r for r in rows if not r.declined_at]), "business_count": len(owners),
        "agreed_count": sum(1 for r in rows if r.agreed_at), "pending_count": pending,
        "declined_count": sum(1 for r in rows if r.declined_at), "asked_at": sale.asked_at,
        "withdraw_until": flash.withdraw_cutoff(sale), "ended_early_at": sale.ended_early_at, "created_at": sale.created_at,
        "editable": sale.status in flash.EDITABLE,
    }
    if detail:
        out["listings"] = [
            {
                "id": r.listing_id, "name": r.listing.name, "business": r.listing.business_owner.display_name,
                "business_id": r.listing.business_owner_id, "normal_price": money(r.normal_price), "sale_price": money(r.sale_price),
                "in_stock": r.listing.stock_quantity, "state": r.state, "agreed_at": r.agreed_at, "asked_at": r.asked_at,
                "problem": flash.eligibility_problem(r.listing, sale) if sale.status in flash.EDITABLE and not r.declined_at else None,
            }
            for r in rows
        ]
    return out


def _parse_dt(value, label):
    if isinstance(value, datetime):
        moment = value
    else:
        moment = parse_datetime(str(value or ""))
    if moment is None:
        raise flash.FlashError(f"{label} must be a date and time.")
    return timezone.make_aware(moment) if timezone.is_naive(moment) else moment


def _clean_sale(data, current=None):
    d = {}
    if current:
        d.update(name=current.name, starts_at=current.starts_at, ends_at=current.ends_at, discount_pct=current.discount_pct,
                stock_cap=current.stock_cap, per_customer_limit=current.per_customer_limit)
    d.update({k: v for k, v in data.items() if k in ("name", "starts_at", "ends_at", "discount_pct", "stock_cap", "per_customer_limit")})
    name = str(d.get("name") or "").strip()
    if not name:
        raise flash.FlashError("Give the sale a name.")
    starts, ends = _parse_dt(d.get("starts_at"), "The start"), _parse_dt(d.get("ends_at"), "The end")
    if ends <= starts:
        raise flash.FlashError("The sale must end after it starts.")
    out = {"name": name[:120], "starts_at": starts, "ends_at": ends}
    for key, label, hi in (("discount_pct", "The discount", flash.MAX_DISCOUNT_PCT), ("stock_cap", "The stock cap", 1_000_000), ("per_customer_limit", "Per customer", 1000)):
        try:
            if isinstance(d.get(key), bool):
                raise ValueError
            n = int(d.get(key))
        except (TypeError, ValueError):
            raise flash.FlashError(f"{label} must be a whole number.")
        if not 1 <= n <= hi:
            raise flash.FlashError(f"{label} must be between 1 and {hi}.")
        out[key] = n
    return out


def _add_listings(sale, listing_ids):
    added = []
    for listing in Listing.objects.filter(pk__in=listing_ids).select_related("business_owner"):
        if FlashSaleListing.objects.filter(sale=sale, listing=listing).exists():
            continue
        problem = flash.eligibility_problem(listing, sale)
        if problem:
            raise flash.FlashError(f"“{listing.name}”: {problem}")
        added.append(FlashSaleListing.objects.create(
            sale=sale, listing=listing, normal_price=listing.price_amount, sale_price=flash.sale_price(listing.price_amount, sale.discount_pct)))
    return added


class FlashSaleListCreateView(APIView):
    def get_permissions(self):
        return [IsAuthenticated(), HasRolePermission(FLASH_PERM)]

    def get(self, request):
        sales = [serialize_sale(s) for s in FlashSale.objects.all()[:200]]
        counts = {}
        for s in sales:
            counts[s["status"]] = counts.get(s["status"], 0) + 1
        return Response({"results": sales, "counts": counts, "promos_enabled": enabled(), "off_notice": None if enabled() else OFF_NOTICE,
                        "threshold": money(policy_rules.approval_threshold())})

    @transaction.atomic
    def post(self, request):
        try:
            fields = _clean_sale(request.data)
            sale = FlashSale.objects.create(created_by=request.user, **fields)
            if request.data.get("listing_ids"):
                _add_listings(sale, request.data["listing_ids"])
        except flash.FlashError as exc:
            transaction.set_rollback(True)
            return _err(exc)
        return Response(serialize_sale(sale, True), status=status.HTTP_201_CREATED)


class FlashSaleDetailView(APIView):
    def get_permissions(self):
        return [IsAuthenticated(), HasRolePermission(FLASH_PERM)]

    def get(self, request, pk):
        sale = FlashSale.objects.filter(pk=pk).first()
        if not sale:
            return Response({"detail": "Not found."}, status=404)
        data = serialize_sale(sale, True)
        data.update(promos_enabled=enabled(), off_notice=None if enabled() else OFF_NOTICE,
                    threshold=money(policy_rules.approval_threshold()), withdraw_cutoff_hours=flash.WITHDRAW_CUTOFF_HOURS)
        return Response(data)

    @transaction.atomic
    def patch(self, request, pk):
        sale = FlashSale.objects.select_for_update().filter(pk=pk).first()
        if not sale:
            return Response({"detail": "Not found."}, status=404)
        if sale.status not in flash.EDITABLE:
            return Response({"detail": "A sale that has started or ended can't be edited."}, status=409)
        try:
            fields = _clean_sale(request.data, sale)
            changed_for_sellers = any(fields[k] != getattr(sale, k) for k in ("discount_pct", "starts_at", "ends_at"))
            for k, v in fields.items():
                setattr(sale, k, v)
            sale.save()
            if changed_for_sellers and sale.status in (FlashSale.WAITING, FlashSale.SCHEDULED):
                flash.reask_after_change(sale)
            elif changed_for_sellers:
                for row in sale.listings.all():
                    row.sale_price = flash.sale_price(row.normal_price, sale.discount_pct)
                    row.save(update_fields=["sale_price"])
        except flash.FlashError as exc:
            transaction.set_rollback(True)
            return _err(exc)
        sale.refresh_from_db()
        return Response(serialize_sale(sale, True))


class FlashSaleListingsView(APIView):
    """POST adds listings; DELETE <listing_id> removes one. On a sale sellers were asked about, either
    asks them all again."""

    def get_permissions(self):
        return [IsAuthenticated(), HasRolePermission(FLASH_PERM)]

    @transaction.atomic
    def post(self, request, pk):
        sale = FlashSale.objects.select_for_update().filter(pk=pk).first()
        if not sale:
            return Response({"detail": "Not found."}, status=404)
        if sale.status not in flash.EDITABLE:
            return Response({"detail": "A sale that has started or ended can't be edited."}, status=409)
        try:
            added = _add_listings(sale, request.data.get("listing_ids") or [])
            if added and sale.status in (FlashSale.WAITING, FlashSale.SCHEDULED):
                flash.reask_after_change(sale)
        except flash.FlashError as exc:
            transaction.set_rollback(True)
            return _err(exc)
        return Response(serialize_sale(sale, True))

    @transaction.atomic
    def delete(self, request, pk, listing_id):
        sale = FlashSale.objects.select_for_update().filter(pk=pk).first()
        if not sale:
            return Response({"detail": "Not found."}, status=404)
        if sale.status not in flash.EDITABLE:
            return Response({"detail": "A sale that has started or ended can't be edited."}, status=409)
        deleted, _ = sale.listings.filter(listing_id=listing_id).delete()
        if deleted and sale.status in (FlashSale.WAITING, FlashSale.SCHEDULED):
            flash.reask_after_change(sale)
        return Response(serialize_sale(sale, True))


class FlashSaleEligibleView(APIView):
    """GET eligible/?q=&sale= — listings that may join (live, verified business, stock tracked, no open fraud case)."""

    def get_permissions(self):
        return [IsAuthenticated(), HasRolePermission(FLASH_PERM)]

    def get(self, request):
        sale = FlashSale.objects.filter(pk=request.query_params.get("sale") or 0).first()
        rows = flash.eligible_listings(request.query_params.get("q", "").strip(), sale)
        return Response({"results": [
            {"id": l.pk, "name": l.name, "business": l.business_owner.display_name, "price": money(l.price_amount), "in_stock": l.stock_quantity,
             "category": l.category.label} for l in rows]})


class _SaleAction(APIView):
    def get_permissions(self):
        return [IsAuthenticated(), HasRolePermission(FLASH_PERM)]


class FlashSaleAskView(_SaleAction):
    @transaction.atomic
    def post(self, request, pk):
        sale = FlashSale.objects.select_for_update().filter(pk=pk).first()
        if not sale:
            return Response({"detail": "Not found."}, status=404)
        if sale.status not in flash.EDITABLE:
            return Response({"detail": "A sale that has started or ended can't be sent to sellers."}, status=409)
        if sale.starts_at <= timezone.now():
            return Response({"detail": "The start time has already passed."}, status=400)
        try:
            n = flash.ask_sellers(sale)
        except flash.FlashError as exc:
            return _err(exc)
        sale.refresh_from_db()
        return Response({**serialize_sale(sale, True), "asked_businesses": n})


class FlashSaleEndView(_SaleAction):
    def post(self, request, pk):
        try:
            sale = flash.end_early(pk, request.user)
        except FlashSale.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        except flash.FlashError as exc:
            return _err(exc)
        return Response(serialize_sale(sale, True))


class FlashSaleCancelView(_SaleAction):
    def post(self, request, pk):
        try:
            sale = flash.cancel(pk)
        except FlashSale.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        except flash.FlashError as exc:
            return _err(exc)
        return Response(serialize_sale(sale, True))


# ─── flash sales (the seller's side) ─────────────────────────────────────────
class OwnerFlashInvitationsView(APIView):
    """GET — the sales AshantiHub has asked this business to take part in."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get(self, request):
        return Response({"results": flash.invitations_for(request.user)})


class OwnerFlashRespondView(APIView):
    """POST {accept: true|false} — answer for all of this business's listings in the sale."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def post(self, request, pk):
        accept = request.data.get("accept")
        if not isinstance(accept, bool):
            return Response({"detail": "Say yes or no."}, status=400)
        try:
            flash.respond(request.user, pk, accept)
        except flash.FlashError as exc:
            return _err(exc)
        return Response({"results": [i for i in flash.invitations_for(request.user) if i["sale_id"] == pk]})


# ─── coupons (staff) ─────────────────────────────────────────────────────────
class CouponListCreateView(APIView):
    def get_permissions(self):
        return [IsAuthenticated(), HasRolePermission(COUPON_PERM)]

    def get(self, request):
        coupons = list(Coupon.objects.select_related("category")[:300])
        rows = [coupon_rules.serialize(c) for c in coupons]
        live = [r for r in rows if r["effective_status"] == Coupon.ACTIVE]
        from datetime import timedelta
        from .models_promos import CouponRedemption

        week = CouponRedemption.objects.filter(released_at__isnull=True, created_at__gte=timezone.now() - timedelta(days=7))
        agg = week.aggregate(n=Count("id"), cost=Sum("amount"))
        remaining = sum(max(0, c.budget_cap - c.cost_to_date()) for c in coupons if c.effective_status() == Coupon.ACTIVE)
        return Response({
            "results": rows, "promos_enabled": enabled(), "off_notice": None if enabled() else OFF_NOTICE,
            "threshold": money(policy_rules.approval_threshold()),
            "kpis": {"live": len(live), "waiting": sum(1 for r in rows if r["status"] == Coupon.WAITING),
                    "paused": sum(1 for r in rows if r["status"] == Coupon.PAUSED), "redeemed_7d": agg["n"] or 0,
                    "cost_7d": money(agg["cost"]), "most_still_payable": money(remaining)},
        })

    def post(self, request):
        try:
            coupon = coupon_rules.save_draft(request.data, request.user)
        except coupon_rules.CouponError as exc:
            return _err(exc)
        return Response(coupon_rules.serialize(coupon, True), status=status.HTTP_201_CREATED)


class CouponDetailView(APIView):
    def get_permissions(self):
        return [IsAuthenticated(), HasRolePermission(COUPON_PERM)]

    def get(self, request, pk):
        coupon = Coupon.objects.select_related("category").filter(pk=pk).first()
        if not coupon:
            return Response({"detail": "Not found."}, status=404)
        data = coupon_rules.serialize(coupon, True)
        data.update(promos_enabled=enabled(), off_notice=None if enabled() else OFF_NOTICE, threshold=money(policy_rules.approval_threshold()))
        return Response(data)

    def patch(self, request, pk):
        coupon = Coupon.objects.filter(pk=pk).first()
        if not coupon:
            return Response({"detail": "Not found."}, status=404)
        try:
            coupon = coupon_rules.save_draft(request.data, request.user, coupon)
        except coupon_rules.CouponError as exc:
            return _err(exc)
        return Response(coupon_rules.serialize(coupon, True))

    def delete(self, request, pk):
        try:
            coupon_rules.delete_draft(pk)
        except Coupon.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        except coupon_rules.CouponError as exc:
            return _err(exc)
        return Response(status=204)


class CouponActionView(APIView):
    """POST <pk>/<action>/ with action in activate, pause, resume, end."""

    def get_permissions(self):
        return [IsAuthenticated(), HasRolePermission(COUPON_PERM)]

    def post(self, request, pk, action):
        try:
            if action == "activate":
                coupon, approval = coupon_rules.activate(pk, request.user, request)
                data = coupon_rules.serialize(coupon, True)
                data["approval_id"] = approval.pk if approval else None
                return Response(data)
            fn = {"pause": coupon_rules.pause, "resume": coupon_rules.resume, "end": coupon_rules.end}.get(action)
            if fn is None:
                return Response({"detail": "Not found."}, status=404)
            return Response(coupon_rules.serialize(fn(pk), True))
        except Coupon.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        except coupon_rules.CouponError as exc:
            return _err(exc)


# ─── the public site and the cart ────────────────────────────────────────────
class PublicPromosView(APIView):
    """GET — whether checkout promotions are on and, only then, the flash sales to show: live ones, and
    ones starting within 48 hours (countdown). No seller names, no counts of customers, no internal ids
    beyond the listing id the card already has."""

    permission_classes = [AllowAny]

    def get(self, request):
        if not enabled():
            return Response({"enabled": False, "flash_sales": []})
        now = timezone.now()
        from datetime import timedelta

        sales = FlashSale.objects.filter(status__in=(FlashSale.SCHEDULED, FlashSale.LIVE), ends_at__gt=now,
                                         starts_at__lte=now + timedelta(hours=48)).order_by("starts_at")
        out = []
        for sale in sales:
            agreed = list(sale.listings.filter(agreed_at__isnull=False, declined_at__isnull=True).select_related("listing"))
            rows = promo_checkout.usable_rows(agreed, [r.listing for r in agreed])
            left = max(0, sale.stock_cap - _sold(sale))
            out.append({
                "id": sale.pk, "name": sale.name, "discount_pct": sale.discount_pct, "starts_at": sale.starts_at, "ends_at": sale.ends_at,
                "live": sale.starts_at <= now, "sold_out": left == 0, "per_customer_limit": sale.per_customer_limit,
                "listings": [{"listing": r.listing_id, "normal_price": money(r.normal_price), "sale_price": money(r.sale_price)} for r in rows],
                "stock_left": left,
            })
        return Response({"enabled": True, "flash_sales": out})


def _delivery_quote(request, items):
    """What the cart shows for delivery, mirroring checkout: None unless fees are on and the customer chose
    door-to-door. `fee` is the amount that will be charged ("0.00" when waived) and is null until a delivery
    point lets the fee be measured; `waived_fee` is what the promo took off, when known. `mixed_note` is set when
    a free-delivery promo exists for part of the cart but the cart spans businesses."""
    from django.conf import settings

    from . import waivers
    from delivery.rates import checkout_fee

    if not settings.DELIVERY_FEE_ENABLED or request.data.get("delivery_method") != Order.DOOR_TO_DOOR or not items:
        return None
    from routing import region

    lat, lng = request.data.get("delivery_lat"), request.data.get("delivery_lng")
    if lat not in (None, "") and lng not in (None, "") and not region.in_service_area(lat, lng):
        return {"fee": None, "fee_status": "out_of_area", "waived": False, "waiver_name": None, "waived_fee": None, "mixed_note": None, "message": region.OUT_OF_AREA_MESSAGE}
    listings = [i.listing for i in items]
    waiver = waivers.covering_waiver(listings, timezone.now())
    quoted = checkout_fee(items, request.data.get("delivery_lat"), request.data.get("delivery_lng"))
    original = money(quoted[1]["total"]) if quoted else None
    from delivery import config

    # "ok": a fee was measured. "no_rate_card": none is in force, so checkout adds NO delivery fee.
    # "needs_location": no usable delivery point, so checkout adds no fee until one is chosen.
    fee_status = "ok" if quoted else ("no_rate_card" if config.live(config.RateCard) is None else "needs_location")
    out = {"fee": original, "fee_status": fee_status, "waived": waiver is not None, "waiver_name": waiver.name if waiver else None, "waived_fee": None, "mixed_note": None}
    out["lines"] = quoted[1]["lines"] if quoted else None
    out["route"] = quoted[1].get("route") if quoted else None
    if waiver is not None:
        out["fee"], out["waived_fee"] = ("0.00", original) if original is not None else (None, None)
    elif waivers.mixed_business(listings) and any(waivers.live_waivers(o, timezone.now()) for o in {l.business_owner_id for l in listings}):
        out["mixed_note"] = "Free delivery only applies when everything in your order is from the same business."
    return out


class CartQuoteView(APIView):
    """POST {coupon_code?, delivery_phone?} — the caller's cart priced with flash sales and the code. Writes nothing."""

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request):
        if not enabled():
            return Response({"enabled": False})
        cart = Cart.objects.filter(customer=request.user).first()
        items = list(cart.items.select_related("listing")) if cart else []
        typed = promo_checkout.normalise_code(request.data.get("coupon_code"))
        if typed and code_guard.blocked(request):
            return Response({"detail": code_guard.TOO_MANY}, status=429)
        try:
            priced = promo_checkout.price(request.user, items, request.data.get("coupon_code"), lock=False,
                                          delivery_phone=str(request.data.get("delivery_phone") or ""))
        except promo_checkout.PromoError as exc:
            code_guard.record_failure(request)
            # The cart is still priced, without the code, so the box can show the reason beside the total.
            priced = promo_checkout.price(request.user, items, "", lock=False)
            data = promo_checkout.quote_data(priced)
            data["coupon_error"] = exc.message
            data["delivery"] = _delivery_quote(request, items)
            return Response(data)
        data = promo_checkout.quote_data(priced)
        data["delivery"] = _delivery_quote(request, items)
        return Response(data)
