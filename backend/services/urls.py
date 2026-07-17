from django.urls import path

from . import views

urlpatterns = [
    path("requests/", views.ServiceRequestCreateView.as_view(), name="service-request-create"),
    path("requests/mine/", views.MyServiceRequestsView.as_view(), name="service-request-mine"),
    path("requests/incoming/", views.IncomingServiceRequestsView.as_view(), name="service-request-incoming"),
    path("requests/<int:pk>/respond/", views.ServiceRequestRespondView.as_view(), name="service-request-respond"),
    path("requests/<int:pk>/pay/", views.ServiceRequestPayView.as_view(), name="service-request-pay"),
    path("requests/<int:pk>/progress/", views.ServiceRequestProgressView.as_view(), name="service-request-progress"),
    path("requests/<int:pk>/complete/", views.ServiceRequestCompleteView.as_view(), name="service-request-complete"),
]
