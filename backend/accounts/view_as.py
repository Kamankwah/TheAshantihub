"""Step-in ("view as") for the Super Admin (SA-6, owner decision 3 of 2026-10-12).

A Super Admin opens a team member's workspace read-only, exactly as that person
sees it, and stays signed in as themselves:

* ``POST /api/accounts/staff/view-as/ {"staff": id}`` starts a view on the Super
  Admin's own session (``StaffSession.view_as_target``) and records
  ``view_as.started``; ``POST .../view-as/end/`` clears it and records
  ``view_as.ended``. Both are sent *without* the header below.
* While a view lasts, the client sends ``X-View-As: <staff id>`` (and
  ``X-View-As-Screen: <screen>``). ``MultiAccountJWTAuthentication`` validates
  the Super Admin's own token and session as always and then, through
  ``resolve()``, hands the views the **target** as ``request.user`` for
  GET/HEAD/OPTIONS only. Every existing endpoint therefore scopes exactly as it
  does for the target (their team, their approvals, their badges) with no
  per-view change. The Super Admin stays in ``request.auth`` (its
  ``staff_session``) and in ``request.view_as_viewer``.
* Any other method carrying the header from a Super Admin's token is refused
  ``403 {"code": "view_only"}`` by ``ViewAsMiddleware`` before the activity
  middleware opens a transaction or any view runs - logout, password
  re-entry, mark-read, the realtime ticket and every other write included.
  Exports are refused the same way (an export is an action, not a view).
* Each screen opened is recorded once as ``view_as.page`` (actor: the Super
  Admin, ``on_behalf_of``: the target), not every request: a screen is logged
  when the view moves to it, and the same screen at most once a minute.
* The header is ignored for anyone who is not a Super Admin, and a Super Admin
  can only open the roles in ``TEAMS`` (never another Super Admin, never
  themselves, never a co-signer or a rider).
"""
import logging
import re

from django.core.cache import caches
from django.http import JsonResponse
from rest_framework import exceptions
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from .models import Role, StaffUser

logger = logging.getLogger(__name__)

HEADER = "HTTP_X_VIEW_AS"
SCREEN_HEADER = "HTTP_X_VIEW_AS_SCREEN"
PERMISSION = "staff.view_as"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

# The Teams (step in) screens and whose workspace each one opens. Scouts sit
# under Operations, as on the canvas ("Operations & scouts").
TEAMS = {
    "operations": (Role.OPERATIONS, Role.SCOUT),
    "support": (Role.SUPPORT,),
    "delivery": (Role.DELIVERY_MANAGER,),
    "marketing": (Role.MARKETING,),
    "accounting": (Role.ACCOUNTANT,),
}
TARGET_ROLES = frozenset(role for roles in TEAMS.values() for role in roles)
TEAM_OF_ROLE = {role: team for team, roles in TEAMS.items() for role in roles}

EXPORT_FORMATS = frozenset({"csv", "xlsx", "pdf"})
EXPORT_SEGMENTS = frozenset({"export", "download"})
# A screen is logged when the view moves to it; staying on it (polling, more
# requests) adds nothing, and returning to it logs again unless it was logged
# less than PAGE_DEDUPE_SECONDS ago.
PAGE_DEDUPE_SECONDS = 60
SCREEN_IDLE_SECONDS = 30 * 60
SCREEN_RE = re.compile(r"^[a-z0-9][a-z0-9/_-]{0,59}$")

VIEW_ONLY_MESSAGE = (
    "You are viewing someone else's workspace read-only, so nothing can be changed here. "
    "Exit the view to act as yourself."
)
EXPORT_MESSAGE = "Exports are switched off while you view someone else's workspace."
NOT_STARTED_MESSAGE = "This view has ended. Start it again from Teams (step in)."


class ViewAsRefused(exceptions.PermissionDenied):
    """A refused step-in request: always 403 with a code, never the 401 that
    accounts.authentication.exception_handler makes of other refusals raised
    while authenticating (the client reads a 401 as "your session ended")."""

    def __init__(self, detail, code="view_as_refused"):
        super().__init__({"detail": detail, "code": code})


def _django(request):
    return getattr(request, "_request", request)


def header_value(request):
    return _django(request).META.get(HEADER, "").strip()


def is_viewer(staff):
    """A Super Admin holding staff.view_as. The role is required as well as
    the code, so granting the code to anyone else does nothing."""
    return (
        isinstance(staff, StaffUser)
        and staff.role.name == Role.SUPER_ADMIN
        and PERMISSION in staff.effective_permission_codenames()
    )


def target_problem(viewer, target):
    """Why `viewer` may not open `target`'s workspace, or None."""
    if target is None:
        return "That person was not found."
    if target.pk == viewer.pk:
        return "You cannot step into your own workspace."
    if target.role.name == Role.SUPER_ADMIN:
        return "A Super Admin's workspace cannot be opened."
    if target.role.name not in TARGET_ROLES:
        return "Only the team workspaces listed under Teams (step in) can be opened."
    if not target.is_active or target.is_suspended:
        return "That person's account is not active."
    if target.invite_token is not None:
        return "That person has not accepted their invite yet."
    return None


