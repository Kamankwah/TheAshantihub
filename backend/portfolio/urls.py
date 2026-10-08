from django.urls import path

from . import views

urlpatterns = [
    path("register/check/", views.RegisterCheckView.as_view(), name="portfolio-register-check"),
    path("register/", views.RegisterBusinessView.as_view(), name="portfolio-register"),
    path("businesses/<int:pk>/kyc/", views.KycResubmitView.as_view(), name="portfolio-kyc-resubmit"),
]
