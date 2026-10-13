from django.urls import path

from . import views

urlpatterns = [
    path("sign-ins/", views.SignInHistoryView.as_view(), name="staffsecurity-sign-ins"),
    path("exports/", views.ExportsLogView.as_view(), name="staffsecurity-exports"),
    path("policy/", views.PolicyView.as_view(), name="staffsecurity-policy"),
]
