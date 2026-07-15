from django.urls import path

from . import views

urlpatterns = [
    path("questions/", views.QuestionAskView.as_view(), name="question-ask"),
    path("questions/listing/<int:pk>/", views.ListingQuestionListView.as_view(), name="question-list-listing"),
    path("questions/event/<int:pk>/", views.EventQuestionListView.as_view(), name="question-list-event"),
    path("questions/<int:pk>/answer/", views.QuestionAnswerView.as_view(), name="question-answer"),
]
