# Staff Platform Phase 1 — Foundations Design

**Date:** 2026-10-07
**Status:** Design approved in conversation 2026-10-07 (Section 1). Not implemented.
**Parent:** `2026-10-07-staff-platform-overview-design.md`
**Followed by:** `2026-10-07-scouts-operations-design.md` (phase 2 builds directly on this)

## 1. Goal

Build the shared machinery every staff role's dashboard needs, once: a supported framework,
live updates, the Operations role and reporting lines, team invites, a tamper-evident activity
log, one approvals engine and inbox, a report engine with CSV/Excel/PDF export, a call log with
follow-up tasks, permission-exact alerts, and safer staff sessions. Phase 1 ships no new
role-specific screen beyond the shared ones (Approvals, Reports, Calls, Tasks, Activity); phases
2–7 plug into these pieces.

### Decisions already made (with the user)

| Question | Decision |
|---|---|
| Live updates | WebSockets via Django Channels + Redis (chosen over Server-Sent Events and faster polling) |
| Admin role | Renamed **Operations**, in code and labels |
| Who invites whom | Super Admin: any role. Operations: Scouts and Support. Delivery Manager: Dispatch |
| Support's manager | An Operations lead |
| Approvals | Maker can never approve their own request (server-enforced); staged changes; escalation timers |
| Reports | Day/week/month; system numbers locked, narrative by the person; Draft → Submitted → Acknowledged/Returned; CSV, Excel, PDF |
| Sessions | 30 min idle, 12 h maximum; password re-entry for sensitive actions; 2-step sign-in for Super Admin |

### Scope

**In scope:** F1–F10 below.
**Out of scope:** role-specific workspaces (phases 2–7); moving existing approval flows (KYC
queue, listing moderation, plan approvals, event pricing) onto the new engine — they keep working
as they are and migrate opportunistically in later phases; offline writes; native push (Web Push
arrives with Dispatch in phase 3).

### Current state this changes

- `backend/requirements.txt` pins **Django 5.0.9** — out of security support since April 2025.
- No Redis, Channels, Celery or WebSockets; compose runs only `db` and `web` (gunicorn, WSGI).
  `infra/scripts/deploy.sh` brings up `db` and `web` only. Badges poll every 60 s.
- No audit/activity log; only scattered `reviewed_by`/`*_by` fields.
- `notify_staff_role` (`backend/notifications/services.py:47`), `StaffBadgesView`
  (`backend/notifications/views.py:82`) and `backend/events/permissions.py:59` read the role's
  permissions only, ignoring per-staffer grants/revokes; `notify_staff_role` also alerts
  suspended/deactivated staff.
- Only `staff.manage` (Super Admin) can invite. `StaffUser` has no manager and no last-login.
- Staff JWTs live 12 h (`SIMPLE_JWT.ACCESS_TOKEN_LIFETIME`) with no server-side session, so
  there is no idle timeout and no "sign out all devices".
- The only export in the codebase is one business-owner CSV.

## 2. Design

### F1 — Framework upgrade (first, alone)

Upgrade Django 5.0 → **5.2 LTS** (supported to April 2028) with the DRF, SimpleJWT and
django-cors-headers versions that support it. Its own commit/PR, full backend suite green,
deployed to staging before anything else in phase 1 builds on it. Fix deprecations the upgrade
surfaces; no behaviour change intended.

### F2 — Live updates and background jobs

**Infrastructure** (`infra/compose/docker-compose.yml`, both environments):
- `redis` service: `redis:7-alpine`, password from `.env`, no host port, `maxmemory 128mb`,
  no persistence (everything in it is rebuildable).
- `web` switches from WSGI to ASGI: gunicorn with uvicorn workers serving
  `ashantihub.asgi:application` (HTTP and WebSocket from one process type).
- `worker` (Celery) and `beat` (Celery beat) services from the same image.
- `deploy.sh` brings up `redis`, `web`, `worker`, `beat` (today it brings up only `db` and
  `web`). Keep its `/tmp` re-exec block untouched.
