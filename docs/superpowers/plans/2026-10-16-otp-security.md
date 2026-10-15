# OTP and 2-Step Security for Everyone — Implementation Plan (Stage 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One OTP service (text or email) for customers, business owners and staff — sign-up contact checks, a second sign-in step (staff and vendors every time, customers on a new device or after a gap), single-use step-up tokens before sensitive changes, an optional authenticator app for customers and vendors, trusted devices, lockouts, an audit trail, an SMS-spend alert and staff-assisted recovery — all behind three switches that default off.

**Architecture:** A new Django app `otp` owns the codes (`OtpChallenge`, kept only as a salted HMAC), the audit trail (`OtpEvent`, which also feeds the lock and the hourly limits), trusted devices, step-up tokens, verified contacts and the customer/vendor authenticator. Public endpoints work from a signed `mfa_token` ticket (like `accounts.two_factor`), never from an identifier. The existing login and registration views ask `otp.signin.sign_in_step()` whether a second step is owed; sensitive views call `otp.step_up.require()` inside the transaction that saves. Policy numbers live on `staffsecurity.SecurityPolicy`. With `OTP_SIGNIN_ENFORCED`, `OTP_STEP_UP_ENFORCED` and `OTP_SIGNUP_VERIFICATION_ENFORCED` all off (the default), every existing response is unchanged.

**Tech Stack:** Django 5.2, DRF, Postgres, `pyotp` and `cryptography` (already installed), the repo's `approvals`, `activity`, `notifications`, `staffsecurity` apps and the Hubtel SMS client in `marketing/providers/hubtel_sms.py`.

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` — §9 "OTP and 2FA", §1 row 10 (and rows 13, 17 for context), §11 step 2. Deviations found while reconciling it with the code are in §0 below; Task 1 records them in the spec.

## 0. Decisions and reconciliation with the code

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Where the code lives | New app `otp` | The three account kinds are separate tables (`Customer`, `BusinessOwner`, `StaffUser`), so every row names `(account_type, account_id)`; `accounts/views.py` is already 1,500 lines; own migrations and tests, like `ledger` and `staffsecurity`. |
| D2 | Audit trail | Dedicated `otp.OtpEvent`, not `activity.record()` | One row per code sent/checked is high-volume and customer-side; `record()` takes a global advisory lock and fans out to staff realtime feeds. The lock and the hourly limits are counted from `OtpEvent`. Staff-relevant outcomes also go where staff look: staff wrong codes to `StaffSignInRecord`, policy changes and staff-assisted recovery to the activity log. |
| D3 | Policy store | Two fields on `staffsecurity.SecurityPolicy` (`otp_customer_gap_days` 30, `otp_sms_daily_alert` 500), changed through the existing `PATCH /api/staff-security/policy/` | It is "the one row of security settings Super Admin can change": Super Admin only, password re-entry, recorded with before/after, other Super Admins told. `ledger.MoneySetting` is for money and has effective-from semantics that mean nothing here. Who gets a sign-in code is fixed in code (owner decision), not a setting. |
| D4 | SMS | `OTP_SMS_PROVIDER`: `simulated` (default, sends nothing, keeps nothing), `hubtel` (reuses `marketing.providers.hubtel_sms.HubtelSmsProvider` with the `HUBTEL_SMS_*` keys and an Approved Sender ID), `locmem` (forced under `manage.py test`; texts kept in `otp.senders.sms_outbox` like `mail.outbox`). | A real Hubtel SMS client already exists (unverified against a live account, see its docstring). No new provider API is invented. Email goes through Django mail like every other AshantiHub email. |
| D5 | SMS-spend alert | Count today's `OtpEvent(kind=sent, channel=sms)`; at the threshold, `notifications.services.notify_staff_role("security.manage", "otp_sms_spend", …)` once a day (advisory lock + an `sms_alert` event) | `fraud.raise_flag` cases are about a business or a staff member; `staff_tasks` are work items. This is a cost alarm for Super Admin. |
| D6 | Rate limits | DRF `ScopedRateThrottle` scopes `otp_send` 5/min and `otp_verify` 10/min (the repo's mechanism, a per-process burst guard) **plus** hourly limits counted from `OtpEvent` rows: 5 per phone/email, 10 per account, 20 per IP | The default cache is local-memory per process (`settings.CACHES`), so a cache counter would not hold across gunicorn workers; database counts do. |
| D7 | Response shapes | Mirror the existing staff 2-step (`accounts/views.py` `StaffLoginView`): `{"otp_required": true, "mfa_token", "channels"}` for a code, `{"two_factor_required": true, "mfa_token"}` for an authenticator; an expired ticket is `400 {"detail", "code": "challenge_expired"}` | The staff shape is a flag key + `mfa_token` (not `challenge` + `stage`); the frontend's staff 2-step screen can be reused. |
| D8 | Step-up tokens | Random token, SHA-256 kept in `StepUpToken`, single use, 5 minutes, bound to action + the access token's `jti`, sent as `X-Step-Up-Token`; refused with `403 {"code": "step_up_required", "action"}` (same pattern as `sudo_required`) | Single use needs server state. Consumed inside the view's `transaction.atomic()`, so a change refused by validation keeps the token. |
| D9 | Sensitive endpoints that exist now | `PATCH /api/accounts/business-owners/me/payout/` (`payout_destination`), `POST /api/accounts/customers/me/secondary-email/` and `/secondary-phone/` (`contact_change`: a verified secondary contact becomes a code channel), and the new authenticator settings (`authenticator_change`) | There is **no** authenticated change-password or change-primary-phone/email endpoint (customer `email`/`phone` are read-only in `CustomerProfileSerializer`; owners' `login_phone` is not editable by them). Password reset is unauthenticated, protected by the emailed link; it now revokes trusted devices. `password_change` and `withdrawal` are defined for later endpoints (Stage 3). |
| D10 | Staff | `accounts.two_factor` (TOTP + recovery codes) is unchanged and checked first; staff without an authenticator stage get the OTP at every sign-in when `OTP_SIGNIN_ENFORCED`; staff step-up stays password re-entry (`RequiresSudo`); staff activation (emailed invite link) is unchanged | The invite link already proves the email; sudo already guards staff sensitive actions. |
| D11 | Sign-up check | The account row is created as today; with `OTP_SIGNUP_VERIFICATION_ENFORCED` registration answers the code challenge **instead of** the token, and `POST /api/otp/sign-in/verify/` gives the token. A customer or vendor with no verified current contact owes the same check at their next sign-in. Contact verification is recorded in `VerifiedContact` keyed by the normalised destination, so a changed phone/email is unverified again. | No frontend change can ship tonight; one verify endpoint serves sign-in and sign-up. |
| D12 | Recovery | (a) "Other channel": the challenge lists both channels; `send` on the same ticket can switch channel. (b) Staff-assisted: approval kind `otp.recovery`, proposed by Support (`otp.recovery` permission), approved by Super Admin with the password; apply ends trusted devices, turns the authenticator off, restarts the wrong-code count and sends a 1-hour password-reset link to a contact the account already has. Customers and vendors only. | Fits in one task, so no Plan 2b. Staff already have Super Admin's 2-step reset. |
| D13 | Customer/vendor authenticator | `otp.AccountAuthenticator`, reusing `accounts.two_factor`'s TOTP/recovery helpers; it replaces the code exactly when a code would be asked; setup offered only while `OTP_SIGNIN_ENFORCED` is on; setup, disable and new recovery codes always need a step-up code | Spec §9: optional for anyone, replaces the sign-in OTP. |

## Global Constraints

- Codes are exactly **6 digits** from `secrets` (`f"{secrets.randbelow(10**6):06d}"`), stored only as `salted_hmac("otp.code", f"{salt}:{code}").hexdigest()` with a 16-byte random hex salt, compared with `hmac.compare_digest`.
- A code lives **5 minutes**; **5 tries** per challenge (a resend rotates the code and keeps the count); **60-second** resend cooldown.
- Hourly send limits counted from `OtpEvent` (`sent` + `send_failed`): **5 per phone/email, 10 per account, 20 per IP**. DRF scopes: `otp_send` **5/min**, `otp_verify` **10/min**.
- Lock: **5 wrong codes** (texted, emailed or authenticator) for one account within **15 minutes** lock sending and checking for that account for **15 minutes**. The lock and the hourly limits answer the same `429 {"detail": "Too many tries. Wait a while, then try again.", "code": "try_later"}`.
- Customer gap default **30 days** (editable 1–365); SMS-spend alert default **500 texts a day** (editable 1–1,000,000). Both on `staffsecurity.SecurityPolicy`.
- Sign-in ticket (`mfa_token`) lives **600 s** and is bound to a random nonce and the password-hash fingerprint. Step-up token: **5 minutes**, single use, bound to action + access-token `jti`.
- Switches, all default **off**: `OTP_SIGNIN_ENFORCED`, `OTP_STEP_UP_ENFORCED`, `OTP_SIGNUP_VERIFICATION_ENFORCED`. With all off, every existing test passes unchanged and every existing response body is identical.
- Never store or log a code, a device token or a step-up token in clear (random tokens: SHA-256). Never log a message body. New secret field names go in `backend/ashantihub/sentry.py` `EXTRA_DENYLIST`.
- Destinations are normalised: phones through `accounts.phones.normalize_gh_phone` (`+233…`), emails stripped and lower-cased. Shown only through `accounts.phones.mask_phone` / `accounts.claims.mask_email`.
- Public OTP endpoints take a signed `mfa_token`, never a phone/email, and set `authentication_classes = []`. Refusals are returned as a `Response`, never raised; never call `otp.service.verify` inside an atomic block that a refusal would roll back (the counted try would be undone).
- `otp.step_up.require(request, ACTION)` is called **inside** the `transaction.atomic()` block that makes the change.
- New OTP views are `activity_exempt = True` (their bodies carry codes; they keep `OtpEvent`), except the staff recovery request, which `approvals.submit()` records.
- Tests: Django `TestCase`/`APIClient`; `cache.clear()` in `setUp` of any class that calls the API; `otp.senders.sms_outbox.clear()` where texts are read; move time by back-dating rows with `.update(...)` or patching a module constant (as `accounts/tests/test_two_factor.py` patches `CHALLENGE_MAX_AGE`); TOTP time via `mock.patch("accounts.two_factor._clock")`; threads only in Task 5's `TransactionTestCase` (`serialized_rollback = True`).
- Commands run from the worktree root `/home/righteoushack/projects/TheAshantihub/.worktrees/otp-security`: `docker compose -p otp1 run --rm web python manage.py test <label> --noinput`. Never run two docker commands at once.
- Migrations: the accounts leaf today is `0052_seed_pickup_desk_role`. This plan adds `staffsecurity/migrations/0003_securitypolicy_otp_settings.py`, `otp/migrations/0001_initial.py`, `otp/migrations/0002_accountauthenticator.py` (both generated by `makemigrations`) and `accounts/migrations/0053_seed_otp_recovery_permission.py` (hand-written).
- Style: module docstrings, no type annotations, tests in `<app>/tests/`, plain words in user-facing messages.

## Review Focus

1. **A code used twice, or by two requests at once** — the second use answers `code_expired`; two simultaneous right answers sign in exactly once. Pinned in Task 5 (`test_the_right_code_works_once`, `ConcurrentUseTests`).
2. **Guessing** — a 6th try on a challenge, or the right code after 5 wrong ones in 15 minutes, is refused; resending never resets the count; tries are counted before comparing. Pinned in Task 5 (`GuessingTests`) and Task 9 (`test_five_wrong_codes_lock_it`).
3. **Account enumeration** — a wrong password reads the same for a real and an unknown account with the switch on; a challenge body has no `id` key, name or whole contact (its signed ticket is handed out only after the right password); the lock and an hourly limit give identical answers. Pinned in Task 5 (`test_a_lock_and_an_hourly_limit_give_the_same_answer`), Task 6 (`test_the_challenge_carries_no_name_id_or_whole_contact`), Task 7 (`test_a_wrong_password_reads_the_same_whether_or_not_the_account_exists`).
4. **A trusted device surviving a password change** — any change of the password hash ends it (fingerprint), and a reset revokes it and records it. Pinned in Task 6 (`test_any_password_change_ends_it`, `test_a_password_reset_revokes_every_device_and_records_it`).
5. **Step-up replay** — a second use, another action, another access token, or after 5 minutes is refused; a change refused by validation keeps the token for the retry. Pinned in Task 8 (`StepUpTests`).
6. **SMS cost abuse through resends** — a resend inside 60 s waits; a 6th text to one phone in an hour is refused; the alert fires once a day at the threshold. Pinned in Task 4 (`SmsSpendAlertTests`) and Task 5 (`ResendAndLimitTests`).
7. **Switches off change nothing** — login, registration, payout and secondary-contact responses are exactly today's. Pinned in Task 6 (`test_with_every_switch_off_nobody_owes_a_second_step`), Task 7 (`SwitchedOffTests`), Task 8 (`SwitchedOffTests`).
8. **Secrets leaking** — no code or token in clear in any OTP row, warning log, activity body or Sentry event. Pinned in Task 1 (`SecretsNeverLeakTests`), Task 4 (`test_a_failed_email_says_so_and_never_logs_the_body`, Hubtel refusal), Task 5 (`test_a_code_is_six_digits_and_stored_only_as_a_salted_hash`), Task 8 (`test_only_the_hash_is_kept`), Task 11 (`otp.recovered` never holds the reset token).

## Assumptions made (decided here, cheap to change — for the owner to confirm)

- **A1** OTP is a new `otp` app; its audit trail is its own `OtpEvent` table (staff-relevant outcomes also reach the activity log / sign-in history).
- **A2** The two editable numbers (customer gap 30 days, SMS alert 500/day) live on the Security settings row, changed by a Super Admin with the password (not maker-checker). Who gets a sign-in code is fixed in code.
- **A3** Hourly limits: 5 codes per phone or email, 10 per account, 20 per IP address; plus 5/min and 10/min per-address bursts on the endpoints.
- **A4** The person picks text or email on each challenge (no stored preference); nothing is sent until they pick.
- **A5** SMS goes through the existing Hubtel SMS client (`OTP_SMS_PROVIDER=hubtel`); the default sends nothing. The sign-in switches must stay off in production until texts really send, or phone-only accounts can't sign in.
- **A6** An account with no Ghana mobile and no email cannot finish a sign-in once the switch is on (no channel); Support must add an email through the existing staff edit first.
- **A7** Step-up accepts a texted/emailed code only (not the authenticator); staff keep password re-entry as their step-up.
- **A8** Step-up applies now to payout details, adding a recovery email/phone, and authenticator changes; password change and withdrawal get it when those endpoints exist (Stage 3).
- **A9** A customer/vendor authenticator replaces the code only when a code would be asked (a trusted customer device still skips it); setup is offered only while `OTP_SIGNIN_ENFORCED` is on, and turning that switch off also stops asking for these authenticators (staff authenticators are unaffected).
- **A10** Sign-up check: the account is created first and gets its token only after the code; existing customers and vendors without a verified contact confirm once at their next sign-in. Staff: the invite link is the check, and staff activation is unchanged.
- **A11** The sign-in ticket lasts 10 minutes (choose a channel, wait for the text, type it); each code still lasts 5.
- **A12** The trusted-device token is returned in the response body and the frontend keeps it (local storage) and sends it back as `device_token` with the password — the API is on another origin, so an httpOnly cookie is not used. It is offered to customers only.
- **A13** The SMS-spend alert is an in-app notice to everyone holding `security.manage`, once a day; it blocks nothing. Simulated texts count, so it can be tested.
- **A14** Staff-assisted recovery is for customers and vendors only; Support proposes, a Super Admin approves; it sends a 1-hour reset link to a contact the account already has and never changes a contact.
- **A15** The customer secondary-contact codes (stored in clear, SMS one returned as `demo_code`) are left as they are; moving them onto the OTP service is a follow-up.

## File Structure

Create:
- `backend/otp/__init__.py`, `apps.py` (app config; `ready()` registers `otp.recovery` from Task 11), `flags.py` (the three switches)
- `backend/otp/models.py` (`OtpChallenge`, `OtpEvent`, `TrustedDevice`, `StepUpToken`, `VerifiedContact`, then `AccountAuthenticator`)
- `backend/otp/identity.py` (account type/id, contacts, hints, password fingerprint), `audit.py` (writes `OtpEvent`)
- `backend/otp/senders.py` (text/email delivery), `spend.py` (SMS-spend alert)
- `backend/otp/service.py` (codes, tries, resends, limits, lock)
- `backend/otp/devices.py` (trusted devices), `signin.py` (tickets, the second-step decision, the signed-in body)
- `backend/otp/step_up.py` (step-up tokens), `authenticator.py` (customer/vendor TOTP)
- `backend/otp/retention.py`, `tasks.py` (nightly clean-up), `approval_kinds.py` (`otp.recovery`)
- `backend/otp/views.py` (shared helpers + sign-in send/verify), `views_step_up.py`, `views_authenticator.py`, `views_account.py`, `views_recovery.py`, `urls.py`
- `backend/otp/migrations/0001_initial.py`, `0002_accountauthenticator.py` (generated)
- `backend/otp/tests/__init__.py`, `helpers.py`, `test_setup.py`, `test_identity.py`, `test_senders.py`, `test_service.py`, `test_devices_and_tickets.py`, `test_sign_in_api.py`, `test_step_up.py`, `test_authenticator.py`, `test_account.py`, `test_recovery.py`
- `backend/staffsecurity/migrations/0003_securitypolicy_otp_settings.py` (generated), `backend/staffsecurity/tests/test_otp_policy.py`
- `backend/accounts/migrations/0053_seed_otp_recovery_permission.py`

Modify:
- `backend/ashantihub/settings.py` (app, switches, SMS provider, throttles, CORS header, beat entry), `backend/ashantihub/urls.py`, `backend/ashantihub/sentry.py`
- `backend/staffsecurity/models.py`, `policy.py`, `views.py`
- `backend/accounts/views.py` (login, registration, payout, secondary contacts), `backend/accounts/serializers.py` (password reset revokes devices)
- `backend/accounts/tests/test_authentication.py`, `test_login.py`, `test_roles_seed.py`, `backend/people/roles.py`
- `backend/CLAUDE.md`, `docs/STAFF_ROLES.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`

API added (all under `/api/otp/`):

| Method + path | Who | Body → answer |
|---|---|---|
| `POST sign-in/send/` | holder of a code `mfa_token` | `{mfa_token, channel}` → `{channel, hint, expires_in, resend_in}` |
| `POST sign-in/verify/` | holder of any `mfa_token` | `{mfa_token, code \| recovery_code, trust_device?, device_token?}` → the signed-in body (+ `device_token`) |
| `POST step-up/send/` | signed in | `{action, channel}` → `{channel, hint, expires_in, resend_in}` |
| `POST step-up/verify/` | signed in | `{action, code}` → `{step_up_token, action, expires_in}` |
| `GET authenticator/` | customer, vendor | → `{enabled, enabled_at, recovery_codes_left, available}` |
| `POST authenticator/setup/` | customer, vendor + step-up | → `{secret, otpauth_uri}` |
| `POST authenticator/setup/confirm/` | customer, vendor | `{code}` → `{recovery_codes}` |
| `POST authenticator/recovery-codes/` | customer, vendor + step-up | → `{recovery_codes}` |
| `POST authenticator/disable/` | customer, vendor + step-up | → 204 |
| `GET me/` | signed in | → `{channels, authenticator, trusted_devices, switches, customer_gap_days}` |
| `POST devices/<id>/remove/`, `POST devices/remove-all/` | signed in | → 204 / `{removed}` |
| `POST recovery/` | staff with `otp.recovery` | `{account_type, account_id, send_to, reason}` → 201 `{approval_id, status}` |

Changed: the three login endpoints and the two registration endpoints may answer a challenge instead of a token (switches on); the customer login body may carry `device_token`; `PATCH business-owners/me/payout/` and `POST customers/me/secondary-email|phone/` may answer `403 step_up_required` (switch on) and accept `X-Step-Up-Token`.

---

### Task 1: App scaffold, switches, settings, secret scrubbing, spec addendum

**Files:**
- Create: `backend/otp/__init__.py`, `backend/otp/apps.py`, `backend/otp/flags.py`, `backend/otp/tests/__init__.py`, `backend/otp/tests/test_setup.py`
- Modify: `backend/ashantihub/settings.py`, `backend/ashantihub/sentry.py`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`

**Interfaces:**
- Produces: `otp.flags.sign_in_enforced() -> bool`, `otp.flags.step_up_enforced() -> bool`, `otp.flags.sign_up_enforced() -> bool`; settings `OTP_SIGNIN_ENFORCED`, `OTP_STEP_UP_ENFORCED`, `OTP_SIGNUP_VERIFICATION_ENFORCED` (bool, default False), `OTP_SMS_PROVIDER` (`"locmem"` under tests, else env, default `"simulated"`); throttle scopes `otp_send`, `otp_verify`; CORS header `x-step-up-token`; Sentry denylist keys `code`, `mfa_token`, `recovery_code`, `device_token`, `step_up_token`, `otpauth_uri`, `x-step-up-token`, `x_step_up_token`.

- [ ] **Step 1: Write the failing test** — `backend/otp/tests/test_setup.py`

```python
"""The switches default off, texts stay in memory under the test runner, the step-up header may cross origins,
and no OTP secret can reach the activity log or Sentry (Review Focus 8)."""
from django.conf import settings
from django.test import SimpleTestCase, override_settings

from activity.services import redact
from ashantihub.sentry import EXTRA_DENYLIST, event_scrubber
from otp import flags

SECRETS = {
    "code": "123456", "mfa_token": "signed-ticket", "recovery_code": "abcde-fghij", "device_token": "raw-device",
    "step_up_token": "raw-step-up", "otpauth_uri": "otpauth://totp/x", "secret": "BASE32SECRET",
}


def shown(value):
    """What Sentry would send: a scrubbed value is an AnnotatedValue."""
    return getattr(value, "value", value)


class SwitchTests(SimpleTestCase):
    def test_every_switch_is_off_by_default(self):
        self.assertEqual((flags.sign_in_enforced(), flags.step_up_enforced(), flags.sign_up_enforced()), (False, False, False))

    @override_settings(OTP_SIGNIN_ENFORCED=True, OTP_STEP_UP_ENFORCED=True, OTP_SIGNUP_VERIFICATION_ENFORCED=True)
    def test_they_are_read_when_asked(self):
        self.assertEqual((flags.sign_in_enforced(), flags.step_up_enforced(), flags.sign_up_enforced()), (True, True, True))

    def test_texts_stay_in_memory_under_the_test_runner(self):
        self.assertEqual(settings.OTP_SMS_PROVIDER, "locmem")

    def test_the_step_up_header_may_cross_origins(self):
        self.assertIn("x-step-up-token", settings.CORS_ALLOW_HEADERS)

    def test_the_code_endpoints_have_their_own_throttles(self):
        rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
        self.assertEqual((rates["otp_send"], rates["otp_verify"]), ("5/min", "10/min"))

    def test_the_app_is_installed(self):
        self.assertIn("otp", settings.INSTALLED_APPS)


class SecretsNeverLeakTests(SimpleTestCase):
    def test_the_activity_log_redacts_every_otp_secret(self):
        out = redact({**SECRETS, "channel": "sms"})
        for key in SECRETS:
            self.assertEqual(out[key], "[redacted]", key)
        self.assertEqual(out["channel"], "sms")

    def test_sentry_scrubs_them_in_the_body_and_the_step_up_header(self):
        for key in ("code", "mfa_token", "recovery_code", "device_token", "step_up_token", "otpauth_uri", "x-step-up-token"):
            self.assertIn(key, EXTRA_DENYLIST)
        event = {"request": {
            "data": {**SECRETS, "channel": "sms"},
            "headers": {"X-Step-Up-Token": "raw-step-up", "User-Agent": "Chrome"},
        }}
        event_scrubber().scrub_event(event)
        data = event["request"]["data"]
        for key in SECRETS:
            self.assertEqual(shown(data[key]), "[Filtered]", key)
        self.assertEqual(data["channel"], "sms")
        self.assertEqual(shown(event["request"]["headers"]["X-Step-Up-Token"]), "[Filtered]")
        self.assertEqual(event["request"]["headers"]["User-Agent"], "Chrome")
```

`backend/otp/tests/__init__.py`: empty file.

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p otp1 run --rm web python manage.py test otp.tests.test_setup --noinput`
Expected: ERROR — `ModuleNotFoundError: No module named 'otp'` (or "Failed to import test module").

- [ ] **Step 3: Create the app**

`backend/otp/__init__.py`: empty file.

`backend/otp/apps.py`:

```python
from django.apps import AppConfig


class OtpConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "otp"
    verbose_name = "One-time codes"
```

`backend/otp/flags.py`:

```python
"""The three OTP switches (docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md §9). Each defaults
off in settings, so merging this app changes nothing: sign-in, sign-up and every sensitive endpoint behave
exactly as before until a switch is turned on. Read at call time, so override_settings works in tests."""
from django.conf import settings


def sign_in_enforced():
    return bool(getattr(settings, "OTP_SIGNIN_ENFORCED", False))


def step_up_enforced():
    return bool(getattr(settings, "OTP_STEP_UP_ENFORCED", False))


def sign_up_enforced():
    return bool(getattr(settings, "OTP_SIGNUP_VERIFICATION_ENFORCED", False))
```

- [ ] **Step 4: Settings** — four edits in `backend/ashantihub/settings.py`.

(a) In `INSTALLED_APPS` replace

```python
    "staffsecurity",
```

with

```python
    "staffsecurity",
    "otp",
```

(b) Replace

```python
CORS_ALLOW_HEADERS = (*cors_default_headers, "x-view-as", "x-view-as-screen")
```

with

```python
# X-Step-Up-Token carries a one-time step-up permission (otp/step_up.py).
CORS_ALLOW_HEADERS = (*cors_default_headers, "x-view-as", "x-view-as-screen", "x-step-up-token")
```

(c) In `DEFAULT_THROTTLE_RATES` replace

```python
        "two_factor": "10/min",
```

with

```python
        "two_factor": "10/min",
        # One-time codes (otp app): a per-process burst guard. The real hourly limits per phone/email, account
        # and IP are counted from otp.OtpEvent rows so they hold across server processes (otp/service.py).
        "otp_send": "5/min",
        "otp_verify": "10/min",
```

(d) At the very end of the file, after the `DELIVERY_FEE_ENABLED = ...` line, append (it must come after `TESTING` is defined):

```python

