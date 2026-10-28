"""Read shapes of a listing revision: the owner's own view, and the staff queue row and detail."""
from rest_framework import serializers

from . import revisions
from .models import ListingRevision


class OwnerRevisionSerializer(serializers.ModelSerializer):
    """What the owner sees and edits: GET/PUT /api/listings/mine/<id>/revision/."""

    listing = serializers.IntegerField(source="listing_id", read_only=True)
    diff = serializers.SerializerMethodField()

    class Meta:
        model = ListingRevision
        fields = [
            "id", "listing", "status", "changes", "variants", "remove_photo_ids", "remove_video_ids", "new_main_photo",
            "rejection_reason", "submitted_at", "created_at", "updated_at", "diff",
        ]
        read_only_fields = fields

    def get_diff(self, obj):
        return revisions.diff(obj, self.context.get("request"))


class RevisionQueueSerializer(serializers.ModelSerializer):
    """One row of the staff queue."""

    listing = serializers.IntegerField(source="listing_id", read_only=True)
    listing_name = serializers.CharField(source="listing.name", read_only=True)
    listing_status = serializers.CharField(source="listing.status", read_only=True)
    business_owner = serializers.IntegerField(source="listing.business_owner_id", read_only=True)
    business_owner_name = serializers.CharField(source="listing.business_owner.full_name", read_only=True)
    reviewed_by_name = serializers.CharField(source="reviewed_by.full_name", read_only=True, default=None)
    changed_fields = serializers.SerializerMethodField()
    made_by_staff = serializers.BooleanField(source="created_by_staff_id", read_only=True)

    class Meta:
        model = ListingRevision
        fields = [
            "id", "listing", "listing_name", "listing_status", "business_owner", "business_owner_name", "status",
            "rejection_reason", "reviewed_by_name", "reviewed_at", "submitted_at", "created_at", "changed_fields",
            "made_by_staff",
        ]
        read_only_fields = fields

    def get_changed_fields(self, obj):
        names = list(obj.changes)
        if obj.variants:
            names.append("variants")
        if obj.new_main_photo:
            names.append("main_photo")
        if obj.remove_photo_ids or obj.remove_video_ids:
            names.append("photos")
        return names


class RevisionDetailSerializer(RevisionQueueSerializer):
    """The staff detail: the queue row plus the full diff."""

    diff = serializers.SerializerMethodField()

    class Meta(RevisionQueueSerializer.Meta):
        fields = [*RevisionQueueSerializer.Meta.fields, "diff"]
        read_only_fields = fields

    def get_diff(self, obj):
        return revisions.diff(obj, self.context.get("request"))
