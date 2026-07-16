from django.contrib import admin

from .models import ContactMessage


@admin.register(ContactMessage)
class ContactMessageAdmin(admin.ModelAdmin):
    list_display = ("id", "category", "name", "email", "status", "created_at")
    list_filter = ("category", "status")
