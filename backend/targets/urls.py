from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MyTargetsView.as_view(), name="targets-me"),
    path("plans/", views.PlansView.as_view(), name="targets-plans"),
    path("limits/", views.LimitsView.as_view(), name="targets-limits"),
    path("holidays/", views.HolidaysView.as_view(), name="targets-holidays"),
    path("holidays/<int:pk>/", views.HolidayDetailView.as_view(), name="targets-holiday-detail"),
    path("leave/", views.LeaveView.as_view(), name="targets-leave"),
    path("leave/<int:pk>/", views.LeaveDetailView.as_view(), name="targets-leave-detail"),
    path("work-pattern/<str:staff>/", views.WorkPatternView.as_view(), name="targets-work-pattern"),
]
