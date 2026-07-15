from django.contrib import admin

from .models import Question


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("id", "target_type", "asked_by", "answered_at", "created_at")
    list_filter = ("target_type",)
