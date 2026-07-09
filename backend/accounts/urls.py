from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.me, name="accounts-me"),
    path("customers/register/", views.CustomerRegisterView.as_view(), name="customer-register"),
]