- nginx: add a `location /ws/` block to `infra/hestia/templates/ashantihub-api.stpl.in` and
  `.tpl.in` with `proxy_http_version 1.1`, `Upgrade`/`Connection` headers and a long read
  timeout. A plain prefix location — never `^~`, never touching `.well-known`. Production
  installs templates on deploy; staging needs `install-hestia-templates.sh` run by hand once.

**Connection auth.** Browsers can't set headers on a WebSocket, and a JWT in a URL ends up in
logs. So: `POST /api/realtime/ticket/` (authenticated staff) returns a single-use ticket valid
30 s, stored in Redis; the client connects to `wss://<api>/ws/staff/?ticket=…`; the consumer
redeems and deletes it. Customers and business owners get no socket in phase 1.

**Groups.** On connect the consumer joins `staff.<id>`, `role.<role>`, `perm.<codename>` for each
of the staffer's **effective** permissions, and `team.<manager_id>` if they have a manager. A
permission change, suspension or deactivation sends `force_disconnect` to `staff.<id>`; the client
reconnects and gets the new group set (or is refused).

**What travels.** Events carry no data the REST API wouldn't show that recipient: `{type, verb,
target: {type, id, label}, actor: {id, name, role}, at, invalidate: [queryKeys]}`. The frontend
uses `invalidate` to refetch through the normal permission-checked REST endpoints (React Query
`invalidateQueries`), and shows `label`/`actor` in live feeds. Events are published from the
activity-log writer (F4) on transaction commit, routed to the groups the event's verb maps to.

**Fallback.** If the socket is down for more than 30 s the existing 60 s polling continues; a
small "Live updates paused" indicator shows in the staff header.

**Background jobs (Celery on the same Redis):** approval escalation (every 5 min, F5), report
reminders (daily), report exports (on demand, F6), nightly activity-chain verification (F4),
session cleanup (F9). Phase 2 adds subscription overdue transitions and commission hold release.
The existing hourly `expire_events` host cron stays as is.

### F3 — Operations rename, reporting lines, team invites

- **Rename:** data migration renames `Role` `admin` → `operations` (`NAME_CHOICES`, label
  "Operations"). Update the ~44 backend and ~5 frontend references, `ROLE_ACCENTS`
  (`components/admin/theme.js`), seed commands and `docs/STAFF_ROLES.md`. Permissions do not
  change.
- **Reporting lines:** `StaffUser.manager` (FK self, null, `on_delete=PROTECT` so a manager
  with reports can't be deleted; deactivating a manager requires reassigning their team first).
  Super Admin sets/changes managers; team invites set it automatically.
- **Team invites:** new model `RoleInviteRule(inviter_role, invitee_role)`, seeded
  `operations → scout`, `operations → support`, `delivery_manager → dispatch`; Super Admin
  bypasses it. New permission `staff.invite_team`: invite, resend an invite, and suspend /
  unsuspend **their own direct reports** of an allowed role. Deactivating, changing role or
  editing someone's permissions stays `staff.manage` (Super Admin). Existing invite email and
  `/staff/activate` flow are reused; the invite records `manager = inviter`.
- **Last sign-in:** recorded via F9's session model.

### F4 — Activity log

New app `activity`, model `ActivityEvent`:

| Field | Notes |
|---|---|
| `id` | bigserial |
| `occurred_at` | server time |
| `actor_type`, `actor_id`, `actor_role` | staff / customer / business_owner / system; role snapshotted |
| `on_behalf_of_id` | staff, for delegated or "view as" actions |
| `verb` | dotted, e.g. `kyc.approved`, `staff.invited`, `report.exported` |
| `target_type`, `target_id`, `target_label` | what was acted on |
| `before`, `after` | JSON, redacted by a per-field policy (passwords and tokens never; payout numbers masked) |
| `ip`, `user_agent`, `request_id` | from the request |
| `prev_hash`, `hash` | SHA-256 chain |

- **Writing:** one function, `activity.record(actor, verb, target, before=None, after=None,
  request=None)`, called inside the same transaction as the change it records. It takes a
  transaction-scoped Postgres advisory lock, reads the previous hash, and computes
  `hash = sha256(prev_hash + canonical_json(row))`. Realtime publish (F2) happens on commit.
- **Immutability:** a migration installs Postgres triggers that raise on `UPDATE` and `DELETE`
  of `activity_activityevent`. A database superuser could still drop the triggers, so the nightly
  job re-verifies the whole chain and emails the latest hash ("the day's seal") to every Super
  Admin; any break raises a Sentry error and a Super Admin alert.
- **Coverage (refined at planning, 2026-10-07):** two layers, both inside the change's
  transaction.
  1. `StaffActivityMiddleware` wraps every authenticated **staff** write request
     (`POST/PUT/PATCH/DELETE`) in `transaction.atomic()` from `process_view`, calls the view, and
     if the response is 2xx records a baseline event — verb = the URL name (e.g.
     `kyc-approve`), target from the URL's `pk`, `after` = the redacted request body and
     response summary. If recording fails, the whole action rolls back. This covers all 61
     existing staff write endpoints (KYC, moderation, users, staff management, escrow, disputes,
     pricing, plans, credit, promotions, categories/zones, site settings, delivery, contact
     messages, messaging replies) and every future one without editing them.
  2. Domain code calls `activity.record()` itself when it has a richer story (before/after
     snapshots, semantic verbs like `business.kyc.approved`) — approvals, invites, staff
     management, reports, exports, and every phase-2+ workflow. An explicit record marks the
     request so the middleware doesn't add a duplicate.
  Sign-in and sign-out are recorded explicitly (sign-in is an anonymous request).
- **Reading:** `GET /api/activity/` with filters (actor, role, verb prefix, target, date
  range). Scopes: everyone sees their own; `activity.view_team` adds their direct reports'
  events; `activity.view_domains` adds events by **actor role** per a map in code (Operations:
  everything by scouts, support, dispatch and marketing, plus Accounting and Delivery Manager
  events whose verb starts with a listed prefix — commission, payout, delivery dispute);
  `activity.view_all` (Super Admin) sees everything.

### F5 — Approvals engine and inbox

New app `approvals`, model `ApprovalRequest`: `kind` (registry key), `status` (pending /
approved / rejected / cancelled / expired), `maker`, `assigned_to` (nullable), `pool_permission`
(fallback pool), `target_type`/`target_id`, `payload` (proposed change), `before` (snapshot at
request time), `maker_note`, `decided_by`, `decided_at`, `decision_note`, `due_at`,
`escalation_level`, `created_at`.

- **Registry:** each kind registers `resolve_approver(request)` (default chain: maker's manager →
  anyone holding `pool_permission` → Super Admin), `validate(request)` (re-checked at decision
  time; if the target changed since `before`, the request can't be approved and the maker must
  resubmit), `apply(request)` (runs in the decision transaction), a response-time target, and a
  diff renderer for the inbox.
- **Rules:** the approver can never be the maker (checked in `decide()`, covered by tests);
  reject requires a note; every create/decide/escalate records an activity event and notifies
  the people involved. A Super Admin's own changes that would need approval are applied
  immediately and recorded (a sole owner can't be maker-checked); if more than one Super Admin
  exists, the others are notified.
- **Escalation:** at 75% of the response time the approver is reminded; at 100% the request
  moves one level up the chain and the new approver is notified; Super Admin is the last level.
- **API:** `GET /api/approvals/?box=mine|made|team|all`, `GET /api/approvals/<id>/`,
  `POST /api/approvals/<id>/approve|reject|cancel` (cancel: maker only, while pending).
- **UI:** `/staff/approvals` (list with filters and counts) and `/staff/approvals/<id>` (before /
  after diff, maker, age, due time, Approve / Return with note). Notification links deep-link
  here and re-check permission on load. A nav item and badge for everyone who can approve
  anything.
- Phase 1 ships the engine, the inbox and its tests with no user-facing kinds; phase 2 registers
  the first real kinds (`business.kyc`, `business.update`, `listing.create`, `listing.photos`,
  `targets.cut`, `commission.policy`). Phases 1 and 2 reach staging together so the inbox is never
  empty in use.

### F6 — Report engine

New app `reports`, model `StaffReport`: `staff`, `period` (day / week / month), `period_start`,
`period_end`, `status` (draft / submitted / acknowledged / returned), `submitted_at`, `is_late`,
`system_snapshot` (JSON, frozen on submit), `achievements`, `blockers`, `plan_next`,
`linked_targets` (list of `{type, id, label}`), `plan_results` (yesterday's plan items with
done / partly / not done), `reviewer`, `reviewed_at`, `review_note`, `similarity` (0–1).

- **System section:** a provider registry keyed by role:
  `register_provider(role, fn(staff, start, end) -> sections)`. Phase 1 ships a generic provider
  for every role (activity counts by verb, approvals made and decided, calls logged, tasks
  done/overdue). Phases 2–7 register role providers. Week and month system sections aggregate
  the days; their narrative fields are their own.
- **Workflow:** Draft (editable) → Submitted (locked; `is_late` if after the role's due time,
  default 19:00 Africa/Accra) → Acknowledged, or Returned with a note (editable again, then
  resubmitted). The reviewer is the staffer's manager; Super Admin can review anyone's.
  Reminder notification at 18:00 to anyone without a submitted day report.
- **Copy check:** on save, trigram similarity (`pg_trgm`) of the narrative against the staffer's
  last five reports; ≥ 0.8 shows the writer a warning before submit and the reviewer a flag.
- **Exports:** `GET /api/reports/<id>/export?format=csv|xlsx|pdf` and
  `GET /api/reports/export?staff=&role=&from=&to=&format=` (scope: own; team for managers; all
  for Super Admin). CSV streamed with a UTF-8 BOM and formula-injection escaping (cells starting
  `= + - @`, tab or CR get a leading `'`); Excel via XlsxWriter in constant-memory mode; PDF via
  WeasyPrint from an HTML template with SVG charts (adds Pango/Cairo to the Docker image).
  Exports over 31 days or 5,000 rows run as a Celery job; the file is stored privately and served
  through a permission-checked Django view with a signed link valid 24 h; the bell notifies when
  ready. Every export records `report.exported` with its filters.