# One-time codes and 2-step sign-in for everyone (otp app; spec §9, plan docs/superpowers/plans/2026-10-16-otp-security.md).
# All three default OFF: with them off, sign-in, sign-up and every sensitive endpoint behave exactly as before. Turn
# them on only after the frontend screens (Plan 2F) ship, and the sign-in ones only once OTP_SMS_PROVIDER=hubtel
# really sends: on a simulated provider a phone-only account could never receive its code.
OTP_SIGNIN_ENFORCED = env.bool("OTP_SIGNIN_ENFORCED", default=False)
OTP_STEP_UP_ENFORCED = env.bool("OTP_STEP_UP_ENFORCED", default=False)
OTP_SIGNUP_VERIFICATION_ENFORCED = env.bool("OTP_SIGNUP_VERIFICATION_ENFORCED", default=False)
# How codes travel by text (otp/senders.py): "simulated" (default) sends nothing to anyone and keeps nothing;
# "hubtel" sends through Hubtel SMS with the HUBTEL_SMS_* keys above and an Approved Sender ID. Under
# `manage.py test` it is always "locmem", which keeps texts in otp.senders.sms_outbox (like Django's mail.outbox).
OTP_SMS_PROVIDER = "locmem" if TESTING else env("OTP_SMS_PROVIDER", default="simulated")
```

- [ ] **Step 5: Sentry** — in `backend/ashantihub/sentry.py` replace

```python
EXTRA_DENYLIST = ["password_confirm", "raw", "token", "claim_link"]
```

with

```python
EXTRA_DENYLIST = [
    "password_confirm", "raw", "token", "claim_link",
    # One-time codes (otp app): request bodies and the step-up header.
    "code", "mfa_token", "recovery_code", "device_token", "step_up_token", "otpauth_uri",
    "x-step-up-token", "x_step_up_token",
]
```

- [ ] **Step 6: Run the tests**

Run: `docker compose -p otp1 run --rm web python manage.py test otp.tests.test_setup core.tests.test_sentry_scrubber --noinput`
Expected: all PASS (8 in `test_setup`, the existing scrubber tests unchanged).

- [ ] **Step 7: Record the deviations in the spec.** Append to the end of `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`:

```markdown

### Stage 2 (OTP) reconciliation (2026-10-16)

Found while writing the Stage 2 plan (`docs/superpowers/plans/2026-10-16-otp-security.md`, §0):

- **O1 Where it lives.** A new `otp` app; rows name `(account_type, account_id)` because the three account kinds are separate tables. Staff keep their authenticator in `accounts.two_factor`; customers and business owners get `otp.AccountAuthenticator`.
- **O2 Sign-up.** The account row is created first; registration answers a code challenge instead of a token, and the token comes after the code. Customers and vendors who never confirmed a contact confirm once at their next sign-in. For staff the emailed invite link is the check.
- **O3 Policy numbers** (customer gap 30 days, SMS alert 500/day) live on `staffsecurity.SecurityPolicy`, changed by a Super Admin with the password re-entered, not through the money-settings maker-checker.
- **O4 Step-up.** Customers and vendors confirm with a texted or emailed code (an authenticator code is not accepted for step-up); staff keep password re-entry (`RequiresSudo`). Applied now to payout details, adding a recovery email/phone, and authenticator changes. There is no change-password or change-primary-contact endpoint yet; `password_change` and `withdrawal` are defined for when they exist (Stage 3).
- **O5 SMS.** The Hubtel SMS client in `marketing/providers/hubtel_sms.py` (unverified against a live account) is reused through `OTP_SMS_PROVIDER=hubtel`; the default `simulated` sends nothing.
- **O6 Not yet moved.** The customer secondary-contact codes (`accounts.serializers.CustomerSecondary*`) still keep their code in clear and return `demo_code` for SMS; moving them onto the OTP service changes their API and is a follow-up.
- **O7 Audit.** OTP events go to `otp.OtpEvent`, not the hash-chained activity log (high volume, customer-side, and the lock and the hourly limits are counted from it). Staff wrong codes also reach the sign-in history; policy changes and staff-assisted recovery also reach the activity log.
```

- [ ] **Step 8: Commit**

```bash
git add backend/otp backend/ashantihub/settings.py backend/ashantihub/sentry.py docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md
git commit -m "feat(otp): app scaffold, switches (default off), SMS provider setting, throttles, secret scrubbing"
```

---

### Task 2: The OTP numbers on the Security settings

**Files:**
- Modify: `backend/staffsecurity/models.py`, `backend/staffsecurity/policy.py`, `backend/staffsecurity/views.py`
- Create: `backend/staffsecurity/migrations/0003_securitypolicy_otp_settings.py` (generated), `backend/staffsecurity/tests/test_otp_policy.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (in `staffsecurity.policy`): `OTP_DEFAULTS = {"otp_customer_gap_days": 30, "otp_sms_daily_alert": 500}`, `OTP_LIMITS`, `OTP_LABELS`, `otp_settings() -> dict`, `otp_customer_gap_days() -> int`, `otp_sms_daily_alert() -> int`, `clean_otp(values: dict) -> dict` (raises `ValueError(key, message)`), `set_otp(values: dict, staff) -> SecurityPolicy`. `GET /api/staff-security/policy/` gains `"otp": {"otp_customer_gap_days", "otp_sms_daily_alert"}`; `PATCH` accepts either key (alone or with `two_factor_roles`) and records `security.otp_policy_changed`.

- [ ] **Step 1: Write the failing test** — `backend/staffsecurity/tests/test_otp_policy.py`

```python
"""The one-time-code numbers Super Admin can change (otp plan Task 2): how long a customer's trusted device skips
the code, and how many texts a day raise the spend alert."""
from activity.models import ActivityEvent
from staffsecurity import policy
from staffsecurity.models import SecurityPolicy

from .base import SecurityBase

URL = "/api/staff-security/policy/"


class OtpPolicyTests(SecurityBase):
    def test_defaults_hold_before_anyone_saves_a_policy(self):
        self.assertFalse(SecurityPolicy.objects.exists())
        self.assertEqual((policy.otp_customer_gap_days(), policy.otp_sms_daily_alert()), (30, 500))

    def test_the_screen_reads_them(self):
        self.as_staff(self.boss)
        self.assertEqual(self.client.get(URL).json()["otp"], {"otp_customer_gap_days": 30, "otp_sms_daily_alert": 500})

    def test_changing_them_needs_the_password(self):
        self.as_staff(self.boss)
        response = self.client.patch(URL, {"otp_customer_gap_days": 14}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (403, "sudo_required"))
        self.assertEqual(policy.otp_customer_gap_days(), 30)

    def test_a_change_is_saved_and_audited_without_touching_the_two_step_roles(self):
        policy.set_roles({"support"}, self.boss)
        self.as_staff(self.boss, sudo=True)
        response = self.client.patch(URL, {"otp_customer_gap_days": 14, "otp_sms_daily_alert": 800}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["otp"], {"otp_customer_gap_days": 14, "otp_sms_daily_alert": 800})
        self.assertEqual((policy.otp_customer_gap_days(), policy.otp_sms_daily_alert()), (14, 800))
        self.assertTrue(policy.requires_two_factor("support"))
        event = ActivityEvent.objects.get(verb="security.otp_policy_changed")
        self.assertEqual(event.before, {"otp_customer_gap_days": 30, "otp_sms_daily_alert": 500})
        self.assertEqual(event.after, {"otp_customer_gap_days": 14, "otp_sms_daily_alert": 800})
        self.assertFalse(ActivityEvent.objects.filter(verb="security.policy_changed").exists())

    def test_saving_the_same_value_records_nothing(self):
        self.as_staff(self.boss, sudo=True)
        self.assertEqual(self.client.patch(URL, {"otp_customer_gap_days": 30}, format="json").status_code, 200)
        self.assertFalse(ActivityEvent.objects.filter(verb="security.otp_policy_changed").exists())

    def test_bad_values_are_refused_and_nothing_changes(self):
        self.as_staff(self.boss, sudo=True)
        cases = [
            ("otp_customer_gap_days", 0), ("otp_customer_gap_days", 366), ("otp_customer_gap_days", "30"),
            ("otp_customer_gap_days", True), ("otp_customer_gap_days", None),
            ("otp_sms_daily_alert", 0), ("otp_sms_daily_alert", 1.5),
        ]
        for key, bad in cases:
            response = self.client.patch(URL, {key: bad}, format="json")
            self.assertEqual(response.status_code, 400, (key, bad))
            self.assertIn(key, response.json())
        self.assertEqual((policy.otp_customer_gap_days(), policy.otp_sms_daily_alert()), (30, 500))

    def test_an_empty_change_is_still_refused(self):
        self.as_staff(self.boss, sudo=True)
        response = self.client.patch(URL, {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("two_factor_roles", response.json())
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p otp1 run --rm web python manage.py test staffsecurity.tests.test_otp_policy --noinput`
Expected: FAIL/ERROR — `module 'staffsecurity.policy' has no attribute 'otp_customer_gap_days'`.

- [ ] **Step 3: Model fields** — in `backend/staffsecurity/models.py` replace

```python
    two_factor_roles = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(null=True, blank=True)
```

with

```python
    two_factor_roles = models.JSONField(default=list, blank=True)
    # One-time codes (otp app, spec §9): a customer's trusted device skips the sign-in code for this many days after
    # their last code, and everyone holding security.manage hears once a day when OTP texts reach the alert count.
    # Defaults and limits: staffsecurity.policy.OTP_DEFAULTS / OTP_LIMITS.
    otp_customer_gap_days = models.PositiveSmallIntegerField(default=30)
    otp_sms_daily_alert = models.PositiveIntegerField(default=500)
    updated_at = models.DateTimeField(null=True, blank=True)
```

Then generate the migration:

Run: `docker compose -p otp1 run --rm web python manage.py makemigrations staffsecurity --name securitypolicy_otp_settings`
Expected: `staffsecurity/migrations/0003_securitypolicy_otp_settings.py` with two `AddField` operations.

- [ ] **Step 4: Policy helpers** — append to `backend/staffsecurity/policy.py` (after `set_roles`):

```python
# One-time codes (otp app). Read through these helpers so a missing policy row means the defaults.
OTP_DEFAULTS = {"otp_customer_gap_days": 30, "otp_sms_daily_alert": 500}
OTP_LIMITS = {"otp_customer_gap_days": (1, 365), "otp_sms_daily_alert": (1, 1000000)}
OTP_LABELS = {
    "otp_customer_gap_days": "Days a trusted customer device skips the sign-in code",
    "otp_sms_daily_alert": "Code texts a day before Super Admin is alerted",
}


def otp_settings():
    policy = current()
    return {key: getattr(policy, key) if policy else default for key, default in OTP_DEFAULTS.items()}


def otp_customer_gap_days():
    return otp_settings()["otp_customer_gap_days"]


def otp_sms_daily_alert():
    return otp_settings()["otp_sms_daily_alert"]


def clean_otp(values):
    """{key: whole number} for the OTP settings in `values`; ValueError(key, message) for a bad one."""
    cleaned = {}
    for key, raw in values.items():
        low, high = OTP_LIMITS[key]
        if isinstance(raw, bool) or not isinstance(raw, int) or not low <= raw <= high:
            raise ValueError(key, f"Use a whole number from {low} to {high}.")
        cleaned[key] = raw
    return cleaned


def set_otp(values, staff):
    from django.utils import timezone

    policy = current() or SecurityPolicy()
    for key, value in values.items():
        setattr(policy, key, value)
    policy.updated_at = timezone.now()
    policy.updated_by = staff
    policy.save()
    return policy
```

- [ ] **Step 5: The endpoint** — in `backend/staffsecurity/views.py`:

(a) In `_policy_payload` replace

```python
        "limits": policy.limits(),
```

with

```python
        "limits": policy.limits(),
        "otp": policy.otp_settings(),
```

(b) Replace the whole `patch` method of `PolicyView` (from `    def patch(self, request):` to the end of the file) with:

```python
    def patch(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        otp_values = {key: data[key] for key in policy.OTP_DEFAULTS if key in data}
        if "two_factor_roles" not in data and not otp_values:
            raise ValidationError({"two_factor_roles": "Send a list of role names."})
        try:
            otp_values = policy.clean_otp(otp_values)
        except ValueError as exc:
            key, message = exc.args
            raise ValidationError({key: message}) from None
        roles = None
        if "two_factor_roles" in data:
            wanted = data["two_factor_roles"]
            if not isinstance(wanted, list) or not all(isinstance(r, str) for r in wanted):
                raise ValidationError({"two_factor_roles": "Send a list of role names."})
            valid = {name for name, _ in Role.NAME_CHOICES}
            unknown = sorted(set(wanted) - valid)
            if unknown:
                raise ValidationError({"two_factor_roles": f"Unknown role: {unknown[0]}."})
            roles = set(wanted) - {Role.SUPER_ADMIN}
        with transaction.atomic():
            events = []
            if roles is not None:
                before = sorted(policy.required_roles())
                policy.set_roles(roles, request.user)
                after = sorted(roles)
                added = sorted(set(after) - set(before))
                removed = sorted(set(before) - set(after))
                if added or removed:
                    summary = "; ".join(filter(None, [
                        f"Now required: {', '.join(ROLE_LABELS[r] for r in added)}" if added else "",
                        f"No longer required: {', '.join(ROLE_LABELS[r] for r in removed)}" if removed else "",
                    ]))
                    for other in StaffUser.objects.filter(role__name=Role.SUPER_ADMIN, is_active=True).exclude(pk=request.user.pk):
                        notify_staff(other, "security_policy_changed", f"{request.user.full_name} changed the 2-step sign-in rules",
                                     body=summary, link="security", icon="🔐")
                events.append({
                    "verb": "security.policy_changed", "target_label": "2-step sign-in by role",
                    "summary": f"2-step sign-in required for: {', '.join(ROLE_LABELS[r] for r in ['super_admin', *after])}",
                    "before": {"two_factor_roles": before}, "after": {"two_factor_roles": after},
                })
            if otp_values:
                before_otp = policy.otp_settings()
                policy.set_otp(otp_values, request.user)
                changed = sorted(key for key, value in otp_values.items() if before_otp[key] != value)
                if changed:
                    events.append({
                        "verb": "security.otp_policy_changed", "target_label": "One-time codes",
                        "summary": "; ".join(f"{policy.OTP_LABELS[k]}: {before_otp[k]} → {otp_values[k]}" for k in changed),
                        "before": {k: before_otp[k] for k in changed}, "after": {k: otp_values[k] for k in changed},
                    })
            # Last, because record() holds the chain lock until commit.
            for event in events:
                verb = event.pop("verb")
                record(request.user, verb, target_type="security.policy", target_id="1", method="PATCH", request=request, **event)
        return Response(_policy_payload())
```

- [ ] **Step 6: Run the tests**

Run: `docker compose -p otp1 run --rm web python manage.py test staffsecurity --noinput`
Expected: all PASS (the 7 new tests and every existing `test_policy` test, including `test_bad_input_is_refused` and the single `security.policy_changed` event).

- [ ] **Step 7: Commit**

```bash
git add backend/staffsecurity
git commit -m "feat(staffsecurity): editable OTP customer gap and SMS alert threshold on the security policy"
```

---

### Task 3: OTP models, who a code goes to, the audit writer

**Files:**
- Create: `backend/otp/models.py`, `backend/otp/identity.py`, `backend/otp/audit.py`, `backend/otp/migrations/0001_initial.py` (generated), `backend/otp/tests/helpers.py`, `backend/otp/tests/test_identity.py`

**Interfaces:**
- Consumes: nothing from earlier tasks besides the app.
- Produces:
  - `otp.models`: constants `SMS = "sms"`, `EMAIL = "email"`, `AUTHENTICATOR = "authenticator"`, `SIGN_IN = "sign_in"`, `SIGN_UP = "sign_up"`, `STEP_UP = "step_up"`, `RECOVERY = "recovery"`; models `OtpChallenge(account_type, account_id, purpose, action, ticket, channel, destination, salt, code_hash, sends, attempts, ip, created_at, last_sent_at, expires_at, consumed_at)`, `OtpEvent(at, kind, account_type, account_id, purpose, action, channel, destination, provider, ip, note)` with kinds `SENT, SEND_FAILED, SEND_REFUSED, VERIFIED, FAILED, LOCKED, STEP_UP_ISSUED, STEP_UP_USED, DEVICE_TRUSTED, DEVICE_REVOKED, AUTHENTICATOR_ON, AUTHENTICATOR_OFF, RECOVERED, SMS_ALERT`, `TrustedDevice(account_type, account_id, token_hash, label, password_fingerprint, created_at, verified_at, last_seen_at, revoked_at, revoked_reason)` with reasons `PASSWORD_RESET, REMOVED, REMOVED_ALL, STAFF_RECOVERY`, `StepUpToken(account_type, account_id, action, token_hash, jti, created_at, expires_at, used_at)`, `VerifiedContact(account_type, account_id, channel, destination, verified_at)`.
  - `otp.identity`: `CUSTOMER`, `BUSINESS_OWNER`, `STAFF`; `account_type_of(account) -> str`, `ref(account) -> (str, int)`, `load(account_type, account_id) -> account | None`, `can_sign_in(account) -> bool`, `contacts(account) -> {channel: destination}`, `hint(channel, destination) -> str`, `channel_list(account) -> [{"channel", "hint"}]`, `fingerprint(account) -> str`.
  - `otp.audit.log(kind, *, account=None, purpose="", action="", channel="", destination="", provider="", note="", request=None, now=None) -> OtpEvent`.
  - `otp.tests.helpers`: `PASSWORD`, `HASHED`, `make_customer(phone=..., email=..., **extra)`, `make_owner(login_phone=..., email=..., **extra)`, `make_support(email=...)`, `last_sms_code()`, `last_email_code()`, `wrong_code(right)`.

- [ ] **Step 1: Write the test helpers** — `backend/otp/tests/helpers.py`

```python
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
```

- [ ] **Step 2: Write the failing test** — `backend/otp/tests/test_identity.py`

```python
"""Who a code goes to (otp.identity), the audit writer and the verified-contact row."""
from django.contrib.auth.hashers import make_password
from django.db import IntegrityError, transaction
from django.test import TestCase

from otp import audit, identity
from otp.models import EMAIL, SMS, OtpEvent, VerifiedContact

from .helpers import make_customer, make_owner, make_support


class ContactsTests(TestCase):
    def test_a_customer_gets_their_phone_and_email_normalised(self):
        customer = make_customer(phone="024 123 4567", email="Ama@Example.com")
        self.assertEqual(identity.contacts(customer), {SMS: "+233241234567", EMAIL: "ama@example.com"})

    def test_a_customer_without_an_email_falls_back_to_a_verified_secondary_only(self):
        customer = make_customer(email=None, secondary_email="backup@example.com", secondary_email_verified=False)
        self.assertEqual(identity.contacts(customer), {SMS: "+233241234567"})
        customer.secondary_email_verified = True
        self.assertEqual(identity.contacts(customer), {SMS: "+233241234567", EMAIL: "backup@example.com"})

    def test_a_phone_that_is_not_a_ghana_mobile_is_not_a_channel(self):
        self.assertEqual(identity.contacts(make_customer(phone="12345")), {EMAIL: "ama@example.com"})

    def test_an_owner_uses_the_login_phone_and_staff_their_email(self):
        self.assertEqual(identity.contacts(make_owner(login_phone="0201112233", email=None)), {SMS: "+233201112233"})
        self.assertEqual(identity.contacts(make_support()), {EMAIL: "esi@example.com"})

    def test_hints_never_show_the_whole_contact(self):
        self.assertEqual(identity.channel_list(make_customer()), [
            {"channel": "sms", "hint": "024 *** 4567"}, {"channel": "email", "hint": "am•••@example.com"},
        ])


class AccountRefTests(TestCase):
    def test_types_ids_and_loading(self):
        customer, owner, staff = make_customer(), make_owner(), make_support()
        self.assertEqual(identity.ref(customer), ("customer", customer.pk))
        self.assertEqual(identity.ref(owner), ("business_owner", owner.pk))
        self.assertEqual(identity.ref(staff), ("staff", staff.pk))
        self.assertEqual(identity.load("business_owner", owner.pk), owner)
        self.assertIsNone(identity.load("nobody", 1))
        self.assertIsNone(identity.load("customer", 999999))

    def test_suspended_or_deactivated_accounts_cannot_finish_signing_in(self):
        customer, staff = make_customer(), make_support()
        self.assertTrue(identity.can_sign_in(customer))
        customer.is_suspended = True
        self.assertFalse(identity.can_sign_in(customer))
        staff.is_active = False
        self.assertFalse(identity.can_sign_in(staff))
        self.assertFalse(identity.can_sign_in(None))

    def test_the_fingerprint_changes_with_the_password(self):
        customer = make_customer()
        before = identity.fingerprint(customer)
        customer.password_hash = make_password("another-password-9")
        self.assertNotEqual(identity.fingerprint(customer), before)


class AuditAndContactRowTests(TestCase):
    def test_an_event_names_the_account(self):
        customer = make_customer()
        event = audit.log(OtpEvent.SENT, account=customer, purpose="sign_in", channel=SMS, destination="+233241234567", provider="locmem")
        self.assertEqual((event.account_type, event.account_id, event.kind, event.provider), ("customer", customer.pk, "sent", "locmem"))
        self.assertIsNone(event.ip)

    def test_an_event_without_an_account(self):
        event = audit.log(OtpEvent.SMS_ALERT, channel=SMS, note="500 texts")
        self.assertEqual((event.account_type, event.account_id), ("", None))

    def test_one_row_per_verified_contact(self):
        customer = make_customer()
        VerifiedContact.objects.create(account_type="customer", account_id=customer.pk, channel=SMS, destination="+233241234567")
        with self.assertRaises(IntegrityError), transaction.atomic():
            VerifiedContact.objects.create(account_type="customer", account_id=customer.pk, channel=SMS, destination="+233241234567")
```

- [ ] **Step 3: Run it to see it fail**

Run: `docker compose -p otp1 run --rm web python manage.py test otp.tests.test_identity --noinput`
Expected: ERROR — `cannot import name 'audit' from 'otp'` / `No module named 'otp.models'`.

- [ ] **Step 4: Write the models** — `backend/otp/models.py`

```python
"""One-time codes (spec §9). Nothing secret is stored in clear: a code is kept as a salted HMAC, a trusted-device
token and a step-up token as a SHA-256. Every row names its account by (account_type, account_id) because the
three account kinds are separate tables; account_type is one of accounts.authentication.ACCOUNT_MODELS' keys."""
from django.db import models
from django.utils import timezone

SMS = "sms"
EMAIL = "email"
AUTHENTICATOR = "authenticator"
CHANNEL_CHOICES = [(SMS, "Text message"), (EMAIL, "Email"), (AUTHENTICATOR, "Authenticator app")]
ACCOUNT_TYPE_CHOICES = [("customer", "Customer"), ("business_owner", "Business owner"), ("staff", "Staff")]

SIGN_IN = "sign_in"
SIGN_UP = "sign_up"
STEP_UP = "step_up"
RECOVERY = "recovery"
PURPOSE_CHOICES = [
    (SIGN_IN, "Signing in"), (SIGN_UP, "Confirming a contact"), (STEP_UP, "Confirming a sensitive change"),
    (RECOVERY, "Staff-assisted recovery"),
]


class OtpChallenge(models.Model):
    """One code in flight. `ticket` binds it to one sign-in attempt (the signed mfa_token's nonce) or, for a step-up,
    to the access token's jti, so a code sent for one attempt never completes another. A resend rotates the code
    and keeps `attempts`, so resending never buys more guesses (otp.service)."""

    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    account_id = models.PositiveIntegerField()
    purpose = models.CharField(max_length=10, choices=PURPOSE_CHOICES)
    action = models.CharField(max_length=30, blank=True, default="")
    ticket = models.CharField(max_length=64, blank=True, default="")
    channel = models.CharField(max_length=15, choices=CHANNEL_CHOICES)
    destination = models.CharField(max_length=254)
    salt = models.CharField(max_length=32)
    code_hash = models.CharField(max_length=64)
    sends = models.PositiveSmallIntegerField(default=1)
    attempts = models.PositiveSmallIntegerField(default=0)
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_sent_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["account_type", "account_id", "purpose", "ticket"])]

    def __str__(self):
        return f"{self.purpose} code for {self.account_type} {self.account_id}"


class OtpEvent(models.Model):
    """The OTP audit trail: codes sent, refused, accepted or wrong, locks, step-up tokens issued and used, trusted
    devices, authenticator changes, recoveries and SMS-spend alerts. Never holds a code or a token. Append-only in
    practice (no endpoint edits or removes a row; otp.retention drops rows after 400 days). The lock and the hourly
    send limits are counted from it, so they hold across every server process."""

    SENT = "sent"
    SEND_FAILED = "send_failed"
    SEND_REFUSED = "send_refused"
    VERIFIED = "verified"
    FAILED = "failed"
    LOCKED = "locked"
    STEP_UP_ISSUED = "step_up_issued"
    STEP_UP_USED = "step_up_used"
    DEVICE_TRUSTED = "device_trusted"
    DEVICE_REVOKED = "device_revoked"
    AUTHENTICATOR_ON = "authenticator_on"
    AUTHENTICATOR_OFF = "authenticator_off"
    RECOVERED = "recovered"
    SMS_ALERT = "sms_alert"
    KIND_CHOICES = [
        (SENT, "Code sent"), (SEND_FAILED, "Code could not be sent"), (SEND_REFUSED, "Code refused (limit or lock)"),
        (VERIFIED, "Code accepted"), (FAILED, "Wrong code"), (LOCKED, "Locked after wrong codes"),
        (STEP_UP_ISSUED, "Step-up given"), (STEP_UP_USED, "Step-up used"),
        (DEVICE_TRUSTED, "Device trusted"), (DEVICE_REVOKED, "Trusted device ended"),
        (AUTHENTICATOR_ON, "Authenticator turned on"), (AUTHENTICATOR_OFF, "Authenticator turned off"),
        (RECOVERED, "Recovered by staff"), (SMS_ALERT, "Text spend alert"),
    ]

    at = models.DateTimeField(default=timezone.now)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    account_type = models.CharField(max_length=20, blank=True, default="")
    account_id = models.PositiveIntegerField(null=True, blank=True)
    purpose = models.CharField(max_length=10, blank=True, default="")
    action = models.CharField(max_length=30, blank=True, default="")
    channel = models.CharField(max_length=15, blank=True, default="")
    destination = models.CharField(max_length=254, blank=True, default="")
    provider = models.CharField(max_length=20, blank=True, default="")
    ip = models.GenericIPAddressField(null=True, blank=True)
    note = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["account_type", "account_id", "kind", "at"]),
            models.Index(fields=["destination", "kind", "at"]),
            models.Index(fields=["ip", "kind", "at"]),
            models.Index(fields=["kind", "at"]),
        ]

    def __str__(self):
        return f"{self.at:%Y-%m-%d %H:%M} {self.kind}"


class TrustedDevice(models.Model):
    """A browser a customer chose to trust after a code (otp.devices). The raw token lives only on the device; the
    row keeps its SHA-256. It skips the sign-in code only while it is not revoked, its password fingerprint matches
    the account's current password (any password change ends it), and its last code is newer than the customer gap
    (staffsecurity.policy.otp_customer_gap_days)."""

    PASSWORD_RESET = "password_reset"
    REMOVED = "removed"
    REMOVED_ALL = "removed_all"
    STAFF_RECOVERY = "staff_recovery"
    REASON_CHOICES = [
        (PASSWORD_RESET, "Password reset"), (REMOVED, "Removed by the account holder"),
        (REMOVED_ALL, "All devices removed by the account holder"), (STAFF_RECOVERY, "Ended by a staff-assisted recovery"),
    ]

    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    account_id = models.PositiveIntegerField()
    token_hash = models.CharField(max_length=64, unique=True)
    label = models.CharField(max_length=120, blank=True, default="")
    password_fingerprint = models.CharField(max_length=64)
    created_at = models.DateTimeField(default=timezone.now)
    verified_at = models.DateTimeField(default=timezone.now)
    last_seen_at = models.DateTimeField(default=timezone.now)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=20, blank=True, default="", choices=REASON_CHOICES)

    class Meta:
        indexes = [models.Index(fields=["account_type", "account_id", "revoked_at"])]

    def __str__(self):
        return f"{self.label or 'Device'} of {self.account_type} {self.account_id}"


class StepUpToken(models.Model):
    """A single-use, 5-minute permission for one sensitive action, bound to the access token (jti) it was issued
    to (otp.step_up). Only the SHA-256 of the token is kept."""

    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    account_id = models.PositiveIntegerField()
    action = models.CharField(max_length=30)
    token_hash = models.CharField(max_length=64, unique=True)
    jti = models.CharField(max_length=64)
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.action} step-up for {self.account_type} {self.account_id}"


class VerifiedContact(models.Model):
    """A phone or email this account proved it receives (a code sent to it was accepted). Matched on the normalised
    destination, so a changed phone or email is unverified until a code to it is accepted."""

    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    account_id = models.PositiveIntegerField()
    channel = models.CharField(max_length=15, choices=CHANNEL_CHOICES)
    destination = models.CharField(max_length=254)
    verified_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["account_type", "account_id", "channel", "destination"], name="otp_unique_verified_contact"),
        ]

    def __str__(self):
        return f"{self.channel} of {self.account_type} {self.account_id}"
```

