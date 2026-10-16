"""Fixtures shared by the otp tests (not test cases themselves)."""
import re

from django.contrib.auth.hashers import make_password
from django.core import mail

from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff

PASSWORD = "correct-horse-1"
HASHED = make_password(PASSWORD)
SIX_DIGITS = re.compile(r"\b(\d{6})\b")


def make_customer(phone="+233241234567", email="ama@example.com", **extra):
    return Customer.objects.create(full_name="Ama Owusu", phone=phone, email=email, password_hash=HASHED, **extra)


def make_owner(login_phone="+233201112233", email="kwame@example.com", **extra):
    return BusinessOwner.objects.create(full_name="Kwame Mensah", login_phone=login_phone, email=email, password_hash=HASHED, **extra)


def make_support(email="esi@example.com"):
    return make_staff("support", email, password_hash=HASHED)


def last_sms_code():
    """The code in the newest text (otp.senders keeps texts in memory under tests)."""
    from otp import senders

    return SIX_DIGITS.search(senders.sms_outbox[-1].body).group(1)


def last_email_code():
    return SIX_DIGITS.search(mail.outbox[-1].body).group(1)


def wrong_code(right):
    return "000000" if right != "000000" else "111111"
