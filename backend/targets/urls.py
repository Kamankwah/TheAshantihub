from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MyTargetsView.as_view(), name="targets-me"),
    path("plans/", views.PlansView.as_view(), name="targets-plans"),
    path("plans/preview/", views.PlansPreviewView.as_view(), name="targets-plans-preview"),
    path("history/", views.TargetsHistoryView.as_view(), name="targets-history"),
    path("limits/", views.LimitsView.as_view(), name="targets-limits"),
    path("holidays/", views.HolidaysView.as_view(), name="targets-holidays"),
    path("holidays/<int:pk>/", views.HolidayDetailView.as_view(), name="targets-holiday-detail"),
    path("leave/", views.LeaveView.as_view(), name="targets-leave"),
    path("leave/preview/", views.LeavePreviewView.as_view(), name="targets-leave-preview"),
    path("leave/<int:pk>/", views.LeaveDetailView.as_view(), name="targets-leave-detail"),
    path("work-pattern/<str:staff>/", views.WorkPatternView.as_view(), name="targets-work-pattern"),
]
