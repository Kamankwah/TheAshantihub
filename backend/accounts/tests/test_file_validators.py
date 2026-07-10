import io

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image

from accounts.validators import validate_document_content_type, validate_image_content_type


def _real_jpeg():
    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="JPEG")
    buf.seek(0)
    return SimpleUploadedFile("photo.jpg", buf.read(), content_type="image/jpeg")


def _real_pdf():
    # Minimal valid PDF header bytes, enough for libmagic to identify as application/pdf.
    pdf_bytes = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"
    return SimpleUploadedFile("cert.pdf", pdf_bytes, content_type="application/pdf")


def _spoofed_executable():
    # Renamed "image" that is actually not image bytes at all.
    return SimpleUploadedFile("fake.jpg", b"MZ\x90\x00\x03\x00\x00\x00fake-executable-bytes", content_type="image/jpeg")


class FileValidatorTests(TestCase):
    def test_validate_image_content_type_accepts_real_jpeg(self):
        validate_image_content_type(_real_jpeg())  # should not raise

    def test_validate_image_content_type_rejects_spoofed_file(self):
        with self.assertRaises(ValidationError):
            validate_image_content_type(_spoofed_executable())

    def test_validate_document_content_type_accepts_real_pdf(self):
        validate_document_content_type(_real_pdf())  # should not raise

    def test_validate_document_content_type_accepts_real_jpeg(self):
        validate_document_content_type(_real_jpeg())  # should not raise

    def test_validate_document_content_type_rejects_spoofed_file(self):
        with self.assertRaises(ValidationError):
            validate_document_content_type(_spoofed_executable())
