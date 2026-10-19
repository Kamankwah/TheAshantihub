import hashlib
from datetime import date

from django.core.cache import cache
from django.db import transaction
from django.db.models import F
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import BaseThrottle, ScopedRateThrottle
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from listings.models import Category

from . import banners, featured
from .models_banners import Banner, FeaturedBooking

MANAGE = "site_promo.manage"
SELECT = ("category", "approved_by", "created_by")


def _err(exc):
    body = {"detail": exc.message}
    if getattr(exc, "code", ""):
        body["code"] = exc.code
    return Response(body, status=exc.status_code)


# ─── Staff: banners ─────────────────────────────────────────────────────────
class BannerInput(serializers.ModelSerializer):
    category = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all(), allow_null=True, required=False)
    ends_at = serializers.DateTimeField(allow_null=True, required=False)
    countdown_ends_at = serializers.DateTimeField(allow_null=True, required=False)

    class Meta:
        model = Banner
        fields = ["slot", "category", "title", "alt_text", "image", "message", "countdown_ends_at", "link_path", "sponsored", "internal_note", "starts_at", "ends_at"]
        # A flash banner has no photo to describe; validate() fills the alt text for it.
        extra_kwargs = {"alt_text": {"required": False, "allow_blank": True}, "image": {"required": False}}

    def validate_image(self, value):
        if value.size > banners.MAX_IMAGE_BYTES:
            raise serializers.ValidationError("The photo must be 5 MB or smaller.")
        return value

    def validate(self, data):
        try:
            if "title" in data:
                data["title"] = banners.clean_text(data["title"], "The title", 140)
            flash = data.get("slot", getattr(self.instance, "slot", None)) == Banner.FLASH
            if flash:
                data["message"] = banners.clean_text(data["message"] if "message" in data else getattr(self.instance, "message", ""), "The message", 200)
                data["alt_text"] = data.get("title") or (self.instance.title if self.instance else "")
            elif "alt_text" in data or self.instance is None:
                data["alt_text"] = banners.clean_text(data.get("alt_text"), "The alt text", 200)
            if "link_path" in data:
                data["link_path"] = banners.clean_link(data["link_path"])
        except banners.BannerError as exc:
            raise serializers.ValidationError({"detail": exc.message}) from exc
        slot = data.get("slot", getattr(self.instance, "slot", None))
        category = data["category"] if "category" in data else getattr(self.instance, "category", None)
        if slot == Banner.CATEGORY_TOP and category is None:
            raise serializers.ValidationError({"category": "Choose the category for a category banner."})
        if slot != Banner.CATEGORY_TOP:
            data["category"] = None
        starts = data.get("starts_at", getattr(self.instance, "starts_at", None))
        ends = data["ends_at"] if "ends_at" in data else getattr(self.instance, "ends_at", None)
        if slot != Banner.FLASH:
            data["message"], data["countdown_ends_at"] = "", None
        else:
            countdown = data["countdown_ends_at"] if "countdown_ends_at" in data else getattr(self.instance, "countdown_ends_at", None)
            if countdown is not None and starts is not None and countdown <= starts:
                raise serializers.ValidationError({"detail": "The countdown must end after the banner starts."})
        try:
            banners.check_window(starts, ends)
        except banners.BannerError as exc:
            raise serializers.ValidationError({"detail": exc.message}) from exc
        return data


def _first_error(errors):
    for key, value in errors.items():
        text = value[0] if isinstance(value, list) else value
        return f"{text}" if key in ("detail", "non_field_errors") else f"{key.replace('_', ' ').capitalize()}: {text}"
    return "Check the form."


