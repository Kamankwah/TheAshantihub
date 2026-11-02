"""Resized WebP copies of listing photos, so a phone on mobile data loads a small file first.

The original upload is never touched or replaced. `build` writes up to three variants; any width the source is not
larger than is skipped and `urls` falls back to the original for it, so a response always has all three keys.

Variants are made only when a new image is saved (the file is not yet committed to storage), never on an ordinary
save of an existing row, and a failure here never fails the save: the row just has no variants until
`manage.py backfill_image_variants` runs."""
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
# An image with more pixels than this is not decoded (a 5 MB upload can hold a very large flat image); originals still serve.
MAX_PIXELS = 40_000_000


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


def _decode(data):
    """The photo as a Pillow image at most 1600 px on its long side, or None when it is unreadable or too large."""
    try:
        source = Image.open(io.BytesIO(data))
        if source.width * source.height > MAX_PIXELS:
            logger.warning("Not resizing a %sx%s image", source.width, source.height)
            return None
        if source.format == "JPEG":
            source.draft("RGB", (WIDTHS["large"], WIDTHS["large"]))  # decode at a reduced scale, saving memory
        source.load()
        source = ImageOps.exif_transpose(source)
        if source.mode not in ("RGB", "RGBA"):
            source = source.convert("RGBA" if "A" in source.mode else "RGB")
        return source
    except Exception:
        logger.warning("Couldn't read an image to resize it", exc_info=True)
        return None


def build(image_file):
    """{variant name: stored path} for the widths the source is larger than; {} for an unreadable or huge image.
    A storage error propagates, so the caller can tell "nothing to make" from "could not make it"."""
    source = _decode(_read(image_file))
    if source is None:
        return {}
    stored = {}
    # Shrink step by step from the largest, so each size works on a smaller picture than the last.
    for name, width in sorted(WIDTHS.items(), key=lambda item: -item[1]):
        if max(source.size) <= width:
            continue
        source.thumbnail((width, width), Image.LANCZOS)
        buffer = io.BytesIO()
        source.save(buffer, "WEBP", quality=QUALITY)
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


def refresh(instance, image_field, variants_field, *, force=False):
    """Make variants for `instance`'s image and store them with the name they came from ("src"). Never raises."""
    image = getattr(instance, image_field)
    try:
        src = image.name if image else ""
        fresh = {"src": src, **build(image)} if src else {}
        type(instance).objects.filter(pk=instance.pk).update(**{variants_field: fresh})
        setattr(instance, variants_field, fresh)
    except Exception:
        logger.exception("Couldn't make image variants for %s %s", type(instance).__name__, instance.pk)


def _mark_new_image(field):
    def handler(sender, instance, raw=False, **kwargs):
        image = getattr(instance, field)
        instance._variants_new_image = bool(image) and not getattr(image, "_committed", True) and not raw

    return handler


def _make_after_save(image_field, variants_field):
    def handler(sender, instance, raw=False, **kwargs):
        if raw or not getattr(instance, "_variants_new_image", False):
            return
        instance._variants_new_image = False
        refresh(instance, image_field, variants_field)

    return handler


mark_photo = _mark_new_image("image")
mark_listing = _mark_new_image("main_photo")
on_photo_saved = _make_after_save("image", "variants")
on_listing_saved = _make_after_save("main_photo", "main_photo_variants")


def picture_urls(request, instance):
    """{thumb, medium, large} URLs for a category or zone picture (a missing size falls back to the original); None
    when the row has no picture."""
    if not instance.image:
        return None
    stored = instance.image_variants if (instance.image_variants or {}).get("src") == instance.image.name else {}
    return urls(request, stored, instance.image)


def discard(stored):
    """Delete the variant files named in a stored {"src", "thumb", ...} dict; a file already gone is ignored."""
    for name in WIDTHS:
        path = (stored or {}).get(name)
        if path:
            try:
                default_storage.delete(path)
            except Exception:
                logger.warning("Couldn't delete image variant %s", path, exc_info=True)
