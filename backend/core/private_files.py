"""Private storage for identity documents, served only through short-lived signed links.

Anything under MEDIA_ROOT is served by nginx to whoever has the URL, forever. A national-ID photo must not be: one
leaked link (a screenshot, a referrer, a log line) would expose it permanently (review BE-01). Files here live under
PRIVATE_MEDIA_ROOT/<area>/, which nginx never serves. ``storage.url(name)`` returns a signed link to
``PrivateFileView`` that stops working after ``LINK_SECONDS``; serializers keep calling ``.url`` / ``ImageField`` as
before, and the link is minted only while building a response for a caller the API already authorised, so there is no
second permission check to keep in step. Names are random (``random_name``), so a name never says whose file it is.
"""
import os
import re
import uuid
from pathlib import Path

from django.conf import settings
from django.core import signing
from django.core.files.storage import FileSystemStorage
from django.urls import reverse

SALT = "ashantihub.private-file.v1"
LINK_SECONDS = 15 * 60


class PrivateAreaStorage(FileSystemStorage):
    """One folder under PRIVATE_MEDIA_ROOT, resolved on every use so a test can point the setting at a temp folder."""

    area = ""

    @property
    def base_location(self):
        return str(Path(settings.PRIVATE_MEDIA_ROOT) / self.area)

    @property
    def location(self):
        return str(Path(self.base_location).resolve())

    def url(self, name):
        token = signing.dumps({"a": self.area, "n": name}, salt=SALT, compress=False)
        return f"{reverse('private-file')}?t={token}"


class KycStorage(PrivateAreaStorage):
    area = "kyc"


# Areas PrivateFileView may open. A signed token naming any other area is refused.
AREAS = {"kyc": KycStorage}


def kyc_storage():
    return KycStorage()


def random_name(folder, filename):
    """``<folder>/<32 hex>.<ext>``: unguessable and free of whatever the client called the file."""
    ext = os.path.splitext(filename or "")[1].lower()
    ext = ext if re.fullmatch(r"\.[a-z0-9]{1,8}", ext) else ""
    return f"{folder}/{uuid.uuid4().hex}{ext}"


def ghana_card_path(instance, filename):
    return random_name("ghana_cards", filename)


def registration_certificate_path(instance, filename):
    return random_name("business_reg_certificates", filename)


def open_signed(token):
    """The (storage, name) a valid, unexpired token names, or None."""
    try:
        data = signing.loads(token, salt=SALT, max_age=LINK_SECONDS)
        storage = AREAS[data["a"]]()
        name = data["n"]
    except (signing.BadSignature, KeyError, TypeError):
        return None
    return storage, name
