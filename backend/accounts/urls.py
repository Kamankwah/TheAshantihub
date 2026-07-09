from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.me, name="accounts-me"),
    path("customers/register/", views.CustomerRegisterView.as_view(), name="customer-register"),
    path("staff/invite/", views.StaffInviteView.as_view(), name="staff-invite"),
    path("staff/activate/", views.StaffActivateView.as_view(), name="staff-activate"),
    path(
        "staff/<int:pk>/resend-invite/",
        views.StaffResendInviteView.as_view(),
        name="staff-resend-invite",
    ),
    path(
        "business-owners/register/",
        views.BusinessOwnerRegisterView.as_view(),
        name="business-owner-register",
    ),
]
