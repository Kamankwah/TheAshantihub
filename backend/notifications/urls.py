from django.urls import path

from . import views

urlpatterns = [
    path("", views.NotificationListView.as_view(), name="notification-list"),
    path("read-all/", views.NotificationReadAllView.as_view(), name="notification-read-all"),
    path("staff-badges/", views.StaffBadgesView.as_view(), name="notification-staff-badges"),
    path("<int:pk>/read/", views.NotificationMarkReadView.as_view(), name="notification-read"),
]
