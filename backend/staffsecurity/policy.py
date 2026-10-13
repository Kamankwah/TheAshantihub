"""The editable security policy and the fixed limits shown beside it."""
from datetime import timedelta

from .models import SecurityPolicy


def current():
    return SecurityPolicy.objects.order_by("id").first()


def required_roles():
    """Role names that must use 2-step sign-in because Super Admin said so
    (Super Admin itself is always required elsewhere)."""
    policy = current()
    return set(policy.two_factor_roles) if policy else set()


def requires_two_factor(role_name):
    return role_name in required_roles()


def set_roles(role_names, staff):
    from django.utils import timezone

    policy = current() or SecurityPolicy()
    policy.two_factor_roles = sorted(role_names)
    policy.updated_at = timezone.now()
    policy.updated_by = staff
    policy.save()
    return policy


def limits():
    """The session limits the server enforces (accounts.sessions); read-only here."""
    from accounts import sessions

    return {
        "idle_minutes": int(sessions.IDLE_LIMIT.total_seconds() // 60),
        "absolute_hours": int(sessions.ABSOLUTE_LIMIT.total_seconds() // 3600),
        "password_window_minutes": int(sessions.SUDO_WINDOW.total_seconds() // 60),
    }


# What asks for the password again, as the code stands. Keep in step with the
# RequiresSudo / require_sudo calls: this list is what the screen tells people.
PASSWORD_PROTECTED = [
    ("Approving money", "Approving a request that moves money."),
    ("Changing who can do what", "Editing a person's permissions."),
    ("Suspending", "Suspending or reactivating a staff member, a business or a customer."),
    ("Personal-data exports", "Exporting other people's names with contact or pay details, now or on a schedule."),
    ("Security settings", "Changing who must use 2-step sign-in, and making new recovery codes."),
    ("Inviting and moving staff", "Inviting staff, changing a manager, resetting someone's 2-step sign-in."),
]
