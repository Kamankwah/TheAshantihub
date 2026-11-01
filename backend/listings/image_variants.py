"""Resized WebP copies of listing photos, so a phone on mobile data loads a small file first.

The original upload is never touched or replaced. `build` writes up to three variants; any width the source is not
larger than is skipped and `urls` falls back to the original for it, so a response always has all three keys."""
import io
import logging
import uuid

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

WIDTHS = {"thumb": 320, "medium": 800, "large": 1600}
QUALITY = 80
FOLDER = "listing_photos/variants/"


def _read(image_file):
    opened_here = False
    if hasattr(image_file, "storage"):  # a stored FieldFile: open it from the storage
        image_file.open("rb")
        opened_here = True
    else:
        image_file.seek(0)
    try:
        return image_file.read()
    finally:
        if opened_here:
            image_file.close()


def build(image_file):
    """{variant name: stored path} for the widths the source is larger than; {} for an unreadable image."""
    try:
        source = Image.open(io.BytesIO(_read(image_file)))
        source.load()
        source = ImageOps.exif_transpose(source)
        if source.mode not in ("RGB", "RGBA"):
            source = source.convert("RGBA" if "A" in source.mode else "RGB")
    except Exception:
        logger.warning("Couldn't read an image to resize it", exc_info=True)
        return {}
    stored = {}
    for name, width in WIDTHS.items():
        if max(source.size) <= width:
            continue
        copy = source.copy()
        copy.thumbnail((width, width), Image.LANCZOS)
        buffer = io.BytesIO()
        copy.save(buffer, "WEBP", quality=QUALITY)
        stored[name] = default_storage.save(f"{FOLDER}{uuid.uuid4().hex}_{width}.webp", ContentFile(buffer.getvalue()))
    return stored


def urls(request, stored, original):
    """All three variant URLs, absolute when a request is given; a missing variant is the original's URL."""
    fallback = original.url if original else None
    result = {}
    for name in WIDTHS:
        path = (stored or {}).get(name)
        url = default_storage.url(path) if path else fallback
        result[name] = request.build_absolute_uri(url) if (request is not None and url) else url
    return result


def refresh(instance, image_field, variants_field):
    """Rebuild `instance`'s variants when its image changed since they were made (the stored "src" is the image name
    they came from). A conditional UPDATE, so saving never loops."""
    image = getattr(instance, image_field)
    current = getattr(instance, variants_field) or {}
    src = image.name if image else ""
    if current.get("src", "") == src and (src or not current):
        return
    fresh = {"src": src, **build(image)} if src else {}
    type(instance).objects.filter(pk=instance.pk).update(**{variants_field: fresh})
    setattr(instance, variants_field, fresh)


def on_photo_saved(sender, instance, **kwargs):
    refresh(instance, "image", "variants")


def on_listing_saved(sender, instance, **kwargs):
    refresh(instance, "main_photo", "main_photo_variants")
