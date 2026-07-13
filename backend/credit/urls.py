from django.urls import path

from . import views

urlpatterns = [
    path("scores/me/", views.CreditScoreMeView.as_view(), name="credit-score-me"),
    path("scores/", views.CreditScoreStaffListView.as_view(), name="credit-score-list"),
]
