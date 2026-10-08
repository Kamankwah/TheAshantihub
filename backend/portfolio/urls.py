from django.urls import path

from . import views

urlpatterns = [
    path("register/check/", views.RegisterCheckView.as_view(), name="portfolio-register-check"),
    path("register/", views.RegisterBusinessView.as_view(), name="portfolio-register"),
    path("businesses/<int:pk>/kyc/", views.KycResubmitView.as_view(), name="portfolio-kyc-resubmit"),
    path("businesses/<int:pk>/handover/", views.HandoverView.as_view(), name="portfolio-handover"),
    path("businesses/<int:pk>/claim-link/", views.ClaimLinkView.as_view(), name="portfolio-claim-link"),
    path("businesses/", views.PortfolioListView.as_view(), name="portfolio-business-list"),
    path("businesses/<int:pk>/", views.PortfolioBusinessDetailView.as_view(), name="portfolio-business-detail"),
    path("businesses/<int:pk>/review/", views.BusinessReviewView.as_view(), name="portfolio-business-review"),
    path("businesses/<int:pk>/reassign/", views.ReassignBusinessView.as_view(), name="portfolio-reassign"),
    path("businesses/<int:pk>/follow-up/", views.BusinessFollowUpView.as_view(), name="portfolio-follow-up"),
    path("subscriptions-due/", views.SubscriptionsDueView.as_view(), name="portfolio-subscriptions-due"),
]
