from django.contrib import admin

from .models import Dispute


@admin.register(Dispute)
class DisputeAdmin(admin.ModelAdmin):
    list_display = ("id", "order", "reason", "status", "refund_amount", "created_at")
    list_filter = ("reason", "status")
