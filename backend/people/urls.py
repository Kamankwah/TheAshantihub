from django.urls import path

from . import directory, invites, profile, sessions_overview, teams

urlpatterns = [
    path("staff/", directory.StaffDirectoryView.as_view(), name="people-staff"),
    path("staff/counts/", directory.StaffDirectoryCountsView.as_view(), name="people-staff-counts"),
    path("staff/export/", directory.StaffDirectoryExportView.as_view(), name="people-staff-export"),
    path("staff/<int:pk>/", profile.StaffProfileView.as_view(), name="people-staff-profile"),
    path("staff/<int:pk>/role/", teams.ChangeRoleView.as_view(), name="people-staff-role"),
    path("teams/", teams.OrgChartView.as_view(), name="people-teams"),
    path("teams/reassign/", teams.ReassignManagerView.as_view(), name="people-teams-reassign"),
    path("invites/", invites.InviteListView.as_view(), name="people-invites"),
    path("sessions/", sessions_overview.SessionsOverviewView.as_view(), name="people-sessions"),
    path("sessions/sign-out-all/", sessions_overview.SignOutEveryoneView.as_view(), name="people-sessions-sign-out-all"),
]
