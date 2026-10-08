import json
import uuid

from django.db import transaction
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from accounts.models import StaffUser

from . import services

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _staff_from_header(request):
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    try:
        token = AccessToken(header[len("Bearer "):])
    except TokenError:
        return None
    if token.get("account_type") != "staff":
        return None
    return (
        StaffUser.objects.select_related("role")
        .filter(pk=token.get("sub"), is_active=True, is_suspended=False)
        .first()
    )


def _request_body(request):
    """Read the body before the view runs. JSON is read via request.body
    (DRF then re-reads the cached bytes); form/multipart via request.POST,
    which DRF explicitly supports when middleware parsed it first."""
    content_type = request.content_type or ""
    if content_type.startswith("application/json"):
        try:
            return json.loads(request.body or b"{}")
        except (ValueError, UnicodeDecodeError):
            return {"unparsed": True}
    if content_type.startswith(("multipart/", "application/x-www-form-urlencoded")):
        data = {key: request.POST.get(key) for key in request.POST.keys()}
        if request.FILES:
            data["files"] = sorted(f.name for f in request.FILES.values())
        return data
    return {}


def _target_type(view_func):
    queryset = getattr(getattr(view_func, "cls", None), "queryset", None)
    return queryset.model._meta.label_lower if queryset is not None else ""


class StaffActivityMiddleware:
    """Wraps every authenticated staff write in a transaction and records it
    (foundations F4, layer 1). If recording fails, the action rolls back."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_view(self, request, view_func, view_args, view_kwargs):
        if getattr(getattr(view_func, "cls", None), "activity_exempt", False):
            return None
        if request.method not in UNSAFE_METHODS or not request.path.startswith("/api/"):
            return None
        staff = _staff_from_header(request)
        if staff is None:
            return None
        body = _request_body(request)
        request.activity_request_id = request.headers.get("X-Request-ID", "")[:64] or uuid.uuid4().hex
        with transaction.atomic():
            response = view_func(request, *view_args, **view_kwargs)
            if 200 <= response.status_code < 300 and not getattr(request, "_activity_recorded", False):
                match = request.resolver_match
                services.record(
                    staff,
                    match.url_name or match.view_name,
                    method=request.method,
                    target_type=_target_type(view_func),
                    target_id=str(view_kwargs.get("pk", "")),
                    after={"request": body, "status": response.status_code},
                    request=request,
                )
        return response
