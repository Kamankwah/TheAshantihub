from django.urls import path

from . import views, views_step_up

urlpatterns = [
    path("sign-in/send/", views.SignInSendView.as_view(), name="otp-sign-in-send"),
    path("sign-in/verify/", views.SignInVerifyView.as_view(), name="otp-sign-in-verify"),
    path("step-up/send/", views_step_up.StepUpSendView.as_view(), name="otp-step-up-send"),
    path("step-up/verify/", views_step_up.StepUpVerifyView.as_view(), name="otp-step-up-verify"),
]