- [ ] **Step 5: Write `backend/otp/identity.py`**

```python
"""Who a code goes to. Everything in this app names an account by (account_type, account_id), account_type being
one of accounts.authentication.ACCOUNT_MODELS' keys: "customer", "business_owner", "staff"."""
from django.utils.crypto import salted_hmac

from accounts.authentication import ACCOUNT_MODELS
from accounts.models import BusinessOwner, Customer, StaffUser
from accounts.phones import mask_phone, normalize_gh_phone

from .models import EMAIL, SMS

CUSTOMER, BUSINESS_OWNER, STAFF = "customer", "business_owner", "staff"
FINGERPRINT_SALT = "otp.password-fingerprint"


def account_type_of(account):
    if isinstance(account, StaffUser):
        return STAFF
    if isinstance(account, BusinessOwner):
        return BUSINESS_OWNER
    if isinstance(account, Customer):
        return CUSTOMER
    raise TypeError(f"Not an account: {type(account).__name__}")


def ref(account):
    """(account_type, account_id) as the rows of this app store them."""
    return account_type_of(account), account.pk


def load(account_type, account_id):
    """The account, or None when the type is unknown or the row is gone."""
    model = ACCOUNT_MODELS.get(account_type) if isinstance(account_type, str) else None
    if model is None or account_id is None:
        return None
    return model.objects.filter(pk=account_id).first()


def can_sign_in(account):
    """The login serializers' refusals: a suspended account, or a deactivated staff member, never finishes."""
    if account is None or account.is_suspended:
        return False
    return not isinstance(account, StaffUser) or account.is_active


def _phone(raw):
    try:
        return normalize_gh_phone(raw) if raw else ""
    except ValueError:
        return ""


def _email(raw):
    return (raw or "").strip().lower()


def contacts(account):
    """{channel: destination} this account can receive a code on, normalised (+233… phones, lower-case emails): its
    own phone and email; a customer without one falls back to the verified secondary of that kind."""
    if isinstance(account, Customer):
        phone = account.phone or (account.secondary_phone if account.secondary_phone_verified else "")
        email = account.email or (account.secondary_email if account.secondary_email_verified else "")
    elif isinstance(account, BusinessOwner):
        phone, email = account.login_phone, account.email
    else:
        phone, email = account.phone, account.email
    found = {}
    if _phone(phone):
        found[SMS] = _phone(phone)
    if _email(email):
        found[EMAIL] = _email(email)
    return found


def hint(channel, destination):
    """What a screen may show of a destination: "024 *** 4567" or "am•••@example.com"."""
    if channel == SMS:
        return mask_phone(destination)
    from accounts.claims import mask_email  # accounts.claims imports activity, which imports accounts.serializers

    return mask_email(destination)


def channel_list(account):
    return [{"channel": channel, "hint": hint(channel, destination)} for channel, destination in contacts(account).items()]


def fingerprint(account):
    """Changes whenever the password does, so anything bound to it dies with any password change."""
    return salted_hmac(FINGERPRINT_SALT, account.password_hash).hexdigest()
```

- [ ] **Step 6: Write `backend/otp/audit.py`**

```python
"""Writes the OTP audit trail (otp.models.OtpEvent). Never pass a code, a token or a message body here."""
from django.utils import timezone

from activity.services import client_ip

from .identity import ref
from .models import OtpEvent


def log(kind, *, account=None, purpose="", action="", channel="", destination="", provider="", note="", request=None, now=None):
    account_type, account_id = ref(account) if account is not None else ("", None)
    django_request = getattr(request, "_request", request)
    return OtpEvent.objects.create(
        at=now or timezone.now(), kind=kind, account_type=account_type, account_id=account_id,
        purpose=purpose, action=(action or "")[:30], channel=channel or "", destination=(destination or "")[:254],
        provider=(provider or "")[:20], note=(note or "")[:200],
        ip=client_ip(django_request) if django_request is not None else None,
    )
```

- [ ] **Step 7: Generate the migration**

Run: `docker compose -p otp1 run --rm web python manage.py makemigrations otp`
Expected: `otp/migrations/0001_initial.py` creating `OtpChallenge`, `OtpEvent`, `StepUpToken`, `TrustedDevice`, `VerifiedContact` (and `otp/migrations/__init__.py`).

- [ ] **Step 8: Run the tests**

Run: `docker compose -p otp1 run --rm web python manage.py test otp --noinput`
Expected: all PASS (Task 1's 8 + 11 here).

- [ ] **Step 9: Commit**

```bash
git add backend/otp
git commit -m "feat(otp): challenge, audit, trusted-device, step-up and verified-contact models; contacts and audit writer"
```

---

### Task 4: Delivery (text and email) and the SMS-spend alert

**Files:**
- Create: `backend/otp/senders.py`, `backend/otp/spend.py`, `backend/otp/tests/test_senders.py`

**Interfaces:**
- Consumes: `otp.models.OtpEvent`, `SMS`, `EMAIL` (Task 3); `staffsecurity.policy.otp_sms_daily_alert()`, `set_otp()` (Task 2).
- Produces: `otp.senders.sms_outbox` (list of `Text(to, body)`), `Delivery(ok: bool, provider: str, ref: str = "")`, `sms_provider() -> str`, `send_sms(to, body) -> Delivery`, `send_email(to, subject, body) -> Delivery`, `deliver(channel, to, subject, body) -> Delivery`; `otp.spend.ALERT_KIND = "otp_sms_spend"`, `ALERT_LOCK_KEY`, `texts_sent_on(day) -> int`, `check(now=None) -> bool` (True when it raised today's alert).

- [ ] **Step 1: Write the failing test** — `backend/otp/tests/test_senders.py`

```python
"""How a code travels (otp.senders) and the SMS-spend alert (otp.spend). Review Focus 6 and 8."""
from datetime import timedelta
from unittest import mock

from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.testing import make_staff
from marketing.models_campaigns import SenderId
from notifications.models import Notification
from otp import senders, spend
from otp.models import EMAIL, SMS, OtpEvent
from staffsecurity import policy

HUBTEL = override_settings(
    OTP_SMS_PROVIDER="hubtel", HUBTEL_SMS_CLIENT_ID="test-id", HUBTEL_SMS_CLIENT_SECRET="test-secret", HUBTEL_SMS_SENDER_ID="AshantiHub",
)
HUBTEL_HTTP = "marketing.providers.hubtel_sms.http_request"
BODY = "123456 is your AshantiHub code to sign in."


class FakeResp:
    def __init__(self, data, status=200):
        self.data, self.status_code = data, status

    def json(self):
        return self.data


class SenderTests(TestCase):
    def setUp(self):
        senders.sms_outbox.clear()

    def test_texts_stay_in_the_outbox_under_tests(self):
        delivery = senders.deliver(SMS, "+233241234567", "Your AshantiHub code", BODY)
        self.assertEqual((delivery.ok, delivery.provider), (True, "locmem"))
        self.assertEqual([(t.to, t.body) for t in senders.sms_outbox], [("+233241234567", BODY)])

    @override_settings(OTP_SMS_PROVIDER="simulated")
    def test_the_simulated_provider_sends_and_keeps_nothing(self):
        delivery = senders.deliver(SMS, "+233241234567", "Your AshantiHub code", BODY)
        self.assertEqual((delivery.ok, delivery.provider), (True, "simulated"))
        self.assertEqual(senders.sms_outbox, [])

    def test_email_goes_through_django_mail(self):
        delivery = senders.deliver(EMAIL, "ama@example.com", "Your AshantiHub code", BODY)
        self.assertEqual((delivery.ok, delivery.provider), (True, "email"))
        self.assertEqual((mail.outbox[0].to, mail.outbox[0].subject, mail.outbox[0].body), (["ama@example.com"], "Your AshantiHub code", BODY))

    def test_a_failed_email_says_so_and_never_logs_the_body(self):
        with mock.patch("otp.senders.send_mail", side_effect=OSError("smtp down")), self.assertLogs("otp.senders", "WARNING") as logs:
            delivery = senders.deliver(EMAIL, "ama@example.com", "Your AshantiHub code", BODY)
        self.assertFalse(delivery.ok)
        self.assertNotIn("123456", "\n".join(logs.output))

    def test_an_unknown_channel_is_a_programming_error(self):
        with self.assertRaises(ValueError):
            senders.deliver("pigeon", "x", "s", BODY)

    @HUBTEL
    def test_hubtel_sends_through_the_marketing_client(self):
        SenderId.objects.create(name="AshantiHub", network="mtn", status=SenderId.APPROVED)
        stub = mock.Mock(return_value=FakeResp({"MessageId": "m-1", "Status": 0}))
        with mock.patch(HUBTEL_HTTP, stub):
            delivery = senders.deliver(SMS, "+233241234567", "Your AshantiHub code", BODY)
        self.assertEqual((delivery.ok, delivery.provider, delivery.ref), (True, "hubtel", "m-1"))
        self.assertEqual(stub.call_args.kwargs["json"]["To"], "233241234567")
        self.assertEqual(stub.call_args.kwargs["json"]["Content"], BODY)

    @HUBTEL
    def test_a_hubtel_refusal_is_a_failed_delivery_and_the_body_is_not_logged(self):
        SenderId.objects.create(name="AshantiHub", network="mtn", status=SenderId.APPROVED)
        with mock.patch(HUBTEL_HTTP, return_value=FakeResp({"Message": "no credit"}, status=402)), \
                self.assertLogs("otp.senders", "WARNING") as logs:
            delivery = senders.deliver(SMS, "+233241234567", "Your AshantiHub code", BODY)
        self.assertFalse(delivery.ok)
        self.assertNotIn("123456", "\n".join(logs.output))

    @override_settings(OTP_SMS_PROVIDER="hubtel", HUBTEL_SMS_CLIENT_ID="")
    def test_hubtel_without_keys_sends_nothing(self):
        with self.assertLogs("otp.senders", "WARNING"):
            self.assertFalse(senders.deliver(SMS, "+233241234567", "s", BODY).ok)


class SmsSpendAlertTests(TestCase):
    def setUp(self):
        self.boss = make_staff("super_admin", "boss@example.com")
        policy.set_otp({"otp_sms_daily_alert": 3}, self.boss)
        self.now = timezone.now()

    def text(self, at=None, channel=SMS, kind=OtpEvent.SENT):
        OtpEvent.objects.create(kind=kind, channel=channel, at=at or self.now, provider="locmem")

    def test_it_alerts_once_when_the_day_reaches_the_threshold(self):
        self.text()
        self.text()
        self.assertFalse(spend.check(self.now))
        self.text()
        self.assertTrue(spend.check(self.now))
        self.text()
        self.assertFalse(spend.check(self.now))
        alerts = Notification.objects.filter(staff=self.boss, kind=spend.ALERT_KIND)
        self.assertEqual(alerts.count(), 1)
        self.assertIn("3", alerts.get().title)
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.SMS_ALERT).count(), 1)

    def test_emails_and_refused_or_failed_sends_do_not_count(self):
        for _ in range(3):
            self.text(channel=EMAIL)
        self.text(kind=OtpEvent.SEND_REFUSED)
        self.text(kind=OtpEvent.SEND_FAILED)
        self.assertFalse(spend.check(self.now))

    def test_a_new_day_can_alert_again(self):
        for _ in range(3):
            self.text()
        self.assertTrue(spend.check(self.now))
        tomorrow = self.now + timedelta(days=1)
        for _ in range(3):
            self.text(at=tomorrow)
        self.assertTrue(spend.check(tomorrow))
        self.assertEqual(Notification.objects.filter(staff=self.boss, kind=spend.ALERT_KIND).count(), 2)

    def test_only_security_managers_hear(self):
        support = make_staff("support", "esi@example.com")
        for _ in range(3):
            self.text()
        spend.check(self.now)
        self.assertFalse(Notification.objects.filter(staff=support, kind=spend.ALERT_KIND).exists())
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p otp1 run --rm web python manage.py test otp.tests.test_senders --noinput`
Expected: ERROR — `cannot import name 'senders' from 'otp'`.

- [ ] **Step 3: Write `backend/otp/senders.py`**

```python
"""How a code reaches a person. Email goes through Django's mail (real only where SMTP is configured, like every
other AshantiHub email). Texts go through settings.OTP_SMS_PROVIDER:

* "simulated" (the default): sends nothing to anyone and keeps nothing; the audit row says "simulated".
* "hubtel": Hubtel SMS through marketing.providers.hubtel_sms (the HUBTEL_SMS_* keys and an Approved Sender ID).
  That client is UNVERIFIED against a live account (see its docstring); only it talks to Hubtel.
* "locmem": keeps each text in `sms_outbox` (settings forces it under `manage.py test`).

A message body holds a code or a reset link, so it is never logged: a failure logs only the provider and the
error type."""
import logging
from dataclasses import dataclass

from django.conf import settings
from django.core.mail import send_mail

from .models import EMAIL, SMS

logger = logging.getLogger(__name__)

sms_outbox = []


@dataclass
class Text:
    to: str
    body: str


@dataclass
class Delivery:
    ok: bool
    provider: str
    ref: str = ""


def sms_provider():
    return getattr(settings, "OTP_SMS_PROVIDER", "simulated") or "simulated"


def send_sms(to, body):
    provider = sms_provider()
    if provider == "locmem":
        sms_outbox.append(Text(to=to, body=body))
        return Delivery(ok=True, provider="locmem")
    if provider == "hubtel":
        from marketing.providers.base import Message, NotConnected
        from marketing.providers.hubtel_sms import HubtelSmsProvider

        try:
            result = HubtelSmsProvider().send(Message(channel="sms", address=to, body=body))
        except NotConnected:
            logger.warning("OTP text not sent: the Hubtel SMS keys or sender ID are missing")
            return Delivery(ok=False, provider="hubtel")
        if result.state != "sent":
            logger.warning("OTP text not sent: Hubtel answered %s", result.state)
            return Delivery(ok=False, provider="hubtel")
        return Delivery(ok=True, provider="hubtel", ref=result.ref)
    return Delivery(ok=True, provider="simulated")


def send_email(to, subject, body):
    try:
        send_mail(subject=subject, message=body, from_email=settings.DEFAULT_FROM_EMAIL, recipient_list=[to], fail_silently=False)
    except Exception as exc:  # the mail server refused or could not be reached
        logger.warning("OTP email not sent: %s", type(exc).__name__)
        return Delivery(ok=False, provider="email")
    return Delivery(ok=True, provider="email")


def deliver(channel, to, subject, body):
    if channel == SMS:
        return send_sms(to, body)
    if channel == EMAIL:
        return send_email(to, subject, body)
    raise ValueError(f"Cannot deliver on {channel!r}")
```

- [ ] **Step 4: Write `backend/otp/spend.py`**

```python
"""The SMS-spend alert (spec §9). OTP texts are counted per day from the audit trail; the first check that finds
today's count at the threshold Super Admin set (staffsecurity.policy.otp_sms_daily_alert, default 500) tells
everyone holding security.manage, once a day. Nothing is blocked: the alert is for a person to look at."""
from django.db import connection, transaction
from django.utils import timezone

from notifications.services import notify_staff_role

from .models import SMS, OtpEvent

ALERT_KIND = "otp_sms_spend"
ALERT_LOCK_KEY = 72210016  # pg_advisory_xact_lock key: one alert a day however many texts race


def texts_sent_on(day):
    return OtpEvent.objects.filter(kind=OtpEvent.SENT, channel=SMS, at__date=day).count()


def check(now=None):
    from staffsecurity import policy

    now = now or timezone.now()
    day = timezone.localdate(now)
    threshold = policy.otp_sms_daily_alert()
    sent = texts_sent_on(day)
    if sent < threshold:
        return False
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [ALERT_LOCK_KEY])
        if OtpEvent.objects.filter(kind=OtpEvent.SMS_ALERT, at__date=day).exists():
            return False
        OtpEvent.objects.create(kind=OtpEvent.SMS_ALERT, at=now, channel=SMS, note=f"{sent} texts on {day:%Y-%m-%d}; alert at {threshold}")
    notify_staff_role(
        "security.manage", ALERT_KIND, f"One-time-code texts reached {threshold} today",
        body=(
            f"{sent} code texts have been sent today ({day:%d %b}). A sudden rise can mean someone is abusing the "
            "code requests. Look at the code log and the text balance."
        ),
        link="security", icon="📱",
    )
    return True
```

- [ ] **Step 5: Run the tests**

Run: `docker compose -p otp1 run --rm web python manage.py test otp.tests.test_senders --noinput`
Expected: 12 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/otp
git commit -m "feat(otp): text and email delivery (simulated, Hubtel, in-memory for tests) and the daily SMS-spend alert"
```

---

### Task 5: The code engine — send, verify, resend, limits, lock

**Files:**
- Create: `backend/otp/service.py`, `backend/otp/tests/test_service.py`

**Interfaces:**
- Consumes: `otp.identity.contacts`, `ref` (Task 3); `otp.audit.log` (Task 3); `otp.senders.deliver`, `Delivery` (Task 4); `otp.spend.check` (Task 4); models (Task 3).
- Produces (`otp.service`): constants `CODE_TTL`, `MAX_ATTEMPTS`, `RESEND_COOLDOWN`, `LOCK_LIMIT`, `LOCK_WINDOW`, `PER_DESTINATION_HOURLY`, `PER_ACCOUNT_HOURLY`, `PER_IP_HOURLY`, messages `TRY_LATER`, `WAIT`, `WRONG`, `EXPIRED`, `NO_CHANNEL`, `NOT_SENT`; `class OtpError(Exception)` with `.message`, `.code`, `.status_code`, `.retry_after`, `.body() -> dict`; `new_code() -> str`, `hash_code(salt, code) -> str`, `clean_code(raw) -> str`, `message_for(code, purpose) -> str`, `failures(account, now=None) -> int`, `is_locked(account, now=None) -> bool`, `note_failure(account, *, purpose, channel, request=None, now=None)`, `send(account, purpose, channel, *, action="", ticket="", request=None, now=None) -> OtpChallenge`, `verify(account, purpose, raw_code, *, action="", ticket="", request=None, now=None) -> OtpChallenge`. Error codes: `no_channel` (400), `resend_cooldown` (429 + `retry_after`), `try_later` (429), `send_failed` (502), `wrong_code` (400), `code_expired` (400).

- [ ] **Step 1: Write the failing test** — `backend/otp/tests/test_service.py`

```python
"""The one OTP service (otp.service): codes, expiry, tries, resends, hourly limits and the lock.
Review Focus 1, 2, 3, 6 and 8."""
import threading
from datetime import timedelta
from unittest import mock

from django.db import connection
from django.test import RequestFactory, TestCase, TransactionTestCase
from django.utils import timezone

from otp import senders, service
from otp.models import EMAIL, SIGN_IN, SMS, STEP_UP, OtpChallenge, OtpEvent, VerifiedContact
from otp.service import OtpError

from .helpers import last_email_code, last_sms_code, make_customer, make_owner, wrong_code


class ServiceBase(TestCase):
    def setUp(self):
        senders.sms_outbox.clear()
        self.customer = make_customer()

    def send(self, channel=SMS, ticket="t1", **kwargs):
        return service.send(self.customer, SIGN_IN, channel, ticket=ticket, **kwargs)

    def verify(self, code, ticket="t1", **kwargs):
        return service.verify(self.customer, SIGN_IN, code, ticket=ticket, **kwargs)

    def refused(self, call, *args, **kwargs):
        with self.assertRaises(OtpError) as caught:
            call(*args, **kwargs)
        return caught.exception

    def age_last_send(self, seconds=61):
        OtpChallenge.objects.update(last_sent_at=timezone.now() - timedelta(seconds=seconds))


class CodeTests(ServiceBase):
    def test_a_code_is_six_digits_and_stored_only_as_a_salted_hash(self):
        challenge = self.send()
        code = last_sms_code()
        self.assertRegex(code, r"^\d{6}$")
        self.assertEqual((len(challenge.code_hash), len(challenge.salt)), (64, 32))
        self.assertEqual(challenge.code_hash, service.hash_code(challenge.salt, code))
        # No text column of any OTP row holds the code (the phone number and the hex hash/salt are left out
        # only because a run of six digits could appear in them by chance).
        for row in (*OtpChallenge.objects.all(), *OtpEvent.objects.all()):
            for field in row._meta.concrete_fields:
                value = getattr(row, field.attname)
                if isinstance(value, str) and field.name not in ("destination", "salt", "code_hash"):
                    self.assertNotIn(code, value, f"{type(row).__name__}.{field.name}")

    def test_codes_come_from_secrets(self):
        with mock.patch("otp.service.secrets.randbelow", return_value=42) as randbelow:
            self.assertEqual(service.new_code(), "000042")
        randbelow.assert_called_once_with(1000000)

    def test_the_text_says_what_it_is_for_and_never_to_share_it(self):
        self.send()
        body = senders.sms_outbox[-1].body
        self.assertIn("to sign in", body)
        self.assertIn("5 minutes", body)
        self.assertIn("Never share it", body)

    def test_the_right_code_works_once(self):
        self.send()
        code = last_sms_code()
        self.assertIsNotNone(self.verify(code).consumed_at)
        self.assertEqual(self.refused(self.verify, code).code, "code_expired")

    def test_typing_spaces_or_a_hyphen_is_fine(self):
        self.send()
        code = last_sms_code()
        self.verify(f"{code[:3]} - {code[3:]}")

    def test_a_code_expires_after_five_minutes(self):
        self.send()
        code = last_sms_code()
        OtpChallenge.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.refused(self.verify, code).code, "code_expired")

    def test_a_code_for_one_ticket_or_purpose_never_completes_another(self):
        self.send(ticket="t1")
        code = last_sms_code()
        self.assertEqual(self.refused(self.verify, code, ticket="t2").code, "code_expired")
        self.assertEqual(self.refused(service.verify, self.customer, STEP_UP, code, ticket="t1").code, "code_expired")
        self.verify(code, ticket="t1")

    def test_an_accepted_code_marks_the_contact_verified(self):
        self.send(channel=EMAIL)
        self.verify(last_email_code())
        self.assertTrue(VerifiedContact.objects.filter(
            account_type="customer", account_id=self.customer.pk, channel=EMAIL, destination="ama@example.com",
        ).exists())
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.VERIFIED, channel=EMAIL).exists())

    def test_a_channel_the_account_lacks_is_refused(self):
        owner = make_owner(email=None)
        error = self.refused(service.send, owner, SIGN_IN, EMAIL, ticket="t")
        self.assertEqual((error.code, error.status_code), ("no_channel", 400))
        self.assertEqual(self.refused(service.send, owner, SIGN_IN, ["sms"], ticket="t").code, "no_channel")


class GuessingTests(ServiceBase):
    def test_wrong_codes_count_and_the_sixth_try_is_refused_even_when_right(self):
        self.send()
        code = last_sms_code()
        for _ in range(5):
            self.assertEqual(self.refused(self.verify, wrong_code(code)).code, "wrong_code")
        error = self.refused(self.verify, code)
        self.assertEqual((error.code, error.status_code), ("try_later", 429))
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.LOCKED).count(), 1)

    def test_a_resend_never_buys_more_guesses(self):
        self.send()
        for _ in range(3):
            self.refused(self.verify, wrong_code(last_sms_code()))
        self.age_last_send()
        self.send()
        code = last_sms_code()
        for _ in range(2):
            self.refused(self.verify, wrong_code(code))
        self.assertEqual(OtpChallenge.objects.get().attempts, 5)
        # Even once the lock has passed, this challenge has used its five tries.
        OtpEvent.objects.update(at=timezone.now() - timedelta(minutes=16))
        self.assertEqual(self.refused(self.verify, code).code, "code_expired")

    def test_the_lock_covers_every_challenge_and_sending_and_passes_after_fifteen_minutes(self):
        for ticket in ("a", "b", "c", "d", "e"):
            self.send(ticket=ticket)
            self.refused(self.verify, wrong_code(last_sms_code()), ticket=ticket)
        self.assertTrue(service.is_locked(self.customer))
        error = self.refused(self.send, ticket="f")
        self.assertEqual((error.code, error.status_code), ("try_later", 429))
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.SEND_REFUSED, note="locked").exists())
        OtpEvent.objects.update(at=timezone.now() - timedelta(minutes=61))
        self.assertFalse(service.is_locked(self.customer))
        self.send(ticket="f")
        self.verify(last_sms_code(), ticket="f")

    def test_a_staff_assisted_recovery_restarts_the_count(self):
        for _ in range(5):
            OtpEvent.objects.create(kind=OtpEvent.FAILED, account_type="customer", account_id=self.customer.pk)
        self.assertTrue(service.is_locked(self.customer))
        OtpEvent.objects.create(kind=OtpEvent.RECOVERED, account_type="customer", account_id=self.customer.pk)
        self.assertFalse(service.is_locked(self.customer))


