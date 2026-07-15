from django.utils import timezone
from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsCustomer
from events.models import Event
from listings.models import Listing

from .models import Question
from .permissions import IsQuestionOwner
from .serializers import QuestionAnswerSerializer, QuestionAskSerializer, QuestionSerializer


class QuestionAskView(APIView):
    """POST /api/qa/questions/ — an authenticated customer asks a question
    about a listing or event. Resolves the target (404 if missing) and
    creates the Question with asked_by=request.user.
    """

    permission_classes = [IsAuthenticated, IsCustomer]

    def post(self, request):
        serializer = QuestionAskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        target_type = data["target_type"]
        target_id = data["target_id"]

        target_kwargs = {}
        if target_type == Question.LISTING:
            generics.get_object_or_404(Listing, pk=target_id)
            target_kwargs["listing_id"] = target_id
        else:
            generics.get_object_or_404(Event, pk=target_id)
            target_kwargs["event_id"] = target_id

        question = Question.objects.create(
            target_type=target_type,
            asked_by=request.user,
            question_text=data["question_text"],
            **target_kwargs,
        )
        return Response(QuestionSerializer(question).data, status=201)


class QuestionPagination(PageNumberPagination):
    page_size = 20


class ListingQuestionListView(generics.ListAPIView):
    """GET /api/qa/questions/listing/<pk>/ — public, paginated."""

    serializer_class = QuestionSerializer
    permission_classes = [AllowAny]
    pagination_class = QuestionPagination

    def get_queryset(self):
        return Question.objects.filter(
            target_type=Question.LISTING, listing_id=self.kwargs["pk"]
        )


class EventQuestionListView(generics.ListAPIView):
    """GET /api/qa/questions/event/<pk>/ — public, paginated."""

    serializer_class = QuestionSerializer
    permission_classes = [AllowAny]
    pagination_class = QuestionPagination

    def get_queryset(self):
        return Question.objects.filter(
            target_type=Question.EVENT, event_id=self.kwargs["pk"]
        )


class QuestionAnswerView(APIView):
    """POST /api/qa/questions/{id}/answer/ — body {"answer_text": "..."},
    ownership-checked (not permission-checked) against the target's derived
    owner via IsQuestionOwner.
    """

    permission_classes = [IsAuthenticated, IsQuestionOwner]

    def post(self, request, pk):
        question = generics.get_object_or_404(Question, pk=pk)
        self.check_object_permissions(request, question)

        serializer = QuestionAnswerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        question.answer_text = serializer.validated_data["answer_text"]
        question.answered_at = timezone.now()
        question.save(update_fields=["answer_text", "answered_at"])
        return Response(QuestionSerializer(question).data)
