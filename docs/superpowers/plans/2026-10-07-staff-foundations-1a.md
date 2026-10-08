# Staff Foundations 1A — Operations Role, Team Invites, Activity Log, Tasks & Call Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first half of the staff-platform foundations: Django 5.2 LTS, the Admin → Operations rename, reporting lines with team invites, permission-exact alerts, a tamper-evident activity log that records every staff write, and the shared Tasks and Call Log tools with their staff-dashboard screens.

**Architecture:** Backend changes stay inside Django apps: `accounts` (rename, manager field, invite rules, scoped staff management), three new apps (`activity`, `staff_tasks`, `calls`), and small edits to `notifications` and `events`. Every authenticated staff write is wrapped in a transaction by `StaffActivityMiddleware`, which records it into an append-only, SHA-256 hash-chained `ActivityEvent` table guarded by Postgres triggers. The frontend adds a "My Work" nav group (Tasks, Call Log, Activity, My Team) to the existing staff shell, following the inline-`D`-palette, no-`useMutation`, own-data-hook conventions.

**Tech Stack:** Django 5.2 LTS, DRF, SimpleJWT, Postgres 16 (triggers, advisory locks), React 18 + React Query + Vitest + MSW.

**Spec:** `docs/superpowers/specs/2026-10-07-staff-foundations-design.md` (F1, F3, F4, F7, F8, and the F10 nav pieces for these tools). Parent: `docs/superpowers/specs/2026-10-07-staff-platform-overview-design.md`. Plan 1B (live updates, approvals, reports, sessions, per-role menus) follows this one.

**Base branch:** create `feature/staff-foundations-1a` from `main` **after PR #134 (phase 0: Sign out / view-only marketplace) is merged** — Task 6 edits phase 0's `staffSignOut`.

## Global Constraints

- Backend commands run from the repo root through compose; the service is `web`: `docker compose run --rm web python manage.py test <apps>`.
- Vitest runs from `frontend/` only: `cd frontend && npx vitest run`. MSW is `onUnhandledRequest: 'error'`, so every new endpoint a shell-level component calls needs a default handler in `frontend/mocks/handlers.js`.
- Staff permission checks read `StaffUser.effective_permission_codenames()` (role + individual grants − revokes) — never `role.permissions` directly.
- Every new permission is also granted to `super_admin` (`accounts/tests/test_roles_seed.py` asserts super_admin holds every permission).
- Role codename `operations`, label `Operations`. Old migrations that mention `"admin"` stay untouched.
- Team invite rules: `operations → scout`, `operations → support`, `delivery_manager → dispatch`. Super Admin (`staff.manage`) may invite any role; only a super_admin may invite a super_admin.
- Team managers (`staff.invite_team` without `staff.manage`) may invite, resend invites to, and suspend/unsuspend **only their own direct reports**. Deactivation, role changes, manager changes and permission edits stay `staff.manage`.
- Activity log: append-only, hash = SHA-256(prev_hash + canonical JSON), genesis = 64 × `"0"`; Postgres triggers refuse `UPDATE` and `DELETE`; secrets (keys containing password, token, secret, otp, totp, recovery) are stored as `"[redacted]"`; JSON payloads over 8,000 characters are truncated.
- Activity visibility: own events always; `activity.view_team` adds direct reports; `activity.view_domains` (Operations) adds everything by scouts, support, dispatch, marketing, plus accountant verbs starting `commission`/`payout` and delivery-manager verbs starting `delivery.dispute`, `order-assign-dispatch`, `order-delivery-status`; `activity.view_all` (Super Admin) sees everything.
- Call log: author may edit for 24 h; follow-up time must be in the future and creates a Task; counterpart phone is masked (`mask_but_last(value, keep=3)`) for everyone except the author and `calls.view_all` holders.
- Frontend: inline `style={{}}` from `D`/`glassCard` (`components/admin/theme.js`); mutations are plain `apiPost`/`apiPatch` in handlers with a local `actionError`; components never import `App.jsx`; `StaffDashboard.test.jsx` is a contract — only change it where this plan's nav additions require, and say why in the commit.
- Commit messages follow the repo style (`feat(staff): …`, `chore(deps): …`) and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CPzLdTaySS6wWWArSXaLps
  ```

## Review Focus

1. **Two staff act at the same moment** → the hash chain must not fork (two events sharing a `prev_hash`). Pinned by `ConcurrentChainTests` in Task 5.
2. **A staff write with a multipart body or malformed JSON** → the middleware must still let the view run (no `RawPostDataException`), record form fields, and record nothing when the view rejects the body. Pinned in Task 6.
3. **A write with a malformed, expired or non-staff token** → the middleware passes it through untouched, DRF answers 401/403, nothing is recorded. Pinned in Task 6.
4. **A team manager acting outside their team, on themselves, or on a Super Admin** → refused (403, or 400 for self). Pinned in Task 3.
5. **A manager chain that would loop** (A manages B, then B is set as A's manager, or someone as their own manager) → refused with 400. Pinned in Task 3.

---

### Task 1: Upgrade Django to 5.2 LTS

**Files:**
- Modify: `backend/requirements.txt`
- Modify (only if the deprecation scan finds hits): files listed by the grep in Step 3

**Interfaces:**
- Consumes: nothing.
- Produces: Django 5.2.x everywhere; every later task assumes it.

- [ ] **Step 1: Find the newest compatible versions**

Run each and note the newest version in the named series:
```bash
docker compose run --rm web pip index versions Django                       # newest 5.2.x
docker compose run --rm web pip index versions djangorestframework          # newest 3.16.x
docker compose run --rm web pip index versions djangorestframework-simplejwt # newest 5.5.x
docker compose run --rm web pip index versions django-cors-headers          # newest 4.x
```

- [ ] **Step 2: Pin them in `backend/requirements.txt`**

Replace the four lines (keep every other line as it is), e.g.:
```
Django==5.2.<newest>
djangorestframework==3.16.<newest>
djangorestframework-simplejwt==5.5.<newest>
django-cors-headers==4.<newest>
```

- [ ] **Step 3: Scan for APIs Django 5.1/5.2 removed or renamed**

Run: `grep -rn "index_together\|DEFAULT_FILE_STORAGE\|STATICFILES_STORAGE\|assertQuerysetEqual\|CheckConstraint(check=\|assertFormsetError" backend --include=*.py`
Fix each hit: `DEFAULT_FILE_STORAGE`/`STATICFILES_STORAGE` → a `STORAGES = {"default": {...}, "staticfiles": {...}}` dict; `assertQuerysetEqual` → `assertQuerySetEqual`; `CheckConstraint(check=` → `CheckConstraint(condition=`; `index_together` → `Meta.indexes`; `assertFormsetError` → `assertFormSetError`. Expected: zero or a handful of hits.

- [ ] **Step 4: Rebuild and run the whole backend suite with warnings on**

```bash
docker compose build web
docker compose run --rm web python -W error::DeprecationWarning manage.py test 2>&1 | tail -15
docker compose run --rm web python manage.py makemigrations --check --dry-run
```
Expected: `OK` (≈1,110 tests) and `No changes detected`. If a third-party package raises a `DeprecationWarning` you can't fix, rerun without `-W error` and record the warning in the commit body.

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend
git commit -m "chore(deps): upgrade to Django 5.2 LTS with compatible DRF, SimpleJWT, cors-headers"
```

---

### Task 2: Rename the Admin role to Operations

**Files:**
- Modify: `backend/accounts/models.py` (`Role` constants)
- Create: `backend/accounts/migrations/0030_rename_admin_role_to_operations.py`
- Modify: backend files referencing the role name `"admin"` (found in Step 5) — tests, `core/management/commands/seed_dev_data.py`, `core/management/commands/seed_staff_queues.py`
- Modify: `frontend/components/admin/theme.js` (`ROLE_ACCENTS`, `ROLE_BADGE_TEXT`), plus frontend role-key/label references found in Step 6
- Test: `backend/accounts/tests/test_operations_role.py`

**Interfaces:**
- Consumes: Task 1.
- Produces: `Role.OPERATIONS = "operations"`; role key `operations` in API payloads (`/api/accounts/me/` `role`) and frontend role maps.

- [ ] **Step 1: Write the failing test**

`backend/accounts/tests/test_operations_role.py`:
```python
from django.test import TestCase

from accounts.models import Role


class OperationsRoleTests(TestCase):
    def test_admin_role_is_renamed_to_operations(self):
        self.assertTrue(Role.objects.filter(name="operations").exists())
        self.assertFalse(Role.objects.filter(name="admin").exists())

    def test_operations_keeps_every_permission_admin_had(self):
        perms = set(Role.objects.get(name="operations").permissions.values_list("codename", flat=True))
        self.assertTrue(
            {"kyc.approve", "listings.moderate", "scouts.assign", "users.manage", "site_settings.manage"} <= perms
        )

    def test_label_is_operations(self):
        self.assertEqual(dict(Role.NAME_CHOICES)["operations"], "Operations")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_operations_role -v 2`
Expected: FAIL — `operations` role does not exist / `KeyError: 'operations'`.

- [ ] **Step 3: Change the model constants**

In `backend/accounts/models.py`, inside `class Role`, replace `ADMIN = "admin"` with `OPERATIONS = "operations"` and the choice `(ADMIN, "Admin")` with `(OPERATIONS, "Operations")`. Then replace every `Role.ADMIN` in non-migration code:
```bash
grep -rln "Role.ADMIN" backend --include=*.py | grep -v /migrations/ | xargs -r sed -i 's/Role\.ADMIN/Role.OPERATIONS/g'
```

- [ ] **Step 4: Generate the migration and add the data step**

```bash
docker compose run --rm web python manage.py makemigrations accounts --name rename_admin_role_to_operations
```
Open the generated `backend/accounts/migrations/0030_rename_admin_role_to_operations.py` (it contains an `AlterField` on `role.name`). Add these functions above `class Migration` and append the `RunPython` after the `AlterField`:
```python
def forwards(apps, schema_editor):
    apps.get_model("accounts", "Role").objects.filter(name="admin").update(name="operations")


def backwards(apps, schema_editor):
    apps.get_model("accounts", "Role").objects.filter(name="operations").update(name="admin")
```
```python
        migrations.RunPython(forwards, backwards),
```

- [ ] **Step 5: Update backend references to the role name**

Run: `grep -rn "\"admin\"\|'admin'" backend --include=*.py | grep -v "/migrations/"`
For every hit that names the **role** (e.g. `Role.objects.get(name="admin")`, `"role": "admin"`, `role__name="admin"`), change `admin` to `operations`. Leave hits that aren't the role. Expected ≈44 hits, mostly in `accounts/tests/` and the two seed commands.

- [ ] **Step 6: Update the frontend role keys and labels**

In `frontend/components/admin/theme.js` rename the `admin:` keys of `ROLE_ACCENTS` and `ROLE_BADGE_TEXT` to `operations:` (keep their values). Then:
`grep -rn "'admin'\|\"admin\"\|\"Admin\"\|'Admin'" frontend --include=*.js --include=*.jsx --include=*.ts --include=*.tsx --exclude-dir=node_modules`
Change role keys `admin` → `operations` and the role's display label `Admin` → `Operations` (e.g. role options in `StaffManagementPanel.jsx`, MSW fixtures, tests). Do not rename the `components/admin/` directory or unrelated words.

- [ ] **Step 7: Run backend and frontend tests**

```bash
docker compose run --rm web python manage.py test accounts core 2>&1 | tail -5
docker compose run --rm web python manage.py test 2>&1 | tail -5
cd frontend && npx vitest run 2>&1 | tail -6
```
Expected: all pass, including `test_operations_role`.

- [ ] **Step 8: Commit**

```bash
git add backend frontend
git commit -m "feat(staff): rename the Admin role to Operations"
```

---

### Task 3: Reporting lines and team invites

**Files:**
- Modify: `backend/accounts/models.py` (add `StaffUser.manager`, new `RoleInviteRule`)
- Create: `backend/accounts/migrations/0031_staffuser_manager_roleinviterule.py` (generated), `backend/accounts/migrations/0032_seed_team_invites.py`
- Modify: `backend/accounts/permissions.py` (add `can_manage_staff`, `IsStaff`)
- Modify: `backend/accounts/serializers.py` (`StaffInviteSerializer`, `StaffListSerializer`)
- Modify: `backend/accounts/views.py` (invite, resend, suspend, unsuspend, deactivate; new `StaffTeamListView`, `InvitableRolesView`, `StaffManagerView`)
- Modify: `backend/accounts/urls.py`
- Test: `backend/accounts/tests/test_team_invites.py`

**Interfaces:**
- Consumes: Task 2 (`operations` role).
- Produces:
  - `StaffUser.manager` → `StaffUser | None`, reverse `staff.direct_reports`
  - `RoleInviteRule(inviter_role: Role, invitee_role: Role)`
  - permission `staff.invite_team` (operations, delivery_manager, super_admin)
  - `accounts.permissions.can_manage_staff(user) -> bool`, `accounts.permissions.IsStaff` (DRF permission class)
  - `GET /api/accounts/staff/team/` → plain list of `StaffListSerializer` rows (direct reports)
  - `GET /api/accounts/staff/invitable-roles/` → sorted list of role names
  - `POST /api/accounts/staff/<pk>/manager/` body `{"manager": <id|null>}` → `StaffListSerializer` row
  - `StaffListSerializer` gains `manager` (id or null) and `manager_name`

- [ ] **Step 1: Write the failing tests**

`backend/accounts/tests/test_team_invites.py`:
```python
from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(),
        email=email,
        password_hash="x",
        role=Role.objects.get(name=role),
        **extra,
    )


class Base(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.super_admin = make_staff("super_admin", "boss@example.com")
        self.ops = make_staff("operations", "ama@example.com")
        self.other_ops = make_staff("operations", "kojo@example.com")
        self.dm = make_staff("delivery_manager", "adwoa@example.com")

    def as_(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")


class TeamInviteTests(Base):
    def invite(self, role, email="new@example.com", **extra):
        return self.client.post(
            "/api/accounts/staff/invite/",
            {"full_name": "New Person", "email": email, "role": role, **extra},
            format="json",
        )

    def test_operations_invites_a_scout_who_reports_to_them(self):
        self.as_(self.ops)
        response = self.invite("scout")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(StaffUser.objects.get(email="new@example.com").manager, self.ops)
        self.assertEqual(len(mail.outbox), 1)

    def test_operations_invites_support(self):
        self.as_(self.ops)
        self.assertEqual(self.invite("support").status_code, 201)

    def test_operations_cannot_invite_other_roles(self):
        self.as_(self.ops)
        for role in ["marketing", "accountant", "dispatch", "operations", "super_admin"]:
            self.assertEqual(self.invite(role, email=f"{role}@example.com").status_code, 400, role)

    def test_delivery_manager_invites_dispatch_only(self):
        self.as_(self.dm)
        self.assertEqual(self.invite("dispatch").status_code, 201)
        self.assertEqual(self.invite("scout", email="s@example.com").status_code, 400)

    def test_role_without_team_invites_is_forbidden(self):
        self.as_(make_staff("support", "esi@example.com"))
        self.assertEqual(self.invite("scout").status_code, 403)

    def test_team_inviter_cannot_pick_another_manager(self):
        self.as_(self.ops)
        self.invite("scout", manager=self.other_ops.id)
        self.assertEqual(StaffUser.objects.get(email="new@example.com").manager, self.ops)

    def test_super_admin_can_set_any_manager(self):
        self.as_(self.super_admin)
        self.assertEqual(self.invite("scout", manager=self.other_ops.id).status_code, 201)
        self.assertEqual(StaffUser.objects.get(email="new@example.com").manager, self.other_ops)


class TeamScopeTests(Base):
    def setUp(self):
        super().setUp()
        self.scout = make_staff("scout", "kwame@example.com", manager=self.ops)
        self.other_scout = make_staff("scout", "efua@example.com", manager=self.other_ops)
        self.pending = make_staff(
            "scout", "pending@example.com", manager=self.ops, invite_token="t" * 43
        )

    def post(self, path, data=None):
        return self.client.post(path, data or {}, format="json")

    def test_manager_suspends_and_unsuspends_own_report(self):
        self.as_(self.ops)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.scout.id}/suspend/", {"reason": "x"}).status_code, 200)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.scout.id}/unsuspend/").status_code, 200)

    def test_manager_cannot_suspend_someone_elses_report(self):
        self.as_(self.ops)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.other_scout.id}/suspend/").status_code, 403)

    def test_manager_cannot_suspend_self_or_super_admin(self):
        self.as_(self.ops)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.ops.id}/suspend/").status_code, 400)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.super_admin.id}/suspend/").status_code, 403)

    def test_manager_cannot_deactivate(self):
        self.as_(self.ops)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.scout.id}/deactivate/").status_code, 403)

    def test_manager_resends_only_own_teams_invites(self):
        self.as_(self.ops)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.pending.id}/resend-invite/").status_code, 200)
        self.other_scout.invite_token = "u" * 43
        self.other_scout.save(update_fields=["invite_token"])
        self.assertEqual(self.post(f"/api/accounts/staff/{self.other_scout.id}/resend-invite/").status_code, 403)

    def test_deactivating_a_manager_with_active_reports_is_refused(self):
        self.as_(self.super_admin)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.ops.id}/deactivate/").status_code, 400)
        StaffUser.objects.filter(manager=self.ops).update(manager=self.other_ops)
        self.assertEqual(self.post(f"/api/accounts/staff/{self.ops.id}/deactivate/").status_code, 200)

    def test_team_list_shows_only_direct_reports(self):
        self.as_(self.ops)
        response = self.client.get("/api/accounts/staff/team/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual({row["email"] for row in response.json()}, {"kwame@example.com", "pending@example.com"})
        self.assertEqual(response.json()[0]["manager_name"], self.ops.full_name)

    def test_invitable_roles(self):
        self.as_(self.ops)
        self.assertEqual(self.client.get("/api/accounts/staff/invitable-roles/").json(), ["scout", "support"])
        self.as_(self.super_admin)
        self.assertEqual(
            self.client.get("/api/accounts/staff/invitable-roles/").json(),
            sorted(Role.objects.values_list("name", flat=True)),
        )


class ManagerAssignmentTests(Base):
    def set_manager(self, staff, manager_id):
        return self.client.post(f"/api/accounts/staff/{staff.id}/manager/", {"manager": manager_id}, format="json")

    def test_super_admin_sets_and_clears_a_manager(self):
        self.as_(self.super_admin)
        scout = make_staff("scout", "kwame@example.com")
        self.assertEqual(self.set_manager(scout, self.ops.id).json()["manager"], self.ops.id)
        self.assertIsNone(self.set_manager(scout, None).json()["manager"])

    def test_own_manager_and_cycles_are_refused(self):
        self.as_(self.super_admin)
        self.assertEqual(self.set_manager(self.ops, self.ops.id).status_code, 400)
        self.set_manager(self.other_ops, self.ops.id)
        self.assertEqual(self.set_manager(self.ops, self.other_ops.id).status_code, 400)

    def test_only_staff_manage_can_set_managers(self):
        self.as_(self.ops)
        self.assertEqual(self.set_manager(self.other_ops, self.ops.id).status_code, 403)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `docker compose run --rm web python manage.py test accounts.tests.test_team_invites`
Expected: errors — `StaffUser() got unexpected keyword 'manager'`.

- [ ] **Step 3: Add the model fields**

In `backend/accounts/models.py`, inside `class StaffUser`, after `invited_by`:
```python
    # Reporting line (staff platform foundations F3). PROTECT: a manager with
    # reports can't be deleted; deactivation is blocked in StaffDeactivateView
    # until their team is reassigned.
    manager = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="direct_reports"
    )
```
After `class StaffUser` add:
```python
class RoleInviteRule(models.Model):
    """Which role may invite which (team invites, foundations F3). Super Admin
    (staff.manage) bypasses these rules."""

    inviter_role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="invite_rules")
    invitee_role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="+")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["inviter_role", "invitee_role"], name="unique_role_invite_rule")
        ]

    def __str__(self):
        return f"{self.inviter_role.name} → {self.invitee_role.name}"