class ResendAndLimitTests(ServiceBase):
    def test_a_resend_inside_a_minute_waits_and_says_how_long(self):
        self.send()
        error = self.refused(self.send)
        self.assertEqual((error.code, error.status_code), ("resend_cooldown", 429))
        self.assertTrue(1 <= error.retry_after <= 61)
        self.assertEqual(error.body()["retry_after"], error.retry_after)
        self.assertEqual(len(senders.sms_outbox), 1)

    def test_a_resend_rotates_the_code_and_may_switch_channel(self):
        self.send()
        first = last_sms_code()
        self.age_last_send()
        challenge = self.send(channel=EMAIL)
        self.assertEqual((challenge.channel, challenge.sends), (EMAIL, 2))
        second = last_email_code()
        if first != second:
            self.assertEqual(self.refused(self.verify, first).code, "wrong_code")
        self.verify(second)

    def test_five_texts_an_hour_to_one_phone_then_try_later(self):
        for ticket in "abcde":
            self.send(ticket=ticket)
        error = self.refused(self.send, ticket="f")
        self.assertEqual((error.code, error.status_code), ("try_later", 429))
        self.assertEqual(len(senders.sms_outbox), 5)
        OtpEvent.objects.update(at=timezone.now() - timedelta(minutes=61))
        self.send(ticket="f")

    def test_ten_codes_an_hour_per_account_whatever_the_destination(self):
        for n in range(10):
            OtpEvent.objects.create(kind=OtpEvent.SENT, account_type="customer", account_id=self.customer.pk, channel=SMS, destination=f"+23320000{n:04d}")
        self.assertEqual(self.refused(self.send).code, "try_later")

    def test_twenty_codes_an_hour_from_one_address(self):
        for n in range(20):
            OtpEvent.objects.create(kind=OtpEvent.SENT, ip="154.160.24.91", channel=SMS, destination=f"+23320000{n:04d}")
        self.assertEqual(self.refused(self.send, request=RequestFactory().post("/", REMOTE_ADDR="154.160.24.91")).code, "try_later")
        self.send(request=RequestFactory().post("/", REMOTE_ADDR="154.160.24.92"))

    def test_a_lock_and_an_hourly_limit_give_the_same_answer(self):
        # Review Focus 3: nobody can tell "this account is locked" from "too many texts".
        owner = make_owner()
        for _ in range(5):
            OtpEvent.objects.create(kind=OtpEvent.SENT, channel=SMS, destination="+233201112233")
        limited = self.refused(service.send, owner, SIGN_IN, SMS, ticket="x")
        for _ in range(5):
            OtpEvent.objects.create(kind=OtpEvent.FAILED, account_type="customer", account_id=self.customer.pk)
        locked = self.refused(self.send)
        self.assertEqual((limited.body(), limited.status_code), (locked.body(), locked.status_code))

    def test_a_failed_delivery_is_reported_and_counted(self):
        with mock.patch("otp.senders.deliver", return_value=senders.Delivery(ok=False, provider="hubtel")):
            error = self.refused(self.send)
        self.assertEqual((error.code, error.status_code), ("send_failed", 502))
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.SEND_FAILED, provider="hubtel").exists())

    def test_every_text_and_no_email_is_checked_against_the_spend_alert(self):
        with mock.patch("otp.spend.check") as check:
            self.send()
            self.age_last_send()
            self.send(channel=EMAIL)
        check.assert_called_once()


class ConcurrentUseTests(TransactionTestCase):
    """Review Focus 1: the same right code sent twice at once signs in once."""

    serialized_rollback = True

    def test_two_requests_with_the_right_code_at_once_succeed_once(self):
        senders.sms_outbox.clear()
        customer = make_customer()
        service.send(customer, SIGN_IN, SMS, ticket="t1")
        code = last_sms_code()
        results = []
        barrier = threading.Barrier(2)

        def run():
            try:
                barrier.wait()
                service.verify(customer, SIGN_IN, code, ticket="t1")
                results.append("ok")
            except OtpError as exc:
                results.append(exc.code)
            finally:
                connection.close()

        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        self.assertEqual(sorted(results), ["code_expired", "ok"])
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.VERIFIED).count(), 1)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p otp1 run --rm web python manage.py test otp.tests.test_service --noinput`
Expected: ERROR — `cannot import name 'service' from 'otp'`.

- [ ] **Step 3: Write `backend/otp/service.py`**

```python
"""The one OTP service (spec §9). A code is 6 digits from `secrets`, kept only as a salted HMAC, alive 5 minutes,
with 5 tries; a resend rotates it after a 60-second wait and keeps the tries. Sends are limited per hour per phone
or email, per account and per IP, counted from the audit trail (otp.models.OtpEvent) so the limits hold across
every server process. Five wrong codes for an account inside 15 minutes lock both sending and checking for 15
minutes; the lock and the hourly limits answer the same words, so nobody can tell them apart.

verify() counts a try before comparing and must never run inside a transaction that is rolled back when it
refuses (the counted try would be undone): the views call it outside any atomic block and answer refusals as a
Response."""
import hmac
import secrets
from datetime import timedelta

from django.db.models import F
from django.utils import timezone
from django.utils.crypto import salted_hmac

from activity.services import client_ip

from . import audit, senders, spend
from .identity import contacts, ref
from .models import SIGN_IN, SIGN_UP, SMS, STEP_UP, OtpChallenge, OtpEvent, VerifiedContact

CODE_DIGITS = 6
CODE_TTL = timedelta(minutes=5)
MAX_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)
LOCK_LIMIT = 5
LOCK_WINDOW = timedelta(minutes=15)
PER_DESTINATION_HOURLY = 5
PER_ACCOUNT_HOURLY = 10
PER_IP_HOURLY = 20
HOUR = timedelta(hours=1)
CODE_SALT = "otp.code"
SEND_KINDS = (OtpEvent.SENT, OtpEvent.SEND_FAILED)
SUBJECT = "Your AshantiHub code"

TRY_LATER = "Too many tries. Wait a while, then try again."
WAIT = "Wait a minute before asking for another code."
WRONG = "That code isn't right. Check the message and try again."
EXPIRED = "That code has expired or was already used. Ask for a new one."
NO_CHANNEL = "We can't send a code that way. Choose another way."
NOT_SENT = "We couldn't send the code. Try again, or choose another way."
PURPOSE_WORDS = {SIGN_IN: "sign in", SIGN_UP: "confirm your phone or email", STEP_UP: "confirm a change to your account"}


class OtpError(Exception):
    """A refusal to show the person; `code` is what the frontend branches on."""

    def __init__(self, message, code, status_code=400, retry_after=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.retry_after = retry_after

    def body(self):
        data = {"detail": self.message, "code": self.code}
        if self.retry_after is not None:
            data["retry_after"] = self.retry_after
        return data


def new_code():
    return f"{secrets.randbelow(10 ** CODE_DIGITS):0{CODE_DIGITS}d}"


def hash_code(salt, code):
    return salted_hmac(CODE_SALT, f"{salt}:{code}").hexdigest()


def clean_code(raw):
    """Six ASCII digits once the spaces and hyphens a person typed are removed, or "" (other scripts' digits pass
    str.isdigit() but are not a code)."""
    if isinstance(raw, bool) or not isinstance(raw, (str, int)):
        return ""
    digits = "".join(str(raw).split()).replace("-", "")
    return digits if len(digits) == CODE_DIGITS and digits.isascii() and digits.isdigit() else ""


def message_for(code, purpose):
    minutes = int(CODE_TTL.total_seconds() // 60)
    return (
        f"{code} is your AshantiHub code to {PURPOSE_WORDS.get(purpose, 'continue')}. It expires in {minutes} minutes. "
        "Never share it: AshantiHub staff will never ask for it."
    )


def failures(account, now=None):
    """Wrong codes (texted, emailed or from an authenticator app) inside the lock window, counting only those
    after the latest staff-assisted recovery (otp.approval_kinds)."""
    account_type, account_id = ref(account)
    now = now or timezone.now()
    mine = OtpEvent.objects.filter(account_type=account_type, account_id=account_id)
    rows = mine.filter(kind=OtpEvent.FAILED, at__gte=now - LOCK_WINDOW)
    recovered = mine.filter(kind=OtpEvent.RECOVERED).order_by("-at").values_list("at", flat=True).first()
    if recovered is not None:
        rows = rows.filter(at__gt=recovered)
    return rows.count()


def is_locked(account, now=None):
    return failures(account, now) >= LOCK_LIMIT


def note_failure(account, *, purpose, channel, request=None, now=None):
    """Count one wrong code towards the account's lock; logs the lock the moment it starts."""
    now = now or timezone.now()
    audit.log(OtpEvent.FAILED, account=account, purpose=purpose, channel=channel, request=request, now=now)
    if failures(account, now) == LOCK_LIMIT:
        audit.log(
            OtpEvent.LOCKED, account=account, purpose=purpose, channel=channel, request=request, now=now,
            note=f"{LOCK_LIMIT} wrong codes in {int(LOCK_WINDOW.total_seconds() // 60)} minutes",
        )


def _ip(request):
    django_request = getattr(request, "_request", request)
    return client_ip(django_request) if django_request is not None else None


def _sent_in_last_hour(now, **match):
    return OtpEvent.objects.filter(kind__in=SEND_KINDS, at__gte=now - HOUR, **match).count()


def _open_challenge(account, purpose, action, ticket):
    account_type, account_id = ref(account)
    return (
        OtpChallenge.objects.filter(
            account_type=account_type, account_id=account_id, purpose=purpose, action=action, ticket=ticket,
            consumed_at__isnull=True, attempts__lt=MAX_ATTEMPTS,
        ).order_by("-id").first()
    )


def _cooldown(challenge, now):
    wait = int((challenge.last_sent_at + RESEND_COOLDOWN - now).total_seconds()) + 1
    return OtpError(WAIT, "resend_cooldown", status_code=429, retry_after=max(wait, 1))


def send(account, purpose, channel, *, action="", ticket="", request=None, now=None):
    """Send, or resend, the code for this sign-in ticket / step-up session on `channel` ("sms" or "email").
    Returns the OtpChallenge. Every refusal raises OtpError and sends nothing."""
    now = now or timezone.now()
    account_type, account_id = ref(account)
    destination = contacts(account).get(channel) if isinstance(channel, str) else None
    if not destination:
        raise OtpError(NO_CHANNEL, "no_channel")
    ip = _ip(request)
    details = {"account": account, "purpose": purpose, "action": action, "channel": channel,
               "destination": destination, "request": request, "now": now}
    if is_locked(account, now):
        audit.log(OtpEvent.SEND_REFUSED, note="locked", **details)
        raise OtpError(TRY_LATER, "try_later", status_code=429)
    challenge = _open_challenge(account, purpose, action, ticket)
    if challenge is not None and challenge.last_sent_at > now - RESEND_COOLDOWN:
        raise _cooldown(challenge, now)
    if (
        _sent_in_last_hour(now, destination=destination) >= PER_DESTINATION_HOURLY
        or _sent_in_last_hour(now, account_type=account_type, account_id=account_id) >= PER_ACCOUNT_HOURLY
        or (ip is not None and _sent_in_last_hour(now, ip=ip) >= PER_IP_HOURLY)
    ):
        audit.log(OtpEvent.SEND_REFUSED, note="hourly limit", **details)
        raise OtpError(TRY_LATER, "try_later", status_code=429)
    code, salt = new_code(), secrets.token_hex(16)
    fields = {"channel": channel, "destination": destination, "salt": salt, "code_hash": hash_code(salt, code),
              "last_sent_at": now, "expires_at": now + CODE_TTL, "ip": ip}
    if challenge is None:
        challenge = OtpChallenge.objects.create(
            account_type=account_type, account_id=account_id, purpose=purpose, action=action, ticket=ticket,
            created_at=now, **fields,
        )
    else:
        # Conditional, so two resends racing past the check above still send one code. Tries are kept.
        rotated = OtpChallenge.objects.filter(pk=challenge.pk, last_sent_at__lte=now - RESEND_COOLDOWN).update(
            sends=F("sends") + 1, **fields,
        )
        if not rotated:
            raise _cooldown(challenge, now)
        challenge.refresh_from_db()
    delivery = senders.deliver(channel, destination, SUBJECT, message_for(code, purpose))
    audit.log(OtpEvent.SENT if delivery.ok else OtpEvent.SEND_FAILED, provider=delivery.provider, **details)
    if not delivery.ok:
        raise OtpError(NOT_SENT, "send_failed", status_code=502)
    if channel == SMS:
        spend.check(now)
    return challenge


def verify(account, purpose, raw_code, *, action="", ticket="", request=None, now=None):
    """Accept the code for this ticket / step-up session once. Returns the consumed OtpChallenge; every refusal
    raises OtpError. A try is counted before the comparison, so racing requests never get a sixth."""
    now = now or timezone.now()
    account_type, account_id = ref(account)
    if is_locked(account, now):
        raise OtpError(TRY_LATER, "try_later", status_code=429)
    challenge = (
        OtpChallenge.objects.filter(
            account_type=account_type, account_id=account_id, purpose=purpose, action=action, ticket=ticket,
            consumed_at__isnull=True,
        ).order_by("-id").first()
    )
    if challenge is None or challenge.expires_at <= now or challenge.attempts >= MAX_ATTEMPTS:
        raise OtpError(EXPIRED, "code_expired")
    counted = OtpChallenge.objects.filter(
        pk=challenge.pk, consumed_at__isnull=True, attempts__lt=MAX_ATTEMPTS,
    ).update(attempts=F("attempts") + 1)
    if not counted:
        raise OtpError(EXPIRED, "code_expired")
    code = clean_code(raw_code)
    if not code or not hmac.compare_digest(hash_code(challenge.salt, code), challenge.code_hash):
        note_failure(account, purpose=purpose, channel=challenge.channel, request=request, now=now)
        raise OtpError(WRONG, "wrong_code")
    if not OtpChallenge.objects.filter(pk=challenge.pk, consumed_at__isnull=True).update(consumed_at=now):
        raise OtpError(EXPIRED, "code_expired")
    VerifiedContact.objects.bulk_create(
        [VerifiedContact(account_type=account_type, account_id=account_id, channel=challenge.channel,
                         destination=challenge.destination, verified_at=now)],
        ignore_conflicts=True,
    )
    audit.log(OtpEvent.VERIFIED, account=account, purpose=purpose, action=action, channel=challenge.channel,
              destination=challenge.destination, request=request, now=now)
    challenge.consumed_at = now
    return challenge
```

- [ ] **Step 4: Run the tests**

Run: `docker compose -p otp1 run --rm web python manage.py test otp.tests.test_service --noinput`
Expected: 22 PASS (the threaded test included).

- [ ] **Step 5: Run the whole app and commit**

Run: `docker compose -p otp1 run --rm web python manage.py test otp --noinput`
Expected: all PASS.

```bash
git add backend/otp
git commit -m "feat(otp): code engine with hashed codes, tries, resend cooldown, hourly limits per phone/account/IP and the 15-minute lock"
```

---

### Task 6: Trusted devices, sign-in tickets and the second-step decision

**Files:**
- Create: `backend/otp/devices.py`, `backend/otp/signin.py`, `backend/otp/tests/test_devices_and_tickets.py`
- Modify: `backend/accounts/serializers.py` (`PasswordResetConfirmSerializer.save`)

**Interfaces:**
- Consumes: `otp.identity` (Task 3), `otp.audit.log` (Task 3), `otp.flags` (Task 1), `staffsecurity.policy.otp_customer_gap_days()` and `set_otp()` (Task 2), `accounts.sessions.describe_device`, `accounts.authentication.issue_token`.
- Produces:
  - `otp.devices.find(account, raw, now=None) -> TrustedDevice | None`, `is_trusted(account, raw, now=None) -> bool`, `trust(account, request, *, existing="", now=None) -> str` (raw token), `revoke_all(account, reason, *, request=None, now=None) -> int`, `live(account, now=None) -> list[TrustedDevice]`.
  - `otp.signin`: `TICKET_SALT`, `TICKET_MAX_AGE = 600`, `CODE_STAGE = "code"`, `AUTHENTICATOR_STAGE = "authenticator"`, `TIMED_OUT`, re-exported `SIGN_IN`, `SIGN_UP`; `Ticket(account, account_type, stage, purpose, nonce)`; `make_ticket(account, stage, purpose) -> str`; `read_ticket(token, stage=None) -> Ticket | None`; `code_challenge(account, purpose) -> {"otp_required": True, "mfa_token", "channels"}`; `has_verified_contact(account) -> bool`; `sign_in_step(account, device_token="") -> dict | None`; `signed_in_body(account, request) -> dict`.
  - Password reset now ends every trusted device with reason `TrustedDevice.PASSWORD_RESET`.

- [ ] **Step 1: Write the failing test** — `backend/otp/tests/test_devices_and_tickets.py`

```python
"""Trusted devices (otp.devices), sign-in tickets and the second-step decision (otp.signin).
Review Focus 3, 4 and 7."""
from datetime import timedelta
from unittest import mock

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import RequestFactory, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import PasswordResetToken
from otp import devices, signin
from otp.models import SIGN_IN, SIGN_UP, SMS, OtpEvent, TrustedDevice, VerifiedContact
from staffsecurity import policy

from .helpers import make_customer, make_owner, make_support

ON = override_settings(OTP_SIGNIN_ENFORCED=True)
SIGN_UP_ON = override_settings(OTP_SIGNUP_VERIFICATION_ENFORCED=True)


def browser():
    return RequestFactory().post("/", HTTP_USER_AGENT="Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36")


class TrustedDeviceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.customer = make_customer()
        self.raw = devices.trust(self.customer, browser())

    def test_a_trusted_device_skips_the_code_is_labelled_and_kept_hashed(self):
        self.assertTrue(devices.is_trusted(self.customer, self.raw))
        device = TrustedDevice.objects.get()
        self.assertEqual(device.label, "Chrome on Android device")
        self.assertNotEqual(device.token_hash, self.raw)
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.DEVICE_TRUSTED).exists())

    def test_any_password_change_ends_it(self):
        # Review Focus 4: whatever path changed the password, the fingerprint no longer matches.
        self.customer.password_hash = make_password("a-new-password-1")
        self.customer.save(update_fields=["password_hash"])
        self.assertFalse(devices.is_trusted(self.customer, self.raw))

    def test_a_password_reset_revokes_every_device_and_records_it(self):
        PasswordResetToken.objects.create(
            account_type="customer", account_id=self.customer.pk, token="reset-1", expires_at=timezone.now() + timedelta(hours=1),
        )
        response = APIClient().post(
            "/api/accounts/password-reset/confirm/",
            {"token": "reset-1", "account_type": "customer", "password": "a-new-password-1"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        device = TrustedDevice.objects.get()
        self.assertEqual(device.revoked_reason, TrustedDevice.PASSWORD_RESET)
        self.assertIsNotNone(device.revoked_at)
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.DEVICE_REVOKED, account_id=self.customer.pk).exists())

    def test_it_lapses_after_the_customer_gap_which_super_admin_can_change(self):
        TrustedDevice.objects.update(verified_at=timezone.now() - timedelta(days=31))
        self.assertFalse(devices.is_trusted(self.customer, self.raw))
        policy.set_otp({"otp_customer_gap_days": 60}, make_support("boss@example.com"))
        self.assertTrue(devices.is_trusted(self.customer, self.raw))

    def test_someone_elses_or_a_made_up_token_is_not_trusted(self):
        other = make_customer(phone="+233249999999", email="yaw@example.com")
        self.assertFalse(devices.is_trusted(other, self.raw))
        for junk in ("", "nonsense", None, 123, "x" * 500):
            self.assertFalse(devices.is_trusted(self.customer, junk))

    def test_trusting_again_with_the_same_token_refreshes_it(self):
        TrustedDevice.objects.update(verified_at=timezone.now() - timedelta(days=31))
        self.assertEqual(devices.trust(self.customer, browser(), existing=self.raw), self.raw)
        self.assertEqual(TrustedDevice.objects.count(), 1)
        self.assertTrue(devices.is_trusted(self.customer, self.raw))

    def test_revoke_all_and_the_live_list(self):
        second = devices.trust(self.customer, browser())
        self.assertEqual(len(devices.live(self.customer)), 2)
        self.assertEqual(devices.revoke_all(self.customer, TrustedDevice.REMOVED_ALL), 2)
        self.assertEqual(devices.live(self.customer), [])
        self.assertFalse(devices.is_trusted(self.customer, second))


class TicketTests(TestCase):
    def setUp(self):
        self.owner = make_owner()

    def test_a_genuine_ticket_reads_back(self):
        ticket = signin.read_ticket(signin.make_ticket(self.owner, signin.CODE_STAGE, SIGN_IN))
        self.assertEqual(
            (ticket.account, ticket.account_type, ticket.stage, ticket.purpose),
            (self.owner, "business_owner", "code", "sign_in"),
        )
        self.assertEqual(len(ticket.nonce), 32)

    def test_every_ticket_has_its_own_nonce(self):
        first = signin.read_ticket(signin.make_ticket(self.owner, signin.CODE_STAGE, SIGN_IN))
        second = signin.read_ticket(signin.make_ticket(self.owner, signin.CODE_STAGE, SIGN_IN))
        self.assertNotEqual(first.nonce, second.nonce)

    def test_tampered_expired_wrong_stage_or_stale_tickets_are_refused(self):
        token = signin.make_ticket(self.owner, signin.CODE_STAGE, SIGN_IN)
        self.assertIsNone(signin.read_ticket(token + "x"))
        self.assertIsNone(signin.read_ticket(token, signin.AUTHENTICATOR_STAGE))
        for junk in (None, "", 7, ["x"]):
            self.assertIsNone(signin.read_ticket(junk))
        with mock.patch("otp.signin.TICKET_MAX_AGE", -1):
            self.assertIsNone(signin.read_ticket(token))
        self.owner.password_hash = make_password("changed-password-1")
        self.owner.save(update_fields=["password_hash"])
        self.assertIsNone(signin.read_ticket(token))

    def test_a_suspended_account_cannot_use_its_ticket(self):
        token = signin.make_ticket(self.owner, signin.CODE_STAGE, SIGN_IN)
        self.owner.is_suspended = True
        self.owner.save(update_fields=["is_suspended"])
        self.assertIsNone(signin.read_ticket(token))


class SignInStepTests(TestCase):
    def setUp(self):
        self.customer, self.owner, self.staff = make_customer(), make_owner(), make_support()

    def test_with_every_switch_off_nobody_owes_a_second_step(self):
        # Review Focus 7.
        for account in (self.customer, self.owner, self.staff):
            self.assertIsNone(signin.sign_in_step(account))

    @ON
    def test_vendors_and_staff_always_owe_a_code(self):
        for account in (self.owner, self.staff):
            step = signin.sign_in_step(account)
            self.assertEqual(set(step), {"otp_required", "mfa_token", "channels"})
            self.assertEqual(signin.read_ticket(step["mfa_token"]).purpose, SIGN_IN)

    @ON
    def test_a_customer_owes_one_only_without_a_trusted_device(self):
        self.assertIsNotNone(signin.sign_in_step(self.customer))
        raw = devices.trust(self.customer, browser())
        self.assertIsNone(signin.sign_in_step(self.customer, raw))
        self.assertIsNotNone(signin.sign_in_step(self.customer, "someone-elses"))

    @SIGN_UP_ON
    def test_an_unverified_customer_or_vendor_owes_a_sign_up_check_but_staff_do_not(self):
        for account in (self.customer, self.owner):
            step = signin.sign_in_step(account)
            self.assertEqual(signin.read_ticket(step["mfa_token"]).purpose, SIGN_UP)
        self.assertIsNone(signin.sign_in_step(self.staff))

    @SIGN_UP_ON
    def test_a_verified_current_contact_is_enough_but_an_old_one_is_not(self):
        VerifiedContact.objects.create(account_type="customer", account_id=self.customer.pk, channel=SMS, destination="+233241234567")
        self.assertTrue(signin.has_verified_contact(self.customer))
        self.assertIsNone(signin.sign_in_step(self.customer))
        self.customer.phone = "+233245550000"
        self.customer.email = None
        self.customer.save()
        self.assertFalse(signin.has_verified_contact(self.customer))
        self.assertIsNotNone(signin.sign_in_step(self.customer))

    @ON
    def test_the_challenge_carries_no_name_id_or_whole_contact(self):
        # Review Focus 3.
        step = signin.sign_in_step(self.owner)
        text = str(step)
        self.assertNotIn("201112233", text)
        self.assertNotIn("kwame@", text)
        self.assertNotIn("Kwame", text)
        self.assertNotIn("id", step)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p otp1 run --rm web python manage.py test otp.tests.test_devices_and_tickets --noinput`
Expected: ERROR — `cannot import name 'devices' from 'otp'`.

- [ ] **Step 3: Write `backend/otp/devices.py`**

```python
"""Trusted devices (spec §9). After a code, a customer may trust the browser. The raw token is returned once, in
the response body; the frontend keeps it (local storage — the API is on another origin, so no cookie) and sends it
back as `device_token` with the password. The row keeps its SHA-256. A device skips the customer's sign-in code
only while it is not revoked, its password fingerprint matches the account's current password (so ANY password
change ends it) and its last code is newer than the customer gap (staffsecurity.policy, default 30 days)."""
import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone

from accounts.sessions import describe_device

from . import audit
from .identity import fingerprint, ref
from .models import OtpEvent, TrustedDevice


