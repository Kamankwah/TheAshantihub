from django.urls import path

from . import views_consent as consent_views
from . import views_segments as segment_views

urlpatterns = [
    path("consent/summary/", consent_views.ConsentSummaryView.as_view(), name="marketing-consent-summary"),
    path("consent/ledger/", consent_views.ConsentLedgerView.as_view(), name="marketing-consent-ledger"),
    path("consent/ledger/<int:pk>/reveal/", consent_views.ConsentRevealView.as_view(), name="marketing-consent-reveal"),
    path("consent/export/", consent_views.ConsentExportView.as_view(), name="marketing-consent-export"),
    path("consent/wordings/", consent_views.ConsentWordingsView.as_view(), name="marketing-consent-wordings"),
    path("consent/me/", consent_views.ConsentMeView.as_view(), name="marketing-consent-me"),
    path("unsubscribe/<str:token>/", consent_views.UnsubscribeView.as_view(), name="marketing-unsubscribe"),
    path("segments/options/", segment_views.SegmentOptionsView.as_view(), name="marketing-segment-options"),
    path("segments/preview/", segment_views.SegmentPreviewView.as_view(), name="marketing-segment-preview"),
    path("segments/", segment_views.SegmentsView.as_view(), name="marketing-segments"),
    path("segments/<int:pk>/", segment_views.SegmentDetailView.as_view(), name="marketing-segment-detail"),
]
