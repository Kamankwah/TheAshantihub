from django.urls import path

from . import views

urlpatterns = [
    path("conversations/", views.ConversationListCreateView.as_view(), name="conversation-list-create"),
    path(
        "conversations/<int:pk>/messages/",
        views.ConversationMessageCreateView.as_view(),
        name="conversation-message-create",
    ),
    path("staff/", views.StaffConversationListView.as_view(), name="staff-conversation-list"),
    path("staff/<int:pk>/", views.StaffConversationDetailView.as_view(), name="staff-conversation-detail"),
    path("staff/<int:pk>/reply/", views.StaffConversationReplyView.as_view(), name="staff-conversation-reply"),
]