- **UI:** `/staff/reports` (my reports; Day/Week/Month; history with status), the composer as
  drawn on the design canvas, and `/staff/reports/team` for managers.

### F7 — Call log and tasks

- New app `tasks`, model `Task`: `owner`, `title`, `due_at`, `source_type`/`source_id`,
  `status` (open / done / cancelled), `done_at`, `created_by` (staff or system). Used by call
  follow-ups now and by scouts' follow-up list in phase 2. `/staff/tasks` lists mine, due today,
  overdue.
- New app `calls`, model `CallLog`: `staff`, `direction` (in / out), `channel` (phone /
  WhatsApp / SMS / visit), `counterpart_type` (customer / business_owner / guest / other) +
  `counterpart_id` + `counterpart_phone` (stored; shown masked except to the logger),
  `related_type`/`related_id` (business, order, conversation, subscription…), `purpose` (per-role
  list), `outcome` (connected / no answer / busy / voicemail / wrong number / promised to pay /
  callback requested), `sentiment` (positive / neutral / negative), `notes`, `started_at`,
  `duration_seconds`, `follow_up_at` (creates a Task), `created_at`.
- The author can edit within 24 h (each edit recorded in the activity log); after that it is
  read-only. Permissions: `calls.log` (Scout, Support, Operations, Super Admin), plus
  `calls.view_team` / `calls.view_all`. `/staff/calls` lists and logs; a "Log a call" action can
  be opened from any business, order or conversation with `related_*` prefilled.

