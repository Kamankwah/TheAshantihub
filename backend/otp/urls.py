from django.urls import path

from . import views, views_account, views_authenticator, views_step_up

urlpatterns = [
    path("sign-in/send/", views.SignInSendView.as_view(), name="otp-sign-in-send"),
    path("sign-in/verify/", views.SignInVerifyView.as_view(), name="otp-sign-in-verify"),
    path("step-up/send/", views_step_up.StepUpSendView.as_view(), name="otp-step-up-send"),
    path("step-up/verify/", views_step_up.StepUpVerifyView.as_view(), name="otp-step-up-verify"),
    path("authenticator/", views_authenticator.AuthenticatorView.as_view(), name="otp-authenticator"),
    path("authenticator/setup/", views_authenticator.AuthenticatorSetupView.as_view(), name="otp-authenticator-setup"),
    path("authenticator/setup/confirm/", views_authenticator.AuthenticatorConfirmView.as_view(), name="otp-authenticator-confirm"),
    path("authenticator/recovery-codes/", views_authenticator.AuthenticatorRecoveryCodesView.as_view(), name="otp-authenticator-recovery-codes"),
    path("authenticator/disable/", views_authenticator.AuthenticatorDisableView.as_view(), name="otp-authenticator-disable"),
    path("me/", views_account.SecurityOverviewView.as_view(), name="otp-me"),
    path("devices/<int:pk>/remove/", views_account.TrustedDeviceRemoveView.as_view(), name="otp-device-remove"),
    path("devices/remove-all/", views_account.TrustedDeviceRemoveAllView.as_view(), name="otp-devices-remove-all"),
]
