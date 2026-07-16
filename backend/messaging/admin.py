from django.contrib import admin

from .models import Conversation, Message


class MessageInline(admin.TabularInline):
    model = Message
    extra = 0


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("id", "customer", "business_owner", "subject", "status", "updated_at")
    list_filter = ("status",)
    inlines = [MessageInline]
