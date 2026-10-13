"""Step-in sweep (SA-6): the URL conf, walked whole.

* Every GET endpoint, opened through a Super Admin's step-in as each kind of
  team member that can be opened, writes nothing to the database except the
  view_as.page activity events (no INSERT/UPDATE/DELETE on any other table, no
  other activity verb, no e-mail). Detail URLs are tried with real ids from the
  seeded development data, so "opening a record" side effects are exercised,
  not only 404s.
* Every write method on every URL carrying the header is refused 403
  view_only before any view runs: no statement that writes, not even an
  activity row.

A new GET endpoint is covered automatically. If it fails here, make its read
free of writes (or a no-op under step-in: accounts.view_as.viewer_of(request)
names the Super Admin behind a substituted request) rather than allow-listing it.
"""
import re
import uuid

from django.apps import apps
from django.core import mail
from django.core.cache import caches
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from django.urls import URLPattern, URLResolver, get_resolver
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import view_as
from accounts.authentication import issue_token
from accounts.models import StaffSession, StaffUser
from accounts.testing import make_staff, session_of
from activity.models import ActivityEvent
from approvals import registry
from approvals import services as approvals
from approvals.tests.kinds import RENAME_STAFF
from reports.models import StaffReport

WRITE_SQL = re.compile(r"^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|COPY)\b", re.I)
ACTIVITY_INSERT = re.compile(r'^\s*INSERT\s+INTO\s+"activity_activityevent"', re.I)
PARAM = re.compile(r"<(?:(?P<conv>\w+):)?(?P<name>\w+)>")

# Detail URLs whose view names no queryset or serializer model: the model
# behind their id, by route prefix (longest prefix wins).
ROUTE_MODELS = {
    "api/accounts/kyc/": "accounts.BusinessOwner",
    "api/accounts/business-owners/": "accounts.BusinessOwner",
    "api/accounts/customers/": "accounts.Customer",
    "api/accounts/staff/": "accounts.StaffUser",
    "api/approvals/": "approvals.ApprovalRequest",
    "api/reports/exports/": "reports.ReportExport",
    "api/reports/": "reports.StaffReport",
    "api/portfolio/businesses/": "accounts.BusinessOwner",
    "api/portfolio/": "accounts.BusinessOwner",
    "api/operations/scouts/": "accounts.StaffUser",
    "api/operations/": "accounts.BusinessOwner",
    "api/fraud/": "fraud.FraudFlag",
    "api/field/visits/": "field.Visit",
    "api/field/prospects/": "field.Prospect",
    "api/listings/": "listings.Listing",
    "api/events/": "events.Event",
    "api/orders/": "orders.Order",
    "api/disputes/": "disputes.Dispute",
    "api/messaging/": "messaging.Conversation",
    "api/tasks/": "staff_tasks.Task",
    "api/calls/": "calls.CallLog",
    "api/targets/holidays/": "targets.Holiday",
    "api/targets/leave/": "targets.Leave",
    "api/marketplace/customers/": "accounts.Customer",
    "api/marketplace/orders/": "orders.Order",
    "api/marketplace/events/": "events.Event",
    "api/marketplace/listings/": "listings.Listing",
    "api/marketplace/disputes/": "disputes.Dispute",
    "api/commission/": "commission.CommissionAccrual",
    "api/delivery/jobs/": "orders.DeliveryAssignment",
    "api/delivery/rider/jobs/": "orders.DeliveryAssignment",
    "api/delivery/riders/": "delivery.Rider",
    "api/delivery/documents/": "delivery.RiderDocument",
    "api/delivery/vehicles/": "delivery.Vehicle",
    "api/delivery/zones/": "delivery.DeliveryZone",
}


def walk(patterns, prefix=""):
    for pattern in patterns:
        if isinstance(pattern, URLResolver):
            yield from walk(pattern.url_patterns, prefix + str(pattern.pattern))
        elif isinstance(pattern, URLPattern):
            yield prefix + str(pattern.pattern), pattern


def view_class(pattern):
    return getattr(pattern.callback, "cls", None) or getattr(pattern.callback, "view_class", None)


def handles(pattern, method):
    actions = getattr(pattern.callback, "actions", None)
    if actions:
        return method in actions
    cls = view_class(pattern)
    if cls is None:
        return True
    return hasattr(cls, method) and method in getattr(cls, "http_method_names", [method])


def _model(label):
    try:
        return apps.get_model(label)
    except LookupError:
        return None


def model_of(route, pattern):
    cls = view_class(pattern)
    queryset = getattr(cls, "queryset", None)
    if queryset is not None:
        return queryset.model
    meta = getattr(getattr(cls, "serializer_class", None), "Meta", None)
    if meta is not None and getattr(meta, "model", None) is not None:
        return meta.model
    for prefix in sorted(ROUTE_MODELS, key=len, reverse=True):
        if route.startswith(prefix):
            return _model(ROUTE_MODELS[prefix])
    return None


