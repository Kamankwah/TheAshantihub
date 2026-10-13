from django.urls import path

from . import views_campaigns as v

urlpatterns = [
    path("campaigns/", v.CampaignsView.as_view(), name="marketing-campaigns"),
    path("campaigns/estimate/", v.CampaignPreviewCountView.as_view(), name="marketing-campaign-estimate"),
    path("campaigns/<int:pk>/", v.CampaignDetailView.as_view(), name="marketing-campaign-detail"),
    path("campaigns/<int:pk>/send/", v.CampaignSendView.as_view(), name="marketing-campaign-send"),
    path("campaigns/<int:pk>/withdraw/", v.CampaignWithdrawView.as_view(), name="marketing-campaign-withdraw"),
    path("campaigns/<int:pk>/duplicate/", v.CampaignDuplicateView.as_view(), name="marketing-campaign-duplicate"),
    path("campaigns/<int:pk>/remind/", v.CampaignRemindView.as_view(), name="marketing-campaign-remind"),
    path("campaigns/<int:pk>/test/", v.CampaignTestView.as_view(), name="marketing-campaign-test"),
    path("campaigns/<int:pk>/results/", v.CampaignResultsView.as_view(), name="marketing-campaign-results"),
    path("results/campaigns/", v.CampaignResultsListView.as_view(), name="marketing-results-list"),
    path("calendar/", v.CalendarView.as_view(), name="marketing-calendar"),
    path("r/<str:token>/", v.TrackedLinkView.as_view(), name="marketing-tracked-link"),
]
