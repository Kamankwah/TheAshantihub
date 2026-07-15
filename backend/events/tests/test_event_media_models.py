import io
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image

from accounts.models import Customer
from listings.models import Category, Zone

from events.models import Event, EventMedia

TEST_MEDIA_ROOT = tempfile.mkdtemp()


def _image(name="event.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class EventMediaModelTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(
            full_name="Ama Buyer", phone="+233200771133", password_hash="x",
        )
        self.event = Event.objects.create(
            category=Category.objects.get(slug="festivals"), zone=Zone.objects.get(name="Manhyia"),
            submitted_by_customer=self.customer,
            name="Akwasidae Festival", description="Royal durbar.", address="Manhyia Palace",
            event_date=timezone.now() + timezone.timedelta(days=30), visibility_days=14,
        )

    def test_media_type_defaults_to_image(self):
        media = EventMedia.objects.create(event=self.event, media=_image())
        self.assertEqual(media.media_type, EventMedia.IMAGE)

    def test_order_defaults_to_zero(self):
        media = EventMedia.objects.create(event=self.event, media=_image())
        self.assertEqual(media.order, 0)

    def test_ordering_by_order_field(self):
        second = EventMedia.objects.create(event=self.event, media=_image("b.jpg"), order=1)
        first = EventMedia.objects.create(event=self.event, media=_image("a.jpg"), order=0)
        self.assertEqual(list(self.event.media.all()), [first, second])

    def test_spoofed_media_upload_is_rejected(self):
        media = EventMedia(
            event=self.event,
            media=SimpleUploadedFile(
                "fake.jpg", b"MZ\x90\x00\x03\x00\x00\x00fake-executable-bytes",
                content_type="image/jpeg",
            ),
        )
        with self.assertRaises(Exception):
            media.full_clean()

    def test_str_includes_order_and_event_name(self):
        media = EventMedia.objects.create(event=self.event, media=_image())
        self.assertIn(str(media.order), str(media))
        self.assertIn(self.event.name, str(media))