```
Run: `docker compose run --rm web python manage.py makemigrations accounts --name staffuser_manager_roleinviterule`

- [ ] **Step 4: Seed the permission and the rules**

`backend/accounts/migrations/0032_seed_team_invites.py`:
```python
from django.db import migrations

GRANT_TO = ["operations", "delivery_manager", "super_admin"]
RULES = [("operations", "scout"), ("operations", "support"), ("delivery_manager", "dispatch")]


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    RoleInviteRule = apps.get_model("accounts", "RoleInviteRule")
    perm, _ = Permission.objects.get_or_create(
        codename="staff.invite_team",
        defaults={"description": "Invite your team, resend their invites, and suspend or unsuspend your direct reports"},
    )
    for name in GRANT_TO:
        Role.objects.get(name=name).permissions.add(perm)
    for inviter, invitee in RULES:
        RoleInviteRule.objects.get_or_create(
            inviter_role=Role.objects.get(name=inviter), invitee_role=Role.objects.get(name=invitee)
        )


def unseed(apps, schema_editor):
    apps.get_model("accounts", "RoleInviteRule").objects.all().delete()
    apps.get_model("accounts", "Permission").objects.filter(codename="staff.invite_team").delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0031_staffuser_manager_roleinviterule")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 5: Add the permission helpers**

Append to `backend/accounts/permissions.py`:
```python
def can_manage_staff(user):
    """Full staff management (Super Admin's staff.manage), as opposed to a
    team manager's staff.invite_team, which is limited to direct reports."""
    return isinstance(user, StaffUser) and "staff.manage" in user.effective_permission_codenames()


class IsStaff(BasePermission):
    def has_permission(self, request, view):
        return isinstance(request.user, StaffUser)
```

- [ ] **Step 6: Update the serializers**

In `backend/accounts/serializers.py` add `RoleInviteRule` to the `.models` import and `can_manage_staff` from `.permissions`. Replace `StaffInviteSerializer`'s field declarations, `Meta` and `validate_role` with:
```python
class StaffInviteSerializer(serializers.ModelSerializer):
    role = serializers.SlugRelatedField(slug_field="name", queryset=Role.objects.all())
    manager = serializers.PrimaryKeyRelatedField(
        queryset=StaffUser.objects.filter(is_active=True), required=False, allow_null=True, write_only=True
    )

    class Meta:
        model = StaffUser
        fields = ["id", "full_name", "email", "phone", "role", "manager"]

    def validate_role(self, value):
        requester = self.context["request"].user
        if value.name == Role.SUPER_ADMIN and requester.role.name != Role.SUPER_ADMIN:
            raise serializers.ValidationError("Only a super_admin can invite another super_admin.")
        if not can_manage_staff(requester) and not RoleInviteRule.objects.filter(
            inviter_role=requester.role, invitee_role=value
        ).exists():
            raise serializers.ValidationError("You can't invite someone to that role.")
        return value

    def validate(self, attrs):
        # A team manager's invitee always reports to them; only staff.manage
        # may name a different manager.
        requester = self.context["request"].user
        if not can_manage_staff(requester):
            attrs["manager"] = requester
        return attrs
```
Keep `create()` unchanged — `validated_data["manager"]` flows into `StaffUser.objects.create(**validated_data)`.
In `StaffListSerializer` add two fields and list them in `Meta.fields` after `"role"`:
```python
    manager = serializers.IntegerField(source="manager_id", read_only=True, allow_null=True)
    manager_name = serializers.CharField(source="manager.full_name", read_only=True, default=None)
```

- [ ] **Step 7: Scope the views**

In `backend/accounts/views.py` import `HasAnyRolePermission, can_manage_staff` from `.permissions` and `RoleInviteRule` from `.models`. Add near `_guard_self_action`:
```python
TEAM_OR_STAFF_MANAGE = ("staff.manage", "staff.invite_team")


def _guard_team_scope(request, staff):
    """A team manager may act only on their own direct reports."""
    if can_manage_staff(request.user) or staff.manager_id == request.user.id:
        return None
    return Response({"detail": "You can only manage your own team."}, status=403)
```
Change `get_permissions` of `StaffInviteView`, `StaffResendInviteView`, `StaffSuspendView` and `StaffUnsuspendView` to `return [HasAnyRolePermission(*TEAM_OR_STAFF_MANAGE)]`. In `StaffResendInviteView.post`, `StaffSuspendView.post` (after the self guard) and `StaffUnsuspendView.post`, right after fetching `staff`, add:
```python
        scope = _guard_team_scope(request, staff)
        if scope:
            return scope
```
In `StaffDeactivateView.post`, after the self guard:
```python
        active_reports = staff.direct_reports.filter(is_active=True).count()
        if active_reports:
            return Response(
                {"detail": f"Reassign {staff.full_name}'s {active_reports} direct report(s) first."},
                status=400,
            )
```
Add three views after `StaffListView`:
```python
class StaffTeamListView(generics.ListAPIView):
    serializer_class = StaffListSerializer
    pagination_class = None

    def get_permissions(self):
        return [HasAnyRolePermission(*TEAM_OR_STAFF_MANAGE)]

    def get_queryset(self):
        return (
            StaffUser.objects.filter(manager=self.request.user)
            .select_related("role", "manager")
            .order_by("full_name")
        )


class InvitableRolesView(APIView):
    def get_permissions(self):
        return [HasAnyRolePermission(*TEAM_OR_STAFF_MANAGE)]

    def get(self, request):
        user = request.user
        if can_manage_staff(user):
            roles = Role.objects.all()
            if user.role.name != Role.SUPER_ADMIN:
                roles = roles.exclude(name=Role.SUPER_ADMIN)
            names = roles.values_list("name", flat=True)
        else:
            names = RoleInviteRule.objects.filter(inviter_role=user.role).values_list(
                "invitee_role__name", flat=True
            )
        return Response(sorted(names))


class StaffManagerView(APIView):
    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def post(self, request, pk):
        staff = generics.get_object_or_404(StaffUser, pk=pk)
        manager_id = request.data.get("manager")
        if manager_id in (None, ""):
            staff.manager = None
        else:
            manager = generics.get_object_or_404(StaffUser, pk=manager_id, is_active=True)
            node = manager
            while node is not None:
                if node.pk == staff.pk:
                    return Response({"detail": "That would make someone their own manager."}, status=400)
                node = node.manager
            staff.manager = manager
        staff.save(update_fields=["manager"])
        return Response(StaffListSerializer(staff).data)
```
Make sure `Role` is imported in `views.py` (add to the `.models` import if missing).

- [ ] **Step 8: Add the URLs**

In `backend/accounts/urls.py`, next to `path("staff/", ...)`:
```python
    path("staff/team/", views.StaffTeamListView.as_view(), name="staff-team"),
    path("staff/invitable-roles/", views.InvitableRolesView.as_view(), name="staff-invitable-roles"),
    path("staff/<int:pk>/manager/", views.StaffManagerView.as_view(), name="staff-manager"),
```

- [ ] **Step 9: Run the tests**

```bash
docker compose run --rm web python manage.py test accounts 2>&1 | tail -5
```
Expected: OK, including all `test_team_invites` tests and the existing `test_staff_invite`/`test_staff_management`/`test_roles_seed`.

- [ ] **Step 10: Commit**

```bash
git add backend/accounts
git commit -m "feat(staff): reporting lines and team invites for Operations and Delivery Manager"
```

---

### Task 4: Alerts, badges and attendee access follow effective permissions

**Files:**
- Modify: `backend/accounts/permissions.py` (add `staff_holding`)
- Modify: `backend/notifications/services.py` (`notify_staff_role`)
- Modify: `backend/notifications/views.py` (`StaffBadgesView`)
- Modify: `backend/events/permissions.py` (`IsEventOwnerOrCanApproveEvents`)
- Test: `backend/notifications/tests/test_effective_permission_alerts.py`

**Interfaces:**
- Consumes: Task 3 (`make_staff` pattern only).
- Produces: `accounts.permissions.staff_holding(codename) -> QuerySet[StaffUser]` — active, unsuspended staff whose effective permissions include `codename`.

- [ ] **Step 1: Write the failing tests**

`backend/notifications/tests/test_effective_permission_alerts.py`:
```python
from types import SimpleNamespace

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Permission, Role, StaffUser
from events.permissions import IsEventOwnerOrCanApproveEvents
from notifications.models import Notification
from notifications.services import notify_staff_role


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


class EffectivePermissionAlertTests(TestCase):
    def setUp(self):
        kyc = Permission.objects.get(codename="kyc.approve")
        self.ops = make_staff("operations", "ama@example.com")
        self.granted = make_staff("marketing", "akua@example.com")
        self.granted.extra_permissions.add(kyc)
        self.revoked = make_staff("operations", "kojo@example.com")
        self.revoked.revoked_permissions.add(kyc)
        self.suspended = make_staff("operations", "yaw@example.com", is_suspended=True)
        self.left = make_staff("operations", "efua@example.com", is_active=False)

    def test_alerts_follow_effective_permissions_and_skip_inactive_staff(self):
        notify_staff_role("kyc.approve", Notification.KYC_NEEDS_APPROVAL, "New KYC")
        emails = set(Notification.objects.filter(staff__isnull=False).values_list("staff__email", flat=True))
        self.assertEqual(emails, {"ama@example.com", "akua@example.com"})

    def test_badges_follow_effective_permissions(self):
        BusinessOwner.objects.create(full_name="Akosua Ntoma", login_phone="0200000101", password_hash="x")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.granted, 'staff')}")
        self.assertEqual(client.get("/api/notifications/staff-badges/").json()["kyc"], 1)
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.revoked, 'staff')}")
        self.assertEqual(client.get("/api/notifications/staff-badges/").json()["kyc"], 0)

    def test_attendee_access_follows_effective_permissions(self):
        event_approve = Permission.objects.get(codename="event.approve")
        support = make_staff("support", "esi@example.com")
        perm = IsEventOwnerOrCanApproveEvents()
        self.assertFalse(perm.has_object_permission(SimpleNamespace(user=support), None, object()))
        support.extra_permissions.add(event_approve)
        self.assertTrue(perm.has_object_permission(SimpleNamespace(user=support), None, object()))
```

- [ ] **Step 2: Run them to verify they fail**

Run: `docker compose run --rm web python manage.py test notifications.tests.test_effective_permission_alerts`
Expected: FAIL — the granted marketer gets no alert/badge, the revoked and inactive operations staff do.

- [ ] **Step 3: Add `staff_holding`**

Append to `backend/accounts/permissions.py` (add `from django.db.models import Q` at the top):
```python
def staff_holding(codename):
    """Active, unsuspended staff whose *effective* permissions include
    `codename` — the same set HasRolePermission enforces."""
    return (
        StaffUser.objects.filter(is_active=True, is_suspended=False)
        .filter(Q(role__permissions__codename=codename) | Q(extra_permissions__codename=codename))
        .exclude(revoked_permissions__codename=codename)
        .distinct()
    )
```

