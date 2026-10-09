from django.db import IntegrityError, transaction
from django.test import TestCase

from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.testing import make_staff
from activity.models import ActivityEvent
from fraud import services
from fraud.models import FraudFlag
from notifications.models import Notification


def make_business(name, phone, *, manager=None):
    """An owner plus profile, the way fraud cases see a business (no factory exists)."""
    owner = BusinessOwner.objects.create(
        full_name=f"{name} Owner", login_phone=phone, password_hash="x", account_manager=manager,
    )
    BusinessOwnerProfile.objects.create(business_owner=owner, business_name=name, business_contact_phone=phone)
    return owner


class Base(TestCase):
    def setUp(self):
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.esi = make_staff("support", "esi@example.com")
        self.owner = make_business("Adwoa Fabrics", "+233244123118", manager=self.scout)
        self.twin = make_business("Suame Auto Parts", "+233244555390")

    def duplicate(self, **overrides):
        fields = {
            "title": "Adwoa Fabrics and Suame Auto Parts share a MoMo number",
            "detail": "The payout number on Adwoa Fabrics matches Suame Auto Parts.",
            "evidence": ["Payout MoMo number ••••••••390 on both", "Map pins 22 m apart"],
            "business_owner": self.owner,
            "related_business_owner": self.twin,
        }
        fields.update(overrides)
        return services.raise_flag(FraudFlag.DUPLICATE, **fields)


class RaiseFlagTests(Base):
    def test_a_system_case_tells_every_fraud_manager_and_is_recorded(self):
        flag = self.duplicate()
        self.assertEqual(
            (flag.kind, flag.status, flag.source, flag.business_owner, flag.related_business_owner, flag.raised_by),
            ("duplicate", "open", "system", self.owner, self.twin, None),
        )
        self.assertEqual(flag.evidence, ["Payout MoMo number ••••••••390 on both", "Map pins 22 m apart"])
        told = set(Notification.objects.filter(kind="fraud_flag_raised").values_list("staff_id", flat=True))
        self.assertEqual(told, {self.lead.id, self.boss.id})  # fraud.manage holders only — not Support or scouts
        note = Notification.objects.get(staff=self.lead, kind="fraud_flag_raised")
        self.assertEqual(
            (note.title, note.body, note.link, note.icon),
            (
                "Fraud case: Adwoa Fabrics and Suame Auto Parts share a MoMo number",
                "The payout number on Adwoa Fabrics matches Suame Auto Parts.",
                "fraud-cases",
                "🚩",
            ),
        )
        event = ActivityEvent.objects.get(verb="fraud.flag_raised")
        self.assertEqual((event.actor_type, event.target_type, event.target_id), ("system", "fraud.fraudflag", str(flag.id)))
        self.assertEqual(event.after["kind"], "duplicate")

    def test_a_staff_case_is_theirs_and_an_owner_case_is_the_systems(self):
        by_staff = services.raise_flag(
            FraudFlag.OTHER, title="Someone asked a shop for cash", raised_by=self.esi, source=FraudFlag.STAFF,
        )
        by_owner = services.raise_flag(
            FraudFlag.OWNER_OBJECTED, title="Adwoa Fabrics · 3 photos undone by the owner",
            business_owner=self.owner, staff_subject=self.scout, source=FraudFlag.OWNER,
        )
        staff_event = ActivityEvent.objects.get(verb="fraud.flag_raised", target_id=str(by_staff.id))
        owner_event = ActivityEvent.objects.get(verb="fraud.flag_raised", target_id=str(by_owner.id))
        self.assertEqual((staff_event.actor_type, staff_event.actor_id), ("staff", self.esi.id))
        self.assertEqual((owner_event.actor_type, owner_event.actor_id), ("system", None))
        self.assertEqual((by_owner.source, by_owner.staff_subject), ("owner", self.scout))

    def test_the_same_dedupe_key_returns_the_open_case(self):
        first = self.duplicate(dedupe_key="momo:244555390")
        notices = Notification.objects.count()
        again = self.duplicate(dedupe_key="momo:244555390", title="A second wording")
        self.assertEqual(again.pk, first.pk)
        self.assertEqual(again.title, "Adwoa Fabrics and Suame Auto Parts share a MoMo number")
        self.assertEqual(Notification.objects.count(), notices)
        self.assertEqual(ActivityEvent.objects.filter(verb="fraud.flag_raised").count(), 1)

    def test_a_decided_case_frees_its_key(self):
        first = self.duplicate(dedupe_key="momo:244555390")
        services.dismiss(first.pk, self.lead, note="Two shops, one family number")
        second = self.duplicate(dedupe_key="momo:244555390")
        self.assertNotEqual(second.pk, first.pk)
        self.assertEqual(second.status, "open")

    def test_record_event_false_records_nothing_but_still_tells_operations(self):
        self.duplicate(record_event=False)
        self.assertFalse(ActivityEvent.objects.filter(verb="fraud.flag_raised").exists())
        self.assertTrue(Notification.objects.filter(kind="fraud_flag_raised").exists())

    def test_an_unknown_kind_is_a_programming_error(self):
        with self.assertRaises(ValueError):
            services.raise_flag("made_up", title="Nothing")

    def test_the_database_keeps_one_open_case_per_key(self):
        self.duplicate(dedupe_key="undo:7")
        with self.assertRaises(IntegrityError), transaction.atomic():
            FraudFlag.objects.create(kind=FraudFlag.OTHER, source=FraudFlag.SYSTEM, title="Same key", dedupe_key="undo:7")
        FraudFlag.objects.create(kind=FraudFlag.OTHER, source=FraudFlag.SYSTEM, title="No key")
        FraudFlag.objects.create(kind=FraudFlag.OTHER, source=FraudFlag.SYSTEM, title="No key either")
        self.assertEqual(FraudFlag.objects.filter(dedupe_key="").count(), 2)


