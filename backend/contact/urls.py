from django.urls import path

from . import views

urlpatterns = [
    path("core/contact/", views.ContactMessageSubmitView.as_view(), name="contact-submit"),
    path("core/contact-messages/", views.ContactMessageListView.as_view(), name="contact-message-list"),
    path(
        "core/contact-messages/<int:pk>/read/",
        views.ContactMessageMarkReadView.as_view(),
        name="contact-message-read",
    ),
    path(
        "core/contact-messages/<int:pk>/resolve/",
        views.ContactMessageResolveView.as_view(),
        name="contact-message-resolve",
    ),
]