def _hash(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def _gap():
    from staffsecurity import policy

    return timedelta(days=policy.otp_customer_gap_days())


def _mine(account):
    account_type, account_id = ref(account)
    return TrustedDevice.objects.filter(account_type=account_type, account_id=account_id, revoked_at__isnull=True)


def find(account, raw, now=None):
    """The live device row this raw token names for this account, or None."""
    if not isinstance(raw, str) or not raw or len(raw) > 200:
        return None
    now = now or timezone.now()
    device = _mine(account).filter(token_hash=_hash(raw)).first()
    if device is None or device.password_fingerprint != fingerprint(account) or device.verified_at < now - _gap():
        return None
    return device


def is_trusted(account, raw, now=None):
    now = now or timezone.now()
    device = find(account, raw, now)
    if device is None:
        return False
    TrustedDevice.objects.filter(pk=device.pk).update(last_seen_at=now)
    return True


def trust(account, request, *, existing="", now=None):
    """After a code was accepted: refresh the device the client already holds (`existing`, if it is this account's
    and not revoked) or create a new one. Returns the raw token for the client."""
    now = now or timezone.now()
    if isinstance(existing, str) and existing:
        device = _mine(account).filter(token_hash=_hash(existing)).first()
        if device is not None:
            TrustedDevice.objects.filter(pk=device.pk).update(
                verified_at=now, last_seen_at=now, password_fingerprint=fingerprint(account),
            )
            return existing
    account_type, account_id = ref(account)
    raw = secrets.token_urlsafe(32)
    django_request = getattr(request, "_request", request)
    agent = django_request.META.get("HTTP_USER_AGENT", "")[:300] if django_request is not None else ""
    device = TrustedDevice.objects.create(
        account_type=account_type, account_id=account_id, token_hash=_hash(raw), label=describe_device(agent),
        password_fingerprint=fingerprint(account), created_at=now, verified_at=now, last_seen_at=now,
    )
    audit.log(OtpEvent.DEVICE_TRUSTED, account=account, note=device.label, request=request, now=now)
    return raw


def revoke_all(account, reason, *, request=None, now=None):
    """End every trusted device of this account (password reset, staff recovery, "remove all")."""
    now = now or timezone.now()
    ended = _mine(account).update(revoked_at=now, revoked_reason=reason)
    if ended:
        audit.log(OtpEvent.DEVICE_REVOKED, account=account, note=f"{ended} device(s): {reason}", request=request, now=now)
    return ended


def live(account, now=None):
    """This account's devices that would skip a code now, most recently seen first."""
    now = now or timezone.now()
    rows = _mine(account).filter(password_fingerprint=fingerprint(account), verified_at__gte=now - _gap())
    return list(rows.order_by("-last_seen_at", "-id"))
```

- [ ] **Step 4: Write `backend/otp/signin.py`**

```python
"""The second sign-in step for customers, business owners and staff, and the sign-up contact check (spec §9).

After a correct password the login views ask sign_in_step(). It answers one of (mirroring the staff 2-step
shape in accounts/views.py, so the frontend can reuse that screen):
* {"otp_required": true, "mfa_token": …, "channels": [{"channel", "hint"}, …]} — a code by text or email;
* {"two_factor_required": true, "mfa_token": …} — the person's authenticator app (customers and business owners,
  otp.authenticator; staff keep accounts.two_factor and its own endpoints);
* None — sign in at once (always, while the switches are off).

The mfa_token is a signed ticket: account, stage, purpose, a random nonce that binds the code to this attempt, and
a fingerprint of the password hash (a password change kills it). It lasts TICKET_MAX_AGE seconds."""
import hmac
import secrets
from dataclasses import dataclass

from django.core import signing
from django.db.models import Q

from accounts.authentication import issue_token

from . import devices, flags
from .identity import CUSTOMER, STAFF, account_type_of, can_sign_in, channel_list, contacts, fingerprint, load, ref
from .models import SIGN_IN, SIGN_UP, VerifiedContact

TICKET_SALT = "otp.signin.ticket"
TICKET_MAX_AGE = 600  # seconds to choose a channel, receive the code and type it
CODE_STAGE = "code"
AUTHENTICATOR_STAGE = "authenticator"
STAGES = (CODE_STAGE, AUTHENTICATOR_STAGE)
PURPOSES = (SIGN_IN, SIGN_UP)
TIMED_OUT = "Your sign-in timed out. Enter your password again."


@dataclass
class Ticket:
    account: object
    account_type: str
    stage: str
    purpose: str
    nonce: str


def make_ticket(account, stage, purpose):
    account_type, account_id = ref(account)
    return signing.dumps(
        {"t": account_type, "i": account_id, "s": stage, "p": purpose, "n": secrets.token_hex(16), "pw": fingerprint(account)},
        salt=TICKET_SALT,
    )


def read_ticket(token, stage=None):
    """The Ticket, or None unless it is genuine, fresh, for an account that may sign in, issued under its current
    password and (when `stage` is given) at that stage."""
    if not isinstance(token, str) or not token:
        return None
    try:
        data = signing.loads(token, salt=TICKET_SALT, max_age=TICKET_MAX_AGE)
    except signing.BadSignature:
        return None
    if not isinstance(data, dict) or data.get("s") not in STAGES or data.get("p") not in PURPOSES:
        return None
    if stage is not None and data["s"] != stage:
        return None
    account = load(data.get("t"), data.get("i"))
    if not can_sign_in(account) or not hmac.compare_digest(str(data.get("pw", "")), fingerprint(account)):
        return None
    return Ticket(account=account, account_type=data["t"], stage=data["s"], purpose=data["p"], nonce=str(data.get("n", "")))


def code_challenge(account, purpose):
    return {"otp_required": True, "mfa_token": make_ticket(account, CODE_STAGE, purpose), "channels": channel_list(account)}


def has_verified_contact(account):
    """True when a code to one of the account's CURRENT phone/email was accepted at some point."""
    account_type, account_id = ref(account)
    current = Q()
    for channel, destination in contacts(account).items():
        current |= Q(channel=channel, destination=destination)
    if not current:
        return False
    return VerifiedContact.objects.filter(current, account_type=account_type, account_id=account_id).exists()


def sign_in_step(account, device_token=""):
    """The second step owed after a correct password, or None to sign in at once. Staff reach this only after
    accounts.two_factor found no authenticator stage for them."""
    kind = account_type_of(account)
    if kind != STAFF and flags.sign_up_enforced() and not has_verified_contact(account):
        return code_challenge(account, SIGN_UP)
    if not flags.sign_in_enforced():
        return None
    if kind == CUSTOMER and devices.is_trusted(account, device_token):
        return None
    return code_challenge(account, SIGN_IN)


def signed_in_body(account, request):
    """What a finished sign-in answers: exactly the body the password-only login gives today."""
    kind = account_type_of(account)
    if kind == STAFF:
        from accounts.views import _staff_sign_in_response  # accounts.views imports this module

        return _staff_sign_in_response(account, request, two_factor_used=True)
    return {"token": issue_token(account, kind), "account_type": kind, "id": account.id, "full_name": account.full_name}
```

- [ ] **Step 5: Password reset ends trusted devices** — in `backend/accounts/serializers.py`, inside `PasswordResetConfirmSerializer`, replace

```python
    def save(self):
        with transaction.atomic():
            self.account.password_hash = make_password(self.validated_data["password"])
            self.account.save(update_fields=["password_hash"])
            self.reset_token.used_at = timezone.now()
            self.reset_token.save(update_fields=["used_at"])
            if isinstance(self.account, StaffUser):
                # A reset is often "someone else may have my password": end
                # every device's session.
                sessions.revoke_all(self.account, StaffSession.PASSWORD_RESET)
        return self.account
```

with

```python
    def save(self):
        from otp import devices  # otp imports accounts
        from otp.models import TrustedDevice

        with transaction.atomic():
            self.account.password_hash = make_password(self.validated_data["password"])
            self.account.save(update_fields=["password_hash"])
            self.reset_token.used_at = timezone.now()
            self.reset_token.save(update_fields=["used_at"])
            if isinstance(self.account, StaffUser):
                # A reset is often "someone else may have my password": end
                # every device's session.
                sessions.revoke_all(self.account, StaffSession.PASSWORD_RESET)
            # Trusted devices already stop working with the old password (their fingerprint); this ends them and
            # records it (otp.devices).
            devices.revoke_all(self.account, TrustedDevice.PASSWORD_RESET)
        return self.account
```

- [ ] **Step 6: Run the tests**

Run: `docker compose -p otp1 run --rm web python manage.py test otp accounts.tests.test_password_reset --noinput`
Expected: all PASS (17 new; the existing password-reset tests unchanged).

- [ ] **Step 7: Commit**

```bash
git add backend/otp backend/accounts/serializers.py
git commit -m "feat(otp): trusted devices bound to the password, signed sign-in tickets and the second-step decision"
```

---

### Task 7: Sign-in and sign-up endpoints, wired into the login and registration views

**Files:**
- Create: `backend/otp/views.py`, `backend/otp/urls.py`, `backend/otp/tests/test_sign_in_api.py`
- Modify: `backend/ashantihub/urls.py`, `backend/accounts/views.py`

**Interfaces:**
- Consumes: `otp.service.send`, `verify`, `OtpError`, `CODE_TTL`, `RESEND_COOLDOWN` (Task 5); `otp.signin.read_ticket`, `CODE_STAGE`, `TIMED_OUT`, `code_challenge`, `sign_in_step`, `signed_in_body`, `SIGN_UP` (Task 6); `otp.devices.trust` (Task 6); `otp.identity.CUSTOMER`, `STAFF`, `hint` (Task 3); `otp.flags.sign_up_enforced` (Task 1).
- Produces: `POST /api/otp/sign-in/send/`, `POST /api/otp/sign-in/verify/`; helpers in `otp.views` used by later view modules: `_body(request) -> dict`, `_text(value) -> str | None`, `_truthy(value) -> bool`, `_expired() -> Response`, `_refused(exc) -> Response`, `_sent(challenge) -> dict`, `_check_code(ticket, body, request) -> Response | None`; `accounts.views._device_token(request) -> str`. The three login views and two registration views now consult `otp_signin`.

- [ ] **Step 1: Write the failing test** — `backend/otp/tests/test_sign_in_api.py`

```python
"""Sign-in and sign-up with a code through the HTTP API (otp plan Task 7). Review Focus 3 and 7."""
import time
from datetime import timedelta
from unittest import mock

import pyotp
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import two_factor
from accounts.models import Customer, StaffSession
from accounts.testing import make_staff
from otp import senders
from otp.models import OtpChallenge, VerifiedContact
from staffsecurity.models import StaffSignInRecord

from .helpers import HASHED, PASSWORD, last_email_code, last_sms_code, make_customer, make_owner, make_support, wrong_code

ON = override_settings(OTP_SIGNIN_ENFORCED=True)
SIGN_UP_ON = override_settings(OTP_SIGNUP_VERIFICATION_ENFORCED=True)
LOGIN = {
    "customer": "/api/accounts/customers/login/",
    "business_owner": "/api/accounts/business-owners/login/",
    "staff": "/api/accounts/staff/login/",
}
SIGNED_IN = {"token", "account_type", "id", "full_name"}
CHALLENGE = {"otp_required", "mfa_token", "channels"}


class SignInApiBase(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.client = APIClient()
        self.customer, self.owner, self.staff = make_customer(), make_owner(), make_support()

    def login(self, kind, identifier, password=PASSWORD, **extra):
        return self.client.post(LOGIN[kind], {"identifier": identifier, "password": password, **extra}, format="json")

    def ticket(self, kind="business_owner", identifier="+233201112233", **extra):
        return self.login(kind, identifier, **extra).json()["mfa_token"]

    def send(self, mfa_token, channel="sms"):
        return self.client.post("/api/otp/sign-in/send/", {"mfa_token": mfa_token, "channel": channel}, format="json")

    def verify(self, mfa_token, code, **extra):
        return self.client.post("/api/otp/sign-in/verify/", {"mfa_token": mfa_token, "code": code, **extra}, format="json")


class SwitchedOffTests(SignInApiBase):
    def test_sign_in_and_registration_answer_exactly_as_before(self):
        # Review Focus 7.
        self.assertEqual(set(self.login("customer", "+233241234567").json()), SIGNED_IN)
        self.assertEqual(set(self.login("business_owner", "+233201112233").json()), SIGNED_IN)
        self.assertEqual(set(self.login("staff", "esi@example.com").json()), SIGNED_IN | {"role", "permissions"})
        response = self.client.post("/api/accounts/customers/register/", {"full_name": "Yaa", "phone": "+233245550000", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertIn("token", response.json())
        self.assertEqual(OtpChallenge.objects.count(), 0)


@ON
class VendorSignInTests(SignInApiBase):
    def test_the_password_step_answers_a_challenge_without_a_token(self):
        body = self.login("business_owner", "+233201112233").json()
        self.assertEqual(set(body), CHALLENGE)
        self.assertEqual(body["channels"], [
            {"channel": "sms", "hint": "020 *** 2233"}, {"channel": "email", "hint": "kw•••@example.com"},
        ])

    def test_a_code_by_text_finishes_signing_in(self):
        ticket = self.ticket()
        sent = self.send(ticket)
        self.assertEqual(sent.status_code, 200, sent.content)
        self.assertEqual(sent.json(), {"channel": "sms", "hint": "020 *** 2233", "expires_in": 300, "resend_in": 60})
        body = self.verify(ticket, last_sms_code()).json()
        self.assertEqual(set(body), SIGNED_IN)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {body['token']}")
        self.assertEqual(self.client.get("/api/accounts/me/").json()["account_type"], "business_owner")

    def test_a_wrong_code_then_the_right_one(self):
        ticket = self.ticket()
        self.send(ticket)
        code = last_sms_code()
        response = self.verify(ticket, wrong_code(code))
        self.assertEqual((response.status_code, response.json()["code"]), (400, "wrong_code"))
        self.assertEqual(self.verify(ticket, code).status_code, 200)

    def test_the_other_channel_recovers_a_code_that_never_arrived(self):
        ticket = self.ticket()
        self.send(ticket)
        text_code = last_sms_code()
        OtpChallenge.objects.update(last_sent_at=timezone.now() - timedelta(seconds=61))
        self.assertEqual(self.send(ticket, "email").status_code, 200)
        email_code = last_email_code()
        if text_code != email_code:
            self.assertEqual(self.verify(ticket, text_code).json()["code"], "wrong_code")
        self.assertEqual(self.verify(ticket, email_code).status_code, 200)

    def test_one_attempts_code_never_finishes_another(self):
        first, second = self.ticket(), self.ticket()
        self.send(first)
        response = self.verify(second, last_sms_code())
        self.assertEqual((response.status_code, response.json()["code"]), (400, "code_expired"))

    def test_a_bad_or_stale_ticket_is_challenge_expired(self):
        for path in ("send", "verify"):
            response = self.client.post(f"/api/otp/sign-in/{path}/", {"mfa_token": "junk", "code": "123456", "channel": "sms"}, format="json")
            self.assertEqual((response.status_code, response.json()["code"]), (400, "challenge_expired"), path)
        ticket = self.ticket()
        self.owner.is_suspended = True
        self.owner.save(update_fields=["is_suspended"])
        self.assertEqual(self.send(ticket).json()["code"], "challenge_expired")

    def test_a_stale_authorization_header_does_not_block_the_public_endpoints(self):
        ticket = self.ticket()
        self.client.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
        self.assertEqual(self.send(ticket).status_code, 200)

    def test_a_wrong_password_reads_the_same_whether_or_not_the_account_exists(self):
        # Review Focus 3: the switch changes nothing before the password is right.
        known = self.login("business_owner", "+233201112233", password="wrong-password-1")
        unknown = self.login("business_owner", "+233209998887", password="wrong-password-1")
        self.assertEqual((known.status_code, known.json()), (unknown.status_code, unknown.json()))


@ON
class CustomerSignInTests(SignInApiBase):
    def test_trusting_the_device_skips_the_next_code(self):
        ticket = self.ticket("customer", "+233241234567")
        self.send(ticket, "email")
        body = self.verify(ticket, last_email_code(), trust_device=True).json()
        device_token = body["device_token"]
        self.assertEqual(set(self.login("customer", "+233241234567", device_token=device_token).json()), SIGNED_IN)
        self.assertEqual(set(self.login("customer", "+233241234567").json()), CHALLENGE)

    def test_no_device_token_unless_asked_and_never_for_vendors(self):
        ticket = self.ticket("customer", "+233241234567")
        self.send(ticket)
        self.assertNotIn("device_token", self.verify(ticket, last_sms_code()).json())
        owner_ticket = self.ticket()
        self.send(owner_ticket)
        self.assertNotIn("device_token", self.verify(owner_ticket, last_sms_code(), trust_device=True).json())


@ON
class StaffSignInTests(SignInApiBase):
    def test_staff_without_an_authenticator_get_a_code_by_email(self):
        body = self.login("staff", "esi@example.com").json()
        self.assertEqual(body["channels"], [{"channel": "email", "hint": "es•••@example.com"}])
        self.send(body["mfa_token"], "email")
        signed_in = self.verify(body["mfa_token"], last_email_code()).json()
        self.assertEqual(signed_in["role"], "support")
        self.assertTrue(StaffSession.objects.get(staff=self.staff).two_factor)

    def test_a_wrong_staff_code_is_in_the_sign_in_history(self):
        ticket = self.ticket("staff", "esi@example.com")
        self.send(ticket, "email")
        self.verify(ticket, wrong_code(last_email_code()))
        self.assertTrue(StaffSignInRecord.objects.filter(kind=StaffSignInRecord.TWO_STEP_FAILED, staff=self.staff).exists())

    def test_staff_with_an_authenticator_keep_the_existing_step(self):
        secret, _ = two_factor.begin_enrolment(self.staff)
        t0 = int(time.time())
        with mock.patch("accounts.two_factor._clock", return_value=t0):
            two_factor.confirm_enrolment(self.staff, pyotp.TOTP(secret).at(t0))
        self.assertEqual(set(self.login("staff", "esi@example.com").json()), {"two_factor_required", "mfa_token"})

    def test_a_super_admin_without_one_still_sets_it_up_first(self):
        make_staff("super_admin", "boss@example.com", password_hash=HASHED)
        self.assertEqual(set(self.login("staff", "boss@example.com").json()), {"two_factor_setup_required", "mfa_token"})


@SIGN_UP_ON
class SignUpTests(SignInApiBase):
    def test_registration_holds_the_token_until_the_contact_is_confirmed(self):
        response = self.client.post("/api/accounts/customers/register/", {"full_name": "Yaa Asantewaa", "phone": "0245550000", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertNotIn("token", body)
        self.assertTrue(body["otp_required"])
        self.send(body["mfa_token"])
        self.assertIn("token", self.verify(body["mfa_token"], last_sms_code()).json())
        yaa = Customer.objects.get(full_name="Yaa Asantewaa")
        self.assertTrue(VerifiedContact.objects.filter(account_type="customer", account_id=yaa.pk, destination="+233245550000").exists())

    def test_a_business_registration_does_too(self):
        response = self.client.post("/api/accounts/business-owners/register/", {"full_name": "Kofi Boateng", "login_phone": "+233207770000", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertNotIn("token", response.json())
        self.assertTrue(response.json()["otp_required"])

    def test_an_existing_unverified_customer_confirms_at_the_next_sign_in(self):
        body = self.login("customer", "+233241234567").json()
        self.assertTrue(body["otp_required"])
        self.send(body["mfa_token"])
        self.assertIn("token", self.verify(body["mfa_token"], last_sms_code()).json())
        self.assertIn("token", self.login("customer", "+233241234567").json())
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p otp1 run --rm web python manage.py test otp.tests.test_sign_in_api --noinput`
Expected: FAIL — the `/api/otp/…` paths answer 404 and the logins still answer tokens with the switches on.

- [ ] **Step 3: Write `backend/otp/views.py`**

```python
"""Sign-in and sign-up codes (otp plan Task 7), plus the helpers the other otp view modules share.

These endpoints work from a signed mfa_token (otp.signin), never from a phone or email, so they cannot tell anyone
whether an account exists. They authenticate nobody (a stale Authorization header can't block them). Refusals are
answered as a Response, never raised, so a wrong code's counted try is never rolled back. activity_exempt: request
bodies carry codes, and these views keep their own audit trail (otp.models.OtpEvent).

POST sign-in/send/   {mfa_token, channel: "sms" | "email"}
    -> {"channel", "hint", "expires_in": 300, "resend_in": 60}
POST sign-in/verify/ {mfa_token, code, trust_device?, device_token?}
    -> the body a password-only sign-in gives, plus "device_token" when a customer trusted this device."""
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from staffsecurity import signin as signin_log
from staffsecurity.models import StaffSignInRecord

from . import devices, service, signin
from .identity import CUSTOMER, STAFF, hint
from .service import OtpError


def _body(request):
    return request.data if isinstance(request.data, dict) else {}


def _text(value):
    """A request value as a string, or None if the client sent anything else."""
    return value if isinstance(value, str) else None


def _truthy(value):
    return value is True or (isinstance(value, str) and value.strip().lower() in ("true", "1", "yes", "on"))


def _expired():
    return Response({"detail": signin.TIMED_OUT, "code": "challenge_expired"}, status=400)


def _refused(exc):
    return Response(exc.body(), status=exc.status_code)


def _sent(challenge):
    return {
        "channel": challenge.channel,
        "hint": hint(challenge.channel, challenge.destination),
        "expires_in": int(service.CODE_TTL.total_seconds()),
        "resend_in": int(service.RESEND_COOLDOWN.total_seconds()),
    }


def _check_code(ticket, body, request):
    """None when the texted or emailed code is right, else the refusal to answer."""
    try:
        service.verify(ticket.account, ticket.purpose, body.get("code"), ticket=ticket.nonce, request=request)
    except OtpError as exc:
        if ticket.account_type == STAFF and exc.code == "wrong_code":
            signin_log.log(StaffSignInRecord.TWO_STEP_FAILED, request, staff=ticket.account, note="Text or email code")
        return _refused(exc)
    return None


class SignInSendView(APIView):
    """Send, or resend, the sign-in or sign-up code on the chosen way (switching way recovers a lost code)."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_scope = "otp_send"
    activity_exempt = True

    def post(self, request):
        body = _body(request)
        ticket = signin.read_ticket(body.get("mfa_token"), signin.CODE_STAGE)
        if ticket is None:
            return _expired()
        try:
            challenge = service.send(ticket.account, ticket.purpose, body.get("channel"), ticket=ticket.nonce, request=request)
        except OtpError as exc:
            return _refused(exc)
        return Response(_sent(challenge))


class SignInVerifyView(APIView):
    """Finish signing in (or confirm the contact after sign-up)."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_scope = "otp_verify"
    activity_exempt = True

    def post(self, request):
        body = _body(request)
        ticket = signin.read_ticket(body.get("mfa_token"), signin.CODE_STAGE)
        if ticket is None:
            return _expired()
        refused = _check_code(ticket, body, request)
        if refused is not None:
            return refused
        payload = signin.signed_in_body(ticket.account, request)
        if ticket.account_type == CUSTOMER and _truthy(body.get("trust_device")):
            payload["device_token"] = devices.trust(ticket.account, request, existing=_text(body.get("device_token")) or "")
        return Response(payload)
```

- [ ] **Step 4: Write `backend/otp/urls.py`**

```python
from django.urls import path

from . import views

urlpatterns = [
    path("sign-in/send/", views.SignInSendView.as_view(), name="otp-sign-in-send"),
    path("sign-in/verify/", views.SignInVerifyView.as_view(), name="otp-sign-in-verify"),
]
```

In `backend/ashantihub/urls.py` replace

```python
    path("api/staff-security/", include("staffsecurity.urls")),
```

with

```python
    path("api/staff-security/", include("staffsecurity.urls")),
    path("api/otp/", include("otp.urls")),
```

- [ ] **Step 5: Wire the account views** — six edits in `backend/accounts/views.py`.

(a) Imports — replace

```python
from staffsecurity import signin as signin_log
from staffsecurity.models import StaffSignInRecord
```

with

```python
from otp import flags as otp_flags
from otp import signin as otp_signin
from staffsecurity import signin as signin_log
from staffsecurity.models import StaffSignInRecord
```

(b) `CustomerRegisterView.create` — replace

```python
        customer = Customer.objects.get(pk=response.data["id"])
        response.data["token"] = issue_token(customer, "customer")
        return response
```

with

```python
        customer = Customer.objects.get(pk=response.data["id"])
        if otp_flags.sign_up_enforced():
            # The contact is confirmed before the account gets a token (spec §9): the token comes from
            # POST /api/otp/sign-in/verify/ once the code is right.
            response.data.update(otp_signin.code_challenge(customer, otp_signin.SIGN_UP))
            return response
        response.data["token"] = issue_token(customer, "customer")
        return response
```

(c) `BusinessOwnerRegisterView.create` — replace

```python
        owner = BusinessOwner.objects.get(pk=response.data["id"])
        response.data["token"] = issue_token(owner, "business_owner")
        return response
```

with

```python
        owner = BusinessOwner.objects.get(pk=response.data["id"])
        if otp_flags.sign_up_enforced():
            response.data.update(otp_signin.code_challenge(owner, otp_signin.SIGN_UP))
            return response
        response.data["token"] = issue_token(owner, "business_owner")
        return response
```

(d) `CustomerLoginView.post` — replace

```python
        account = serializer.account
        return Response({
            "token": issue_token(account, "customer"),
```

with

```python
        account = serializer.account
        step = otp_signin.sign_in_step(account, _device_token(request))
        if step is not None:
            return Response(step)
        return Response({
            "token": issue_token(account, "customer"),
```

(e) `BusinessOwnerLoginView.post` — replace

```python
        account = serializer.account
        return Response({
            "token": issue_token(account, "business_owner"),
```

with

```python
        account = serializer.account
        step = otp_signin.sign_in_step(account)
        if step is not None:
            return Response(step)
        return Response({
            "token": issue_token(account, "business_owner"),
```

(f) `StaffLoginView.post` — replace

```python
            return Response({"two_factor_setup_required": True, "mfa_token": two_factor.make_challenge(account, stage)})
        return Response(_staff_sign_in_response(account, request))
```

with

```python
            return Response({"two_factor_setup_required": True, "mfa_token": two_factor.make_challenge(account, stage)})
        # No authenticator stage: a texted or emailed code at every sign-in while OTP_SIGNIN_ENFORCED is on.
        step = otp_signin.sign_in_step(account)
        if step is not None:
            return Response(step)
        return Response(_staff_sign_in_response(account, request))
```

Then add the helper — replace

```python
def _text(value):
    """A request value as a string, or None if the client sent anything else."""
    return value if isinstance(value, str) else None
```

with

```python
def _text(value):
    """A request value as a string, or None if the client sent anything else."""
    return value if isinstance(value, str) else None


def _device_token(request):
    """The trusted-device token a customer's browser sends with the password (otp.devices), or ""."""
    return _text(_body(request).get("device_token")) or ""
```

- [ ] **Step 6: Run the tests**

Run: `docker compose -p otp1 run --rm web python manage.py test otp accounts staffsecurity --noinput`
Expected: all PASS (18 new; every existing login, registration, 2-step and rate-limit test unchanged).

- [ ] **Step 7: Commit**

```bash
git add backend/otp backend/ashantihub/urls.py backend/accounts/views.py
git commit -m "feat(otp): sign-in and sign-up code endpoints; login and registration ask for a second step when switched on"
```

---

### Task 8: Step-up tokens before sensitive changes

**Files:**
- Create: `backend/otp/step_up.py`, `backend/otp/views_step_up.py`, `backend/otp/tests/test_step_up.py`
- Modify: `backend/otp/urls.py`, `backend/accounts/views.py`

**Interfaces:**
- Consumes: `otp.service.send`, `verify`, `OtpError` (Task 5); `otp.views._body`, `_refused`, `_sent` (Task 7); `otp.identity.ref` (Task 3); `otp.audit.log` (Task 3); `otp.flags.step_up_enforced` (Task 1); `otp.models.STEP_UP`, `StepUpToken`, `OtpEvent`.
- Produces (`otp.step_up`): actions `PAYOUT_DESTINATION = "payout_destination"`, `CONTACT_CHANGE = "contact_change"`, `AUTHENTICATOR_CHANGE = "authenticator_change"`, `PASSWORD_CHANGE = "password_change"`, `WITHDRAWAL = "withdrawal"`; `ACTIONS` (dict action → label); `TOKEN_TTL`; `HEADER = "HTTP_X_STEP_UP_TOKEN"`; `class StepUpRequired(PermissionDenied)` → `403 {"detail", "code": "step_up_required", "action"}`; `session_key(request) -> str`; `issue(account, action, request, now=None) -> str`; `enforced(force=False) -> bool`; `require(request, action, *, force=False)`. Endpoints `POST /api/otp/step-up/send/` and `/verify/`.

- [ ] **Step 1: Write the failing test** — `backend/otp/tests/test_step_up.py`

```python
"""Step-up tokens before sensitive changes (otp plan Task 8). Review Focus 5 and 7."""
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwnerProfile
from otp import senders, step_up
from otp.models import OtpEvent, StepUpToken

from .helpers import last_sms_code, make_customer, make_owner

ON = override_settings(OTP_STEP_UP_ENFORCED=True)
PAYOUT = "/api/accounts/business-owners/me/payout/"
NEW_MOMO = {"default_payout_method": "momo", "payout_momo_network": "MTN", "payout_momo_number": "+233209990000", "payout_momo_name": "Kwame Mensah"}


def client_for(account, kind):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")
    return client


class StepUpBase(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.owner = make_owner()
        self.profile = BusinessOwnerProfile.objects.create(business_owner=self.owner, default_payout_method="momo", payout_momo_number="+233201112233")
        self.client = client_for(self.owner, "business_owner")

    def step_up(self, action=step_up.PAYOUT_DESTINATION, client=None):
        client = client or self.client
        sent = client.post("/api/otp/step-up/send/", {"action": action, "channel": "sms"}, format="json")
        self.assertEqual(sent.status_code, 200, sent.content)
        response = client.post("/api/otp/step-up/verify/", {"action": action, "code": last_sms_code()}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()["action"], response.json()["expires_in"]), (action, 300))
        return response.json()["step_up_token"]

    def patch_payout(self, token=None, body=NEW_MOMO):
        headers = {"HTTP_X_STEP_UP_TOKEN": token} if token else {}
        return self.client.patch(PAYOUT, body, format="json", **headers)


class SwitchedOffTests(StepUpBase):
    def test_sensitive_endpoints_work_exactly_as_before(self):
        # Review Focus 7.
        self.assertEqual(self.patch_payout().status_code, 200)
        customer = client_for(make_customer(), "customer")
        self.assertEqual(customer.post("/api/accounts/customers/me/secondary-email/", {"secondary_email": "backup@example.com"}, format="json").status_code, 200)
        self.assertEqual(customer.post("/api/accounts/customers/me/secondary-phone/", {"secondary_phone": "+233245550000"}, format="json").status_code, 200)


@ON
class StepUpTests(StepUpBase):
    def test_a_payout_change_without_a_code_is_refused_and_says_which_action(self):
        response = self.patch_payout()
        self.assertEqual(response.status_code, 403)
        self.assertEqual((response.json()["code"], response.json()["action"]), ("step_up_required", "payout_destination"))
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.payout_momo_number, "+233201112233")

    def test_a_code_unlocks_one_change_once(self):
        token = self.step_up()
        self.assertEqual(self.patch_payout(token).status_code, 200)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.payout_momo_number, "+233209990000")
        self.assertEqual(self.patch_payout(token).status_code, 403)
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.STEP_UP_USED).count(), 1)
        self.assertEqual(OtpEvent.objects.filter(kind=OtpEvent.STEP_UP_ISSUED).count(), 1)

    def test_a_token_for_another_action_is_refused(self):
        self.assertEqual(self.patch_payout(self.step_up(step_up.CONTACT_CHANGE)).status_code, 403)

    def test_a_token_works_only_with_the_access_token_it_was_issued_to(self):
        token = self.step_up()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")
        self.assertEqual(self.patch_payout(token).status_code, 403)

    def test_a_token_lasts_five_minutes(self):
        token = self.step_up()
        StepUpToken.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.patch_payout(token).status_code, 403)

    def test_a_refused_change_leaves_the_token_for_the_retry(self):
        token = self.step_up()
        self.assertEqual(self.patch_payout(token, {"default_payout_method": "bank", "payout_bank_account_number": ""}).status_code, 400)
        self.assertEqual(self.patch_payout(token).status_code, 200)

    def test_only_the_hash_is_kept(self):
        token = self.step_up()
        row = StepUpToken.objects.get()
        self.assertNotEqual(row.token_hash, token)
        self.assertEqual((row.action, row.account_type, row.account_id), ("payout_destination", "business_owner", self.owner.pk))

    def test_adding_a_recovery_contact_needs_its_own_code(self):
        client = client_for(make_customer(), "customer")
        url = "/api/accounts/customers/me/secondary-email/"
        self.assertEqual(client.post(url, {"secondary_email": "backup@example.com"}, format="json").status_code, 403)
        token = self.step_up(step_up.CONTACT_CHANGE, client=client)
        self.assertEqual(client.post(url, {"secondary_email": "backup@example.com"}, format="json", HTTP_X_STEP_UP_TOKEN=token).status_code, 200)
        phone_url = "/api/accounts/customers/me/secondary-phone/"
        self.assertEqual(client.post(phone_url, {"secondary_phone": "+233245550000"}, format="json", HTTP_X_STEP_UP_TOKEN=token).status_code, 403)

    def test_bad_requests(self):
        self.assertEqual(self.client.post("/api/otp/step-up/send/", {"action": "launch_rockets", "channel": "sms"}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/otp/step-up/send/", {"action": ["x"], "channel": "sms"}, format="json").status_code, 400)
        response = self.client.post("/api/otp/step-up/verify/", {"action": "payout_destination", "code": "123456"}, format="json")
        self.assertEqual(response.json()["code"], "code_expired")
        anonymous = APIClient()
        self.assertEqual(anonymous.post("/api/otp/step-up/send/", {"action": "payout_destination", "channel": "sms"}, format="json").status_code, 401)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p otp1 run --rm web python manage.py test otp.tests.test_step_up --noinput`
Expected: ERROR — `cannot import name 'step_up' from 'otp'`.

- [ ] **Step 3: Write `backend/otp/step_up.py`**

```python
"""Step-up tokens (spec §9). Before a sensitive change the signed-in person proves it is them with a code and gets
a single-use token for that one action, alive 5 minutes and bound to the access token it was issued to (its jti).
The client sends it once in the X-Step-Up-Token header. A view calls require(request, ACTION) INSIDE the
transaction.atomic() block that makes the change: the token is spent only if the change commits, so a change
refused by validation leaves it usable for the retry.

While settings.OTP_STEP_UP_ENFORCED is off, require() does nothing; force=True (the authenticator settings, which
exist only while sign-in codes are on) asks for it anyway."""
import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone
from rest_framework import exceptions

from . import audit, flags
from .identity import ref
from .models import STEP_UP, OtpEvent, StepUpToken

PAYOUT_DESTINATION = "payout_destination"
CONTACT_CHANGE = "contact_change"
AUTHENTICATOR_CHANGE = "authenticator_change"
PASSWORD_CHANGE = "password_change"
WITHDRAWAL = "withdrawal"
ACTIONS = {
    PAYOUT_DESTINATION: "Change where your money is paid",
    CONTACT_CHANGE: "Add or change a phone number or email",
    AUTHENTICATOR_CHANGE: "Turn the authenticator app on or off",
    PASSWORD_CHANGE: "Change your password",
    WITHDRAWAL: "Withdraw money",
}
TOKEN_TTL = timedelta(minutes=5)
HEADER = "HTTP_X_STEP_UP_TOKEN"
REQUIRED = "Confirm it's you with a code first."


class StepUpRequired(exceptions.PermissionDenied):
    """403 {"detail", "code": "step_up_required", "action"}: the frontend asks for a code, then retries with the
    X-Step-Up-Token header (the same pattern as sudo_required)."""

    def __init__(self, action):
        super().__init__({"detail": REQUIRED, "code": "step_up_required", "action": action})


def _hash(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def session_key(request):
    """The jti of the access token on this request ("" when there is none): what a step-up is bound to."""
    token = getattr(request, "auth", None)
    try:
        return str(token.get("jti", "")) if token is not None else ""
    except AttributeError:
        return ""


def issue(account, action, request, now=None):
    if action not in ACTIONS:
        raise ValueError(f"Unknown step-up action: {action}")
    now = now or timezone.now()
    account_type, account_id = ref(account)
    raw = secrets.token_urlsafe(32)
    StepUpToken.objects.create(
        account_type=account_type, account_id=account_id, action=action, token_hash=_hash(raw),
        jti=session_key(request), created_at=now, expires_at=now + TOKEN_TTL,
    )
    audit.log(OtpEvent.STEP_UP_ISSUED, account=account, purpose=STEP_UP, action=action, request=request, now=now)
    return raw


def enforced(force=False):
    return force or flags.step_up_enforced()


def require(request, action, *, force=False):
    """Spend this request's step-up token for `action`, or raise StepUpRequired. Call inside the atomic block that
    saves the change."""
    if action not in ACTIONS:
        raise ValueError(f"Unknown step-up action: {action}")
    if not enforced(force):
        return
    raw = request.META.get(HEADER, "")
    jti = session_key(request)
    if not raw or not jti:
        raise StepUpRequired(action)
    account_type, account_id = ref(request.user)
    now = timezone.now()
    spent = StepUpToken.objects.filter(
        token_hash=_hash(raw), account_type=account_type, account_id=account_id, action=action, jti=jti,
        used_at__isnull=True, expires_at__gt=now,
    ).update(used_at=now)
    if spent != 1:
        raise StepUpRequired(action)
    audit.log(OtpEvent.STEP_UP_USED, account=request.user, purpose=STEP_UP, action=action, request=request, now=now)
```

- [ ] **Step 4: Write `backend/otp/views_step_up.py`**

```python
"""Step-up codes for signed-in people (otp plan Task 8).

POST step-up/send/   {action, channel} -> {"channel", "hint", "expires_in", "resend_in"}
POST step-up/verify/ {action, code}    -> {"step_up_token", "action", "expires_in"}
The token goes once in the X-Step-Up-Token header of the change it was asked for (otp.step_up.require). The code
is bound to the access token's jti, like the token it buys."""
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import service, step_up
from .models import STEP_UP
from .service import OtpError
from .views import _body, _refused, _sent

UNKNOWN_ACTION = "Choose what you are confirming."


def _action(body):
    action = body.get("action")
    return action if isinstance(action, str) and action in step_up.ACTIONS else None


class StepUpSendView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "otp_send"
    activity_exempt = True

    def post(self, request):
        body = _body(request)
        action = _action(body)
        if action is None:
            return Response({"action": [UNKNOWN_ACTION]}, status=400)
        try:
            challenge = service.send(
                request.user, STEP_UP, body.get("channel"), action=action, ticket=step_up.session_key(request), request=request,
            )
        except OtpError as exc:
            return _refused(exc)
        return Response(_sent(challenge))


class StepUpVerifyView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "otp_verify"
    activity_exempt = True

    def post(self, request):
        body = _body(request)
        action = _action(body)
        if action is None:
            return Response({"action": [UNKNOWN_ACTION]}, status=400)
        try:
            service.verify(request.user, STEP_UP, body.get("code"), action=action, ticket=step_up.session_key(request), request=request)
        except OtpError as exc:
            return _refused(exc)
        return Response({
            "step_up_token": step_up.issue(request.user, action, request),
            "action": action,
            "expires_in": int(step_up.TOKEN_TTL.total_seconds()),
        })
```

- [ ] **Step 5: Replace `backend/otp/urls.py`**

```python
from django.urls import path

from . import views, views_step_up

urlpatterns = [
    path("sign-in/send/", views.SignInSendView.as_view(), name="otp-sign-in-send"),
    path("sign-in/verify/", views.SignInVerifyView.as_view(), name="otp-sign-in-verify"),
    path("step-up/send/", views_step_up.StepUpSendView.as_view(), name="otp-step-up-send"),
    path("step-up/verify/", views_step_up.StepUpVerifyView.as_view(), name="otp-step-up-verify"),
]
```

- [ ] **Step 6: Guard the sensitive endpoints** — four edits in `backend/accounts/views.py`.

(a) Imports — replace

```python
from otp import signin as otp_signin
```

with

```python
from otp import signin as otp_signin
from otp import step_up
```

(b) `PayoutDetailUpdateView` — replace

```python
    def get_object(self):
        return self.request.user.profile


class BusinessOwnerProfileUpdateView(generics.RetrieveUpdateAPIView):
```

with

```python
    def get_object(self):
        return self.request.user.profile

    def update(self, request, *args, **kwargs):
        # Where a business is paid is a sensitive change (spec §9): a step-up code first, spent only if it saves.
        with transaction.atomic():
            step_up.require(request, step_up.PAYOUT_DESTINATION)
            return super().update(request, *args, **kwargs)


class BusinessOwnerProfileUpdateView(generics.RetrieveUpdateAPIView):
```

(c) `CustomerSecondaryEmailRequestView.post` — replace

```python
        serializer = self.get_serializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        customer = serializer.save()
        send_verification_code_email(customer.secondary_email, customer.secondary_email_verify_code)
```

with

```python
        serializer = self.get_serializer(data=request.data, context={"request": request})
        with transaction.atomic():
            # A verified recovery email becomes a way to receive sign-in codes (otp.identity.contacts): a step-up
            # code first (spec §9), spent only if the change saves.
            step_up.require(request, step_up.CONTACT_CHANGE)
            serializer.is_valid(raise_exception=True)
            customer = serializer.save()
        send_verification_code_email(customer.secondary_email, customer.secondary_email_verify_code)
```

(d) `CustomerSecondaryPhoneRequestView.post` — replace

```python
        serializer.is_valid(raise_exception=True)
        customer = serializer.save()
        return Response({
            "secondary_phone": customer.secondary_phone,
            "demo_code": customer.secondary_phone_verify_code,
```

with

```python
        with transaction.atomic():
            step_up.require(request, step_up.CONTACT_CHANGE)
            serializer.is_valid(raise_exception=True)
            customer = serializer.save()
        return Response({
            "secondary_phone": customer.secondary_phone,
            "demo_code": customer.secondary_phone_verify_code,
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p otp1 run --rm web python manage.py test otp accounts.tests.test_payout_details accounts.tests.test_customer_secondary_contact_verification --noinput`
Expected: all PASS (10 new; the payout and secondary-contact suites unchanged).

- [ ] **Step 8: Commit**

```bash
git add backend/otp backend/accounts/views.py
git commit -m "feat(otp): single-use step-up tokens bound to action and session; payout and recovery-contact changes need one"
```

---

### Task 9: Authenticator app for customers and business owners

**Files:**
- Modify: `backend/otp/models.py`, `backend/otp/signin.py`, `backend/otp/views.py`, `backend/otp/urls.py`
- Create: `backend/otp/authenticator.py`, `backend/otp/views_authenticator.py`, `backend/otp/migrations/0002_accountauthenticator.py` (generated), `backend/otp/tests/test_authenticator.py`

**Interfaces:**
- Consumes: `accounts.two_factor` helpers `ISSUER`, `SecretUnreadable`, `_match_step`, `_hash_code`, `_new_recovery_codes`, `_normalise_code`, `encrypt_secret`, `decrypt_secret`, `_clock`; `otp.step_up.require`, `AUTHENTICATOR_CHANGE` (Task 8); `otp.service.is_locked`, `note_failure`, `TRY_LATER`, `OtpError` (Task 5); `otp.signin.make_ticket`, `AUTHENTICATOR_STAGE` (Task 6); `otp.views` helpers (Task 7).
- Produces: model `AccountAuthenticator(account_type, account_id, secret_encrypted, pending_secret_encrypted, confirmed_at, last_used_step, recovery_code_hashes, created_at)`; `otp.authenticator.KINDS`, `is_enabled(account) -> bool`, `begin(account) -> (secret, uri)`, `confirm(account, code, now=None) -> list | None`, `verify(account, code, now=None) -> bool`, `use_recovery_code(account, code) -> bool`, `regenerate_recovery_codes(account) -> list | None`, `disable(account) -> bool`, `status(account) -> {"enabled", "enabled_at", "recovery_codes_left"}`. `sign_in_step` answers `{"two_factor_required": true, "mfa_token"}` for an enabled authenticator; `POST /api/otp/sign-in/verify/` accepts an authenticator ticket with `code` or `recovery_code`. Endpoints under `/api/otp/authenticator/`.

- [ ] **Step 1: Write the failing test** — `backend/otp/tests/test_authenticator.py`

```python
"""Authenticator-app sign-in for customers and business owners (otp plan Task 9). Review Focus 2."""
import time
from unittest import mock

import pyotp
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.testing import staff_token
from accounts.two_factor import encrypt_secret
from otp import authenticator, devices, senders
from otp.models import AccountAuthenticator, OtpEvent

from .helpers import PASSWORD, last_sms_code, make_customer, make_owner, make_support, wrong_code

ON = override_settings(OTP_SIGNIN_ENFORCED=True)


class AuthenticatorBase(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.t0 = int(time.time())
        self.owner = make_owner()
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.owner, 'business_owner')}")

    def clock(self, offset=0):
        return mock.patch("accounts.two_factor._clock", return_value=self.t0 + offset)

    def step_up(self):
        self.client.post("/api/otp/step-up/send/", {"action": "authenticator_change", "channel": "sms"}, format="json")
        response = self.client.post("/api/otp/step-up/verify/", {"action": "authenticator_change", "code": last_sms_code()}, format="json")
        return response.json()["step_up_token"]

    def turn_on(self):
        """Enrol through the API; returns (secret, recovery codes)."""
        secret = self.client.post("/api/otp/authenticator/setup/", HTTP_X_STEP_UP_TOKEN=self.step_up()).json()["secret"]
        with self.clock():
            response = self.client.post("/api/otp/authenticator/setup/confirm/", {"code": pyotp.TOTP(secret).at(self.t0)}, format="json")
        return secret, response.json()["recovery_codes"]

    def password_step(self):
        return APIClient().post("/api/accounts/business-owners/login/", {"identifier": "+233201112233", "password": PASSWORD}, format="json").json()

    def finish(self, mfa_token, **body):
        return APIClient().post("/api/otp/sign-in/verify/", {"mfa_token": mfa_token, **body}, format="json")


class SetupTests(AuthenticatorBase):
    def test_it_is_not_offered_while_sign_in_codes_are_off(self):
        response = self.client.post("/api/otp/authenticator/setup/")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "otp_off"))
        self.assertFalse(self.client.get("/api/otp/authenticator/").json()["available"])

    @ON
    def test_setting_it_up_needs_a_step_up_code_even_with_step_up_switched_off(self):
        response = self.client.post("/api/otp/authenticator/setup/")
        self.assertEqual((response.status_code, response.json()["code"]), (403, "step_up_required"))

    @ON
    def test_turning_it_on_gives_ten_recovery_codes_and_keeps_the_secret_encrypted(self):
        secret, codes = self.turn_on()
        self.assertEqual(len(codes), 10)
        self.assertNotIn(secret, AccountAuthenticator.objects.get().secret_encrypted)
        self.assertTrue(authenticator.is_enabled(self.owner))
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.AUTHENTICATOR_ON).exists())
        self.assertTrue(self.client.get("/api/otp/authenticator/").json()["enabled"])

    @ON
    def test_a_wrong_first_code_turns_nothing_on(self):
        secret = self.client.post("/api/otp/authenticator/setup/", HTTP_X_STEP_UP_TOKEN=self.step_up()).json()["secret"]
        with self.clock():
            response = self.client.post("/api/otp/authenticator/setup/confirm/", {"code": wrong_code(pyotp.TOTP(secret).at(self.t0))}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(authenticator.is_enabled(self.owner))

    def test_staff_use_their_own_endpoints(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_support())}")
        self.assertEqual(client.get("/api/otp/authenticator/").status_code, 403)


@ON
class SignInTests(AuthenticatorBase):
    def test_it_replaces_the_code_at_sign_in(self):
        secret, _ = self.turn_on()
        body = self.password_step()
        self.assertEqual(set(body), {"two_factor_required", "mfa_token"})
        with self.clock(30):
            response = self.finish(body["mfa_token"], code=pyotp.TOTP(secret).at(self.t0 + 30))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn("token", response.json())

    def test_no_authenticator_code_works_twice(self):
        secret, _ = self.turn_on()
        code = pyotp.TOTP(secret).at(self.t0 + 30)
        with self.clock(30):
            self.assertEqual(self.finish(self.password_step()["mfa_token"], code=code).status_code, 200)
            self.assertEqual(self.finish(self.password_step()["mfa_token"], code=code).status_code, 400)

    def test_a_recovery_code_works_once(self):
        _, codes = self.turn_on()
        self.assertEqual(self.finish(self.password_step()["mfa_token"], recovery_code=codes[0]).status_code, 200)
        self.assertEqual(self.finish(self.password_step()["mfa_token"], recovery_code=codes[0]).status_code, 400)

    def test_five_wrong_codes_lock_it(self):
        secret, _ = self.turn_on()
        ticket = self.password_step()["mfa_token"]
        with self.clock(30):
            right = pyotp.TOTP(secret).at(self.t0 + 30)
            for _ in range(5):
                self.assertEqual(self.finish(ticket, code=wrong_code(right)).json()["code"], "wrong_code")
            response = self.finish(ticket, code=right)
        self.assertEqual((response.status_code, response.json()["code"]), (429, "try_later"))

    def test_a_trusted_customer_device_still_skips_the_second_step(self):
        customer = make_customer()
        AccountAuthenticator.objects.create(
            account_type="customer", account_id=customer.pk, secret_encrypted=encrypt_secret(pyotp.random_base32()), confirmed_at=timezone.now(),
        )
        raw = devices.trust(customer, None)
        body = APIClient().post("/api/accounts/customers/login/", {"identifier": "+233241234567", "password": PASSWORD, "device_token": raw}, format="json").json()
        self.assertIn("token", body)

    def test_an_authenticator_ticket_cannot_ask_for_a_text(self):
        self.turn_on()
        ticket = self.password_step()["mfa_token"]
        response = APIClient().post("/api/otp/sign-in/send/", {"mfa_token": ticket, "channel": "sms"}, format="json")
        self.assertEqual(response.json()["code"], "challenge_expired")


@ON
class ManageTests(AuthenticatorBase):
    def test_turning_it_off_needs_a_code_and_brings_back_the_text_code(self):
        self.turn_on()
        self.assertEqual(self.client.post("/api/otp/authenticator/disable/").status_code, 403)
        self.assertEqual(self.client.post("/api/otp/authenticator/disable/", HTTP_X_STEP_UP_TOKEN=self.step_up()).status_code, 204)
        self.assertFalse(authenticator.is_enabled(self.owner))
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.AUTHENTICATOR_OFF).exists())
        self.assertIn("otp_required", self.password_step())

    def test_new_recovery_codes_need_a_code_and_replace_the_old(self):
        _, old = self.turn_on()
        new = self.client.post("/api/otp/authenticator/recovery-codes/", HTTP_X_STEP_UP_TOKEN=self.step_up()).json()["recovery_codes"]
        self.assertEqual(len(new), 10)
        self.assertEqual(self.finish(self.password_step()["mfa_token"], recovery_code=old[0]).status_code, 400)
        self.assertEqual(self.finish(self.password_step()["mfa_token"], recovery_code=new[0]).status_code, 200)

    def test_nothing_to_turn_off_spends_no_code(self):
        self.assertEqual(self.client.post("/api/otp/authenticator/disable/").status_code, 400)
        self.assertEqual(self.client.post("/api/otp/authenticator/recovery-codes/").status_code, 400)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p otp1 run --rm web python manage.py test otp.tests.test_authenticator --noinput`
Expected: ERROR — `cannot import name 'authenticator' from 'otp'`.

- [ ] **Step 3: The model** — append to `backend/otp/models.py`:

```python


class AccountAuthenticator(models.Model):
    """An authenticator app (TOTP) for a customer or a business owner (spec §9: optional for anyone). Staff keep
    accounts.StaffTwoFactor. Same storage as the staff one: the secret Fernet-encrypted with STAFF_SECRETS_KEY, a
    pending secret until its first code, the last 30-second step used (no code works twice) and HMAC-hashed
    single-use recovery codes."""

    account_type = models.CharField(max_length=20, choices=[("customer", "Customer"), ("business_owner", "Business owner")])
    account_id = models.PositiveIntegerField()
    secret_encrypted = models.TextField(blank=True, default="")
    pending_secret_encrypted = models.TextField(blank=True, default="")
    confirmed_at = models.DateTimeField(null=True, blank=True)
    last_used_step = models.BigIntegerField(default=0)
    recovery_code_hashes = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["account_type", "account_id"], name="otp_one_authenticator_per_account"),
        ]

    def __str__(self):
        return f"Authenticator for {self.account_type} {self.account_id}"
```

Run: `docker compose -p otp1 run --rm web python manage.py makemigrations otp`
Expected: `otp/migrations/0002_accountauthenticator.py` — `Create model AccountAuthenticator`.

- [ ] **Step 4: Write `backend/otp/authenticator.py`**

```python
"""Authenticator-app sign-in for customers and business owners (spec §9). Optional; once confirmed it replaces the
texted/emailed code whenever a sign-in code would be asked (otp.signin.sign_in_step). Reuses the staff module's
TOTP and recovery-code helpers (accounts.two_factor), so both behave the same: ±1 step of clock drift, no code
works twice, recovery codes shown once and kept hashed."""
import logging

import pyotp
from cryptography.fernet import InvalidToken
from django.db import transaction
from django.utils import timezone

from accounts.two_factor import (  # shared helpers; accounts.two_factor stays the staff module
    ISSUER,
    SecretUnreadable,
    _hash_code,
    _match_step,
    _new_recovery_codes,
    _normalise_code,
    decrypt_secret,
    encrypt_secret,
)

from .identity import BUSINESS_OWNER, CUSTOMER, contacts, ref
from .models import EMAIL, SMS, AccountAuthenticator

logger = logging.getLogger(__name__)

KINDS = (CUSTOMER, BUSINESS_OWNER)


def _rows(account):
    account_type, account_id = ref(account)
    return AccountAuthenticator.objects.filter(account_type=account_type, account_id=account_id)


def _open(account, token):
    try:
        return decrypt_secret(token)
    except InvalidToken as exc:
        logger.critical("An authenticator secret for %s %s cannot be decrypted; did STAFF_SECRETS_KEY change?", *ref(account))
        raise SecretUnreadable from exc


def is_enabled(account):
    if ref(account)[0] not in KINDS:
        return False
    row = _rows(account).first()
    return bool(row and row.confirmed_at and row.secret_encrypted)


def _label(account):
    found = contacts(account)
    return found.get(EMAIL) or found.get(SMS) or "AshantiHub account"


def begin(account):
    """A fresh secret waiting for its first code. One already confirmed keeps working until the new one is."""
    secret = pyotp.random_base32()
    account_type, account_id = ref(account)
    row, _ = AccountAuthenticator.objects.get_or_create(account_type=account_type, account_id=account_id)
    row.pending_secret_encrypted = encrypt_secret(secret)
    row.save(update_fields=["pending_secret_encrypted"])
    return secret, pyotp.TOTP(secret).provisioning_uri(name=_label(account), issuer_name=ISSUER)


def confirm(account, code, now=None):
    """Switch the pending secret on if `code` matches it. Returns 10 new recovery codes (shown once), or None."""
    with transaction.atomic():
        row = _rows(account).select_for_update().first()
        if row is None or not row.pending_secret_encrypted:
            return None
        step = _match_step(_open(account, row.pending_secret_encrypted), code, 0, now)
        if step is None:
            return None
        codes = _new_recovery_codes()
        row.secret_encrypted = row.pending_secret_encrypted
        row.pending_secret_encrypted = ""
        row.confirmed_at = timezone.now()
        row.last_used_step = step
        row.recovery_code_hashes = [_hash_code(_normalise_code(c)) for c in codes]
        row.save()
    return codes


def verify(account, code, now=None):
    with transaction.atomic():
        row = _rows(account).select_for_update().first()
        if row is None or not row.confirmed_at or not row.secret_encrypted:
            return False
        step = _match_step(_open(account, row.secret_encrypted), code, row.last_used_step, now)
        if step is None:
            return False
        row.last_used_step = step
        row.save(update_fields=["last_used_step"])
    return True


def use_recovery_code(account, code):
    normalised = _normalise_code(code) if isinstance(code, str) else ""
    if not normalised:
        return False
    with transaction.atomic():
        row = _rows(account).select_for_update().first()
        hashed = _hash_code(normalised)
        if row is None or not row.confirmed_at or hashed not in row.recovery_code_hashes:
            return False
        row.recovery_code_hashes = [h for h in row.recovery_code_hashes if h != hashed]
        row.save(update_fields=["recovery_code_hashes"])
    return True


def regenerate_recovery_codes(account):
    if not is_enabled(account):
        return None
    codes = _new_recovery_codes()
    _rows(account).update(recovery_code_hashes=[_hash_code(_normalise_code(c)) for c in codes])
    return codes


def disable(account):
    """Remove it (and any pending secret). True when there was one."""
    deleted, _ = _rows(account).delete()
    return bool(deleted)


def status(account):
    row = _rows(account).first()
    enabled = bool(row and row.confirmed_at and row.secret_encrypted)
    return {
        "enabled": enabled,
        "enabled_at": row.confirmed_at if enabled else None,
        "recovery_codes_left": len(row.recovery_code_hashes) if enabled else 0,
    }
```

- [ ] **Step 5: The sign-in decision** — in `backend/otp/signin.py`:

(a) Replace

```python
from . import devices, flags
```

with

```python
from . import authenticator, devices, flags
```

(b) Replace

```python
    if kind == CUSTOMER and devices.is_trusted(account, device_token):
        return None
    return code_challenge(account, SIGN_IN)
```

with

```python
    if kind == CUSTOMER and devices.is_trusted(account, device_token):
        return None
    if kind != STAFF and authenticator.is_enabled(account):
        # The authenticator app replaces the texted or emailed code (spec §9). Staff use accounts.two_factor.
        return {"two_factor_required": True, "mfa_token": make_ticket(account, AUTHENTICATOR_STAGE, SIGN_IN)}
    return code_challenge(account, SIGN_IN)
```

- [ ] **Step 6: The verify endpoint takes authenticator tickets** — in `backend/otp/views.py`:

(a) Replace

```python
from staffsecurity import signin as signin_log
```

with

```python
from accounts.two_factor import SecretUnreadable
from staffsecurity import signin as signin_log
```

(b) Replace

```python
from . import devices, service, signin
from .identity import CUSTOMER, STAFF, hint
from .service import OtpError
```

with

```python
from . import audit, authenticator, devices, service, signin
from .identity import CUSTOMER, STAFF, hint
from .models import AUTHENTICATOR, SIGN_IN, OtpEvent
from .service import OtpError

UNREADABLE = "Your authenticator app can't be checked right now. Ask AshantiHub Support to help you sign in."
WRONG_AUTHENTICATOR = "That code isn't right. Check your authenticator app and try again."
```

(c) Replace

```python
class SignInSendView(APIView):
```

with

```python
def _check_authenticator(account, body, request):
    """None when the authenticator code (or a recovery code) is right, else the refusal to answer. Wrong codes count
    towards the same 15-minute lock as texted ones."""
    if service.is_locked(account):
        return _refused(OtpError(service.TRY_LATER, "try_later", status_code=429))
    recovery = _text(body.get("recovery_code"))
    try:
        if recovery:
            ok = authenticator.use_recovery_code(account, recovery)
        else:
            ok = authenticator.verify(account, _text(body.get("code")) or "")
    except SecretUnreadable:
        return Response({"detail": UNREADABLE, "code": "authenticator_unreadable"}, status=400)
    if not ok:
        service.note_failure(account, purpose=SIGN_IN, channel=AUTHENTICATOR, request=request)
        return _refused(OtpError(WRONG_AUTHENTICATOR, "wrong_code"))
    audit.log(OtpEvent.VERIFIED, account=account, purpose=SIGN_IN, channel=AUTHENTICATOR,
              note="recovery code" if recovery else "", request=request)
    return None


class SignInSendView(APIView):
```

(d) In `SignInVerifyView.post` replace

```python
        ticket = signin.read_ticket(body.get("mfa_token"), signin.CODE_STAGE)
        if ticket is None:
            return _expired()
        refused = _check_code(ticket, body, request)
```

with

```python
        ticket = signin.read_ticket(body.get("mfa_token"))
        if ticket is None:
            return _expired()
        if ticket.stage == signin.AUTHENTICATOR_STAGE:
            refused = _check_authenticator(ticket.account, body, request)
        else:
            refused = _check_code(ticket, body, request)
```

- [ ] **Step 7: Write `backend/otp/views_authenticator.py`**

```python
"""Authenticator-app settings for customers and business owners (otp plan Task 9). Staff keep
/api/accounts/staff/two-factor/…. Setting it up is offered only while OTP_SIGNIN_ENFORCED is on (it replaces the
sign-in code, which exists only then); setting it up, turning it off and renewing recovery codes always need a
step-up code, whatever OTP_STEP_UP_ENFORCED says.

GET  authenticator/                  -> {"enabled", "enabled_at", "recovery_codes_left", "available"}
POST authenticator/setup/            (X-Step-Up-Token) -> {"secret", "otpauth_uri"}
POST authenticator/setup/confirm/    {code} -> {"recovery_codes"}
POST authenticator/recovery-codes/   (X-Step-Up-Token) -> {"recovery_codes"}
POST authenticator/disable/          (X-Step-Up-Token) -> 204"""
from django.db import transaction
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer
from accounts.two_factor import SecretUnreadable

from . import audit, authenticator, flags, step_up
from .models import AUTHENTICATOR, OtpEvent
from .views import UNREADABLE, _body, _text

OFF = "The authenticator app can be used once sign-in codes are switched on."
NOT_ON = "The authenticator app isn't on."
WRONG_FIRST = "That code isn't right. Check the app shows AshantiHub and try again."


class IsCustomerOrOwner(BasePermission):
    def has_permission(self, request, view):
        return isinstance(request.user, (Customer, BusinessOwner))


def _off():
    return Response({"detail": OFF, "code": "otp_off"}, status=409)


class AuthenticatorView(APIView):
    permission_classes = [IsCustomerOrOwner]

    def get(self, request):
        return Response({**authenticator.status(request.user), "available": flags.sign_in_enforced()})


class AuthenticatorSetupView(APIView):
    """A new secret to scan. One already on keeps working until the new one is confirmed."""

    permission_classes = [IsCustomerOrOwner]
    throttle_scope = "two_factor"
    activity_exempt = True

    def post(self, request):
        if not flags.sign_in_enforced():
            return _off()
        with transaction.atomic():
            step_up.require(request, step_up.AUTHENTICATOR_CHANGE, force=True)
            secret, uri = authenticator.begin(request.user)
        return Response({"secret": secret, "otpauth_uri": uri})


class AuthenticatorConfirmView(APIView):
    """The app's first code switches it on; answers ten recovery codes, shown once."""

    permission_classes = [IsCustomerOrOwner]
    throttle_scope = "two_factor"
    activity_exempt = True

    def post(self, request):
        if not flags.sign_in_enforced():
            return _off()
        try:
            codes = authenticator.confirm(request.user, _text(_body(request).get("code")) or "")
        except SecretUnreadable:
            return Response({"detail": UNREADABLE}, status=400)
        if codes is None:
            return Response({"detail": WRONG_FIRST, "code": "wrong_code"}, status=400)
        audit.log(OtpEvent.AUTHENTICATOR_ON, account=request.user, channel=AUTHENTICATOR, request=request)
        return Response({"recovery_codes": codes})


class AuthenticatorRecoveryCodesView(APIView):
    permission_classes = [IsCustomerOrOwner]
    throttle_scope = "two_factor"
    activity_exempt = True

    def post(self, request):
        if not authenticator.is_enabled(request.user):
            return Response({"detail": NOT_ON}, status=400)
        with transaction.atomic():
            step_up.require(request, step_up.AUTHENTICATOR_CHANGE, force=True)
            codes = authenticator.regenerate_recovery_codes(request.user)
        return Response({"recovery_codes": codes})


class AuthenticatorDisableView(APIView):
    permission_classes = [IsCustomerOrOwner]
    throttle_scope = "two_factor"
    activity_exempt = True

    def post(self, request):
        if not authenticator.is_enabled(request.user):
            return Response({"detail": NOT_ON}, status=400)
        with transaction.atomic():
            step_up.require(request, step_up.AUTHENTICATOR_CHANGE, force=True)
            authenticator.disable(request.user)
            audit.log(OtpEvent.AUTHENTICATOR_OFF, account=request.user, channel=AUTHENTICATOR, request=request)
        return Response(status=204)
```

- [ ] **Step 8: Replace `backend/otp/urls.py`**

```python
from django.urls import path

from . import views, views_authenticator, views_step_up

urlpatterns = [
    path("sign-in/send/", views.SignInSendView.as_view(), name="otp-sign-in-send"),
    path("sign-in/verify/", views.SignInVerifyView.as_view(), name="otp-sign-in-verify"),
    path("step-up/send/", views_step_up.StepUpSendView.as_view(), name="otp-step-up-send"),
    path("step-up/verify/", views_step_up.StepUpVerifyView.as_view(), name="otp-step-up-verify"),
    path("authenticator/", views_authenticator.AuthenticatorView.as_view(), name="otp-authenticator"),
    path("authenticator/setup/", views_authenticator.AuthenticatorSetupView.as_view(), name="otp-authenticator-setup"),
    path("authenticator/setup/confirm/", views_authenticator.AuthenticatorConfirmView.as_view(), name="otp-authenticator-confirm"),
    path("authenticator/recovery-codes/", views_authenticator.AuthenticatorRecoveryCodesView.as_view(), name="otp-authenticator-recovery-codes"),
    path("authenticator/disable/", views_authenticator.AuthenticatorDisableView.as_view(), name="otp-authenticator-disable"),
]
```

- [ ] **Step 9: Run the tests**

Run: `docker compose -p otp1 run --rm web python manage.py test otp accounts.tests.test_two_factor --noinput`
Expected: all PASS (14 new; earlier otp tests and the staff 2-step suite unchanged).

- [ ] **Step 10: Commit**

```bash
git add backend/otp
git commit -m "feat(otp): optional authenticator app for customers and vendors, replacing the sign-in code"
```

---

### Task 10: Account security overview, device removal and nightly clean-up

**Files:**
- Create: `backend/otp/views_account.py`, `backend/otp/retention.py`, `backend/otp/tasks.py`, `backend/otp/tests/test_account.py`
- Modify: `backend/otp/urls.py`, `backend/ashantihub/settings.py` (`CELERY_BEAT_SCHEDULE`)

**Interfaces:**
- Consumes: `otp.devices.live`, `revoke_all` (Task 6); `otp.authenticator.status` (Task 9); `otp.identity` (Task 3); `otp.flags` (Task 1); `staffsecurity.policy.otp_customer_gap_days` (Task 2); `otp.audit.log`.
- Produces: `GET /api/otp/me/`, `POST /api/otp/devices/<int:pk>/remove/`, `POST /api/otp/devices/remove-all/`; `otp.retention.purge(now=None) -> {"challenges", "step_up_tokens", "devices", "events"}`; Celery task `otp.tasks.purge_old_otp_rows` scheduled nightly at 03:55.

- [ ] **Step 1: Write the failing test** — `backend/otp/tests/test_account.py`

```python
"""The account security overview, removing trusted devices and the nightly clean-up (otp plan Task 10)."""
import hashlib
from datetime import timedelta

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.testing import staff_token
from otp import devices
from otp.models import SMS, OtpChallenge, OtpEvent, StepUpToken, TrustedDevice, VerifiedContact
from otp.tasks import purge_old_otp_rows

from .helpers import make_customer, make_support


class AccountBase(TestCase):
    def setUp(self):
        cache.clear()
        self.customer = make_customer()
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")

    def other_customer(self):
        return make_customer(phone="+233249999999", email="yaw@example.com")


class OverviewTests(AccountBase):
    def test_it_shows_the_ways_a_code_can_come_and_which_are_verified(self):
        VerifiedContact.objects.create(account_type="customer", account_id=self.customer.pk, channel=SMS, destination="+233241234567")
        body = self.client.get("/api/otp/me/").json()
        self.assertEqual(body["channels"], [
            {"channel": "sms", "hint": "024 *** 4567", "verified": True},
            {"channel": "email", "hint": "am•••@example.com", "verified": False},
        ])
        self.assertEqual(body["authenticator"], {"enabled": False, "enabled_at": None, "recovery_codes_left": 0})
        self.assertEqual(body["switches"], {"sign_in": False, "step_up": False, "sign_up": False})
        self.assertEqual(body["customer_gap_days"], 30)

    def test_it_lists_only_live_devices_of_this_account(self):
        devices.trust(self.customer, None)
        old = devices.trust(self.customer, None)
        TrustedDevice.objects.filter(token_hash=hashlib.sha256(old.encode()).hexdigest()).update(verified_at=timezone.now() - timedelta(days=31))
        devices.trust(self.other_customer(), None)
        rows = self.client.get("/api/otp/me/").json()["trusted_devices"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(set(rows[0]), {"id", "label", "trusted_since", "last_code_at", "last_seen_at"})

    def test_staff_see_no_customer_authenticator(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_support())}")
        body = self.client.get("/api/otp/me/").json()
        self.assertIsNone(body["authenticator"])
        self.assertEqual(body["channels"], [{"channel": "email", "hint": "es•••@example.com", "verified": False}])

    def test_signed_out_is_401(self):
        self.assertEqual(APIClient().get("/api/otp/me/").status_code, 401)


class RemoveDeviceTests(AccountBase):
    def test_removing_one_of_your_own(self):
        devices.trust(self.customer, None)
        device = TrustedDevice.objects.get()
        self.assertEqual(self.client.post(f"/api/otp/devices/{device.pk}/remove/").status_code, 204)
        device.refresh_from_db()
        self.assertEqual(device.revoked_reason, TrustedDevice.REMOVED)
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.DEVICE_REVOKED).exists())

    def test_someone_elses_is_not_found(self):
        devices.trust(self.other_customer(), None)
        device = TrustedDevice.objects.get()
        self.assertEqual(self.client.post(f"/api/otp/devices/{device.pk}/remove/").status_code, 404)
        device.refresh_from_db()
        self.assertIsNone(device.revoked_at)

    def test_removing_all(self):
        devices.trust(self.customer, None)
        devices.trust(self.customer, None)
        self.assertEqual(self.client.post("/api/otp/devices/remove-all/").json(), {"removed": 2})
        self.assertEqual(devices.live(self.customer), [])


class RetentionTests(TestCase):
    def test_spent_rows_go_and_recent_ones_stay(self):
        now = timezone.now()
        long_ago = now - timedelta(days=2)
        challenge = {"account_type": "customer", "account_id": 1, "purpose": "sign_in", "channel": "sms",
                     "destination": "+233241234567", "salt": "s", "code_hash": "h"}
        OtpChallenge.objects.create(created_at=long_ago, last_sent_at=long_ago, expires_at=long_ago, **challenge)
        OtpChallenge.objects.create(created_at=now, last_sent_at=now, expires_at=now + timedelta(minutes=5), **challenge)
        token = {"account_type": "customer", "account_id": 1, "action": "payout_destination", "jti": "j"}
        StepUpToken.objects.create(token_hash="a" * 64, created_at=long_ago, expires_at=long_ago, **token)
        StepUpToken.objects.create(token_hash="b" * 64, created_at=now, expires_at=now + timedelta(minutes=5), **token)
        OtpEvent.objects.create(kind=OtpEvent.SENT, at=now - timedelta(days=401))
        OtpEvent.objects.create(kind=OtpEvent.SENT, at=now - timedelta(days=399))
        device = {"account_type": "customer", "account_id": 1, "password_fingerprint": "f"}
        TrustedDevice.objects.create(token_hash="c" * 64, revoked_at=now - timedelta(days=91), **device)
        TrustedDevice.objects.create(token_hash="d" * 64, revoked_at=now - timedelta(days=10), **device)
        TrustedDevice.objects.create(token_hash="e" * 64, **device)
        self.assertEqual(purge_old_otp_rows(), {"challenges": 1, "step_up_tokens": 1, "devices": 1, "events": 1})
        self.assertEqual((OtpChallenge.objects.count(), StepUpToken.objects.count(), OtpEvent.objects.count(), TrustedDevice.objects.count()), (1, 1, 1, 2))

    def test_it_is_a_scheduled_job(self):
        from core.jobs import scheduled_task_names

        self.assertIn("otp.tasks.purge_old_otp_rows", scheduled_task_names())
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p otp1 run --rm web python manage.py test otp.tests.test_account --noinput`
Expected: ERROR — `No module named 'otp.tasks'`.

- [ ] **Step 3: Write `backend/otp/views_account.py`**

```python
"""A signed-in person's own sign-in security (otp plan Task 10).

GET  me/                    -> {"channels": [{"channel", "hint", "verified"}], "authenticator" (null for staff),
                                "trusted_devices": [{"id", "label", "trusted_since", "last_code_at", "last_seen_at"}],
                                "switches": {"sign_in", "step_up", "sign_up"}, "customer_gap_days"}
POST devices/<id>/remove/   -> 204 (404 when it isn't yours or already ended)
POST devices/remove-all/    -> {"removed": n}"""
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from staffsecurity import policy

from . import audit, authenticator, devices, flags
from .identity import STAFF, contacts, hint, ref
from .models import OtpEvent, TrustedDevice, VerifiedContact


class SecurityOverviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        account = request.user
        account_type, account_id = ref(account)
        verified = set(
            VerifiedContact.objects.filter(account_type=account_type, account_id=account_id).values_list("channel", "destination")
        )
        return Response({
            "channels": [
                {"channel": channel, "hint": hint(channel, destination), "verified": (channel, destination) in verified}
                for channel, destination in contacts(account).items()
            ],
            "authenticator": None if account_type == STAFF else authenticator.status(account),
            "trusted_devices": [
                {"id": d.pk, "label": d.label, "trusted_since": d.created_at, "last_code_at": d.verified_at, "last_seen_at": d.last_seen_at}
                for d in devices.live(account)
            ],
            "switches": {"sign_in": flags.sign_in_enforced(), "step_up": flags.step_up_enforced(), "sign_up": flags.sign_up_enforced()},
            "customer_gap_days": policy.otp_customer_gap_days(),
        })


class TrustedDeviceRemoveView(APIView):
    permission_classes = [IsAuthenticated]
    activity_exempt = True

    def post(self, request, pk):
        account_type, account_id = ref(request.user)
        ended = TrustedDevice.objects.filter(
            pk=pk, account_type=account_type, account_id=account_id, revoked_at__isnull=True,
        ).update(revoked_at=timezone.now(), revoked_reason=TrustedDevice.REMOVED)
        if not ended:
            return Response({"detail": "Not found."}, status=404)
        audit.log(OtpEvent.DEVICE_REVOKED, account=request.user, note="1 device: removed", request=request)
        return Response(status=204)


class TrustedDeviceRemoveAllView(APIView):
    permission_classes = [IsAuthenticated]
    activity_exempt = True

    def post(self, request):
        return Response({"removed": devices.revoke_all(request.user, TrustedDevice.REMOVED_ALL, request=request)})
```

- [ ] **Step 4: Write `backend/otp/retention.py` and `backend/otp/tasks.py`**

`backend/otp/retention.py`:

```python
"""Nightly clean-up (otp.tasks.purge_old_otp_rows). Codes and step-up tokens are useless after minutes, so they
go after a day; ended trusted devices after 90 days; the audit trail after RETENTION_DAYS (the staff sign-in
history keeps the same 400)."""
from datetime import timedelta

from django.utils import timezone

from .models import OtpChallenge, OtpEvent, StepUpToken, TrustedDevice

SHORT_LIVED = timedelta(days=1)
ENDED_DEVICES = timedelta(days=90)
RETENTION_DAYS = 400


def purge(now=None):
    now = now or timezone.now()
    challenges, _ = OtpChallenge.objects.filter(created_at__lt=now - SHORT_LIVED).delete()
    tokens, _ = StepUpToken.objects.filter(created_at__lt=now - SHORT_LIVED).delete()
    ended, _ = TrustedDevice.objects.filter(revoked_at__lt=now - ENDED_DEVICES).delete()
    events, _ = OtpEvent.objects.filter(at__lt=now - timedelta(days=RETENTION_DAYS)).delete()
    return {"challenges": challenges, "step_up_tokens": tokens, "devices": ended, "events": events}
```

`backend/otp/tasks.py`:

```python
from celery import shared_task

from . import retention


@shared_task
def purge_old_otp_rows():
    """Nightly: drop spent codes and step-up tokens, long-ended trusted devices and old audit rows. The beat entry
    makes core.jobs keep a JobRun heartbeat for it."""
    return retention.purge()
```

- [ ] **Step 5: Schedule it** — in `backend/ashantihub/settings.py` replace

```python
    "delivery-purge-pings": {
        "task": "delivery.tasks.purge_old_pings",
        "schedule": crontab(hour=3, minute=50),
    },
}
```

with

```python
    "delivery-purge-pings": {
        "task": "delivery.tasks.purge_old_pings",
        "schedule": crontab(hour=3, minute=50),
    },
    "otp-purge-old-rows": {
        "task": "otp.tasks.purge_old_otp_rows",
        "schedule": crontab(hour=3, minute=55),
    },
}
```

- [ ] **Step 6: Replace `backend/otp/urls.py`**

```python
from django.urls import path

from . import views, views_account, views_authenticator, views_step_up

urlpatterns = [
    path("sign-in/send/", views.SignInSendView.as_view(), name="otp-sign-in-send"),
    path("sign-in/verify/", views.SignInVerifyView.as_view(), name="otp-sign-in-verify"),
    path("step-up/send/", views_step_up.StepUpSendView.as_view(), name="otp-step-up-send"),
    path("step-up/verify/", views_step_up.StepUpVerifyView.as_view(), name="otp-step-up-verify"),
    path("authenticator/", views_authenticator.AuthenticatorView.as_view(), name="otp-authenticator"),
    path("authenticator/setup/", views_authenticator.AuthenticatorSetupView.as_view(), name="otp-authenticator-setup"),
    path("authenticator/setup/confirm/", views_authenticator.AuthenticatorConfirmView.as_view(), name="otp-authenticator-confirm"),
    path("authenticator/recovery-codes/", views_authenticator.AuthenticatorRecoveryCodesView.as_view(), name="otp-authenticator-recovery-codes"),
    path("authenticator/disable/", views_authenticator.AuthenticatorDisableView.as_view(), name="otp-authenticator-disable"),
    path("me/", views_account.SecurityOverviewView.as_view(), name="otp-me"),
    path("devices/<int:pk>/remove/", views_account.TrustedDeviceRemoveView.as_view(), name="otp-device-remove"),
    path("devices/remove-all/", views_account.TrustedDeviceRemoveAllView.as_view(), name="otp-devices-remove-all"),
]
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p otp1 run --rm web python manage.py test otp core.tests.test_background_jobs --noinput`
Expected: all PASS (9 new; `test_every_scheduled_job_names_a_registered_task` passes with the new entry).

- [ ] **Step 8: Commit**

```bash
git add backend/otp backend/ashantihub/settings.py
git commit -m "feat(otp): security overview, trusted-device removal and nightly clean-up of spent codes"
```

---

### Task 11: Staff-assisted recovery (approval kind `otp.recovery`)

**Files:**
- Create: `backend/otp/approval_kinds.py`, `backend/otp/views_recovery.py`, `backend/accounts/migrations/0053_seed_otp_recovery_permission.py`, `backend/otp/tests/test_recovery.py`
- Modify: `backend/otp/apps.py`, `backend/otp/urls.py`, `backend/accounts/tests/test_authentication.py`, `backend/accounts/tests/test_login.py`, `backend/accounts/tests/test_roles_seed.py`, `backend/people/roles.py`, `docs/STAFF_ROLES.md`

**Interfaces:**
- Consumes: `otp.authenticator.disable`, `is_enabled` (Task 9); `otp.devices.revoke_all`, `live` (Task 6); `otp.audit.log` (Task 3); `otp.senders.send_sms` (Task 4); `otp.spend.check` (Task 4); `otp.service.is_locked` (Task 5, counts only failures after `RECOVERED`); `otp.identity` (Task 3); `approvals.services.submit`, `ApprovalError`; `accounts.emails.send_password_reset_email`; `accounts.serializers.PASSWORD_RESET_TOKEN_LIFETIME`.
- Produces: permission `otp.recovery` (Support, Super Admin); `otp.approval_kinds.KEY = "otp.recovery"`, `KINDS`, `AccountMissing(ApprovalError)` (404), `check_payload(payload) -> account`, `RECOVERY_KIND`; endpoint `POST /api/otp/recovery/`; activity verb `otp.recovered`.

- [ ] **Step 1: Write the failing test** — `backend/otp/tests/test_recovery.py`

```python
"""Staff-assisted recovery (otp.recovery approval kind, otp plan Task 11). Review Focus 8 (the reset token never
reaches the activity log)."""
import pyotp
from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, PasswordResetToken
from accounts.testing import make_staff, staff_token
from accounts.two_factor import encrypt_secret
from activity.models import ActivityEvent
from approvals import services as approvals
from approvals.models import ApprovalRequest
from otp import authenticator, devices, senders, service
from otp.models import AccountAuthenticator, OtpEvent, TrustedDevice

from .helpers import make_customer, make_owner

URL = "/api/otp/recovery/"


class RecoveryTests(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.support = make_staff("support", "esi@example.com")
        self.customer = make_customer()
        self.raw_device = devices.trust(self.customer, None)
        AccountAuthenticator.objects.create(
            account_type="customer", account_id=self.customer.pk,
            secret_encrypted=encrypt_secret(pyotp.random_base32()), confirmed_at=timezone.now(),
        )

    def as_staff(self, staff, sudo=False):
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def ask(self, **overrides):
        body = {
            "account_type": "customer", "account_id": self.customer.pk, "send_to": "email",
            "reason": "Called her back on the number on her orders; she confirmed her last order.",
        }
        body.update(overrides)
        return self.client.post(URL, body, format="json")

    def test_support_asks_and_nothing_changes_until_a_super_admin_approves(self):
        self.as_staff(self.support)
        response = self.ask()
        self.assertEqual(response.status_code, 201, response.content)
        approval = ApprovalRequest.objects.get(pk=response.json()["approval_id"])
        self.assertEqual((approval.kind, approval.status), ("otp.recovery", ApprovalRequest.PENDING))
        self.assertTrue(authenticator.is_enabled(self.customer))
        self.assertTrue(devices.is_trusted(self.customer, self.raw_device))

    def test_approving_clears_devices_authenticator_and_lock_and_emails_a_reset_link(self):
        for _ in range(5):
            OtpEvent.objects.create(kind=OtpEvent.FAILED, account_type="customer", account_id=self.customer.pk)
        self.assertTrue(service.is_locked(self.customer))
        self.as_staff(self.support)
        approval_id = self.ask().json()["approval_id"]
        with self.captureOnCommitCallbacks(execute=True):
            approvals.approve(approval_id, self.boss)
        self.assertFalse(authenticator.is_enabled(self.customer))
        self.assertFalse(devices.is_trusted(self.customer, self.raw_device))
        self.assertEqual(TrustedDevice.objects.get().revoked_reason, TrustedDevice.STAFF_RECOVERY)
        self.assertFalse(service.is_locked(self.customer))
        reset = PasswordResetToken.objects.get(account_type="customer", account_id=self.customer.pk)
        self.assertEqual(mail.outbox[-1].to, ["ama@example.com"])
        self.assertIn(reset.token, mail.outbox[-1].body)
        event = ActivityEvent.objects.get(verb="otp.recovered")
        self.assertEqual(event.actor_id, self.boss.pk)
        self.assertNotIn(reset.token, str(event.after))
        self.assertNotIn(reset.token, event.summary)

    def test_a_link_by_text_goes_to_the_phone(self):
        self.as_staff(self.support)
        approval_id = self.ask(send_to="sms").json()["approval_id"]
        with self.captureOnCommitCallbacks(execute=True):
            approvals.approve(approval_id, self.boss)
        reset = PasswordResetToken.objects.get()
        self.assertEqual(senders.sms_outbox[-1].to, "+233241234567")
        self.assertIn(reset.token, senders.sms_outbox[-1].body)
        self.assertTrue(OtpEvent.objects.filter(kind=OtpEvent.SENT, purpose="recovery").exists())

    def test_only_otp_recovery_holders_may_ask(self):
        self.as_staff(make_staff("operations", "ama@example.com"))
        self.assertEqual(self.ask().status_code, 403)

    def test_bad_requests_queue_nothing(self):
        self.as_staff(self.support)
        staff_target = make_staff("marketing", "abena@example.com")
        unclaimed = make_owner(registration_channel=BusinessOwner.SCOUT)
        for overrides in (
            {"reason": ""},
            {"account_type": "staff", "account_id": staff_target.pk},
            {"account_id": "1"},
            {"account_id": True},
            {"account_type": "business_owner", "account_id": unclaimed.pk},
            {"send_to": "whatsapp"},
            {"send_to": ["email"]},
        ):
            self.assertEqual(self.ask(**overrides).status_code, 400, overrides)
        self.assertEqual(self.ask(account_id=999999).status_code, 404)
        self.assertEqual(ApprovalRequest.objects.count(), 0)

    def test_a_contact_changed_since_the_request_makes_it_stale(self):
        self.as_staff(self.support)
        approval_id = self.ask().json()["approval_id"]
        self.customer.email = "new@example.com"
        self.customer.save(update_fields=["email"])
        with self.assertRaises(approvals.StaleRequest):
            approvals.approve(approval_id, self.boss)
        self.assertTrue(authenticator.is_enabled(self.customer))

    def test_a_super_admin_request_needs_the_password_and_applies_at_once(self):
        self.as_staff(self.boss)
        self.assertEqual(self.ask().json()["code"], "sudo_required")
        self.as_staff(self.boss, sudo=True)
        response = self.ask()
        self.assertEqual(response.json()["status"], ApprovalRequest.APPROVED)
        self.assertFalse(authenticator.is_enabled(self.customer))
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p otp1 run --rm web python manage.py test otp.tests.test_recovery --noinput`
Expected: FAIL — `POST /api/otp/recovery/` answers 404.

- [ ] **Step 3: Seed the permission** — `backend/accounts/migrations/0053_seed_otp_recovery_permission.py`

```python
from django.db import migrations

# Staff-assisted sign-in recovery (otp plan Task 11): Support asks, a Super Admin approves (approval kind otp.recovery).
PERMISSIONS = [("otp.recovery", "Ask for a customer's or business owner's sign-in to be recovered (a Super Admin approves)")]
GRANTS = {"support": ["otp.recovery"], "super_admin": ["otp.recovery"]}


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
    dependencies = [("accounts", "0052_seed_pickup_desk_role")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 4: Write `backend/otp/approval_kinds.py`**

```python
"""otp.recovery (otp plan Task 11). Support asks for a customer's or business owner's sign-in to be recovered when
they can receive a code neither by text nor by email and have no working authenticator app; a Super Admin approves
with the password re-entered (a Super Admin's own request applies at once). Applying ends every trusted device,
turns the authenticator app off, restarts the wrong-code count (an OtpEvent "recovered") and sends a one-hour
password-reset link to a contact the account already has - never to a new one: a contact changes only through the
existing staff edit. Staff sign-ins are not recovered here; a Super Admin resets their 2-step sign-in."""
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import get_random_string

from accounts.emails import send_password_reset_email
from accounts.models import BusinessOwner, PasswordResetToken
from accounts.serializers import PASSWORD_RESET_TOKEN_LIFETIME
from activity.services import record
from approvals.models import ApprovalRequest
from approvals.registry import ApprovalKind
from approvals.services import ApprovalError

from . import audit, authenticator, devices, senders, spend
from .identity import BUSINESS_OWNER, CUSTOMER, contacts, hint, load, ref
from .models import EMAIL, RECOVERY, SMS, OtpEvent, TrustedDevice

KEY = "otp.recovery"
KINDS = (CUSTOMER, BUSINESS_OWNER)
WAYS = {SMS: "text message", EMAIL: "email"}


class AccountMissing(ApprovalError):
    status_code = 404


def check_payload(payload):
    """The account a recovery request names, or ApprovalError saying what to fix."""
    payload = payload if isinstance(payload, dict) else {}
    if payload.get("account_type") not in KINDS:
        raise ApprovalError("Choose a customer or a business owner. A Super Admin resets a staff member's 2-step sign-in.")
    account_id = payload.get("account_id")
    if isinstance(account_id, bool) or not isinstance(account_id, int):
        raise ApprovalError("Choose a customer or a business owner.")
    account = load(payload["account_type"], account_id)
    if account is None:
        raise AccountMissing("We couldn't find that account.")
    if isinstance(account, BusinessOwner) and account.needs_claim:
        raise ApprovalError("This business owner hasn't set up their login yet. Send them a claim link instead.")
    if account.is_suspended:
        raise ApprovalError("This account is suspended, so its sign-in can't be recovered.")
    send_to = payload.get("send_to")
    if not isinstance(send_to, str) or send_to not in contacts(account):
        raise ApprovalError("Send the reset link to their phone or their email, whichever they still have.")
    return account


def current_state(request):
    """What the decision is made on. A contact that changes after the request makes it stale (409)."""
    try:
        account = check_payload(request.payload)
    except ApprovalError:
        return {"exists": False}
    return {"name": account.full_name, "contacts": {c: hint(c, d) for c, d in contacts(account).items()}}


def validate(request):
    check_payload(request.payload)


def _send_link(account, channel, destination, link):
    if channel == SMS:
        delivery = senders.send_sms(destination, f"AshantiHub Support reset your sign-in. Choose a new password within 1 hour: {link}")
        audit.log(OtpEvent.SENT if delivery.ok else OtpEvent.SEND_FAILED, account=account, purpose=RECOVERY,
                  channel=SMS, destination=destination, provider=delivery.provider)
        if delivery.ok:
            spend.check()
        return
    send_password_reset_email(destination, link)
    audit.log(OtpEvent.SENT, account=account, purpose=RECOVERY, channel=EMAIL, destination=destination, provider="email")


def apply(request):
    account = check_payload(request.payload)
    account_type, account_id = ref(account)
    channel = request.payload["send_to"]
    destination = contacts(account)[channel]
    decider = request.decided_by or request.maker
    had_authenticator = authenticator.disable(account)
    ended = devices.revoke_all(account, TrustedDevice.STAFF_RECOVERY)
    audit.log(OtpEvent.RECOVERED, account=account, purpose=RECOVERY, note=f"Approval {request.pk}")
    raw = get_random_string(43)
    PasswordResetToken.objects.create(
        account_type=account_type, account_id=account_id, token=raw, expires_at=timezone.now() + PASSWORD_RESET_TOKEN_LIFETIME,
    )
    link = f"{settings.FRONTEND_BASE_URL}/reset-password?token={raw}&type={account_type}"
    # After commit, so a decision that rolls back sends nothing.
    transaction.on_commit(lambda: _send_link(account, channel, destination, link), robust=True)
    # Last: record() holds the activity chain lock until commit. The link and its token never go in it.
    record(
        decider, "otp.recovered", target=account,
        summary=f"Sign-in recovered; a reset link goes by {WAYS[channel]} to {hint(channel, destination)}",
        after={"send_to": channel, "authenticator_removed": had_authenticator, "devices_ended": ended},
    )


def super_admin_only(request):
    return [(ApprovalRequest.SUPER_ADMIN, None)]


def diff(request):
    payload = request.payload or {}
    shown = ((request.before or {}).get("contacts") or {}).get(payload.get("send_to"), "")
    way = WAYS.get(payload.get("send_to"), "")
    return [{"field": "Sign-in", "before": "Can't receive a code", "after": f"Recovered: reset link by {way} to {shown}"}]


RECOVERY_KIND = ApprovalKind(
    key=KEY, label="Recover a sign-in", pool_permission="", current_state=current_state, apply=apply,
    response_hours=24, chain_note="Super Admin only", resolve_approver=super_admin_only, render_diff=diff,
    validate=validate, requires_sudo=True,
    consequences=lambda request: [
        "Ends every trusted device and turns their authenticator app off.",
        "Sends a one-hour password-reset link to the contact chosen. Nothing else about the account changes.",
    ],
)
```

- [ ] **Step 5: Register it** — replace `backend/otp/apps.py` with:

```python
from django.apps import AppConfig


class OtpConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "otp"
    verbose_name = "One-time codes"

    def ready(self):
        from approvals import registry

        from .approval_kinds import RECOVERY_KIND

        if registry.get_kind(RECOVERY_KIND.key) is None:
            registry.register(RECOVERY_KIND)
```

- [ ] **Step 6: Write `backend/otp/views_recovery.py`**

```python
"""POST recovery/ {account_type, account_id, send_to: "sms" | "email", reason} (otp plan Task 11): Support asks for
a customer's or business owner's sign-in to be recovered; a Super Admin decides it in the approvals inbox
(otp.recovery). A Super Admin's own request applies at once, so it needs the password re-entered.
Answers 201 {"approval_id", "status"}. Recorded by approvals.submit() (approval.requested / applied_directly)."""
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import sessions
from accounts.models import Role
from accounts.permissions import HasRolePermission
from approvals import services as approvals

from . import approval_kinds
from .views import _body, _text

NO_REASON = "Say how you confirmed it is really them."


class RecoveryRequestView(APIView):
    def get_permissions(self):
        return [HasRolePermission("otp.recovery")]

    def post(self, request):
        body = _body(request)
        reason = (_text(body.get("reason")) or "").strip()
        if not reason:
            return Response({"reason": [NO_REASON]}, status=400)
        payload = {"account_type": body.get("account_type"), "account_id": body.get("account_id"), "send_to": body.get("send_to")}
        try:
            account = approval_kinds.check_payload(payload)
            if request.user.role.name == Role.SUPER_ADMIN:
                sessions.require_sudo(request)
            approval = approvals.submit(
                request.user, approval_kinds.KEY, title=f"Recover the sign-in of {account.full_name}"[:200],
                payload=payload, target=account, maker_note=reason[:500], request=request,
            )
        except approvals.ApprovalError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        return Response({"approval_id": approval.pk, "status": approval.status}, status=201)
```

- [ ] **Step 7: Replace `backend/otp/urls.py`**

```python
from django.urls import path

from . import views, views_account, views_authenticator, views_recovery, views_step_up

urlpatterns = [
    path("sign-in/send/", views.SignInSendView.as_view(), name="otp-sign-in-send"),
    path("sign-in/verify/", views.SignInVerifyView.as_view(), name="otp-sign-in-verify"),
    path("step-up/send/", views_step_up.StepUpSendView.as_view(), name="otp-step-up-send"),
    path("step-up/verify/", views_step_up.StepUpVerifyView.as_view(), name="otp-step-up-verify"),
    path("authenticator/", views_authenticator.AuthenticatorView.as_view(), name="otp-authenticator"),
    path("authenticator/setup/", views_authenticator.AuthenticatorSetupView.as_view(), name="otp-authenticator-setup"),
    path("authenticator/setup/confirm/", views_authenticator.AuthenticatorConfirmView.as_view(), name="otp-authenticator-confirm"),
    path("authenticator/recovery-codes/", views_authenticator.AuthenticatorRecoveryCodesView.as_view(), name="otp-authenticator-recovery-codes"),
    path("authenticator/disable/", views_authenticator.AuthenticatorDisableView.as_view(), name="otp-authenticator-disable"),
    path("me/", views_account.SecurityOverviewView.as_view(), name="otp-me"),
    path("devices/<int:pk>/remove/", views_account.TrustedDeviceRemoveView.as_view(), name="otp-device-remove"),
    path("devices/remove-all/", views_account.TrustedDeviceRemoveAllView.as_view(), name="otp-devices-remove-all"),
    path("recovery/", views_recovery.RecoveryRequestView.as_view(), name="otp-recovery"),
]
```

- [ ] **Step 8: Keep the permission lists true**

(a) `backend/accounts/tests/test_authentication.py` **and** `backend/accounts/tests/test_login.py` — in each file replace

```python
                "fraud.flag", "orders.verify",
```

with

```python
                "fraud.flag", "orders.verify", "otp.recovery",
```

(b) `backend/accounts/tests/test_roles_seed.py` — replace

```python
    "support": {"messaging.manage", "disputes.flag", "users.view", "fraud.flag"},
```

with

```python
    "support": {"messaging.manage", "disputes.flag", "users.view", "fraud.flag", "otp.recovery"},
```

(c) `backend/people/roles.py` — in `GROUPS` replace

```python
    ("People and access", ("staff.", "leave.", "calendar.", "activity.", "roles.")),
```

with

```python
    ("People and access", ("staff.", "leave.", "calendar.", "activity.", "roles.", "otp.")),
```

(d) `docs/STAFF_ROLES.md` — replace

```markdown
| | `orders.verify` | Verify a delivered or collected product order by phone; a match releases the vendor's money, a mismatch raises a dispute | ✓ | | | | ✓ | | | | |
```

with

```markdown
| | `orders.verify` | Verify a delivered or collected product order by phone; a match releases the vendor's money, a mismatch raises a dispute | ✓ | | | | ✓ | | | | |
| | `otp.recovery` | Ask for a customer's or business owner's sign-in to be recovered (ends trusted devices and the authenticator, sends a reset link); a Super Admin approves | ✓ | | | | ✓ | | | | |
```

- [ ] **Step 9: Run the tests**

Run: `docker compose -p otp1 run --rm web python manage.py test otp accounts people approvals --noinput`
Expected: all PASS (7 new; `test_super_admin_has_every_permission`, the support permission lists and the people role matrix pass with `otp.recovery`).

- [ ] **Step 10: Commit**

```bash
git add backend/otp backend/accounts backend/people/roles.py docs/STAFF_ROLES.md
git commit -m "feat(otp): staff-assisted sign-in recovery as an otp.recovery approval (Support asks, Super Admin approves)"
```

---

### Task 12: Documentation and full verification

**Files:**
- Modify: `backend/CLAUDE.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md`

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Correctness core** — in `backend/CLAUDE.md`, replace

```markdown
- **Pickup Desk** is the `pickup_desk` staff role with the single permission `pickup.confirm` (store-pickup queue and
  collection); only a Super Admin invites it.
```

with

```markdown
- **Pickup Desk** is the `pickup_desk` staff role with the single permission `pickup.confirm` (store-pickup queue and
  collection); only a Super Admin invites it.
- **One-time codes (`otp/`).** One OTP service for every account kind: 6-digit codes kept only as a salted HMAC,
  5 minutes, 5 tries per code (a resend keeps the count), 60 s resend wait, hourly send limits per phone/email,
  account and IP counted from `OtpEvent` (so they hold across processes), and a 15-minute lock after 5 wrong codes
  (texted, emailed or authenticator) that answers the same `try_later` as a limit. Public endpoints take a signed
  `mfa_token` (nonce + password fingerprint), never an identifier; refusals are Responses, never raised - never call
  `otp.service.verify` inside an atomic block a refusal would roll back. Sensitive changes call
  `otp.step_up.require(request, ACTION)` **inside** the `transaction.atomic()` that saves (a refused change keeps
  the token); tokens are single-use, 5 minutes, bound to the action and the access token's `jti`
  (`X-Step-Up-Token`, `403 step_up_required`). A new sensitive endpoint (password change, withdrawal, payout
  destination) must call it. Trusted devices die with any password change (fingerprint) and are revoked on reset.
  Login and registration views ask `otp.signin.sign_in_step()`; staff authenticators (`accounts.two_factor`) are
  checked first. Three switches default off (`OTP_SIGNIN_ENFORCED`, `OTP_STEP_UP_ENFORCED`,
  `OTP_SIGNUP_VERIFICATION_ENFORCED`); turn the sign-in ones on only after the frontend (Plan 2F) ships and
  `OTP_SMS_PROVIDER=hubtel` really sends. Texts go through `otp.senders` only (`locmem` under tests: read
  `otp.senders.sms_outbox`). Codes and device/step-up tokens are never stored or logged in clear; add any new secret
  field to `ashantihub/sentry.py`.
```

- [ ] **Step 2: Spec status** — in `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` replace

```markdown
**Status:** Approved 2026-10-15. Stage 1 plan: docs/superpowers/plans/2026-10-15-ledger-fees-foundation.md.
```

with

```markdown
**Status:** Approved 2026-10-15. Stage 1 plan: docs/superpowers/plans/2026-10-15-ledger-fees-foundation.md. Stage 2 (OTP, backend) plan: docs/superpowers/plans/2026-10-16-otp-security.md.
```

- [ ] **Step 3: Stage index** — in `docs/IMPLEMENTATION_INSTRUCTIONS.md` replace

```markdown
| **2** OTP and security | One OTP service, step-up tokens, trusted devices, customer and vendor 2FA. Must precede any wallet going live. |
```

with

```markdown
| **2** OTP and security | One OTP service, step-up tokens, trusted devices, customer and vendor 2FA. Must precede any wallet going live. Backend: docs/superpowers/plans/2026-10-16-otp-security.md, behind three switches that default off; the screens are Plan 2F. |
```

- [ ] **Step 4: Run the whole backend suite**

Run: `docker compose -p otp1 run --rm web python manage.py test --noinput`
Expected: PASS. If a failure is unrelated to this work, confirm it on the base commit (`git stash push -u -m otp-verify`, re-run the failing label, `git stash apply` by SHA, drop it) and report it rather than fixing it here.

- [ ] **Step 5: Migrations check**

Run: `docker compose -p otp1 run --rm web python manage.py makemigrations --check --dry-run`
Expected: `No changes detected`.

- [ ] **Step 6: Commit**

```bash
git add backend/CLAUDE.md docs
git commit -m "docs(otp): correctness core, spec status, stage index"
```

---

## What this plan deliberately does not do (later plans)

| Plan | Scope | Why separate |
|---|---|---|
| **2F** Frontend | Code entry screen (channel chooser with hints, resend timer, "send by email instead"), trusted-device checkbox and keeping `device_token`, step-up prompt on `step_up_required` with one retry carrying `X-Step-Up-Token`, authenticator settings for customers and vendors, security overview and device list, Super Admin's two OTP numbers on the Security screen, Support's recovery request form, the `otp_sms_spend` notice. | Must ship before any switch is turned on; the current frontend expects a token from every login. |
| **Real SMS** | Hubtel SMS credentials, an Approved Sender ID, then `OTP_SMS_PROVIDER=hubtel`; check the client against a live account; a `core.integrations` card for OTP texts. | Needs credentials and network approval. |
| **3** Wallet | Step-up on withdrawals and wallet payout-destination changes (`step_up.WITHDRAWAL`, `PAYOUT_DESTINATION`), OTP-confirmed payout destinations and the cooling period (spec §8). | Those endpoints don't exist yet. |
| **2c** Hardening | Move the customer secondary-contact codes onto the OTP service (drop `demo_code`); authenticated change-password and change-primary-contact endpoints with step-up; a verify-first sign-up (code before the account row) so registration stops revealing taken phones/emails; a staff screen for the OTP audit trail. | Each changes an existing API or needs frontend work. |

## Self-review

**Spec coverage (§9, §1 row 10):**

| Requirement | Task(s) |
|---|---|
| One OTP service, SMS or email at the user's choice | 4 (delivery), 5 (service), 7 (channel chosen per challenge) |
| 6 digits, stored hashed, 5-minute expiry, limited attempts, resend cooldown | 5 |
| Rate limits per user, phone and IP | 5 (hourly, from `OtpEvent`), 1 (DRF burst scopes) |
| No account-existence leaks | 5 (one answer for lock and limits), 6 (challenge carries no id/name/contact), 7 (wrong password reads the same; endpoints take a ticket, never an identifier) |
| OTP at sign-up (verify contact) | 6 (`sign_in_step` sign-up branch), 7 (registration) |
| Step-up before sensitive actions, single-purpose, short-lived, bound to the action | 8 (payout, recovery contacts), 9 (authenticator changes); withdrawal and payout destinations of the wallet → Stage 3 |
| Every sign-in for staff and vendors | 6, 7 |
| Customers on a new device or after a gap (editable, default 30 days) | 2, 6, 7 |
| Authenticator optional for anyone, recovery codes, replaces the sign-in OTP | 9 (customers, vendors); staff already have it (`accounts.two_factor`), kept first in 7 |
| Trusted-device records | 6, 10 |
| Lockouts | 5 (+ 9 for authenticator codes) |
| Audit log of OTP events | 3, 5 (and every later task writes `OtpEvent`) |
| SMS-spend alert | 4 |
| Recovery via the other channel | 5 (channel switch on resend), 7 (API test) |
| Recovery via an approved staff-assisted request | 11 |
| Mandatory for everyone (row 10) | 6, 7 (behind `OTP_SIGNIN_ENFORCED` / `OTP_SIGNUP_VERIFICATION_ENFORCED`) |
| §11: OTP precedes any wallet | switches + Task 12 docs |

**Placeholder scan:** every code step carries complete code; every test step carries complete test code; no "TBD", "similar to", or undefined names. Edits to existing files quote the exact text replaced.

**Name consistency:** `service.send(account, purpose, channel, *, action="", ticket="", request=None, now=None)` and `service.verify(account, purpose, raw_code, *, action="", ticket="", request=None, now=None)` (Tasks 5, 7, 8); `signin.read_ticket(token, stage=None)`, `CODE_STAGE`, `AUTHENTICATOR_STAGE`, `sign_in_step(account, device_token="")`, `signed_in_body(account, request)`, `code_challenge(account, purpose)` (Tasks 6, 7, 9); `devices.trust(account, request, *, existing="", now=None)`, `revoke_all(account, reason, *, request=None, now=None)`, `live(account, now=None)` (Tasks 6, 10, 11); `step_up.require(request, action, *, force=False)` with the action constants (Tasks 8, 9); `audit.log(kind, *, account=None, …)` (all); `TrustedDevice.PASSWORD_RESET / REMOVED / REMOVED_ALL / STAFF_RECOVERY` (Tasks 6, 10, 11); `policy.otp_settings / otp_customer_gap_days / otp_sms_daily_alert / set_otp / clean_otp` (Tasks 2, 4, 6, 10); helpers `_body`, `_text`, `_truthy`, `_expired`, `_refused`, `_sent`, `UNREADABLE` in `otp.views` (Tasks 7, 8, 9, 11).

**Review Focus pins:** each of the eight lines above names the task and test that pins it; all of those tests are written out in their tasks.