class OpenFlagExistsTests(Base):
    def test_only_an_open_case_of_that_kind_on_that_business_counts(self):
        flag = services.raise_flag(
            FraudFlag.SELF_DEALING, title="Owner phone matches a staff member",
            business_owner=self.owner, staff_subject=self.scout,
        )
        self.assertTrue(services.open_flag_exists(self.owner, FraudFlag.SELF_DEALING))
        self.assertFalse(services.open_flag_exists(self.owner, FraudFlag.DUPLICATE))
        self.assertFalse(services.open_flag_exists(self.twin, FraudFlag.SELF_DEALING))
        services.dismiss(flag.pk, self.lead, note="The owner is the scout's sister and has her own phone")
        self.assertFalse(services.open_flag_exists(self.owner, FraudFlag.SELF_DEALING))


class DecisionTests(Base):
    def test_deciding_always_needs_a_note(self):
        flag = self.duplicate()
        for decide in (
            lambda: services.confirm(flag.pk, self.lead, note="  "),
            lambda: services.dismiss(flag.pk, self.lead, note=""),
        ):
            with self.assertRaises(services.FraudError) as raised:
                decide()
            self.assertEqual(
                (raised.exception.message, raised.exception.status_code),
                ("Write a note — confirming or dismissing always needs one.", 400),
            )
        flag.refresh_from_db()
        self.assertEqual(flag.status, "open")

    def test_a_case_is_decided_once(self):
        flag = self.duplicate()
        services.dismiss(flag.pk, self.lead, note="Different shops")
        for decide in (
            lambda: services.confirm(flag.pk, self.boss, note="Actually the same shop"),
            lambda: services.dismiss(flag.pk, self.boss, note="Again"),
        ):
            with self.assertRaises(services.FraudError) as raised:
                decide()
            self.assertEqual(raised.exception.message, "This case has already been decided.")

    def test_confirming_with_suspend_suspends_the_business_and_tells_the_owner(self):
        flag = self.duplicate()
        services.confirm(flag.pk, self.lead, note="Called both owners — it is one shop", suspend=True)
        flag.refresh_from_db()
        self.owner.refresh_from_db()
        self.twin.refresh_from_db()
        self.assertEqual(
            (flag.status, flag.resolved_by, flag.resolution_note),
            ("confirmed", self.lead, "Called both owners — it is one shop"),
        )
        self.assertIsNotNone(flag.resolved_at)
        self.assertTrue(self.owner.is_suspended)
        self.assertEqual(
            self.owner.suspension_reason, "Confirmed fraud case: Adwoa Fabrics and Suame Auto Parts share a MoMo number",
        )
        self.assertFalse(self.twin.is_suspended)  # only the case's own business
        self.assertTrue(Notification.objects.filter(business_owner=self.owner, kind="account_suspended").exists())
        event = ActivityEvent.objects.get(verb="fraud.flag_confirmed")
        self.assertEqual((event.actor_id, event.after["suspend"]), (self.lead.id, True))

    def test_confirming_without_suspend_leaves_the_business_trading(self):
        flag = self.duplicate()
        services.confirm(flag.pk, self.lead, note="Same shop; Operations will merge them by hand")
        self.owner.refresh_from_db()
        self.assertFalse(self.owner.is_suspended)
        self.assertFalse(Notification.objects.filter(business_owner=self.owner, kind="account_suspended").exists())

    def test_only_a_suspendable_case_with_a_business_can_suspend(self):
        self.assertEqual(FraudFlag.SUSPENDABLE, {"duplicate", "similar_nearby", "self_dealing", "fake_business"})
        undone = services.raise_flag(
            FraudFlag.OWNER_OBJECTED, title="Adwoa Fabrics · 3 photos undone by the owner",
            business_owner=self.owner, staff_subject=self.scout, source=FraudFlag.OWNER,
        )
        no_business = services.raise_flag(FraudFlag.FAKE_BUSINESS, title="A shop that may not exist")
        self.assertFalse(services.can_suspend(undone))
        self.assertFalse(services.can_suspend(no_business))
        for flag in (undone, no_business):
            with self.assertRaises(services.FraudError) as raised:
                services.confirm(flag.pk, self.lead, note="Checked on site", suspend=True)
            self.assertEqual(raised.exception.message, "This kind of case can't suspend a business.")
            flag.refresh_from_db()
            self.assertEqual(flag.status, "open")
        self.owner.refresh_from_db()
        self.assertFalse(self.owner.is_suspended)
        self.assertTrue(services.can_suspend(self.duplicate()))

    def test_an_already_suspended_business_is_not_told_twice(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(is_suspended=True, suspension_reason="Suspended by Support")
        flag = FraudFlag.objects.select_related("business_owner").get(pk=self.duplicate().pk)  # fresh owner row
        self.assertFalse(services.can_suspend(flag))
        services.confirm(flag.pk, self.lead, note="Same shop", suspend=True)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.suspension_reason, "Suspended by Support")
        self.assertFalse(Notification.objects.filter(business_owner=self.owner, kind="account_suspended").exists())

    def test_dismissing_records_and_changes_nothing_else(self):
        flag = self.duplicate()
        services.dismiss(flag.pk, self.lead, note="Two shops on one street, one family number")
        flag.refresh_from_db()
        self.owner.refresh_from_db()
        self.assertEqual((flag.status, flag.resolved_by), ("dismissed", self.lead))
        self.assertFalse(self.owner.is_suspended)
        event = ActivityEvent.objects.get(verb="fraud.flag_dismissed")
        self.assertEqual(event.after["note"], "Two shops on one street, one family number")

    def test_nobody_decides_a_case_about_themselves(self):
        flag = services.raise_flag(
            FraudFlag.OUTSIDE_RADIUS, title="Ama · 3 check-ins over 100 m away in 7 days", staff_subject=self.lead,
        )
        with self.assertRaises(services.FraudError) as raised:
            services.dismiss(flag.pk, self.lead, note="The shop moved")
        self.assertEqual(
            (raised.exception.message, raised.exception.status_code),
            ("A case about you is decided by someone else.", 403),
        )
        services.dismiss(flag.pk, self.boss, note="The shop moved; Ama re-pinned it")


