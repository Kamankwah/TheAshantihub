from django.urls import path

from . import views

urlpatterns = [
    path("sign-in/send/", views.SignInSendView.as_view(), name="otp-sign-in-send"),
    path("sign-in/verify/", views.SignInVerifyView.as_view(), name="otp-sign-in-verify"),
]