### F8 — Permission-exact alerts and badges

`notify_staff_role` resolves recipients by **effective** permissions and skips suspended and
deactivated staff; `StaffBadgesView` and `backend/events/permissions.py:59` use the effective
set. Remove the three entries from `docs/STAFF_ROLES.md` "Known gaps" when done. Realtime groups
(F2) already use the effective set.

### F9 — Session safety and 2-step sign-in

- New model `StaffSession`: `staff`, `jti` (from the access token), `device_label`, `ip`,
  `user_agent`, `created_at`, `last_seen_at`, `revoked_at`, `sudo_until`. Staff login creates one
  and puts its `jti` in the token. `MultiAccountJWTAuthentication` (already checks suspension per
  request) also rejects a staff token whose session is revoked, older than **12 h**, or idle more
  than **30 min**; `last_seen_at` is written at most once a minute. The frontend also signs out
  after 30 min without input and on the 401.
- **Sessions & devices:** staffers see and end their own sessions; Super Admin sees anyone's and
  can **sign out all devices** for a person. Login history comes from the same table (this
  replaces the missing `last_login`).
- **Re-enter password ("sudo"):** `POST /api/accounts/staff/reauth/` sets `sudo_until = now +
  10 min` on the session. Required by: payout and payroll approval, role and permission changes,
  staff suspension, and exports containing personal data.
