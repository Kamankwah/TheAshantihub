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
    path(
        "core/contact-messages/<int:pk>/mark-unread/",
        views.ContactMessageMarkUnreadView.as_view(),
        name="contact-message-mark-unread",
    ),
    path(
        "core/contact-messages/<int:pk>/reply/",
        views.ContactMessageReplyView.as_view(),
        name="contact-message-reply",
    ),
    path(
        "core/contact-messages/<int:pk>/pass-to-operations/",
        views.ContactMessagePassToOperationsView.as_view(),
        name="contact-message-pass-to-operations",
    ),
]
