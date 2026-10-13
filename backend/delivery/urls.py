from django.urls import path

from . import views_fleet, views_live, views_rider

urlpatterns = [
    # ── Rider (delivery.dispatch): the rider app is built on these ──────────────────────────────────
    path("rider/me/", views_rider.MeView.as_view(), name="delivery-rider-me"),
    path("rider/shift/start/", views_rider.ShiftStartView.as_view(), name="delivery-rider-shift-start"),
    path("rider/shift/end/", views_rider.ShiftEndView.as_view(), name="delivery-rider-shift-end"),
    path("rider/shift/break/", views_rider.ShiftBreakView.as_view(), name="delivery-rider-shift-break"),
    path("rider/ping/", views_rider.PingView.as_view(), name="delivery-rider-ping"),
    path("rider/jobs/", views_rider.JobListView.as_view(), name="delivery-rider-jobs"),
    path("rider/jobs/<int:pk>/", views_rider.JobDetailView.as_view(), name="delivery-rider-job"),
    path("rider/jobs/<int:pk>/accept/", views_rider.AcceptView.as_view(), name="delivery-rider-accept"),
    path("rider/jobs/<int:pk>/arrive-pickup/", views_rider.ArrivePickupView.as_view(), name="delivery-rider-arrive-pickup"),
    path("rider/jobs/<int:pk>/pickup/", views_rider.PickupView.as_view(), name="delivery-rider-pickup"),
    path("rider/jobs/<int:pk>/arrive-drop/", views_rider.ArriveDropView.as_view(), name="delivery-rider-arrive-drop"),
    path("rider/jobs/<int:pk>/deliver/", views_rider.DeliverView.as_view(), name="delivery-rider-deliver"),
    path("rider/jobs/<int:pk>/cant-deliver/", views_rider.CantDeliverView.as_view(), name="delivery-rider-cant-deliver"),
    path("rider/jobs/<int:pk>/call/", views_rider.CallCustomerView.as_view(), name="delivery-rider-call"),
    path("rider/jobs/<int:pk>/photo/", views_rider.JobPhotoView.as_view(), name="delivery-rider-photo"),
    path("rider/jobs/<int:pk>/note/", views_rider.JobNoteView.as_view(), name="delivery-rider-note"),
    path("rider/calls/<int:pk>/outcome/", views_rider.CallOutcomeView.as_view(), name="delivery-rider-call-outcome"),
    path("rider/documents/", views_rider.DocumentListCreateView.as_view(), name="delivery-rider-documents"),
    path("rider/issues/", views_rider.IssueView.as_view(), name="delivery-rider-issues"),
    # ── Manager: live (delivery.manage) ────────────────────────────────────────────────────────────
    path("live/", views_live.LiveView.as_view(), name="delivery-live"),
    path("active/", views_live.ActiveView.as_view(), name="delivery-active"),
    path("jobs/<int:pk>/", views_live.JobDetailView.as_view(), name="delivery-job"),
    path("jobs/<int:pk>/flag-decision/", views_live.FlagDecisionView.as_view(), name="delivery-job-flag-decision"),
    path("jobs/<int:pk>/call-rider/", views_live.CallRiderView.as_view(), name="delivery-job-call-rider"),
    path("jobs/<int:pk>/photos/<int:photo_id>/", views_live.PhotoFileView.as_view(), name="delivery-job-photo"),
    # ── Manager: fleet (delivery.fleet) ────────────────────────────────────────────────────────────
    path("riders/", views_fleet.RidersView.as_view(), name="delivery-riders"),
    path("riders/<int:pk>/", views_fleet.RiderDetailView.as_view(), name="delivery-rider"),
    path("riders/<int:pk>/job-hold/", views_fleet.RiderJobHoldView.as_view(), name="delivery-rider-job-hold"),
    path("riders/<int:pk>/reinstate/", views_fleet.RiderReinstateView.as_view(), name="delivery-rider-reinstate"),
    path("documents/", views_fleet.DocumentsView.as_view(), name="delivery-documents"),
    path("documents/<int:pk>/review/", views_fleet.DocumentReviewView.as_view(), name="delivery-document-review"),
    path("documents/<int:pk>/remind/", views_fleet.DocumentRemindView.as_view(), name="delivery-document-remind"),
    path("documents/<int:pk>/file/", views_fleet.DocumentFileView.as_view(), name="delivery-document-file"),
    path("vehicles/", views_fleet.VehiclesView.as_view(), name="delivery-vehicles"),
    path("vehicles/<int:pk>/", views_fleet.VehicleDetailView.as_view(), name="delivery-vehicle"),
    path("vehicles/<int:pk>/assign/", views_fleet.VehicleAssignView.as_view(), name="delivery-vehicle-assign"),
    path("zones/", views_fleet.ZonesView.as_view(), name="delivery-zones"),
    path("zones/<int:pk>/", views_fleet.ZoneDetailView.as_view(), name="delivery-zone"),
    path("invites/", views_fleet.InvitesView.as_view(), name="delivery-invites"),
]
