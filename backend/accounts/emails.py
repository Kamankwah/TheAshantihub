import logging

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)


def _send(subject, message, recipient):
    # v1 tradeoff: best-effort send only — no delivery guarantee, no retry
    # queue. A failed send is logged, never raised, so it can't break the
    # caller's request (staff invite / password reset / verification-code
    # issuance all still succeed server-side even if the email itself never
    # lands). Revisit with a real outbox/retry mechanism post-launch.
    try:
        send_mail(
            subject=subject,
            message=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient],
            fail_silently=False,
        )
    except Exception:
        logger.exception("Failed to send email to %s (subject: %s)", recipient, subject)


def send_staff_invite_email(staff_user, invite_link):
    subject = "You've been invited to join AshantiHub staff"
    # The staff-app install page. Per-environment like the invite link, so a
    # staging invite installs the staging app.
    install_link = f"{settings.FRONTEND_BASE_URL}/staff/install"
    message = (
        f"Hi {staff_user.full_name},\n\n"
        "You've been invited to join AshantiHub staff. Click the link below to "
        "activate your account and set a password:\n\n"
        f"{invite_link}\n\n"
        "This invite link expires in 7 days.\n\n"
        "To put the AshantiHub Staff app on your phone, open this link on the "
        "phone and follow the steps:\n\n"
        f"{install_link}\n\n"
        "If you weren't expecting this, you can safely ignore this email.\n\n"
        "— AshantiHub"
    )
    _send(subject, message, staff_user.email)


def send_password_reset_email(email, reset_link):
    subject = "Reset your AshantiHub password"
    message = (
        "We received a request to reset your AshantiHub password. Click the "
        "link below to choose a new password:\n\n"
        f"{reset_link}\n\n"
        "This link expires in 1 hour.\n\n"
        "If you didn't request this, you can safely ignore this email — your "
        "password won't be changed.\n\n"
        "— AshantiHub"
    )
    _send(subject, message, email)


def send_new_order_email(email, order_id, lines, subtotal):
    """Tell a business owner about a paid order. `lines` are only this owner's
    (quantity, item name, line total) — an order can span several businesses,
    and no owner sees another's lines or the customer's details."""
    subject = f"New order #{order_id} on AshantiHub"
    items = "\n".join(f"  {quantity} × {name} — GHS {total}" for quantity, name, total in lines)
    message = (
        f"You have a new paid order on AshantiHub (order #{order_id}):\n\n"
        f"{items}\n\n"
        f"Your total: GHS {subtotal}\n\n"
        "See it and arrange delivery in your dashboard:\n\n"
        f"{settings.FRONTEND_BASE_URL}/business-dashboard\n\n"
        "— AshantiHub"
    )
    _send(subject, message, email)


def send_verification_code_email(email, code):
    subject = "Your AshantiHub verification code"
    message = (
        f"Your AshantiHub verification code is {code}, expires in 10 minutes.\n\n"
        "If you didn't request this, you can safely ignore this email.\n\n"
        "— AshantiHub"
    )
    _send(subject, message, email)