class OwnBusinessCaseTests(Base):
    """Whoever registered or manages a business never decides a case about it."""

    def case(self, registrar):
        owner = make_business("Boss Stores", "+233205550000")
        BusinessOwner.objects.filter(pk=owner.pk).update(registered_by=registrar)
        owner.refresh_from_db()
        return services.raise_flag(
            FraudFlag.SELF_DEALING, title="Owner's phone matches staff member Esi", business_owner=owner,
            staff_subject=self.esi,
        )

    def test_the_registrar_is_refused_on_confirm_and_dismiss(self):
        flag = self.case(self.lead)
        message = "A case about a business you registered or manage is decided by someone else."
        for decide in (services.confirm, services.dismiss):
            with self.assertRaises(services.FraudError) as raised:
                decide(flag.pk, self.lead, note="Fine")
            self.assertEqual((raised.exception.message, raised.exception.status_code), (message, 403))
        flag.refresh_from_db()
        self.assertEqual(flag.status, FraudFlag.OPEN)

    def test_the_account_manager_is_refused_too(self):
        flag = self.case(self.boss)
        BusinessOwner.objects.filter(pk=flag.business_owner_id).update(account_manager=self.lead)
        with self.assertRaises(services.FraudError):
            services.dismiss(flag.pk, self.lead, note="Fine")

    def test_another_operations_lead_can_decide_it(self):
        flag = self.case(self.lead)
        other = make_staff("operations", "kojo@example.com")
        services.dismiss(flag.pk, other, note="Cleared by phone")
        flag.refresh_from_db()
        self.assertEqual(flag.status, FraudFlag.DISMISSED)


