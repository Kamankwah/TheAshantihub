from django.urls import path

from . import views

urlpatterns = [
    path("register/check/", views.RegisterCheckView.as_view(), name="portfolio-register-check"),
    path("register/", views.RegisterBusinessView.as_view(), name="portfolio-register"),
    path("businesses/<int:pk>/kyc/", views.KycResubmitView.as_view(), name="portfolio-kyc-resubmit"),
    path("businesses/<int:pk>/handover/", views.HandoverView.as_view(), name="portfolio-handover"),
    path("businesses/<int:pk>/claim-link/", views.ClaimLinkView.as_view(), name="portfolio-claim-link"),
]
