"""Segments (canvas 06): build an audience of customers or businesses and see how many are reachable. Counts only."""
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from activity.services import record
from listings.models import Category, Zone

from . import audience
from .models_consent import AUDIENCES, BUSINESS, CHANNEL_LABELS, CHANNELS, CUSTOMER, Segment


def rules_text(seg):
    f = seg.filters or {}
    parts = []
    if f.get("zones"):
        parts.append(", ".join(sorted(Zone.objects.filter(pk__in=f["zones"]).values_list("name", flat=True))))
    else:
        parts.append("All zones")
    if f.get("categories"):
        parts.append(" or ".join(sorted(Category.objects.filter(pk__in=f["categories"]).values_list("label", flat=True))))
    activity = f.get("activity", "any")
    label = audience.ACTIVITIES[seg.audience].get(activity, "")
    parts.append(label.replace("N days", f"{f.get('days', 90)} days") if activity != "any" else "any activity")
    return " · ".join(parts)


def used_by(seg):
    """The campaign that last used the segment, as {id, name, at}; None until a campaign uses it."""
    c = seg.campaigns.order_by("-created_at").first()
    return {"id": c.pk, "name": c.name, "at": c.created_at} if c else None


def body(seg, with_count=True):
    data = {
        "id": seg.pk, "name": seg.name, "audience": seg.audience, "audience_label": dict(AUDIENCES)[seg.audience],
        "channel": seg.channel, "channel_label": CHANNEL_LABELS[seg.channel], "filters": seg.filters, "rules": rules_text(seg),
        "created_at": seg.created_at, "created_by": seg.created_by.full_name if seg.created_by_id else None, "last_used": used_by(seg),
    }
    if with_count:
        data["size"] = audience.count_for(seg.audience, seg.filters, seg.channel)["count"]
    return data


def parse(data):
    """(name, audience, channel, filters) from a request body or raises audience.AudienceError."""
    name = str(data.get("name", "")).strip()
    if not name:
        raise audience.AudienceError("Give the segment a name.")
    if len(name) > 120:
        raise audience.AudienceError("Keep the name under 120 characters.")
    who, channel = data.get("audience"), data.get("channel")
    if channel not in CHANNEL_LABELS:
        raise audience.AudienceError("Choose a channel.")
    return name, who, channel, audience.clean_filters(who, data.get("filters"))


class SegmentOptionsView(APIView):
    """GET segments/options/ — what the builder offers: zones, categories, activities."""

    def get_permissions(self):
        return [HasRolePermission("campaigns.manage")]

    def get(self, request):
        return Response({
            "zones": [{"id": z.pk, "name": z.name} for z in Zone.objects.order_by("name")],
            "categories": [{"id": c.pk, "label": c.label, "kind": c.kind} for c in Category.objects.order_by("label")],
            "activities": {who: [{"key": k, "label": v} for k, v in options.items()] for who, options in audience.ACTIVITIES.items()},
            "channels": [{"key": k, "label": v} for k, v in CHANNELS],
            "audiences": [{"key": k, "label": v} for k, v in AUDIENCES],
            "zone_note": "Zone for customers is where they have bought or booked (the listing's zone). Customers have no zone of their own on file.",
        })


class SegmentPreviewView(APIView):
    """POST segments/preview/ — the live count for the rules as drawn (nothing is saved)."""

    def get_permissions(self):
        return [HasRolePermission("campaigns.manage")]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        channel = data.get("channel")
        if channel not in CHANNEL_LABELS:
            return Response({"detail": "Choose a channel."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = audience.count_for(data.get("audience"), data.get("filters"), channel)
            result["by_channel"] = {
                key: audience.reachable(data["audience"], result["filters"], key).count() for key in CHANNEL_LABELS
            }
        except audience.AudienceError as exc:
            return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)


class SegmentsView(APIView):
    """GET segments/ — saved segments with their size now. POST — save one."""

    def get_permissions(self):
        return [HasRolePermission("campaigns.manage")]

    def get(self, request):
        rows = Segment.objects.filter(archived_at__isnull=True).select_related("created_by")[:100]
        return Response({"results": [body(seg) for seg in rows]})

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            name, who, channel, filters = parse(data)
        except audience.AudienceError as exc:
            return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        seg = Segment.objects.create(name=name, audience=who, channel=channel, filters=filters, created_by=request.user)
        return Response(body(seg), status=status.HTTP_201_CREATED)


class SegmentDetailView(APIView):
    """PATCH segments/<id>/ — change a saved segment. DELETE — remove it from the list (campaigns that used it keep their own copy of the rules)."""

    def get_permissions(self):
        return [HasRolePermission("campaigns.manage")]

    def _segment(self, pk):
        return Segment.objects.filter(pk=pk, archived_at__isnull=True).select_related("created_by").first()

    def patch(self, request, pk):
        seg = self._segment(pk)
        if seg is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        data = request.data if isinstance(request.data, dict) else {}
        merged = {"name": seg.name, "audience": seg.audience, "channel": seg.channel, "filters": seg.filters, **data}
        try:
            seg.name, seg.audience, seg.channel, seg.filters = parse(merged)
        except audience.AudienceError as exc:
            return Response({"detail": exc.message}, status=status.HTTP_400_BAD_REQUEST)
        seg.save()
        return Response(body(seg))

    def delete(self, request, pk):
        seg = self._segment(pk)
        if seg is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        seg.archived_at = timezone.now()
        seg.save(update_fields=["archived_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)
