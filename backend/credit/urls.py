from django.urls import path

from . import views

urlpatterns = [
    path("scores/me/", views.CreditScoreMeView.as_view(), name="credit-score-me"),
    path("scores/", views.CreditScoreStaffListView.as_view(), name="credit-score-list"),
    path("scores/<int:pk>/adjust/", views.CreditScoreAdjustView.as_view(), name="credit-score-adjust"),

    path("partners/", views.LendingPartnerListCreateView.as_view(), name="lending-partner-list"),
    path("partners/<int:pk>/", views.LendingPartnerDetailView.as_view(), name="lending-partner-detail"),

    path("loans/", views.LoanApplicationStaffListView.as_view(), name="loan-application-list"),
    path("loans/submit/", views.LoanApplicationCreateView.as_view(), name="loan-application-create"),
    path("loans/mine/", views.MyLoanApplicationsView.as_view(), name="loan-application-mine"),
    path("loans/<int:pk>/review/", views.LoanApplicationReviewView.as_view(), name="loan-application-review"),
]