- [ ] **Step 4: Use it**

In `backend/notifications/services.py`, inside `notify_staff_role`, replace the import and recipient query with:
```python
    from accounts.permissions import staff_holding

    created = []
    try:
        recipients = list(staff_holding(permission_codename))
```
(keep the `except`/loop below unchanged). Update its docstring's first line to "…every active staffer whose effective permissions hold…".
In `backend/notifications/views.py` (`StaffBadgesView.get`) replace
`held = set(user.role.permissions.values_list("codename", flat=True))` with `held = user.effective_permission_codenames()`.
In `backend/events/permissions.py` (`IsEventOwnerOrCanApproveEvents.has_object_permission`) replace the staff branch's return with
`return "event.approve" in user.effective_permission_codenames()`.

- [ ] **Step 5: Run the tests**

```bash
docker compose run --rm web python manage.py test notifications events accounts 2>&1 | tail -5
```
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add backend/accounts/permissions.py backend/notifications backend/events/permissions.py
git commit -m "fix(staff): alerts, badges and attendee access follow effective permissions"
```

---

### Task 5: Activity log core — append-only, hash-chained events

**Files:**
- Create: `backend/activity/__init__.py`, `backend/activity/apps.py`, `backend/activity/models.py`, `backend/activity/services.py`
- Create: `backend/activity/migrations/__init__.py`, `backend/activity/migrations/0001_initial.py` (generated), `backend/activity/migrations/0002_append_only_triggers.py`
- Create: `backend/activity/management/__init__.py`, `backend/activity/management/commands/__init__.py`, `backend/activity/management/commands/verify_activity_chain.py`
- Create: `backend/activity/tests/__init__.py`, `backend/activity/tests/test_chain.py`
- Modify: `backend/ashantihub/settings.py` (`INSTALLED_APPS`)
- Modify: `infra/cron/ashantihub.cron`

**Interfaces:**
- Consumes: nothing beyond `accounts` models.
- Produces:
  - `activity.models.ActivityEvent` (fields below; constants `STAFF`, `CUSTOMER`, `BUSINESS_OWNER`, `SYSTEM`)
  - `activity.services.record(actor, verb, *, target=None, target_type="", target_id="", target_label="", summary="", before=None, after=None, method="", request=None, on_behalf_of=None) -> ActivityEvent` — `actor` is a `StaffUser`, `Customer`, `BusinessOwner` or `None` (system); writes inside a transaction; marks the Django request `_activity_recorded = True`
  - `activity.services.verify_chain() -> tuple[bool, int | None]`
  - `activity.services.redact(value)`, `activity.services.GENESIS`
  - `activity.services.on_recorded: list[Callable[[ActivityEvent], None]]` — run after commit (plan 1B attaches the realtime publisher)

- [ ] **Step 1: Write the failing tests**

`backend/activity/tests/test_chain.py`:
```python
import threading

from django.db import InternalError, connection, transaction
from django.test import TestCase, TransactionTestCase

from accounts.models import Role, StaffUser
from activity import services
from activity.models import ActivityEvent


class ChainTests(TestCase):
    def setUp(self):
        self.staff = StaffUser.objects.create(
            full_name="Ama Boateng", email="ama@example.com", password_hash="x",
            role=Role.objects.get(name="operations"),
        )

    def test_events_link_to_genesis_then_to_each_other(self):
        first = services.record(self.staff, "test.first")
        second = services.record(None, "test.second", summary="system job")
        self.assertEqual(first.prev_hash, services.GENESIS)
        self.assertEqual(second.prev_hash, first.hash)
        self.assertEqual((first.actor_type, first.actor_role, first.actor_label), ("staff", "operations", "Ama Boateng"))
        self.assertEqual((second.actor_type, second.actor_label), ("system", "System"))

    def test_target_instance_fills_target_fields(self):
        event = services.record(self.staff, "test.target", target=self.staff)
        self.assertEqual(
            (event.target_type, event.target_id, event.target_label),
            ("accounts.staffuser", str(self.staff.pk), str(self.staff)),
        )

    def test_secrets_are_redacted(self):
        event = services.record(
            self.staff, "test.redact",
            after={"password": "hunter2", "nested": {"invite_token": "abc"}, "reason": "ok"},
        )
        self.assertEqual(event.after["password"], "[redacted]")
        self.assertEqual(event.after["nested"]["invite_token"], "[redacted]")
        self.assertEqual(event.after["reason"], "ok")

    def test_large_payloads_are_truncated(self):
        event = services.record(self.staff, "test.big", after={"blob": "x" * 20000})
        self.assertTrue(event.after["truncated"])

    def test_chain_verifies_after_reload(self):
        for i in range(5):
            services.record(self.staff, f"test.{i}", after={"n": i, "price": 12.5})
        self.assertEqual(services.verify_chain(), (True, None))

    def test_update_and_delete_are_refused(self):
        event = services.record(self.staff, "test.locked")
        with self.assertRaises(InternalError):
            with transaction.atomic():
                ActivityEvent.objects.filter(pk=event.pk).update(summary="changed")
        with self.assertRaises(InternalError):
            with transaction.atomic():
                ActivityEvent.objects.filter(pk=event.pk).delete()

    def test_tampering_is_detected(self):
        events = [services.record(self.staff, f"test.{i}") for i in range(3)]
        with connection.cursor() as cursor:
            cursor.execute("ALTER TABLE activity_activityevent DISABLE TRIGGER activity_event_no_update")
            cursor.execute("UPDATE activity_activityevent SET summary = 'forged' WHERE id = %s", [events[1].pk])
            cursor.execute("ALTER TABLE activity_activityevent ENABLE TRIGGER activity_event_no_update")
        self.assertEqual(services.verify_chain(), (False, events[1].pk))


class ConcurrentChainTests(TransactionTestCase):
    serialized_rollback = True

    def test_simultaneous_records_do_not_fork_the_chain(self):
        errors = []

        def worker(n):
            try:
                for i in range(10):
                    services.record(None, f"test.thread{n}.{i}")
            except Exception as exc:  # surfaced through the assertion below
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker, args=(n,)) for n in range(3)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(ActivityEvent.objects.count(), 30)
        self.assertEqual(ActivityEvent.objects.values("prev_hash").distinct().count(), 30)
        self.assertEqual(services.verify_chain(), (True, None))
```

- [ ] **Step 2: Create the app skeleton and register it**

`backend/activity/__init__.py` and `backend/activity/tests/__init__.py`, `backend/activity/migrations/__init__.py`, `backend/activity/management/__init__.py`, `backend/activity/management/commands/__init__.py`: empty files.
`backend/activity/apps.py`:
```python
from django.apps import AppConfig


class ActivityConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "activity"
```
Add `"activity",` to `INSTALLED_APPS` in `backend/ashantihub/settings.py` after `"notifications",`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `docker compose run --rm web python manage.py test activity`
Expected: ERROR — `cannot import name 'services' from 'activity'` / no `ActivityEvent`.

- [ ] **Step 4: Write the model**

`backend/activity/models.py`:
```python
from django.db import models


class ActivityEvent(models.Model):
    """One staff (or system) action. Append-only: Postgres triggers refuse
    UPDATE and DELETE (migration 0002), and each row carries the SHA-256 of
    the previous row's hash plus its own canonical JSON (activity.services)."""

    STAFF = "staff"
    CUSTOMER = "customer"
    BUSINESS_OWNER = "business_owner"
    SYSTEM = "system"
    ACTOR_TYPE_CHOICES = [
        (STAFF, "Staff"),
        (CUSTOMER, "Customer"),
        (BUSINESS_OWNER, "Business owner"),
        (SYSTEM, "System"),
    ]

    id = models.BigAutoField(primary_key=True)
    occurred_at = models.DateTimeField()
    actor_type = models.CharField(max_length=20, choices=ACTOR_TYPE_CHOICES)
    actor_id = models.PositiveBigIntegerField(null=True, blank=True)
    actor_role = models.CharField(max_length=20, blank=True, default="")
    actor_label = models.CharField(max_length=150, blank=True, default="")
    on_behalf_of_id = models.PositiveBigIntegerField(null=True, blank=True)
    verb = models.CharField(max_length=100)
    method = models.CharField(max_length=8, blank=True, default="")
    target_type = models.CharField(max_length=50, blank=True, default="")
    target_id = models.CharField(max_length=64, blank=True, default="")
    target_label = models.CharField(max_length=200, blank=True, default="")
    summary = models.CharField(max_length=300, blank=True, default="")
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True, default="")
    request_id = models.CharField(max_length=64, blank=True, default="")
    prev_hash = models.CharField(max_length=64)
    hash = models.CharField(max_length=64, unique=True)

    class Meta:
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["actor_type", "actor_id", "-occurred_at"]),
            models.Index(fields=["actor_role", "-occurred_at"]),
            models.Index(fields=["verb"]),
            models.Index(fields=["target_type", "target_id"]),
        ]

    def __str__(self):
        return f"#{self.id} {self.actor_label} {self.verb}"
```
Run: `docker compose run --rm web python manage.py makemigrations activity`
Expected: `activity/migrations/0001_initial.py` created.

- [ ] **Step 5: Add the append-only triggers**

`backend/activity/migrations/0002_append_only_triggers.py`:
```python
from django.db import migrations

FORWARD = """
CREATE OR REPLACE FUNCTION activity_event_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'activity_activityevent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER activity_event_no_update
    BEFORE UPDATE OR DELETE ON activity_activityevent
    FOR EACH ROW EXECUTE FUNCTION activity_event_immutable();
"""

REVERSE = """
DROP TRIGGER IF EXISTS activity_event_no_update ON activity_activityevent;
DROP FUNCTION IF EXISTS activity_event_immutable();
"""