class OnConfirmedHookTests(Base):
    def test_hooks_run_after_the_status_change_and_the_suspension(self):
        seen = []

        def hook(flag, staff):
            seen.append((
                FraudFlag.objects.get(pk=flag.pk).status,
                flag.resolved_by,
                staff,
                BusinessOwner.objects.get(pk=self.owner.pk).is_suspended,
            ))

        services.ON_CONFIRMED.append(hook)
        self.addCleanup(services.ON_CONFIRMED.remove, hook)
        flag = self.duplicate()
        services.confirm(flag.pk, self.lead, note="One shop", suspend=True)
        self.assertEqual(seen, [("confirmed", self.lead, self.lead, True)])

    def test_hooks_see_the_suspension_on_the_cases_business(self):
        seen = []
        hook = lambda flag, staff: seen.append((flag.business_owner.is_suspended, flag.business_owner.suspension_reason))  # noqa: E731
        services.ON_CONFIRMED.append(hook)
        self.addCleanup(services.ON_CONFIRMED.remove, hook)
        flag = self.duplicate()
        services.confirm(flag.pk, self.lead, note="One shop", suspend=True)
        self.assertEqual(seen, [(True, f"Confirmed fraud case: {flag.title}")])

    def test_a_failing_hook_undoes_the_whole_confirmation(self):
        def hook(flag, staff):
            raise RuntimeError("commission reversal failed")

        services.ON_CONFIRMED.append(hook)
        self.addCleanup(services.ON_CONFIRMED.remove, hook)
        flag = self.duplicate()
        with self.assertRaises(RuntimeError):
            services.confirm(flag.pk, self.lead, note="One shop", suspend=True)
        flag.refresh_from_db()
        self.owner.refresh_from_db()
        self.assertEqual(flag.status, "open")
        self.assertFalse(self.owner.is_suspended)
        self.assertFalse(ActivityEvent.objects.filter(verb="fraud.flag_confirmed").exists())

    def test_dismissing_runs_no_hooks(self):
        seen = []
        hook = lambda flag, staff: seen.append(flag.pk)  # noqa: E731
        services.ON_CONFIRMED.append(hook)
        self.addCleanup(services.ON_CONFIRMED.remove, hook)
        services.dismiss(self.duplicate().pk, self.lead, note="Different shops")
        self.assertEqual(seen, [])
