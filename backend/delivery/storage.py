"""Private storage for rider papers and delivery photos. Never under MEDIA_ROOT (nginx serves
that to anyone): files are served only through permission-checked views."""
from pathlib import Path

from django.conf import settings
from django.core.files.storage import FileSystemStorage


class PrivateDeliveryStorage(FileSystemStorage):
    """Resolves its folder from settings on every use, so a test can point
    PRIVATE_MEDIA_ROOT at a temporary directory."""

    @property
    def base_location(self):
        return str(Path(settings.PRIVATE_MEDIA_ROOT) / "delivery")

    @property
    def location(self):
        return str(Path(self.base_location).resolve())

    def url(self, name):  # never a public URL
        raise ValueError("Delivery files are served by an authenticated view only.")


def private_storage():
    return PrivateDeliveryStorage()
