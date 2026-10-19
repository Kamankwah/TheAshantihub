"""Test helper: move the marketplace opening into the past so shopper buy endpoints work."""
from datetime import timedelta

from django.utils import timezone

from .models import OpeningTime


def open_marketplace():
    """Make the marketplace open now, whatever the gate flag says."""
    return OpeningTime.objects.create(opens_at=timezone.now() - timedelta(days=1), reason="test: open marketplace")


def close_marketplace(days=30):
    """Make the opening `days` from now, so a test of the closed marketplace never depends on the real date."""
    return OpeningTime.objects.create(opens_at=timezone.now() + timedelta(days=days), reason="test: close marketplace")