- **2-step sign-in:** TOTP (authenticator app, `pyotp`) with 10 single-use recovery codes.
  Mandatory for Super Admin (enrolled on next sign-in), optional for other staff. Secrets
  encrypted at rest.

### F10 — Staff shell

- Nav model becomes a per-role menu config (groups and items from the design canvas), still
  filtered by effective permissions; the existing tab ids and labels the contract tests rely on
  keep working.
- New shared nav items for everyone who can use them: Approvals, Reports, Calls, Tasks,
  Activity. Badge keys added for approvals waiting and tasks overdue.
- A realtime client (`frontend/lib/realtime.js`): gets a ticket, connects, reconnects with
  backoff, routes `invalidate` keys to React Query, exposes connection state to the header.
- Sign out and view-only marketplace come from phase 0.

## 3. Errors and edge cases

- Redis down: sockets fail, polling continues, Celery jobs retry; `/api/health/` reports Redis
  state for System health (phase 7).
- Activity write fails: the surrounding transaction fails — an action without its record never
  commits.
- Chain break detected: alert, never auto-repair; investigation via the Super Admin audit log.
- Approval target changed meanwhile: approve is refused with "this changed since it was
  requested — ask for a fresh request".
- Manager deactivated with open approvals: escalation moves them up; deactivation is blocked
  while they still have direct reports.
- Export job fails: the requester is notified with the error; nothing partial is served.

## 4. Testing

- Upgrade: full backend suite and `makemigrations --check` on 5.2.
- Activity: `UPDATE`/`DELETE` raise; chain verifies; tampering a row makes verification fail;
  a staff write through the middleware records exactly one event and rolls back when recording
  fails; customer/owner/anonymous writes and failed (4xx/5xx) staff writes record nothing.
- Approvals: maker ≠ checker; stale `before` blocks approval; escalation moves level and
  notifies; apply runs atomically with the decision.
- Realtime (`channels.testing.WebsocketCommunicator`): ticket single-use and 30 s expiry; group
  membership follows effective permissions; force-disconnect on suspension; events carry no
  fields outside the allowed payload.
- Reports: lock on submit; late flag; return/resubmit; similarity flag; CSV formula escaping and
  BOM; XLSX and PDF open; scope (a scout can't export a teammate's report).
- Sessions: idle and absolute expiry; revoked session refused; sudo required where listed; TOTP
  enrolment and recovery codes.
- Alert gap: grant-only staffer gets the alert and badge; revoked staffer doesn't; suspended
  staffer doesn't.
- Frontend: StaffDashboard contract kept; new tests for approvals inbox, report composer,
  call log form, realtime client reconnect and invalidation, idle sign-out.

## 5. Rollout

1. F1 alone → staging → (production only on the user's say-so).
2. F3 + F8 (small, independent) → staging.
3. F4 + F7 → staging.
4. F2 infrastructure: compose services, deploy.sh, nginx template; on staging run
   `install-hestia-templates.sh` by hand; confirm `/ws/` upgrades and Let's Encrypt renewal still
   works (`certbot renew --dry-run` equivalent via Hestia) before promoting.
5. F5, F6, F9, F10 → staging; verify with the per-role staging accounts
   (`staging-<role>@example.com`).

Docs updated as pieces land: `docs/STAFF_ROLES.md` (Operations, invites, known gaps),
`infra/README.md` (Redis, worker, beat, `/ws/`), root `CLAUDE.md` (compose services).