def people():
    """Everyone a Super Admin can step in as, by team then name."""
    order = {role: index for index, role in enumerate(r for roles in TEAMS.values() for r in roles)}
    rows = (
        StaffUser.objects.filter(
            role__name__in=TARGET_ROLES, is_active=True, is_suspended=False, invite_token__isnull=True
        )
        .select_related("role", "manager")
        .order_by("full_name", "pk")
    )
    return sorted(rows, key=lambda staff: order[staff.role.name])


def is_export(request):
    django_request = _django(request)
    if django_request.GET.get("format", "").strip().lower() in EXPORT_FORMATS:
        return True
    return any(segment in EXPORT_SEGMENTS for segment in django_request.path.lower().split("/"))


def _staff_id(raw):
    return int(raw) if raw.isdigit() and len(raw) <= 18 else None


def resolve(request, account, session):
    """The staff member the views should see as request.user, or None to
    carry on as `account` (no header, or a caller who is not a Super Admin).
    Raises ViewAsRefused for a write, an export, or a view that was never
    started, has ended or names someone who cannot be opened."""
    raw = header_value(request)
    if not raw or not isinstance(account, StaffUser) or account.role.name != Role.SUPER_ADMIN:
        return None
    if request.method not in SAFE_METHODS:
        raise ViewAsRefused(VIEW_ONLY_MESSAGE, code="view_only")
    if is_export(request):
        raise ViewAsRefused(EXPORT_MESSAGE, code="view_only")
    if PERMISSION not in account.effective_permission_codenames():
        raise ViewAsRefused("You do not have the step-in permission.")
    if not session.two_factor:
        raise ViewAsRefused("Stepping in needs a session signed in with 2-step sign-in.")
    target_id = _staff_id(raw)
    if target_id is None or session.view_as_target_id != target_id:
        raise ViewAsRefused(NOT_STARTED_MESSAGE, code="view_as_not_started")
    target = StaffUser.objects.select_related("role", "manager__role").filter(pk=target_id).first()
    problem = target_problem(account, target)
    if problem:
        raise ViewAsRefused(problem)
    _django(request).view_as_viewer = account
    note_page(request, account, target, session)
    return target


def viewer_of(request):
    """The Super Admin behind a substituted request, or None."""
    return getattr(_django(request), "view_as_viewer", None)


def screen_of(request):
    django_request = _django(request)
    raw = django_request.META.get(SCREEN_HEADER, "").strip().lower()
    if SCREEN_RE.match(raw):
        return raw
    # No readable screen name: the API area ("approvals", "reports", ...).
    parts = [part for part in django_request.path.split("/") if part]
    return parts[1][:60] if len(parts) > 1 and parts[0] == "api" else "other"


def _screen_key(session, target):
    return f"view-as:screen:{session.pk}:{target.pk}"


def note_page(request, viewer, target, session):
    """Record view_as.page when the view moves to a screen (see module doc).
    A cache outage records every request rather than losing the trail."""
    screen = screen_of(request)
    cache = caches["realtime"]
    try:
        current_key = _screen_key(session, target)
        if cache.get(current_key) == screen:
            cache.touch(current_key, SCREEN_IDLE_SECONDS)
            return None
        cache.set(current_key, screen, SCREEN_IDLE_SECONDS)
        if not cache.add(f"view-as:page:{session.pk}:{target.pk}:{screen}", 1, timeout=PAGE_DEDUPE_SECONDS):
            return None
    except Exception:
        logger.warning("Step-in page dedupe unavailable; recording this request", exc_info=True)
    from activity.services import record

    return record(
        viewer, "view_as.page", target=target, method=_django(request).method,
        summary=f"Opened {screen} as {target.full_name} (read-only)",
        after={"screen": screen, "path": _django(request).path[:200]},
        request=request, on_behalf_of=target,
    )


def forget_screen(session, target):
    try:
        caches["realtime"].delete(_screen_key(session, target))
    except Exception:
        logger.warning("Could not reset the step-in screen", exc_info=True)


def _bearer_is_super_admin(request):
    header = request.META.get("HTTP_AUTHORIZATION", "")
    if not header.startswith("Bearer "):
        return False
    try:
        token = AccessToken(header[len("Bearer "):])
    except TokenError:
        return False
    if token.get("account_type") != "staff":
        return False
    return StaffUser.objects.filter(pk=token.get("sub"), role__name=Role.SUPER_ADMIN).exists()


class ViewAsMiddleware:
    """Refuses every request other than GET/HEAD/OPTIONS that carries
    X-View-As from a Super Admin's token: 403 {"code": "view_only"}, before
    activity.middleware.StaffActivityMiddleware (listed after this one) opens
    a transaction and before any view runs, DRF or not, whatever its own
    authentication - so logout, password re-entry, mark-read, report saves and
    the realtime ticket are all refused, with no exception. The header is
    ignored for everyone else."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if (
            request.method not in SAFE_METHODS
            and request.META.get(HEADER, "").strip()
            and _bearer_is_super_admin(request)
        ):
            return JsonResponse({"detail": VIEW_ONLY_MESSAGE, "code": "view_only"}, status=403)
        return self.get_response(request)
