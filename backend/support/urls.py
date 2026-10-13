from django.urls import path

from . import views

urlpatterns = [
    path("staff/people/", views.PeopleLookupView.as_view(), name="support-people-lookup"),
    path("staff/people/recent/", views.PeopleRecentView.as_view(), name="support-people-recent"),
    path("staff/customers/<int:pk>/360/", views.CustomerProfileView.as_view(), name="support-customer-360"),
    path("staff/businesses/<int:pk>/360/", views.BusinessProfileView.as_view(), name="support-business-360"),
    path("staff/profile-opened/", views.ProfileOpenedView.as_view(), name="support-profile-opened"),
    path(
        "staff/customers/<int:pk>/start-conversation/", views.StartConversationView.as_view(),
        name="staff-conversation-start",
    ),
]