class BannerListCreateView(APIView):
    """GET site-banners/ — every banner, newest window first, with its counters. POST — a new draft (multipart)."""

    def get_permissions(self):
        return [HasRolePermission(MANAGE)]

    def get(self, request):
        rows = Banner.objects.select_related(*SELECT)
        if request.query_params.get("state") in dict(Banner.STATE_CHOICES):
            rows = rows.filter(state=request.query_params["state"])
        return Response({
            "banners": [banners.staff_row(b, request) for b in rows[:200]],
            "slots": [{"key": k, **v} for k, v in banners.SLOT_INFO.items()],
            "categories": [{"id": c.pk, "slug": c.slug, "label": c.label} for c in Category.objects.order_by("label")],
            "counters_note": "Views and clicks are first-party counts made by this site's own pages. They began at zero when banners launched.",
        })

    def post(self, request):
        serializer = BannerInput(data=request.data)
        if not serializer.is_valid():
            return Response({"detail": _first_error(serializer.errors), "errors": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
        if "image" not in serializer.validated_data and serializer.validated_data.get("slot") != Banner.FLASH:
            return Response({"detail": "Add the banner photo."}, status=status.HTTP_400_BAD_REQUEST)
        banner = serializer.save(created_by=request.user)
        return Response(banners.staff_row(banner, request), status=status.HTTP_201_CREATED)


class BannerDetailView(APIView):
    """PATCH site-banners/<id>/ — edit a draft, returned or taken-down banner (it goes back to draft)."""

    def get_permissions(self):
        return [HasRolePermission(MANAGE)]

    def patch(self, request, pk):
        with transaction.atomic():
            banner = Banner.objects.select_for_update(of=("self",)).select_related(*SELECT).filter(pk=pk).first()
            if banner is None:
                return Response({"detail": "That banner no longer exists."}, status=404)
            if banner.state not in (Banner.DRAFT, Banner.REJECTED, Banner.TAKEN_DOWN):
                return Response({"detail": "A banner that is waiting or approved can't be edited. Withdraw it or take it down first."}, status=409)
            serializer = BannerInput(banner, data=request.data, partial=True)
            if not serializer.is_valid():
                return Response({"detail": _first_error(serializer.errors), "errors": serializer.errors}, status=400)
            banner = serializer.save(state=Banner.DRAFT, return_note="", approval=None)
        return Response(banners.staff_row(banner, request))


class BannerActionView(APIView):
    """POST site-banners/<id>/<action>/ with action = submit | withdraw | take-down | reschedule | publish
    (publish: flash banners only, straight to live, no Super Admin approval)."""
    action = ""

    def get_permissions(self):
        return [HasRolePermission(MANAGE)]

    def post(self, request, pk):
        try:
            if self.action == "submit":
                banner = banners.submit(pk, request.user, request)
            elif self.action == "withdraw":
                banner = banners.withdraw(pk, request.user, request)
            elif self.action == "publish":
                banner = banners.publish_direct(pk, request.user)
            elif self.action == "take-down":
                banner = banners.take_down(pk, request.user)
            else:
                data = request.data if isinstance(request.data, dict) else {}
                field = serializers.DateTimeField()
                try:
                    starts = field.to_internal_value(data.get("starts_at"))
                    ends_raw = data.get("ends_at")
                    ends = field.to_internal_value(ends_raw) if ends_raw else None
                except serializers.ValidationError:
                    return Response({"detail": "Give the start and the end as dates."}, status=400)
                banner = banners.reschedule(pk, request.user, starts, ends)
        except banners.BannerError as exc:
            return _err(exc)
        banner = Banner.objects.select_related(*SELECT).get(pk=banner.pk)
        return Response(banners.staff_row(banner, request))


# ─── Public: read and count-only beacons ────────────────────────────────────
class PublicBannersView(APIView):
    """GET banners/?slot=home_hero|home_strip|category_top|events_top|flash[&category=<slug>] — live, approved banners only.
    No staff names, counters or notes. Never writes."""
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def get(self, request):
        slot = request.query_params.get("slot", "")
        if slot not in dict(Banner.SLOT_CHOICES):
            return Response({"detail": "Choose a slot."}, status=400)
        rows = Banner.live().filter(slot=slot)
        if slot == Banner.CATEGORY_TOP:
            rows = rows.filter(category__slug=request.query_params.get("category", ""))
        rows = rows.order_by("-starts_at", "-id")[:5]
        return Response({"banners": [banners.public_row(b, request) for b in rows]}, headers={"Cache-Control": "public, max-age=60"})


class BannerBeaconView(APIView):
    """POST banners/<id>/view/ and /click/ — add one to a counter. Nothing is read from the caller
    but the address, which is hashed into a short-lived cache key to ignore repeats and never stored."""
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "banner_beacon"
    kind = ""
    # Seconds a repeat from the same address is ignored.
    quiet = {"view": 1800, "click": 5}

    def post(self, request, pk):
        who = hashlib.sha256((BaseThrottle().get_ident(request) or "?").encode()).hexdigest()[:20]
        if cache.add(f"mkt-banner:{self.kind}:{pk}:{who}", 1, self.quiet[self.kind]):
            counter = "views" if self.kind == "view" else "clicks"
            Banner.live().filter(pk=pk).update(**{counter: F(counter) + 1})
        return Response(status=status.HTTP_204_NO_CONTENT)


# ─── Staff: featured slots ──────────────────────────────────────────────────
class FeaturedGridView(APIView):
    """GET featured/grid/?from=YYYY-MM-DD — four weeks of slots, who holds each, the slot prices."""

    def get_permissions(self):
        return [HasRolePermission(MANAGE)]

    def get(self, request):
        start = None
        raw = request.query_params.get("from")
        if raw:
            try:
                start = date.fromisoformat(raw)
            except ValueError:
                return Response({"detail": "from must be a date like 2026-10-12."}, status=400)
        data = featured.grid(start)
        data["categories"] = [{"id": c.pk, "slug": c.slug, "label": c.label} for c in Category.objects.order_by("label")]
        data["slots"] = [{"key": s.key, "kind": s.kind, "label": s.label, "capacity": s.capacity, "weekly_price": str(s.weekly_price)}
                         for s in featured.FeaturedSlot.objects.filter(active=True)]
        return Response(data)


class FeaturedCandidatesView(APIView):
    """GET featured/candidates/?q= — featured promotions that can still be given a place."""

    def get_permissions(self):
        return [HasRolePermission(MANAGE)]

    def get(self, request):
        return Response({"promotions": featured.candidates(request.query_params.get("q", ""))})


class FeaturedBookView(APIView):
    """POST featured/bookings/ {promotion_id, slot_key, week_start, weeks, category?, position?}"""

    def get_permissions(self):
        return [HasRolePermission(MANAGE)]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            week_start = date.fromisoformat(str(data.get("week_start", "")))
        except ValueError:
            return Response({"detail": "Choose the first week."}, status=400)
        try:
            created = featured.book(
                request.user, promotion_id=data.get("promotion_id"), slot_key=str(data.get("slot_key", "")), week_start=week_start,
                weeks=data.get("weeks", 1), category_id=data.get("category") or None, position=data.get("position") or None,
            )
        except featured.FeaturedError as exc:
            return _err(exc)
        except (TypeError, ValueError):
            return Response({"detail": "Check the booking details."}, status=400)
        return Response({"booked": [b.pk for b in created], "weeks": len(created)}, status=status.HTTP_201_CREATED)


class FeaturedReleaseView(APIView):
    """POST featured/bookings/<id>/release/ {note?} — free that week's place. Not a refund."""

    def get_permissions(self):
        return [HasRolePermission(MANAGE)]

    def post(self, request, pk):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            booking = featured.release(pk, request.user, str(data.get("note", "")))
        except featured.FeaturedError as exc:
            return _err(exc)
        return Response({"id": booking.pk, "status": booking.status})


class PublicFeaturedView(APIView):
    """GET featured/home/[?category=<slug>] — the listings on the featured row right now."""
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def get(self, request):
        slug = request.query_params.get("category") or None
        return Response({"listings": featured.public_listings(slug, request)}, headers={"Cache-Control": "public, max-age=60"})