def paths_for(route, pattern):
    """Concrete paths for a route: real ids where the model is known."""
    if route.startswith("^") or "(?P" in route:
        return []  # regex routes (static media under DEBUG)
    ints = [m for m in PARAM.finditer(route) if m.group("conv") == "int"]
    ids = [999999]
    if ints:
        model = model_of(route, pattern)
        if model is not None:
            # The oldest rows and the newest (the target's own fixtures below).
            pks = model.objects.order_by("pk").values_list("pk", flat=True)
            ids = list(pks[:2]) + list(model.objects.order_by("-pk").values_list("pk", flat=True)[:1]) + [999999]

    def fill(value):
        def repl(match):
            conv = match.group("conv") or "str"
            if conv == "int":
                return str(value)
            if conv == "uuid":
                return str(uuid.uuid4())
            return "x"
        return "/" + PARAM.sub(repl, route)

    return list(dict.fromkeys(fill(value) for value in ids))


class WriteDetector:
    def __init__(self):
        self.statements = []

    def __call__(self, execute, sql, params, many, context):
        if WRITE_SQL.match(sql):
            self.statements.append(sql[:160])
        return execute(sql, params, many, context)


class ViewAsSweepTests(TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        registry.register(RENAME_STAFF)
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        registry.unregister(RENAME_STAFF.key)

    @classmethod
    def setUpTestData(cls):
        with override_settings(DEBUG=True):
            call_command("seed_dev_data", verbosity=0)
            call_command("seed_staff_queues", verbosity=0)
        cls.simon = make_staff("super_admin", "sweep-admin@example.com")
        cls.targets = {}
        for role in sorted(view_as.TARGET_ROLES):
            person = StaffUser.objects.filter(role__name=role, is_active=True, is_suspended=False, invite_token__isnull=True).first()
            cls.targets[role] = person or make_staff(role, f"sweep-{role}@example.com")
        # Records the Operations lead and her scout open in their own screens:
        # a request waiting for her and a submitted day report.
        lead, scout = cls.targets["operations"], cls.targets["scout"]
        StaffUser.objects.filter(pk=scout.pk).update(manager=lead)
        scout.refresh_from_db()
        approvals.submit(
            scout, RENAME_STAFF.key, target=cls.targets["support"], title="Rename",
            payload={"full_name": "Esi Nyarko"}, maker_note="Spelled out at the office",
        )
        today = timezone.localdate()
        StaffReport.objects.create(
            staff=scout, period=StaffReport.DAY, period_start=today, period_end=today,
            status=StaffReport.SUBMITTED, submitted_at=timezone.now(), achievements="Visited 3 shops",
        )

    def setUp(self):
        caches["realtime"].clear()
        self.client = APIClient()
        self.client.raise_request_exception = False  # a crash is a 500 to report, not an abort
        self.token = issue_token(self.simon, "staff", two_factor=True)
        self.session = session_of(self.token)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")

    def start(self, target):
        response = self.client.post("/api/accounts/staff/view-as/", {"staff": target.pk}, format="json")
        self.assertIn(response.status_code, (200, 201), response.content)

    def routes(self, method):
        return [(route, pattern) for route, pattern in walk(get_resolver().url_patterns) if handles(pattern, method)]

    def test_every_get_writes_nothing_but_page_events(self):
        offenders, opened = [], 0
        for role, target in self.targets.items():
            self.start(target)
            for route, pattern in self.routes("get"):
                for path in paths_for(route, pattern):
                    # Keep the Super Admin's own session fresh so its once-a-minute
                    # "last seen" write (the viewer's own activity) stays out of the count.
                    StaffSession.objects.filter(pk=self.session.pk).update(last_seen_at=timezone.now())
                    last_event = ActivityEvent.objects.order_by("-id").values_list("id", flat=True).first() or 0
                    sent_mail = len(mail.outbox)
                    detector = WriteDetector()
                    with connection.execute_wrapper(detector):
                        response = self.client.get(path, HTTP_X_VIEW_AS=str(target.pk), HTTP_X_VIEW_AS_SCREEN="sweep")
                    if response.status_code == 200:
                        opened += 1
                    writes = [sql for sql in detector.statements if not ACTIVITY_INSERT.match(sql)]
                    verbs = set(ActivityEvent.objects.filter(id__gt=last_event).values_list("verb", flat=True))
                    if writes or verbs - {"view_as.page"} or len(mail.outbox) != sent_mail or response.status_code >= 500:
                        offenders.append((role, path, response.status_code, writes[:3], sorted(verbs - {"view_as.page"})))
        self.assertEqual(offenders, [], "GET under step-in must not write (role, path, status, SQL, verbs)")
        self.assertGreater(opened, 100)  # the sweep really opened screens, not only 403/404s

    def test_every_write_method_is_refused_before_any_view_runs(self):
        target = self.targets["operations"]
        self.start(target)
        before = ActivityEvent.objects.count()
        offenders = []
        for method in ("post", "put", "patch", "delete"):
            for route, pattern in walk(get_resolver().url_patterns):
                for path in paths_for(route, pattern)[:1]:
                    detector = WriteDetector()
                    with connection.execute_wrapper(detector):
                        response = getattr(self.client, method)(path, {}, format="json", HTTP_X_VIEW_AS=str(target.pk))
                    code = response.json().get("code") if response.get("Content-Type", "").startswith("application/json") else None
                    if response.status_code != 403 or code != "view_only" or detector.statements:
                        offenders.append((method, path, response.status_code, code, detector.statements[:2]))
        self.assertEqual(offenders, [])
        self.assertEqual(ActivityEvent.objects.count(), before)
        self.session.refresh_from_db()
        self.assertIsNone(self.session.revoked_at)
        self.assertEqual(self.session.view_as_target_id, target.pk)
