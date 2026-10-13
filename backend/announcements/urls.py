from django.urls import path

from . import views

urlpatterns = [
    path("", views.AnnouncementListView.as_view(), name="announcement-list"),
    path("mine/", views.MineView.as_view(), name="announcement-mine"),
    path("mine/<int:pk>/open/", views.MineOpenView.as_view(), name="announcement-mine-open"),
    path("mine/<int:pk>/confirm/", views.MineConfirmView.as_view(), name="announcement-mine-confirm"),
    path("<int:pk>/", views.AnnouncementDetailView.as_view(), name="announcement-detail"),
    path("<int:pk>/cancel/", views.AnnouncementCancelView.as_view(), name="announcement-cancel"),
    path("<int:pk>/remind/", views.AnnouncementRemindView.as_view(), name="announcement-remind"),
]
