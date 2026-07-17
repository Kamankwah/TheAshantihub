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
        "password-reset/request/",
        views.PasswordResetRequestView.as_view(),
        name="password-reset-request",
    ),
    path(
        "password-reset/confirm/",
        views.PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
    path("customers/login/", views.CustomerLoginView.as_view(), name="customer-login"),
    path(
        "customers/me/profile/",
        views.CustomerProfileUpdateView.as_view(),
        name="customer-profile-update",
    ),
    path(
        "customers/me/secondary-email/",
        views.CustomerSecondaryEmailRequestView.as_view(),
        name="customer-secondary-email-request",
    ),
    path(
        "customers/me/secondary-email/confirm/",
        views.CustomerSecondaryEmailConfirmView.as_view(),
        name="customer-secondary-email-confirm",
    ),
    path(
        "customers/me/secondary-phone/",
        views.CustomerSecondaryPhoneRequestView.as_view(),
        name="customer-secondary-phone-request",
    ),
    path(
        "customers/me/secondary-phone/confirm/",
        views.CustomerSecondaryPhoneConfirmView.as_view(),
        name="customer-secondary-phone-confirm",
    ),
    path("business-owners/login/", views.BusinessOwnerLoginView.as_view(), name="business-owner-login"),
    path("staff/login/", views.StaffLoginView.as_view(), name="staff-login"),
    path(
        "business-owners/register/",
        views.BusinessOwnerRegisterView.as_view(),
        name="business-owner-register",
    ),
    path("business-owners/me/payout/", views.PayoutDetailUpdateView.as_view(), name="payout-update"),
    path(
        "business-owners/me/profile/",
        views.BusinessOwnerProfileUpdateView.as_view(),
        name="business-owner-profile-update",
    ),
    path("business-owners/me/terms/", views.TermsAcceptView.as_view(), name="business-owner-terms"),
    path("kyc/pending/", views.KYCPendingQueueView.as_view(), name="kyc-pending"),
    path("kyc/<int:pk>/", views.KYCDetailView.as_view(), name="kyc-detail"),
    path("kyc/<int:pk>/approve/", views.KYCApproveView.as_view(), name="kyc-approve"),
    path("kyc/<int:pk>/reject/", views.KYCRejectView.as_view(), name="kyc-reject"),
    path("customers/", views.CustomerListView.as_view(), name="customer-list"),
    path("customers/<int:pk>/", views.StaffCustomerDetailView.as_view(), name="staff-customer-detail"),
    path(
        "customers/<int:pk>/suspend/",
        views.StaffCustomerSuspendView.as_view(),
        name="staff-customer-suspend",
    ),
    path(
        "customers/<int:pk>/unsuspend/",
        views.StaffCustomerUnsuspendView.as_view(),
        name="staff-customer-unsuspend",
    ),
    path("business-owners/", views.BusinessOwnerListView.as_view(), name="business-owner-list"),
    path(
        "business-owners/<int:pk>/",
        views.StaffBusinessOwnerDetailView.as_view(),
        name="staff-business-owner-detail",
    ),
    path(
        "business-owners/<int:pk>/suspend/",
        views.StaffBusinessOwnerSuspendView.as_view(),
        name="staff-business-owner-suspend",
    ),
    path(
        "business-owners/<int:pk>/unsuspend/",
        views.StaffBusinessOwnerUnsuspendView.as_view(),
        name="staff-business-owner-unsuspend",
    ),
    path("staff/", views.StaffListView.as_view(), name="staff-list"),
]
