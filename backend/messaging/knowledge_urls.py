from django.urls import path

from . import knowledge as k

urlpatterns = [
    path("staff/canned/", k.StaffCannedListView.as_view(), name="staff-canned-list"),
    path("staff/canned/fields/", k.StaffCannedFieldsView.as_view(), name="staff-canned-fields"),
    path("staff/canned/preview/", k.StaffCannedPreviewView.as_view(), name="staff-canned-preview"),
    path("staff/canned/<int:pk>/", k.StaffCannedDetailView.as_view(), name="staff-canned-detail"),
    path("staff/canned/<int:pk>/retire/", k.StaffCannedRetireView.as_view(), name="staff-canned-retire"),
    path("staff/canned/<int:pk>/restore/", k.StaffCannedRestoreView.as_view(), name="staff-canned-restore"),
    path("staff/canned/<int:pk>/use/", k.StaffCannedUseView.as_view(), name="staff-canned-use"),
    path("staff/tags/", k.StaffTagListView.as_view(), name="staff-tag-list"),
    path("staff/tags/<int:pk>/", k.StaffTagDetailView.as_view(), name="staff-tag-detail"),
    path("staff/tags/<int:pk>/archive/", k.StaffTagArchiveView.as_view(), name="staff-tag-archive"),
    path("staff/tags/<int:pk>/unarchive/", k.StaffTagUnarchiveView.as_view(), name="staff-tag-unarchive"),
    path("staff/tags/<int:pk>/merge/", k.StaffTagMergeView.as_view(), name="staff-tag-merge"),
]
