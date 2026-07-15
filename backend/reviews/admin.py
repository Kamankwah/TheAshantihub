from django.contrib import admin

from .models import Review


@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = ("id", "target_type", "author", "rating", "status", "verified", "created_at")
    list_filter = ("target_type", "status", "verified")
