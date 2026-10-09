from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.MyCommissionView.as_view(), name="commission-me"),
    path("accruals/", views.AccrualsView.as_view(), name="commission-accruals"),
    path("policies/", views.PoliciesView.as_view(), name="commission-policies"),
]