class Migration(migrations.Migration):
    # No TRUNCATE trigger on purpose: Django's TransactionTestCase flushes
    # with TRUNCATE. Truncation is caught instead by the nightly seal
    # (verify_activity_chain --email-seal) going off-server.
    dependencies = [("activity", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
```

- [ ] **Step 6: Write the service**

`backend/activity/services.py`:
```python
import datetime as dt
import hashlib
import json
import logging

from django.db import connection, transaction
from django.utils import timezone

from .models import ActivityEvent

logger = logging.getLogger(__name__)

GENESIS = "0" * 64
CHAIN_LOCK_KEY = 72210001  # pg_advisory_xact_lock key serialising chain writes
MAX_JSON_CHARS = 8000
SECRET_MARKERS = ("password", "token", "secret", "otp", "totp", "recovery")

# Callables run after commit with each saved event (plan 1B: realtime publish).
on_recorded = []


def _is_secret_key(key):
    lowered = str(key).lower()
    return any(marker in lowered for marker in SECRET_MARKERS)


def redact(value):
    if isinstance(value, dict):
        return {k: "[redacted]" if _is_secret_key(k) else redact(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


def _bounded(value):
    if value is None:
        return None
    text = json.dumps(redact(value), default=str, sort_keys=True)
    if len(text) > MAX_JSON_CHARS:
        return {"truncated": True, "preview": text[:MAX_JSON_CHARS]}
    return json.loads(text)


def _actor_fields(actor):
    from accounts.models import BusinessOwner, Customer, StaffUser

    if actor is None:
        return {"actor_type": ActivityEvent.SYSTEM, "actor_id": None, "actor_role": "", "actor_label": "System"}
    if isinstance(actor, StaffUser):
        return {
            "actor_type": ActivityEvent.STAFF, "actor_id": actor.pk,
            "actor_role": actor.role.name, "actor_label": actor.full_name,
        }
    if isinstance(actor, BusinessOwner):
        return {"actor_type": ActivityEvent.BUSINESS_OWNER, "actor_id": actor.pk, "actor_role": "", "actor_label": actor.full_name}
    if isinstance(actor, Customer):
        return {"actor_type": ActivityEvent.CUSTOMER, "actor_id": actor.pk, "actor_role": "", "actor_label": actor.full_name}
    raise TypeError(f"Unsupported activity actor: {type(actor).__name__}")


def hashable_fields(event):
    return {
        "occurred_at": event.occurred_at.astimezone(dt.timezone.utc).isoformat(),
        "actor_type": event.actor_type,
        "actor_id": event.actor_id,
        "actor_role": event.actor_role,
        "actor_label": event.actor_label,
        "on_behalf_of_id": event.on_behalf_of_id,
        "verb": event.verb,
        "method": event.method,
        "target_type": event.target_type,
        "target_id": event.target_id,
        "target_label": event.target_label,
        "summary": event.summary,
        "before": event.before,
        "after": event.after,
        "ip": event.ip,
        "user_agent": event.user_agent,
        "request_id": event.request_id,
    }


def compute_hash(prev_hash, fields):
    payload = prev_hash + json.dumps(fields, default=str, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (forwarded.split(",")[0].strip() if forwarded else request.META.get("REMOTE_ADDR")) or None


def _notify(event):
    for hook in list(on_recorded):
        try:
            hook(event)
        except Exception:
            logger.exception("activity on_recorded hook failed for event %s", event.pk)


def record(actor, verb, *, target=None, target_type="", target_id="", target_label="",
           summary="", before=None, after=None, method="", request=None, on_behalf_of=None):
    django_request = getattr(request, "_request", request)
    if target is not None:
        target_type = target._meta.label_lower
        target_id = str(target.pk)
        target_label = str(target)
    event = ActivityEvent(
        occurred_at=timezone.now(),
        on_behalf_of_id=getattr(on_behalf_of, "pk", None),
        verb=verb[:100],
        method=method[:8],
        target_type=target_type[:50],
        target_id=str(target_id)[:64],
        target_label=target_label[:200],
        summary=summary[:300],
        before=_bounded(before),
        after=_bounded(after),
        ip=_client_ip(django_request) if django_request is not None else None,
        user_agent=django_request.META.get("HTTP_USER_AGENT", "")[:300] if django_request is not None else "",
        request_id=getattr(django_request, "activity_request_id", "") if django_request is not None else "",
        **_actor_fields(actor),
    )
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [CHAIN_LOCK_KEY])
        prev = ActivityEvent.objects.order_by("-id").values_list("hash", flat=True).first() or GENESIS
        event.prev_hash = prev
        event.hash = compute_hash(prev, hashable_fields(event))
        event.save(force_insert=True)
        transaction.on_commit(lambda: _notify(event))
    if django_request is not None:
        django_request._activity_recorded = True
    return event


def verify_chain():
    """(True, None) if every event links to the previous one and its hash
    matches its content; otherwise (False, id_of_first_bad_event)."""
    prev = GENESIS
    for event in ActivityEvent.objects.order_by("id").iterator(chunk_size=2000):
        if event.prev_hash != prev or event.hash != compute_hash(prev, hashable_fields(event)):
            return False, event.pk
        prev = event.hash
    return True, None
```

- [ ] **Step 7: Run the tests**

```bash
docker compose run --rm web python manage.py migrate activity
docker compose run --rm web python manage.py test activity -v 2 2>&1 | tail -15
```
Expected: 8 tests OK (7 in `ChainTests`, 1 in `ConcurrentChainTests`).

- [ ] **Step 8: Add the nightly verification command**

`backend/activity/management/commands/verify_activity_chain.py`:
```python
import logging

from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError

from accounts.models import StaffUser
from activity.models import ActivityEvent
from activity.services import GENESIS, verify_chain

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Re-verify the activity-log hash chain; with --email-seal, email the result to every active Super Admin."

    def add_arguments(self, parser):
        parser.add_argument("--email-seal", action="store_true")

    def handle(self, *args, **options):
        ok, broken_id = verify_chain()
        last = ActivityEvent.objects.order_by("-id").first()
        count = ActivityEvent.objects.count()
        if ok:
            seal = f"OK · {count} events · last #{last.pk if last else 0} · {last.hash if last else GENESIS}"
        else:
            seal = f"BROKEN at event #{broken_id} · {count} events"
            logger.error("Activity chain broken at event %s", broken_id)
        if options["email_seal"]:
            recipients = list(
                StaffUser.objects.filter(role__name="super_admin", is_active=True).values_list("email", flat=True)
            )
            if recipients:
                send_mail(
                    "AshantiHub activity seal",
                    f"{seal}\n\nKeep this email: it lets you prove later that the activity log was not rewritten.",
                    settings.DEFAULT_FROM_EMAIL,
                    recipients,
                )
        if not ok:
            raise CommandError(seal)
        self.stdout.write(seal)
```
Add to `backend/activity/tests/test_chain.py`:
```python
from io import StringIO

from django.core import mail
from django.core.management import CommandError, call_command


class VerifyCommandTests(TestCase):
    def test_ok_chain_prints_and_emails_the_seal(self):
        StaffUser.objects.create(
            full_name="Boss", email="boss@example.com", password_hash="x", role=Role.objects.get(name="super_admin")
        )
        services.record(None, "test.one")
        out = StringIO()
        call_command("verify_activity_chain", "--email-seal", stdout=out)
        self.assertIn("OK · 1 events", out.getvalue())
        self.assertEqual(mail.outbox[0].to, ["boss@example.com"])

    def test_broken_chain_fails(self):
        event = services.record(None, "test.one")
        with connection.cursor() as cursor:
            cursor.execute("ALTER TABLE activity_activityevent DISABLE TRIGGER activity_event_no_update")
            cursor.execute("UPDATE activity_activityevent SET verb = 'forged' WHERE id = %s", [event.pk])
            cursor.execute("ALTER TABLE activity_activityevent ENABLE TRIGGER activity_event_no_update")
        with self.assertRaises(CommandError):
            call_command("verify_activity_chain", stdout=StringIO())
```
Run: `docker compose run --rm web python manage.py test activity 2>&1 | tail -4` — Expected: 10 tests OK.

- [ ] **Step 9: Schedule it**

Append to `infra/cron/ashantihub.cron`:
```
# Activity-log integrity: production emails the nightly seal to Super Admins; staging only verifies.
45 1 * * * root cd /opt/ashantihub && docker compose -p ashantihub -f infra/compose/docker-compose.yml run --rm --no-deps web python manage.py verify_activity_chain --email-seal >> /var/log/ashantihub-cron.log 2>&1
55 1 * * * root cd /opt/ashantihub-staging && docker compose -p ashantihub-staging -f infra/compose/docker-compose.yml run --rm --no-deps web python manage.py verify_activity_chain >> /var/log/ashantihub-cron.log 2>&1
```

- [ ] **Step 10: Commit**

```bash
git add backend/activity backend/ashantihub/settings.py infra/cron/ashantihub.cron
git commit -m "feat(activity): append-only, hash-chained activity log with nightly verification"
```

---

### Task 6: Record every staff write; sign-in/out events; the activity API

**Files:**
- Create: `backend/activity/middleware.py`, `backend/activity/serializers.py`, `backend/activity/views.py`, `backend/activity/urls.py`
- Create: `backend/activity/tests/test_middleware.py`, `backend/activity/tests/test_activity_api.py`
- Create: `backend/accounts/migrations/0033_seed_activity_permissions.py`
- Modify: `backend/ashantihub/settings.py` (`MIDDLEWARE`), `backend/ashantihub/urls.py`
- Modify: `backend/accounts/views.py` (`StaffLoginView` records sign-in; new `StaffLogoutView`), `backend/accounts/urls.py`
- Modify: `frontend/App.jsx` (`staffSignOut` posts to the logout endpoint), `frontend/mocks/handlers.js`, `frontend/App.staffSession.test.jsx`

**Interfaces:**
- Consumes: Task 5 (`record`, `ActivityEvent`), Task 3 (`IsStaff`, `StaffUser.manager`).
- Produces:
  - `activity.middleware.StaffActivityMiddleware`
  - `POST /api/accounts/staff/logout/` → 204 (records `staff.signed_out`); `StaffLoginView` records `staff.signed_in`
  - `GET /api/activity/` → DRF page `{count, next, previous, results:[ActivityEvent rows]}`; filters `mine=1`, `actor`, `role`, `verb` (prefix), `target_type`, `target_id`, `since`, `until` (YYYY-MM-DD)
  - `activity.views.visible_events(user) -> QuerySet[ActivityEvent]`, `activity.views.ROLE_ACTIVITY_VISIBILITY`
  - permissions `activity.view_team` (operations, delivery_manager, super_admin), `activity.view_domains` (operations, super_admin), `activity.view_all` (super_admin)

- [ ] **Step 1: Write the failing middleware tests**

`backend/activity/tests/test_middleware.py`:
```python
from unittest import mock

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Customer, Role, StaffUser
from activity.models import ActivityEvent


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


class StaffActivityMiddlewareTests(TestCase):
    def setUp(self):
        cache.clear()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.support = make_staff("support", "esi@example.com")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.boss, 'staff')}")
        self.suspend_url = f"/api/accounts/staff/{self.support.id}/suspend/"

    def test_successful_staff_write_records_one_event(self):
        response = self.client.post(self.suspend_url, {"reason": "investigation"}, format="json")
        self.assertEqual(response.status_code, 200)
        event = ActivityEvent.objects.get()
        self.assertEqual((event.verb, event.method, event.actor_id), ("staff-suspend", "POST", self.boss.id))
        self.assertEqual(event.target_id, str(self.support.id))
        self.assertEqual(event.after, {"request": {"reason": "investigation"}, "status": 200})

    def test_rejected_staff_write_records_nothing(self):
        response = self.client.post(f"/api/accounts/staff/{self.boss.id}/suspend/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ActivityEvent.objects.exists())

    def test_multipart_body_is_recorded_and_the_view_still_works(self):
        response = self.client.post(self.suspend_url, {"reason": "form post"}, format="multipart")
        self.assertEqual(response.status_code, 200)
        self.support.refresh_from_db()
        self.assertEqual(self.support.suspension_reason, "form post")
        self.assertEqual(ActivityEvent.objects.get().after["request"], {"reason": "form post"})

    def test_malformed_json_reaches_the_view_and_records_nothing(self):
        response = self.client.generic("POST", self.suspend_url, "{not json", content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ActivityEvent.objects.exists())

    def test_reads_are_not_recorded(self):
        self.client.get("/api/accounts/staff/")
        self.assertFalse(ActivityEvent.objects.exists())

    def test_bad_tokens_pass_through(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer not-a-token")
        self.assertEqual(self.client.post(self.suspend_url, {}, format="json").status_code, 401)
        self.assertFalse(ActivityEvent.objects.exists())

    def test_customer_writes_are_not_recorded(self):
        customer = Customer.objects.create(full_name="Yaw Mensah", phone="0240000001", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        self.client.patch("/api/accounts/customers/me/profile/", {"full_name": "Yaw M."}, format="json")
        self.assertFalse(ActivityEvent.objects.exists())

    def test_recording_failure_rolls_the_action_back(self):
        with mock.patch("activity.middleware.services.record", side_effect=RuntimeError("db down")):
            with self.assertRaises(RuntimeError):
                self.client.post(self.suspend_url, {"reason": "x"}, format="json")
        self.support.refresh_from_db()
        self.assertFalse(self.support.is_suspended)

    def test_logout_records_once(self):
        self.assertEqual(self.client.post("/api/accounts/staff/logout/", {}, format="json").status_code, 204)
        self.assertEqual(list(ActivityEvent.objects.values_list("verb", flat=True)), ["staff.signed_out"])

    def test_login_is_recorded(self):
        self.support.password_hash = make_password("correct-horse-1")
        self.support.save(update_fields=["password_hash"])
        anonymous = APIClient()
        response = anonymous.post(
            "/api/accounts/staff/login/", {"identifier": "esi@example.com", "password": "correct-horse-1"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        event = ActivityEvent.objects.get()
        self.assertEqual((event.verb, event.actor_id), ("staff.signed_in", self.support.id))
```

- [ ] **Step 2: Run them to verify they fail**

Run: `docker compose run --rm web python manage.py test activity.tests.test_middleware`
Expected: FAIL — nothing recorded; `/api/accounts/staff/logout/` 404.

- [ ] **Step 3: Write the middleware**

`backend/activity/middleware.py`:
```python
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
```
In `backend/ashantihub/settings.py` add `"activity.middleware.StaffActivityMiddleware",` to `MIDDLEWARE` after `"django.middleware.common.CommonMiddleware",`.

- [ ] **Step 4: Record sign-in and add sign-out**

In `backend/accounts/views.py` import `from activity.services import record as record_activity` and `IsStaff` from `.permissions`. In `StaffLoginView.post`, after `account = serializer.account`:
```python
        record_activity(account, "staff.signed_in", target=account, method="POST", request=request)
```
Add:
```python
class StaffLogoutView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def post(self, request):
        record_activity(request.user, "staff.signed_out", target=request.user, method="POST", request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)
```
In `backend/accounts/urls.py` add `path("staff/logout/", views.StaffLogoutView.as_view(), name="staff-logout"),` after `staff/login/`.

- [ ] **Step 5: Run the middleware tests**

Run: `docker compose run --rm web python manage.py test activity.tests.test_middleware -v 2 2>&1 | tail -14`
Expected: 10 tests OK.

- [ ] **Step 6: Write the failing API tests**

`backend/activity/tests/test_activity_api.py`:
```python
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Customer, Role, StaffUser
from activity import services


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


class ActivityApiTests(TestCase):
    def setUp(self):
        self.boss = make_staff("super_admin", "boss@example.com")
        self.ops = make_staff("operations", "ama@example.com")
        self.dm = make_staff("delivery_manager", "adwoa@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.ops)
        self.other_scout = make_staff("scout", "efua@example.com")
        self.marketer = make_staff("marketing", "akua@example.com")
        self.accountant = make_staff("accountant", "kwabena@example.com")
        self.rider = make_staff("dispatch", "kofi@example.com", manager=self.dm)
        for actor, verb in [
            (self.ops, "kyc-approve"), (self.scout, "scout.checked_in"), (self.other_scout, "scout.checked_in"),
            (self.marketer, "promotion-approve"), (self.accountant, "commission.batch_prepared"),
            (self.accountant, "escrow-release"), (self.dm, "order-assign-dispatch"), (self.dm, "shift.planned"),
            (self.rider, "delivery-pickup"),
        ]:
            services.record(actor, verb)
        self.client = APIClient()

    def verbs_for(self, staff, query=""):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")
        response = self.client.get(f"/api/activity/{query}")
        self.assertEqual(response.status_code, 200)
        return sorted((row["actor_label"], row["verb"]) for row in response.json()["results"])

    def test_a_scout_sees_only_their_own_events(self):
        self.assertEqual(self.verbs_for(self.scout), [("Kwame", "scout.checked_in")])

    def test_operations_sees_overseen_roles_and_relevant_finance_and_delivery(self):
        got = self.verbs_for(self.ops)
        self.assertIn(("Ama", "kyc-approve"), got)
        self.assertIn(("Efua", "scout.checked_in"), got)
        self.assertIn(("Akua", "promotion-approve"), got)
        self.assertIn(("Kwabena", "commission.batch_prepared"), got)
        self.assertIn(("Adwoa", "order-assign-dispatch"), got)
        self.assertIn(("Kofi", "delivery-pickup"), got)
        self.assertNotIn(("Kwabena", "escrow-release"), got)
        self.assertNotIn(("Adwoa", "shift.planned"), got)

    def test_delivery_manager_sees_own_and_team(self):
        self.assertEqual(
            self.verbs_for(self.dm),
            [("Adwoa", "order-assign-dispatch"), ("Adwoa", "shift.planned"), ("Kofi", "delivery-pickup")],
        )

    def test_super_admin_sees_everything(self):
        self.assertEqual(len(self.verbs_for(self.boss)), 9)

    def test_filters(self):
        self.assertEqual(self.verbs_for(self.boss, "?verb=scout."), [("Efua", "scout.checked_in"), ("Kwame", "scout.checked_in")])
        self.assertEqual(self.verbs_for(self.ops, "?mine=1"), [("Ama", "kyc-approve")])
        self.assertEqual(self.verbs_for(self.boss, "?role=dispatch"), [("Kofi", "delivery-pickup")])

    def test_bad_date_is_a_400(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.boss, 'staff')}")
        self.assertEqual(self.client.get("/api/activity/?since=yesterday").status_code, 400)

    def test_non_staff_is_refused(self):
        customer = Customer.objects.create(full_name="Yaw", phone="0240000001", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        self.assertEqual(self.client.get("/api/activity/").status_code, 403)
```

- [ ] **Step 7: Seed the permissions**

`backend/accounts/migrations/0033_seed_activity_permissions.py`:
```python
from django.db import migrations

PERMISSIONS = [
    ("activity.view_team", "See your direct reports' activity"),
    ("activity.view_domains", "See the activity of the roles your role oversees"),
    ("activity.view_all", "See every staff member's activity"),
]
GRANTS = {
    "operations": ["activity.view_team", "activity.view_domains"],
    "delivery_manager": ["activity.view_team"],
    "super_admin": [codename for codename, _ in PERMISSIONS],
}


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    by_code = {}
    for codename, description in PERMISSIONS:
        by_code[codename], _ = Permission.objects.get_or_create(codename=codename, defaults={"description": description})
    for role_name, codenames in GRANTS.items():
        Role.objects.get(name=role_name).permissions.add(*[by_code[c] for c in codenames])


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0032_seed_team_invites")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 8: Write the API**

`backend/activity/serializers.py`:
```python
from rest_framework import serializers

from .models import ActivityEvent


class ActivityEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityEvent
        fields = [
            "id", "occurred_at", "actor_type", "actor_id", "actor_role", "actor_label",
            "verb", "method", "target_type", "target_id", "target_label", "summary", "before", "after",
        ]
```
`backend/activity/views.py`:
```python
from django.db.models import Q
from django.utils.dateparse import parse_date
from rest_framework import generics
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination

from accounts.models import StaffUser
from accounts.permissions import IsStaff

from .models import ActivityEvent
from .serializers import ActivityEventSerializer

# activity.view_domains: what each overseeing role sees beyond its own team.
ROLE_ACTIVITY_VISIBILITY = {
    "operations": {
        "roles": ["scout", "support", "dispatch", "marketing"],
        "partial": {
            "accountant": ["commission", "payout"],
            "delivery_manager": ["delivery.dispute", "order-assign-dispatch", "order-delivery-status"],
        },
    },
}


def visible_events(user):
    perms = user.effective_permission_codenames()
    events = ActivityEvent.objects.all()
    if "activity.view_all" in perms:
        return events
    staff = Q(actor_type=ActivityEvent.STAFF)
    scope = staff & Q(actor_id=user.id)
    if "activity.view_team" in perms:
        team = list(StaffUser.objects.filter(manager=user).values_list("id", flat=True))
        scope |= staff & Q(actor_id__in=team)
    if "activity.view_domains" in perms:
        rule = ROLE_ACTIVITY_VISIBILITY.get(user.role.name, {})
        if rule.get("roles"):
            scope |= staff & Q(actor_role__in=rule["roles"])
        for role, prefixes in rule.get("partial", {}).items():
            for prefix in prefixes:
                scope |= staff & Q(actor_role=role, verb__startswith=prefix)
    return events.filter(scope)


class ActivityPagination(PageNumberPagination):
    page_size = 50


def _date_param(params, name):
    raw = params.get(name)
    if not raw:
        return None
    value = parse_date(raw)
    if value is None:
        raise ValidationError({name: "Use YYYY-MM-DD."})
    return value


class ActivityListView(generics.ListAPIView):
    serializer_class = ActivityEventSerializer
    pagination_class = ActivityPagination

    def get_permissions(self):
        return [IsStaff()]

    def get_queryset(self):
        user = self.request.user
        params = self.request.query_params
        events = visible_events(user)
        if params.get("mine") == "1":
            events = events.filter(actor_type=ActivityEvent.STAFF, actor_id=user.id)
        if params.get("actor"):
            events = events.filter(actor_type=ActivityEvent.STAFF, actor_id=params["actor"])
        if params.get("role"):
            events = events.filter(actor_role=params["role"])
        if params.get("verb"):
            events = events.filter(verb__startswith=params["verb"])
        if params.get("target_type"):
            events = events.filter(target_type=params["target_type"])
        if params.get("target_id"):
            events = events.filter(target_id=params["target_id"])
        since = _date_param(params, "since")
        until = _date_param(params, "until")
        if since:
            events = events.filter(occurred_at__date__gte=since)
        if until:
            events = events.filter(occurred_at__date__lte=until)
        return events.order_by("-id")
```
`backend/activity/urls.py`:
```python
from django.urls import path

from . import views

urlpatterns = [path("", views.ActivityListView.as_view(), name="activity-list")]
```
In `backend/ashantihub/urls.py` add `path("api/activity/", include("activity.urls")),`.

- [ ] **Step 9: Run the activity and accounts tests**

```bash
docker compose run --rm web python manage.py test activity accounts 2>&1 | tail -5
docker compose run --rm web python manage.py test 2>&1 | tail -5
```
Expected: OK everywhere (the middleware now wraps every existing staff write; the full suite proves none broke).

- [ ] **Step 10: Sign-out calls the endpoint (frontend)**

In `frontend/App.jsx`, `staffSignOut` (added by phase 0) becomes:
```javascript
  const staffSignOut=()=>{
    // Best-effort audit trail: the token is read synchronously by apiPost
    // before logout() clears it; a failed call never blocks signing out.
    apiPost("/api/accounts/staff/logout/",{}).catch(()=>{});
    queryClient.clear();
    auth.logout();
    setAuthModal(null);
    if(location.pathname!=="/staff") navigate("/staff",{replace:onStaffDashboardPath});
  };
```
In `frontend/mocks/handlers.js` add to `handlers`:
```javascript
  http.post('http://localhost:8000/api/accounts/staff/logout/', () => new HttpResponse(null, { status: 204 })),
```
Append to `frontend/App.staffSession.test.jsx` (it already defines `signInStaff`, `renderAt` and `staffNav`, and imports `http`, `HttpResponse`, `server`, `waitFor`):
```javascript
describe('Staff Sign out is recorded', () => {
  it('posts to /api/accounts/staff/logout/ with the staff token before clearing it', async () => {
    let authHeader = null
    server.use(http.post('http://localhost:8000/api/accounts/staff/logout/', ({ request }) => {
      authHeader = request.headers.get('Authorization')
      return new HttpResponse(null, { status: 204 })
    }))
    signInStaff()
    renderAt('/staff/users')
    await staffNav()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(authHeader).toBe('Bearer test-token'))
  }, 10000)
})
```
Run: `cd frontend && npx vitest run App.staffSession.test.jsx` — Expected: PASS (the new test fails before the `staffSignOut` change, with `authHeader` still `null`).

- [ ] **Step 11: Commit**

```bash
git add backend frontend/App.jsx frontend/mocks/handlers.js frontend/App.staffSession.test.jsx
git commit -m "feat(activity): record every staff write, sign-in and sign-out; activity API with role scopes"
```

---

### Task 7: Staff tasks

**Files:**
- Create: `backend/staff_tasks/__init__.py`, `apps.py`, `models.py`, `services.py`, `serializers.py`, `views.py`, `urls.py`, `migrations/__init__.py`, `migrations/0001_initial.py` (generated), `tests/__init__.py`, `tests/test_tasks.py`
- Modify: `backend/ashantihub/settings.py`, `backend/ashantihub/urls.py`
- Modify: `backend/notifications/views.py` (`StaffBadgesView` adds `tasks_overdue`)

**Interfaces:**
- Consumes: Task 3 (`IsStaff`).
- Produces:
  - `staff_tasks.models.Task` (`OPEN`, `DONE`, `CANCELLED`)
  - `staff_tasks.services.create_task(owner, title, due_at, *, notes="", source=None, created_by=None) -> Task`
  - `GET /api/tasks/?view=open|today|overdue|upcoming|done` → plain list (max 200); `POST /api/tasks/` `{title, due_at, notes?}`; `POST /api/tasks/<id>/done/`; `POST /api/tasks/<id>/cancel/`
  - badge key `tasks_overdue` in `GET /api/notifications/staff-badges/`

- [ ] **Step 1: Write the failing tests**

`backend/staff_tasks/tests/test_tasks.py`:
```python
import datetime as dt

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser
from staff_tasks.models import Task
from staff_tasks.services import create_task


def make_staff(role, email):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x", role=Role.objects.get(name=role)
    )


class TaskTests(TestCase):
    def setUp(self):
        self.scout = make_staff("scout", "kwame@example.com")
        self.other = make_staff("scout", "efua@example.com")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.scout, 'staff')}")
        now = timezone.now()
        self.overdue = create_task(self.scout, "Call Adwoa Fabrics", now - dt.timedelta(hours=2))
        self.today = create_task(self.scout, "Photos at Bonwire", now + dt.timedelta(minutes=1))
        self.later = create_task(self.scout, "Visit Kejetia", now + dt.timedelta(days=3))
        self.not_mine = create_task(self.other, "Someone else's", now + dt.timedelta(hours=1))

    def titles(self, view):
        response = self.client.get(f"/api/tasks/?view={view}")
        self.assertEqual(response.status_code, 200)
        return [row["title"] for row in response.json()]

    def test_views_filter_my_tasks(self):
        self.assertEqual(self.titles("open"), ["Call Adwoa Fabrics", "Photos at Bonwire", "Visit Kejetia"])
        self.assertEqual(self.titles("overdue"), ["Call Adwoa Fabrics"])
        self.assertEqual(self.titles("upcoming"), ["Visit Kejetia"])
        today = self.titles("today")  # open and due before midnight, overdue included
        self.assertIn("Call Adwoa Fabrics", today)
        self.assertNotIn("Visit Kejetia", today)

    def test_create_complete_and_cancel(self):
        due = (timezone.now() + dt.timedelta(days=1)).isoformat()
        response = self.client.post("/api/tasks/", {"title": "Resend claim link", "due_at": due}, format="json")
        self.assertEqual(response.status_code, 201)
        task = Task.objects.get(title="Resend claim link")
        self.assertEqual((task.owner, task.created_by), (self.scout, self.scout))
        self.assertEqual(self.client.post(f"/api/tasks/{task.id}/done/").status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.status, Task.DONE)
        self.assertIsNotNone(task.done_at)
        self.assertEqual(self.client.post(f"/api/tasks/{self.later.id}/cancel/").status_code, 200)
        self.assertEqual(self.titles("done"), ["Resend claim link"])

    def test_cannot_touch_someone_elses_task(self):
        self.assertEqual(self.client.post(f"/api/tasks/{self.not_mine.id}/done/").status_code, 404)

    def test_due_at_is_required(self):
        self.assertEqual(self.client.post("/api/tasks/", {"title": "No date"}, format="json").status_code, 400)

    def test_overdue_badge(self):
        self.assertEqual(self.client.get("/api/notifications/staff-badges/").json()["tasks_overdue"], 1)
```

- [ ] **Step 2: Create the app and register it**

Empty `backend/staff_tasks/__init__.py`, `backend/staff_tasks/migrations/__init__.py`, `backend/staff_tasks/tests/__init__.py`.
`backend/staff_tasks/apps.py`:
```python
from django.apps import AppConfig


class StaffTasksConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "staff_tasks"
```
Add `"staff_tasks",` to `INSTALLED_APPS` after `"activity",`; add `path("api/tasks/", include("staff_tasks.urls")),` to `backend/ashantihub/urls.py`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `docker compose run --rm web python manage.py test staff_tasks`
Expected: ERROR — `No module named 'staff_tasks.models'`.

- [ ] **Step 4: Model and service**

`backend/staff_tasks/models.py`:
```python
from django.db import models


class Task(models.Model):
    OPEN = "open"
    DONE = "done"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [(OPEN, "Open"), (DONE, "Done"), (CANCELLED, "Cancelled")]

    owner = models.ForeignKey("accounts.StaffUser", on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=200)
    notes = models.TextField(blank=True, default="")
    due_at = models.DateTimeField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=OPEN)
    done_at = models.DateTimeField(null=True, blank=True)
    source_type = models.CharField(max_length=50, blank=True, default="")
    source_id = models.CharField(max_length=64, blank=True, default="")
    created_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )  # null = created by the system
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["due_at", "id"]
        indexes = [models.Index(fields=["owner", "status", "due_at"])]

    def __str__(self):
        return self.title
```
`backend/staff_tasks/services.py`:
```python
from .models import Task


def create_task(owner, title, due_at, *, notes="", source=None, created_by=None):
    return Task.objects.create(
        owner=owner,
        title=title[:200],
        notes=notes,
        due_at=due_at,
        source_type=source._meta.label_lower if source is not None else "",
        source_id=str(source.pk) if source is not None else "",
        created_by=created_by,
    )
```
Run: `docker compose run --rm web python manage.py makemigrations staff_tasks`

- [ ] **Step 5: API**

`backend/staff_tasks/serializers.py`:
```python
from rest_framework import serializers

from .models import Task


class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ["id", "title", "notes", "due_at", "status", "done_at", "source_type", "source_id", "created_at"]
        read_only_fields = ["status", "done_at", "source_type", "source_id", "created_at"]
```
`backend/staff_tasks/views.py`:
```python
import datetime as dt

from django.utils import timezone
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsStaff

from .models import Task
from .serializers import TaskSerializer
from .services import create_task

MAX_ROWS = 200


def _end_of_today():
    today = timezone.localdate()
    return timezone.make_aware(dt.datetime.combine(today + dt.timedelta(days=1), dt.time.min))


class TaskListCreateView(generics.ListCreateAPIView):
    serializer_class = TaskSerializer
    pagination_class = None

    def get_permissions(self):
        return [IsStaff()]

    def get_queryset(self):
        mine = Task.objects.filter(owner=self.request.user)
        view = self.request.query_params.get("view", "open")
        now = timezone.now()
        if view == "done":
            return mine.filter(status=Task.DONE).order_by("-done_at")[:MAX_ROWS]
        open_tasks = mine.filter(status=Task.OPEN)
        if view == "overdue":
            open_tasks = open_tasks.filter(due_at__lt=now)
        elif view == "today":
            open_tasks = open_tasks.filter(due_at__lt=_end_of_today())
        elif view == "upcoming":
            open_tasks = open_tasks.filter(due_at__gte=_end_of_today())
        return open_tasks[:MAX_ROWS]

    def perform_create(self, serializer):
        data = serializer.validated_data
        serializer.instance = create_task(
            self.request.user, data["title"], data["due_at"], notes=data.get("notes", ""), created_by=self.request.user
        )


class _TaskStatusView(APIView):
    new_status = None

    def get_permissions(self):
        return [IsStaff()]

    def post(self, request, pk):
        task = generics.get_object_or_404(Task, pk=pk, owner=request.user)
        task.status = self.new_status
        task.done_at = timezone.now() if self.new_status == Task.DONE else None
        task.save(update_fields=["status", "done_at"])
        return Response(TaskSerializer(task).data)


class TaskDoneView(_TaskStatusView):
    new_status = Task.DONE


class TaskCancelView(_TaskStatusView):
    new_status = Task.CANCELLED
```
`backend/staff_tasks/urls.py`:
```python
from django.urls import path

from . import views

urlpatterns = [
    path("", views.TaskListCreateView.as_view(), name="task-list"),
    path("<int:pk>/done/", views.TaskDoneView.as_view(), name="task-done"),
    path("<int:pk>/cancel/", views.TaskCancelView.as_view(), name="task-cancel"),
]
```
In `backend/notifications/views.py` `StaffBadgesView.get`, import `from staff_tasks.models import Task` with the other local imports and add to the response dict:
```python
                "tasks_overdue": Task.objects.filter(
                    owner=user, status=Task.OPEN, due_at__lt=timezone.now()
                ).count(),
```
(import `from django.utils import timezone` at the top of the module if missing.)

- [ ] **Step 6: Run the tests**

```bash
docker compose run --rm web python manage.py test staff_tasks notifications 2>&1 | tail -5
```
Expected: OK.

- [ ] **Step 7: Commit**

```bash
git add backend/staff_tasks backend/ashantihub backend/notifications/views.py
git commit -m "feat(staff): personal task list with overdue badge"
```

---

### Task 8: Call log

**Files:**
- Create: `backend/calls/__init__.py`, `apps.py`, `models.py`, `serializers.py`, `views.py`, `urls.py`, `migrations/__init__.py`, `migrations/0001_initial.py` (generated), `tests/__init__.py`, `tests/test_calls.py`
- Create: `backend/accounts/migrations/0034_seed_calls_permissions.py`
- Modify: `backend/ashantihub/settings.py`, `backend/ashantihub/urls.py`

**Interfaces:**
- Consumes: Task 7 (`create_task`), Task 3 (`StaffUser.manager`).
- Produces:
  - `calls.models.CallLog`, `calls.models.PURPOSES_BY_ROLE: dict[str, list[tuple[str, str]]]`
  - `GET /api/calls/` → DRF page; filters `direction`, `outcome`, `related_type`, `related_id`, `staff`; `POST /api/calls/`; `GET/PATCH /api/calls/<id>/`; `GET /api/calls/purposes/` → `[{value, label}]` for the caller's role
  - permissions `calls.log` (scout, support, operations, super_admin), `calls.view_team` (operations, super_admin), `calls.view_all` (super_admin)

- [ ] **Step 1: Write the failing tests**

`backend/calls/tests/test_calls.py`:
```python
import datetime as dt

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import Role, StaffUser
from calls.models import CallLog
from staff_tasks.models import Task


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


class CallLogTests(TestCase):
    def setUp(self):
        self.ops = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.ops)
        self.boss = make_staff("super_admin", "boss@example.com")
        self.client = APIClient()

    def as_(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(staff, 'staff')}")

    def payload(self, **overrides):
        data = {
            "direction": "out", "channel": "phone", "counterpart_type": "business_owner",
            "counterpart_name": "Adwoa Fabrics", "counterpart_phone": "0244123118",
            "related_type": "accounts.businessowner", "related_id": "7", "related_label": "Adwoa Fabrics",
            "purpose": "subscription_payment", "outcome": "promised_to_pay", "sentiment": "positive",
            "notes": "Will pay Friday", "started_at": (timezone.now() - dt.timedelta(minutes=10)).isoformat(),
            "duration_seconds": 180,
        }
        data.update(overrides)
        return data

    def test_scout_logs_a_call_with_a_follow_up_task(self):
        self.as_(self.scout)
        follow_up = (timezone.now() + dt.timedelta(days=2)).isoformat()
        response = self.client.post("/api/calls/", self.payload(follow_up_at=follow_up), format="json")
        self.assertEqual(response.status_code, 201)
        call = CallLog.objects.get()
        self.assertEqual(call.staff, self.scout)
        task = Task.objects.get()
        self.assertEqual((task.owner, task.source_type, task.source_id), (self.scout, "calls.calllog", str(call.id)))
        self.assertEqual(response.json()["counterpart_phone"], "0244123118")

    def test_follow_up_in_the_past_is_refused(self):
        self.as_(self.scout)
        past = (timezone.now() - dt.timedelta(hours=1)).isoformat()
        self.assertEqual(self.client.post("/api/calls/", self.payload(follow_up_at=past), format="json").status_code, 400)

    def test_call_in_the_future_is_refused(self):
        self.as_(self.scout)
        future = (timezone.now() + dt.timedelta(hours=1)).isoformat()
        self.assertEqual(self.client.post("/api/calls/", self.payload(started_at=future), format="json").status_code, 400)

    def test_purpose_must_belong_to_the_role(self):
        self.as_(self.scout)
        self.assertEqual(self.client.post("/api/calls/", self.payload(purpose="refund_return"), format="json").status_code, 400)

    def test_roles_without_calls_log_cannot_log(self):
        self.as_(make_staff("dispatch", "kofi@example.com"))
        self.assertEqual(self.client.post("/api/calls/", self.payload(), format="json").status_code, 403)

    def test_visibility_and_phone_masking(self):
        self.as_(self.scout)
        self.client.post("/api/calls/", self.payload(), format="json")
        self.as_(self.ops)
        rows = self.client.get("/api/calls/").json()["results"]
        self.assertEqual(len(rows), 1)
        self.assertNotEqual(rows[0]["counterpart_phone"], "0244123118")
        self.assertTrue(rows[0]["counterpart_phone"].endswith("118"))
        self.as_(self.boss)
        self.assertEqual(self.client.get("/api/calls/").json()["results"][0]["counterpart_phone"], "0244123118")
        self.as_(make_staff("support", "esi@example.com"))
        self.assertEqual(self.client.get("/api/calls/").json()["results"], [])

    def test_author_edits_within_24_hours_only(self):
        self.as_(self.scout)
        call_id = self.client.post("/api/calls/", self.payload(), format="json").json()["id"]
        self.assertEqual(self.client.patch(f"/api/calls/{call_id}/", {"notes": "Paid"}, format="json").status_code, 200)
        CallLog.objects.filter(pk=call_id).update(created_at=timezone.now() - dt.timedelta(hours=25))
        self.assertEqual(self.client.patch(f"/api/calls/{call_id}/", {"notes": "Late edit"}, format="json").status_code, 403)
        self.as_(self.ops)
        self.assertEqual(self.client.patch(f"/api/calls/{call_id}/", {"notes": "Not mine"}, format="json").status_code, 403)

    def test_purposes_endpoint(self):
        self.as_(self.scout)
        values = [p["value"] for p in self.client.get("/api/calls/purposes/").json()]
        self.assertIn("subscription_payment", values)
        self.assertNotIn("refund_return", values)
```

- [ ] **Step 2: Create the app, register it, seed permissions**

Empty `backend/calls/__init__.py`, `backend/calls/migrations/__init__.py`, `backend/calls/tests/__init__.py`.
`backend/calls/apps.py`:
```python
from django.apps import AppConfig


class CallsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "calls"
```
Add `"calls",` to `INSTALLED_APPS` after `"staff_tasks",`; add `path("api/calls/", include("calls.urls")),` to `backend/ashantihub/urls.py`.
`backend/accounts/migrations/0034_seed_calls_permissions.py`:
```python
from django.db import migrations

PERMISSIONS = [
    ("calls.log", "Log inbound and outbound calls"),
    ("calls.view_team", "See your direct reports' call logs"),
    ("calls.view_all", "See every call log, with full phone numbers"),
]
GRANTS = {
    "scout": ["calls.log"],
    "support": ["calls.log"],
    "operations": ["calls.log", "calls.view_team"],
    "super_admin": [codename for codename, _ in PERMISSIONS],
}


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    by_code = {}
    for codename, description in PERMISSIONS:
        by_code[codename], _ = Permission.objects.get_or_create(codename=codename, defaults={"description": description})
    for role_name, codenames in GRANTS.items():
        Role.objects.get(name=role_name).permissions.add(*[by_code[c] for c in codenames])


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename__in=[c for c, _ in PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0033_seed_activity_permissions")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `docker compose run --rm web python manage.py test calls`
Expected: ERROR — `No module named 'calls.models'`.

- [ ] **Step 4: Model**

`backend/calls/models.py`:
```python
from django.db import models

COMMON_PURPOSES = [("other", "Other")]
PURPOSES_BY_ROLE = {
    "scout": [
        ("prospecting", "Prospecting"), ("onboarding", "Onboarding"), ("photos_listings", "Photos and listings"),
        ("subscription_payment", "Subscription payment"), ("delivery_follow_up", "Delivery follow-up"),
        ("info_update", "Business info update"),
    ],
    "support": [
        ("order_question", "Order question"), ("delivery", "Delivery"), ("payment", "Payment"),
        ("complaint", "Complaint"), ("refund_return", "Refund or return"), ("account_help", "Account help"),
        ("business_question", "Business question"),
    ],
    "operations": [
        ("escalation", "Escalation"), ("fraud_check", "Fraud check"), ("kyc_follow_up", "KYC follow-up"),
        ("business_issue", "Business issue"), ("staff_follow_up", "Staff follow-up"),
    ],
}


def purposes_for(role_name):
    if role_name == "super_admin":
        merged = {value: label for options in PURPOSES_BY_ROLE.values() for value, label in options}
        return sorted(merged.items(), key=lambda item: item[1]) + COMMON_PURPOSES
    return PURPOSES_BY_ROLE.get(role_name, []) + COMMON_PURPOSES


class CallLog(models.Model):
    DIRECTION_CHOICES = [("in", "Inbound"), ("out", "Outbound")]
    CHANNEL_CHOICES = [("phone", "Phone"), ("whatsapp", "WhatsApp"), ("sms", "SMS"), ("visit", "Visit")]
    COUNTERPART_CHOICES = [
        ("customer", "Customer"), ("business_owner", "Business owner"), ("guest", "Guest"), ("other", "Other"),
    ]
    OUTCOME_CHOICES = [
        ("connected", "Connected"), ("no_answer", "No answer"), ("busy", "Busy"), ("voicemail", "Voicemail"),
        ("wrong_number", "Wrong number"), ("promised_to_pay", "Promised to pay"),
        ("callback_requested", "Callback requested"),
    ]
    SENTIMENT_CHOICES = [("positive", "Positive"), ("neutral", "Neutral"), ("negative", "Negative")]

    staff = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="call_logs")
    direction = models.CharField(max_length=3, choices=DIRECTION_CHOICES)
    channel = models.CharField(max_length=10, choices=CHANNEL_CHOICES, default="phone")
    counterpart_type = models.CharField(max_length=20, choices=COUNTERPART_CHOICES)
    counterpart_id = models.PositiveBigIntegerField(null=True, blank=True)
    counterpart_name = models.CharField(max_length=150, blank=True, default="")
    counterpart_phone = models.CharField(max_length=20, blank=True, default="")
    related_type = models.CharField(max_length=50, blank=True, default="")
    related_id = models.CharField(max_length=64, blank=True, default="")
    related_label = models.CharField(max_length=200, blank=True, default="")
    purpose = models.CharField(max_length=40)
    outcome = models.CharField(max_length=20, choices=OUTCOME_CHOICES)
    sentiment = models.CharField(max_length=10, choices=SENTIMENT_CHOICES, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    started_at = models.DateTimeField()
    duration_seconds = models.PositiveIntegerField(default=0)
    follow_up_at = models.DateTimeField(null=True, blank=True)
    follow_up_task = models.OneToOneField(
        "staff_tasks.Task", on_delete=models.SET_NULL, null=True, blank=True, related_name="call_log"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at", "-id"]
        indexes = [models.Index(fields=["staff", "-started_at"]), models.Index(fields=["related_type", "related_id"])]
```
Run: `docker compose run --rm web python manage.py makemigrations calls`

- [ ] **Step 5: Serializer and views**

`backend/calls/serializers.py`:
```python
import datetime as dt

from django.utils import timezone
from rest_framework import serializers

from accounts.serializers import mask_but_last
from staff_tasks.services import create_task

from .models import CallLog, purposes_for

FUTURE_TOLERANCE = dt.timedelta(minutes=5)


class CallLogSerializer(serializers.ModelSerializer):
    staff_name = serializers.CharField(source="staff.full_name", read_only=True)

    class Meta:
        model = CallLog
        fields = [
            "id", "staff", "staff_name", "direction", "channel", "counterpart_type", "counterpart_id",
            "counterpart_name", "counterpart_phone", "related_type", "related_id", "related_label",
            "purpose", "outcome", "sentiment", "notes", "started_at", "duration_seconds",
            "follow_up_at", "follow_up_task", "created_at", "updated_at",
        ]
        read_only_fields = ["staff", "follow_up_task", "created_at", "updated_at"]

    def _viewer(self):
        return self.context["request"].user

    def validate_purpose(self, value):
        allowed = {code for code, _ in purposes_for(self._viewer().role.name)}
        if value not in allowed:
            raise serializers.ValidationError("That purpose isn't available for your role.")
        return value

    def validate_started_at(self, value):
        if value > timezone.now() + FUTURE_TOLERANCE:
            raise serializers.ValidationError("A call can't start in the future.")
        return value

    def validate_follow_up_at(self, value):
        if value is not None and value <= timezone.now():
            raise serializers.ValidationError("Pick a follow-up time in the future.")
        return value

    def create(self, validated_data):
        staff = self._viewer()
        call = CallLog.objects.create(staff=staff, **validated_data)
        if call.follow_up_at:
            label = call.counterpart_name or call.related_label or "call"
            call.follow_up_task = create_task(
                staff, f"Follow up: {label}", call.follow_up_at, source=call, created_by=staff
            )
            call.save(update_fields=["follow_up_task"])
        return call

    def to_representation(self, instance):
        data = super().to_representation(instance)
        viewer = self._viewer()
        sees_full = instance.staff_id == viewer.id or "calls.view_all" in viewer.effective_permission_codenames()
        if data["counterpart_phone"] and not sees_full:
            data["counterpart_phone"] = mask_but_last(data["counterpart_phone"], keep=3)
        return data
```
`backend/calls/views.py`:
```python
import datetime as dt

from django.db.models import Q
from django.utils import timezone
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import StaffUser
from accounts.permissions import HasAnyRolePermission, IsStaff

from .models import CallLog, purposes_for
from .serializers import CallLogSerializer

EDIT_WINDOW = dt.timedelta(hours=24)
READ_PERMISSIONS = ("calls.log", "calls.view_team", "calls.view_all")


def visible_calls(user):
    perms = user.effective_permission_codenames()
    calls = CallLog.objects.select_related("staff")
    if "calls.view_all" in perms:
        return calls
    scope = Q(staff=user)
    if "calls.view_team" in perms:
        scope |= Q(staff__in=StaffUser.objects.filter(manager=user))
    return calls.filter(scope)


class CallPagination(PageNumberPagination):
    page_size = 50


class CallLogListCreateView(generics.ListCreateAPIView):
    serializer_class = CallLogSerializer
    pagination_class = CallPagination

    def get_permissions(self):
        if self.request.method == "POST":
            return [HasAnyRolePermission("calls.log")]
        return [HasAnyRolePermission(*READ_PERMISSIONS)]

    def get_queryset(self):
        params = self.request.query_params
        calls = visible_calls(self.request.user)
        for field in ("direction", "outcome", "related_type", "related_id"):
            if params.get(field):
                calls = calls.filter(**{field: params[field]})
        if params.get("staff"):
            calls = calls.filter(staff_id=params["staff"])
        return calls


class CallLogDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = CallLogSerializer
    http_method_names = ["get", "patch"]

    def get_permissions(self):
        return [HasAnyRolePermission(*READ_PERMISSIONS)]

    def get_queryset(self):
        return visible_calls(self.request.user)

    def perform_update(self, serializer):
        call = serializer.instance
        if call.staff_id != self.request.user.id:
            raise PermissionDenied("Only the person who logged a call can edit it.")
        if timezone.now() - call.created_at > EDIT_WINDOW:
            raise PermissionDenied("Calls can be edited for 24 hours after they're logged.")
        serializer.save()


class CallPurposesView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        return Response([{"value": value, "label": label} for value, label in purposes_for(request.user.role.name)])
```
`backend/calls/urls.py`:
```python
from django.urls import path

from . import views

urlpatterns = [
    path("", views.CallLogListCreateView.as_view(), name="call-list"),
    path("purposes/", views.CallPurposesView.as_view(), name="call-purposes"),
    path("<int:pk>/", views.CallLogDetailView.as_view(), name="call-detail"),
]
```

- [ ] **Step 6: Run the tests**

```bash
docker compose run --rm web python manage.py test calls accounts staff_tasks 2>&1 | tail -5
docker compose run --rm web python manage.py makemigrations --check --dry-run
```
Expected: OK; `No changes detected`.

- [ ] **Step 7: Commit**

```bash
git add backend/calls backend/accounts/migrations/0034_seed_calls_permissions.py backend/ashantihub
git commit -m "feat(calls): shared call log with follow-up tasks, role purposes and phone masking"
```

---

### Task 9: "My Work" nav group with Tasks and Activity screens

**Files:**
- Create: `frontend/hooks/useMyTasks.js`, `frontend/hooks/useActivity.js`
- Create: `frontend/components/admin/panels/TasksPanel.jsx`, `frontend/components/admin/panels/ActivityPanel.jsx`
- Create: `frontend/components/admin/panels/__tests__/TasksPanel.test.jsx`, `frontend/components/admin/panels/__tests__/ActivityPanel.test.jsx`
- Modify: `frontend/components/admin/shell/navModel.js` (new group + badge key), `frontend/components/admin/shell/__tests__/navModel.test.js`
- Modify: `frontend/components/admin/AdminCommandCenter.jsx` (render the panels)
- Modify: `frontend/mocks/handlers.js` (defaults for the new endpoints + `tasks_overdue` in staff badges)

**Interfaces:**
- Consumes: Task 6 (`GET /api/activity/`), Task 7 (`/api/tasks/…`, `tasks_overdue` badge).
- Produces: nav ids `tasks`, `activity` (and reserves `calls`, `my-team` for Task 10); hooks `useMyTasks(view)` → plain array, `useActivity(params)` → DRF page.

- [ ] **Step 1: Write the failing nav test**

Append to `frontend/components/admin/shell/__tests__/navModel.test.js`:
```javascript
describe('My Work group', () => {
  const authWith = (perms) => ({ hasPermission: (c) => perms.includes(c) })
  const myWork = (perms) => buildNavGroups(authWith(perms)).find((g) => g.id === 'my-work')

  it('gives every staffer Tasks and Activity', () => {
    expect(myWork([]).items.map((i) => i.id)).toEqual(['tasks', 'activity'])
  })

  it('adds Call Log and My Team for the permissions that unlock them', () => {
    expect(myWork(['calls.log', 'staff.invite_team']).items.map((i) => i.id)).toEqual(['tasks', 'calls', 'activity', 'my-team'])
  })

  it('maps the tasks badge to tasks_overdue', () => {
    expect(makeBadgeFor({ tasks_overdue: 2 })('tasks')).toBe(2)
  })
})
```
Run: `cd frontend && npx vitest run components/admin/shell/__tests__/navModel.test.js`
Expected: FAIL — no `my-work` group.

- [ ] **Step 2: Add the group and badge key**

In `frontend/components/admin/shell/navModel.js`, add as the **last** group in `buildNavGroups` (after `system`):
```javascript
    {
      id: "my-work", label: "My Work",
      items: [
        { id: "tasks", icon: "✅", label: "Tasks", show: true },
        { id: "calls", icon: "📞", label: "Call Log", show: auth.hasPermission("calls.log") },
        { id: "activity", icon: "🕘", label: "Activity", show: true },
        { id: "my-team", icon: "👥", label: "My Team", show: auth.hasPermission("staff.invite_team") },
      ],
    },
```
Add `tasks: "tasks_overdue",` to `BADGE_KEY_BY_TAB`.
Run the nav test again — Expected: PASS.

- [ ] **Step 3: Default MSW handlers**

In `frontend/mocks/handlers.js` add:
```javascript
  http.get('http://localhost:8000/api/tasks/', () => HttpResponse.json([])),
  http.get('http://localhost:8000/api/activity/', () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
  http.get('http://localhost:8000/api/calls/', () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
  http.get('http://localhost:8000/api/calls/purposes/', () => HttpResponse.json([{ value: 'other', label: 'Other' }])),
  http.get('http://localhost:8000/api/accounts/staff/team/', () => HttpResponse.json([])),
  http.get('http://localhost:8000/api/accounts/staff/invitable-roles/', () => HttpResponse.json([])),
```
The existing staff-badges default handler (end of `handlers.js`) returns a fixed object — add `tasks_overdue: 0` to it:
```javascript
      kyc: 0, listings: 0, events: 0, hero: 0, reviews: 0,
      plan_approvals: 0, contact_messages: 0, escrow: 0, tasks_overdue: 0,
```

- [ ] **Step 4: Write the failing panel tests**

`frontend/components/admin/panels/__tests__/TasksPanel.test.jsx`:
```javascript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import TasksPanel from '../TasksPanel.jsx'

const task = (id, title, due) => ({ id, title, notes: '', due_at: due, status: 'open', done_at: null, source_type: '', source_id: '', created_at: due })

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><TasksPanel /></QueryClientProvider>)
}

describe('TasksPanel', () => {
  it('lists open tasks and marks one done', async () => {
    let done = null
    server.use(
      http.get('http://localhost:8000/api/tasks/', () => HttpResponse.json([task(1, 'Call Adwoa Fabrics', '2026-10-07T09:00:00Z')])),
      http.post('http://localhost:8000/api/tasks/1/done/', () => { done = 1; return HttpResponse.json({}) }),
    )
    renderPanel()
    expect(await screen.findByText('Call Adwoa Fabrics')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mark "Call Adwoa Fabrics" done' }))
    await waitFor(() => expect(done).toBe(1))
  })

  it('adds a task', async () => {
    let body = null
    server.use(http.post('http://localhost:8000/api/tasks/', async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 9 }, { status: 201 }) }))
    renderPanel()
    fireEvent.change(await screen.findByLabelText('New task'), { target: { value: 'Resend claim link' } })
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-10-09T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    await waitFor(() => expect(body?.title).toBe('Resend claim link'))
    expect(body.due_at).toMatch(/^2026-10-09T/)
  })

  it('shows an honest empty state', async () => {
    renderPanel()
    expect(await screen.findByText('Nothing here.')).toBeInTheDocument()
  })
})
```
`frontend/components/admin/panels/__tests__/ActivityPanel.test.jsx`:
```javascript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ActivityPanel from '../ActivityPanel.jsx'

const event = (id, actor, role, verb) => ({ id, occurred_at: '2026-10-07T11:40:00Z', actor_type: 'staff', actor_id: id, actor_role: role, actor_label: actor, verb, method: 'POST', target_type: '', target_id: '', target_label: '', summary: '', before: null, after: null })

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ActivityPanel /></QueryClientProvider>)
}

describe('ActivityPanel', () => {
  it('shows who did what, humanising the verb', async () => {
    server.use(http.get('http://localhost:8000/api/activity/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [event(1, 'Efua Mensah', 'scout', 'scout.checked_in')] })))
    renderPanel()
    expect(await screen.findByText('Efua Mensah')).toBeInTheDocument()
    expect(screen.getByText('scout checked in')).toBeInTheDocument()
  })

  it('asks the server for only my activity', async () => {
    let lastUrl = ''
    server.use(http.get('http://localhost:8000/api/activity/', ({ request }) => { lastUrl = request.url; return HttpResponse.json({ count: 0, next: null, previous: null, results: [] }) }))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Only mine' }))
    await waitFor(() => expect(lastUrl).toContain('mine=1'))
  })
})
```
Run: `cd frontend && npx vitest run components/admin/panels/__tests__/TasksPanel.test.jsx components/admin/panels/__tests__/ActivityPanel.test.jsx`
Expected: FAIL — modules not found.

- [ ] **Step 5: Hooks**

`frontend/hooks/useMyTasks.js`:
```javascript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/tasks/?view= — the signed-in staffer's own tasks, a plain array
// (not a DRF page). view: open | today | overdue | upcoming | done.
export function useMyTasks(view = 'open') {
  return useQuery({ queryKey: ['my-tasks', view], queryFn: () => apiFetch(`/api/tasks/?view=${view}`) })
}
```
`frontend/hooks/useActivity.js`:
```javascript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/activity/ — a DRF page ({count, next, previous, results}); read
// data?.results. The server scopes it to what this staffer may see.
export function useActivity(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
  return useQuery({ queryKey: ['activity', query], queryFn: () => apiFetch(`/api/activity/${query ? `?${query}` : ''}`) })
}
```

- [ ] **Step 6: Panels**

`frontend/components/admin/panels/TasksPanel.jsx`:
```javascript
import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useMyTasks } from "../../../hooks/useMyTasks.js";
import { D, glassCard } from "../theme.js";

const VIEWS = [["today", "Today"], ["overdue", "Overdue"], ["upcoming", "Upcoming"], ["open", "All open"], ["done", "Done"]];
const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: "#fff" };
const pill = (active) => ({ background: active ? D.text : "transparent", color: active ? "#fff" : D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "6px 12px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });

export default function TasksPanel() {
  const [view, setView] = useState("today");
  const { data, isLoading, isError, refetch } = useMyTasks(view);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [actionError, setActionError] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    setActionError(null);
    if (!title.trim() || !due) { setActionError("Give the task a title and a due time."); return; }
    try {
      await apiPost("/api/tasks/", { title: title.trim(), due_at: new Date(due).toISOString() });
      setTitle(""); setDue(""); refetch();
    } catch (err) { setActionError("Could not add the task."); }
  };
  const finish = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/tasks/${id}/done/`, {}); refetch(); }
    catch (err) { setActionError("Could not update the task."); }
  };

  const tasks = data || [];
  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Tasks</div>
      <form onSubmit={add} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text, flex: "1 1 220px" }}>New task
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={field} maxLength={200} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text }}>Due
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} style={field} />
        </label>
        <button type="submit" style={{ background: D.gold, color: D.text, border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>Add task</button>
      </form>
      <div role="group" aria-label="Which tasks" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {VIEWS.map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} style={pill(view === id)}>{label}</button>)}
      </div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      {isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your tasks.</div>}
      {!isLoading && !isError && tasks.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Nothing here.</div>}
      {tasks.map((t) => {
        const overdue = t.status === "open" && new Date(t.due_at) < new Date();
        return (
          <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 0", borderTop: `1px solid ${D.divider}` }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{t.title}</div>
              <div style={{ color: overdue ? D.red : D.textDim, fontSize: "0.72rem", fontWeight: overdue ? 700 : 400 }}>
                {t.status === "done" ? `Done ${t.done_at?.slice(0, 10)}` : `${overdue ? "Overdue · " : ""}Due ${new Date(t.due_at).toLocaleString("en-GH")}`}
              </div>
            </div>
            {t.status === "open" && (
              <button type="button" aria-label={`Mark "${t.title}" done`} onClick={() => finish(t.id)} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "6px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Done</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
```
`frontend/components/admin/panels/ActivityPanel.jsx`:
```javascript
import { useState } from "react";
import { useActivity } from "../../../hooks/useActivity.js";
import { D, glassCard, ROLE_ACCENTS, ROLE_BADGE_TEXT } from "../theme.js";

const humanise = (verb) => verb.replace(/[._-]+/g, " ").trim();
const pill = (active) => ({ background: active ? D.text : "transparent", color: active ? "#fff" : D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "6px 12px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });

export default function ActivityPanel() {
  const [mine, setMine] = useState(false);
  const { data, isLoading, isError } = useActivity({ mine: mine ? "1" : "" });
  const events = data?.results || [];
  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Activity</div>
        <div role="group" aria-label="Whose activity" style={{ display: "flex", gap: 6 }}>
          <button type="button" aria-pressed={!mine} onClick={() => setMine(false)} style={pill(!mine)}>Everything I can see</button>
          <button type="button" aria-pressed={mine} onClick={() => setMine(true)} style={pill(mine)}>Only mine</button>
        </div>
      </div>
      {isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load activity.</div>}
      {!isLoading && !isError && events.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No activity yet.</div>}
      {events.map((e) => (
        <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "8px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.8rem", flexWrap: "wrap" }}>
          <span style={{ color: D.textDim, minWidth: 120 }}>{new Date(e.occurred_at).toLocaleString("en-GH")}</span>
          {e.actor_role && <span style={{ background: ROLE_ACCENTS[e.actor_role] || D.textDim, color: ROLE_BADGE_TEXT[e.actor_role] || "#fff", borderRadius: 20, padding: "2px 8px", fontSize: "0.65rem", fontWeight: 800 }}>{e.actor_role.replace("_", " ")}</span>}
          <span style={{ color: D.text, fontWeight: 700 }}>{e.actor_label}</span>
          <span style={{ color: D.text }}>{humanise(e.verb)}</span>
          {e.target_label && <span style={{ color: D.textDim }}>· {e.target_label}</span>}
        </div>
      ))}
    </div>
  );
}
```
(`ROLE_ACCENTS` and `ROLE_BADGE_TEXT` are defined in `components/admin/theme.js`, which also re-exports `D` and `glassCard`, so the single import above is correct.)

- [ ] **Step 7: Render them in the command center**

In `frontend/components/admin/AdminCommandCenter.jsx` import the two panels next to the others and add after the last `{activeTab === … && …}` line:
```javascript
          {activeTab === "tasks" && <TasksPanel />}
          {activeTab === "activity" && <ActivityPanel />}
```

- [ ] **Step 8: Run the frontend suite**

```bash
cd frontend && npx vitest run 2>&1 | tail -8
```
Expected: all pass. If a `StaffDashboard.test.jsx` assertion fails **only** because every staffer now sees "Tasks" and "Activity" (e.g. a nav-item count or a "renders exactly these labels" check), update that expectation to include them and note it in the commit body. Any other failure is a real regression — fix the code, not the test.

- [ ] **Step 9: Commit**

```bash
git add frontend
git commit -m "feat(staff): My Work nav group with Tasks and Activity screens

StaffDashboard.test.jsx: every staffer now has Tasks and Activity in the nav (intentional)."
```

---

### Task 10: Call Log and My Team screens

**Files:**
- Create: `frontend/hooks/useCallLogs.js`, `frontend/hooks/useCallPurposes.js`, `frontend/hooks/useMyTeam.js`, `frontend/hooks/useInvitableRoles.js`
- Create: `frontend/components/admin/panels/CallLogPanel.jsx`, `frontend/components/admin/panels/MyTeamPanel.jsx`
- Create: `frontend/components/admin/panels/__tests__/CallLogPanel.test.jsx`, `frontend/components/admin/panels/__tests__/MyTeamPanel.test.jsx`
- Modify: `frontend/components/admin/AdminCommandCenter.jsx`

**Interfaces:**
- Consumes: Task 8 (`/api/calls/…`), Task 3 (`/api/accounts/staff/team/`, `/invitable-roles/`, invite/resend/suspend/unsuspend), Task 9 (nav ids `calls`, `my-team`, MSW defaults).
- Produces: `useCallLogs()` → DRF page; `useCallPurposes()` → `[{value,label}]`; `useMyTeam()` → plain array; `useInvitableRoles()` → `string[]`.

- [ ] **Step 1: Write the failing tests**

`frontend/components/admin/panels/__tests__/CallLogPanel.test.jsx`:
```javascript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import CallLogPanel from '../CallLogPanel.jsx'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><CallLogPanel /></QueryClientProvider>)
}

describe('CallLogPanel', () => {
  it('logs a call with a follow-up', async () => {
    let body = null
    server.use(
      http.get('http://localhost:8000/api/calls/purposes/', () => HttpResponse.json([{ value: 'subscription_payment', label: 'Subscription payment' }, { value: 'other', label: 'Other' }])),
      http.post('http://localhost:8000/api/calls/', async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 1 }, { status: 201 }) }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Log a call' }))
    fireEvent.change(screen.getByLabelText('Who'), { target: { value: 'Adwoa Fabrics' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0244123118' } })
    await screen.findByRole('option', { name: 'Subscription payment' })
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'subscription_payment' } })
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'promised_to_pay' } })
    fireEvent.change(screen.getByLabelText('Follow up on'), { target: { value: '2030-01-02T09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }))
    await waitFor(() => expect(body?.purpose).toBe('subscription_payment'))
    expect(body).toMatchObject({ direction: 'out', counterpart_name: 'Adwoa Fabrics', outcome: 'promised_to_pay' })
    expect(body.follow_up_at).toMatch(/^2030-01-02T/)
  })

  it('shows the server message when a save is refused', async () => {
    server.use(http.post('http://localhost:8000/api/calls/', () => HttpResponse.json({ follow_up_at: ['Pick a follow-up time in the future.'] }, { status: 400 })))
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Log a call' }))
    fireEvent.change(screen.getByLabelText('Who'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }))
    expect(await screen.findByText('Could not save the call. Check the times and try again.')).toBeInTheDocument()
  })
})
```
`frontend/components/admin/panels/__tests__/MyTeamPanel.test.jsx`:
```javascript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import MyTeamPanel from '../MyTeamPanel.jsx'

const member = (id, name, status) => ({ id, full_name: name, email: `${id}@example.com`, phone: null, role: 'scout', manager: 2, manager_name: 'Ama', status, is_suspended: status === 'suspended', suspension_reason: '', is_active: true, permissions: [], role_permissions: [], created_at: '2026-10-01T00:00:00Z' })

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><MyTeamPanel /></QueryClientProvider>)
}

describe('MyTeamPanel', () => {
  it('invites someone to a role the server allows', async () => {
    let body = null
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/invitable-roles/', () => HttpResponse.json(['scout', 'support'])),
      http.post('http://localhost:8000/api/accounts/staff/invite/', async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 9 }, { status: 201 }) }),
    )
    renderPanel()
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Kwame Asante' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kwame@example.com' } })
    await screen.findByRole('option', { name: 'Support' })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'support' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    await waitFor(() => expect(body).toEqual({ full_name: 'Kwame Asante', email: 'kwame@example.com', role: 'support' }))
  })

  it('resends a pending invite and suspends an active member', async () => {
    const calls = []
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/team/', () => HttpResponse.json([member(5, 'Pending Person', 'invited'), member(6, 'Efua Mensah', 'active')])),
      http.post('http://localhost:8000/api/accounts/staff/5/resend-invite/', () => { calls.push('resend'); return HttpResponse.json({}) }),
      http.post('http://localhost:8000/api/accounts/staff/6/suspend/', async ({ request }) => { calls.push((await request.json()).reason); return HttpResponse.json({}) }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Resend invite to Pending Person' }))
    fireEvent.change(screen.getByLabelText('Reason for suspending Efua Mensah'), { target: { value: 'Investigation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suspend Efua Mensah' }))
    await waitFor(() => expect(calls).toEqual(['resend', 'Investigation']))
  })
})
```
Run: `cd frontend && npx vitest run components/admin/panels/__tests__/CallLogPanel.test.jsx components/admin/panels/__tests__/MyTeamPanel.test.jsx`
Expected: FAIL — modules not found.

- [ ] **Step 2: Hooks**

`frontend/hooks/useCallLogs.js`:
```javascript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/calls/ — a DRF page; read data?.results. Scoped server-side to
// own calls, the team's (calls.view_team) or everyone's (calls.view_all).
export function useCallLogs() {
  return useQuery({ queryKey: ['call-logs'], queryFn: () => apiFetch('/api/calls/') })
}
```
`frontend/hooks/useCallPurposes.js`:
```javascript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/calls/purposes/ — [{value, label}] for the caller's role.
export function useCallPurposes() {
  return useQuery({ queryKey: ['call-purposes'], queryFn: () => apiFetch('/api/calls/purposes/'), staleTime: Infinity })
}
```
`frontend/hooks/useMyTeam.js`:
```javascript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/staff/team/ — the caller's direct reports, a plain array.
export function useMyTeam() {
  return useQuery({ queryKey: ['my-team'], queryFn: () => apiFetch('/api/accounts/staff/team/') })
}
```
`frontend/hooks/useInvitableRoles.js`:
```javascript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/staff/invitable-roles/ — role names this staffer may invite.
export function useInvitableRoles() {
  return useQuery({ queryKey: ['invitable-roles'], queryFn: () => apiFetch('/api/accounts/staff/invitable-roles/'), staleTime: Infinity })
}
```

- [ ] **Step 3: Call Log panel**

`frontend/components/admin/panels/CallLogPanel.jsx`:
```javascript
import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useCallLogs } from "../../../hooks/useCallLogs.js";
import { useCallPurposes } from "../../../hooks/useCallPurposes.js";
import { D, glassCard } from "../theme.js";

const OUTCOMES = [["connected", "Connected"], ["no_answer", "No answer"], ["busy", "Busy"], ["voicemail", "Voicemail"], ["wrong_number", "Wrong number"], ["promised_to_pay", "Promised to pay"], ["callback_requested", "Callback requested"]];
const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: "#fff" };
const labelStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text };
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const blank = () => ({ direction: "out", channel: "phone", counterpart_type: "business_owner", counterpart_name: "", counterpart_phone: "", purpose: "other", outcome: "connected", sentiment: "", notes: "", started_at: nowLocal(), duration_minutes: "", follow_up_at: "" });

export default function CallLogPanel() {
  const { data, isLoading, isError, refetch } = useCallLogs();
  const { data: purposes } = useCallPurposes();
  const [form, setForm] = useState(null);
  const [actionError, setActionError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setActionError(null);
    const { duration_minutes, follow_up_at, started_at, ...rest } = form;
    try {
      await apiPost("/api/calls/", {
        ...rest,
        started_at: new Date(started_at).toISOString(),
        duration_seconds: Math.round(Number(duration_minutes || 0) * 60),
        ...(follow_up_at ? { follow_up_at: new Date(follow_up_at).toISOString() } : {}),
      });
      setForm(null);
      refetch();
    } catch (err) { setActionError("Could not save the call. Check the times and try again."); }
  };

  const calls = data?.results || [];
  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Call Log</div>
        {!form && <button type="button" onClick={() => setForm(blank())} style={{ background: D.gold, color: D.text, border: "none", borderRadius: 10, padding: "8px 14px", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>Log a call</button>}
      </div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      {form && (
        <form onSubmit={save} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, padding: 12, background: D.pageBg, borderRadius: 12 }}>
          <label style={labelStyle}>Direction<select value={form.direction} onChange={set("direction")} style={field}><option value="out">Outbound</option><option value="in">Inbound</option></select></label>
          <label style={labelStyle}>Channel<select value={form.channel} onChange={set("channel")} style={field}><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="visit">Visit</option></select></label>
          <label style={labelStyle}>Who<input value={form.counterpart_name} onChange={set("counterpart_name")} style={field} maxLength={150} /></label>
          <label style={labelStyle}>Phone<input value={form.counterpart_phone} onChange={set("counterpart_phone")} style={field} maxLength={20} inputMode="tel" /></label>
          <label style={labelStyle}>They are<select value={form.counterpart_type} onChange={set("counterpart_type")} style={field}><option value="business_owner">Business owner</option><option value="customer">Customer</option><option value="guest">Guest</option><option value="other">Other</option></select></label>
          <label style={labelStyle}>Purpose<select value={form.purpose} onChange={set("purpose")} style={field}>{(purposes || []).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
          <label style={labelStyle}>Outcome<select value={form.outcome} onChange={set("outcome")} style={field}>{OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label style={labelStyle}>How it went<select value={form.sentiment} onChange={set("sentiment")} style={field}><option value="">Not set</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option></select></label>
          <label style={labelStyle}>Started<input type="datetime-local" value={form.started_at} onChange={set("started_at")} style={field} /></label>
          <label style={labelStyle}>Minutes<input type="number" min="0" step="1" value={form.duration_minutes} onChange={set("duration_minutes")} style={field} /></label>
          <label style={labelStyle}>Follow up on<input type="datetime-local" value={form.follow_up_at} onChange={set("follow_up_at")} style={field} /></label>
          <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Notes and feedback<textarea value={form.notes} onChange={set("notes")} rows={3} style={{ ...field, resize: "vertical" }} /></label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setForm(null)} style={{ background: "#fff", color: D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 14px", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <button type="submit" style={{ background: D.gold, color: D.text, border: "none", borderRadius: 10, padding: "8px 16px", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>Save call</button>
          </div>
        </form>
      )}
      {isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the call log.</div>}
      {!isLoading && !isError && calls.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No calls logged yet.</div>}
      {calls.map((c) => (
        <div key={c.id} style={{ padding: "10px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.8rem" }}>
          <div style={{ color: D.text, fontWeight: 700 }}>{c.direction === "out" ? "Outbound" : "Inbound"} · {c.counterpart_name || c.related_label || "Unknown"} {c.counterpart_phone && <span style={{ color: D.textDim, fontWeight: 400 }}>({c.counterpart_phone})</span>}</div>
          <div style={{ color: D.textDim }}>{new Date(c.started_at).toLocaleString("en-GH")} · {c.purpose.replace(/_/g, " ")} · {c.outcome.replace(/_/g, " ")}{c.staff_name ? ` · by ${c.staff_name}` : ""}</div>
          {c.notes && <div style={{ color: D.text, marginTop: 4 }}>{c.notes}</div>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: My Team panel**

`frontend/components/admin/panels/MyTeamPanel.jsx`:
```javascript
import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useMyTeam } from "../../../hooks/useMyTeam.js";
import { useInvitableRoles } from "../../../hooks/useInvitableRoles.js";
import { D, glassCard } from "../theme.js";

const ROLE_LABELS = { super_admin: "Super Admin", operations: "Operations", accountant: "Accountant", marketing: "Marketing", support: "Support", scout: "Scout", delivery_manager: "Delivery Manager", dispatch: "Dispatch" };
const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: "#fff" };
const labelStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text };
const smallBtn = (bg, color) => ({ background: bg, color, border: bg === "#fff" ? `1px solid ${D.cardBorder}` : "none", borderRadius: 20, padding: "6px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });

export default function MyTeamPanel() {
  const { data: team, isLoading, isError, refetch } = useMyTeam();
  const { data: roles } = useInvitableRoles();
  const [invite, setInvite] = useState({ full_name: "", email: "", role: "" });
  const [reasons, setReasons] = useState({});
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const chosenRole = invite.role || (roles || [])[0] || "";

  const run = async (fn, okText, errText) => {
    setActionError(null); setMessage(null);
    try { await fn(); setMessage(okText); refetch(); }
    catch (err) { setActionError(errText); }
  };
  const sendInvite = (e) => {
    e.preventDefault();
    run(async () => {
      await apiPost("/api/accounts/staff/invite/", { full_name: invite.full_name.trim(), email: invite.email.trim(), role: chosenRole });
      setInvite({ full_name: "", email: "", role: "" });
    }, "Invite sent.", "Could not send the invite. Check the email isn't already used.");
  };

  const members = team || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <form onSubmit={sendInvite} style={{ ...glassCard, padding: 18, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ width: "100%", color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Invite to your team</div>
        <label style={{ ...labelStyle, flex: "1 1 200px" }}>Full name<input value={invite.full_name} onChange={(e) => setInvite({ ...invite, full_name: e.target.value })} style={field} required /></label>
        <label style={{ ...labelStyle, flex: "1 1 220px" }}>Email<input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} style={field} required /></label>
        <label style={labelStyle}>Role<select value={chosenRole} onChange={(e) => setInvite({ ...invite, role: e.target.value })} style={field}>{(roles || []).map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}</select></label>
        <button type="submit" style={{ background: D.gold, color: D.text, border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>Send invite</button>
        <div style={{ width: "100%", color: D.textDim, fontSize: "0.72rem" }}>They get an email link to set their password. The link works for 7 days and you can resend it.</div>
      </form>
      {message && <div style={{ color: D.green, fontSize: "0.8rem" }}>{message}</div>}
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      <div style={{ ...glassCard, padding: 18 }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem", marginBottom: 8 }}>My team ({members.length})</div>
        {isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
        {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your team.</div>}
        {!isLoading && !isError && members.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Nobody reports to you yet.</div>}
        {members.map((m) => (
          <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${D.divider}` }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{m.full_name} <span style={{ color: D.textDim, fontWeight: 400 }}>· {ROLE_LABELS[m.role] || m.role} · {m.status}</span></div>
              <div style={{ color: D.textDim, fontSize: "0.72rem" }}>{m.email}</div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {(m.status === "invited" || m.status === "invite_expired") && <button type="button" aria-label={`Resend invite to ${m.full_name}`} onClick={() => run(() => apiPost(`/api/accounts/staff/${m.id}/resend-invite/`, {}), "Invite resent.", "Could not resend the invite.")} style={smallBtn("#fff", D.text)}>Resend invite</button>}
              {m.status === "active" && (
                <>
                  <input aria-label={`Reason for suspending ${m.full_name}`} placeholder="Reason" value={reasons[m.id] || ""} onChange={(e) => setReasons({ ...reasons, [m.id]: e.target.value })} style={{ ...field, padding: "6px 8px", fontSize: "0.75rem" }} />
                  <button type="button" aria-label={`Suspend ${m.full_name}`} onClick={() => run(() => apiPost(`/api/accounts/staff/${m.id}/suspend/`, { reason: reasons[m.id] || "" }), `${m.full_name} is suspended.`, "Could not suspend.")} style={smallBtn(D.red, "#fff")}>Suspend</button>
                </>
              )}
              {m.status === "suspended" && <button type="button" aria-label={`Unsuspend ${m.full_name}`} onClick={() => run(() => apiPost(`/api/accounts/staff/${m.id}/unsuspend/`, {}), `${m.full_name} is active again.`, "Could not unsuspend.")} style={smallBtn(D.green, "#fff")}>Unsuspend</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```
(`StaffListSerializer.get_status` returns `deactivated`, `suspended`, `active`, `invite_expired` or `invited`; resend is offered for the last two.)

- [ ] **Step 5: Render them in the command center**

In `frontend/components/admin/AdminCommandCenter.jsx` import both panels and add:
```javascript
          {activeTab === "calls" && <CallLogPanel />}
          {activeTab === "my-team" && <MyTeamPanel />}
```

- [ ] **Step 6: Run the whole frontend suite and build**

```bash
cd frontend && npx vitest run 2>&1 | tail -8 && npm run build 2>&1 | tail -3
```
Expected: all tests pass; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(staff): Call Log and My Team screens"
```

---

### Task 11: Verify end to end and update the docs

**Files:**
- Modify: `infra/README.md` (cron line for `verify_activity_chain`; the activity log's append-only rule)
- Modify: `backend/CLAUDE.md` (two conventions — see Step 2)

**Interfaces:**
- Consumes: Tasks 1–10.
- Produces: a branch ready for the PR flow.

- [ ] **Step 1: Full verification**

```bash
docker compose run --rm web python manage.py test 2>&1 | tail -5
docker compose run --rm web python manage.py makemigrations --check --dry-run
cd frontend && npx vitest run 2>&1 | tail -6 && npm run build 2>&1 | tail -3
```
Expected: backend OK (≈1,110 + ~60 new tests), `No changes detected`, frontend all green, build passes.

- [ ] **Step 2: Record the conventions future sessions need**

Append to `backend/CLAUDE.md` under "Correctness cores — change with care":
```markdown
- **The activity log is append-only and hash-chained.** `activity.services.record()` is the only
  writer; Postgres triggers refuse `UPDATE`/`DELETE` on `activity_activityevent`, and
  `verify_activity_chain` re-checks the SHA-256 chain nightly. `StaffActivityMiddleware` wraps
  every authenticated staff write in a transaction and records it, so a new staff endpoint is
  covered automatically; call `record()` yourself (inside the same transaction) when you have a
  richer before/after story — it marks the request so the middleware doesn't duplicate it.
- **Team managers act only on their direct reports.** `staff.invite_team` (Operations, Delivery
  Manager) is checked with `_guard_team_scope`; anything beyond invite/resend/suspend/unsuspend
  stays `staff.manage`.
```
Add to `infra/README.md`'s cron section a line describing the `verify_activity_chain` jobs from Task 5 and that the cron file must be re-installed on the server after this deploy (follow that README's existing install instruction for `infra/cron/ashantihub.cron`).

- [ ] **Step 3: Commit**

```bash
git add backend/CLAUDE.md infra/README.md
git commit -m "docs(staff): activity-log and team-scope conventions; nightly chain check"
```

- [ ] **Step 4: Ship to staging (needs the user's go-ahead for push/merge)**

Follow the `deploy` skill: push `feature/staff-foundations-1a`, PR into `righteoushack`, then into `main`; run the staging deploy (this branch has migrations). On staging, sign in as `staging-admin@example.com` (its role becomes Operations; the email doesn't change), invite a scout, log a call with a follow-up, and confirm the events appear under Activity for the Operations account and under Super Admin. Production waits for the user.
