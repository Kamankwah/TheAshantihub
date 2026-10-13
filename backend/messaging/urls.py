from django.urls import path

from . import desk_views as desk
from . import views

urlpatterns = [
    path("conversations/", views.ConversationListCreateView.as_view(), name="conversation-list-create"),
    path(
        "conversations/<int:pk>/messages/",
        views.ConversationMessageCreateView.as_view(),
        name="conversation-message-create",
    ),
    path("staff/", desk.StaffConversationListView.as_view(), name="staff-conversation-list"),
    path("staff/team/", desk.StaffConversationTeamView.as_view(), name="staff-conversation-team"),
    path("staff/limits/", desk.StaffConversationLimitsView.as_view(), name="staff-conversation-limits"),
    path("staff/assign/", desk.StaffConversationBulkAssignView.as_view(), name="staff-conversation-bulk-assign"),
    path("staff/me/away/", desk.StaffConversationAwayView.as_view(), name="staff-conversation-away"),
    path("staff/<int:pk>/", desk.StaffConversationDetailView.as_view(), name="staff-conversation-detail"),
    path("staff/<int:pk>/context/", desk.StaffConversationContextView.as_view(), name="staff-conversation-context"),
    path("staff/<int:pk>/reply/", desk.StaffConversationReplyView.as_view(), name="staff-conversation-reply"),
    path("staff/<int:pk>/note/", desk.StaffConversationNoteView.as_view(), name="staff-conversation-note"),
    path("staff/<int:pk>/assign/", desk.StaffConversationAssignView.as_view(), name="staff-conversation-assign"),
    path("staff/<int:pk>/priority/", desk.StaffConversationPriorityView.as_view(), name="staff-conversation-priority"),
    path("staff/<int:pk>/snooze/", desk.StaffConversationSnoozeView.as_view(), name="staff-conversation-snooze"),
    path("staff/<int:pk>/wake/", desk.StaffConversationWakeView.as_view(), name="staff-conversation-wake"),
    path("staff/<int:pk>/resolve/", desk.StaffConversationResolveView.as_view(), name="staff-conversation-resolve"),
    path("staff/<int:pk>/reopen/", desk.StaffConversationReopenView.as_view(), name="staff-conversation-reopen"),
    path("staff/<int:pk>/tags/", desk.StaffConversationTagsView.as_view(), name="staff-conversation-tags"),
    path("staff/<int:pk>/loop-in/", desk.StaffConversationLoopInView.as_view(), name="staff-conversation-loop-in"),
    path("staff/<int:pk>/ask-accounting/", desk.StaffConversationAskAccountingView.as_view(), name="staff-conversation-ask-accounting"),
    path("staff/<int:pk>/escalate/", desk.StaffConversationEscalateView.as_view(), name="staff-conversation-escalate"),
]
