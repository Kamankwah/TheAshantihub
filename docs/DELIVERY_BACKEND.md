# Delivery backend: models and API (for the rider app and the Delivery Manager)

The `delivery` Django app (`backend/delivery/`) owns everything a rider and the Delivery Manager share.
`orders.DeliveryAssignment` stays in `orders` and carries the step stamps; `delivery.DeliveryEvent` holds the
place and distance of every step. A rider is a `StaffUser` with role `dispatch` plus one `delivery.Rider` row
(made automatically by `delivery/signals.py` when the account is saved, and by migration `delivery/0002` for
existing accounts). Routes are under `/api/delivery/`. Every URL name starts `delivery-`, which is the verb
the activity log and `realtime/publish.py` use.

Nothing here moves money. There is no payout, payroll, ledger or tax model, no cash-on-delivery order, no push,
no SMS and no road routing service; where a screen would need one it says so (`push: "not_connected"`,
`fee: null`, `cash_held: null`, `acceptance_30d: null`). Distances are straight-line estimates times
`services.ROAD_FACTOR` (1.3) and are labelled that way.

## Models

| Model | Purpose |
|---|---|
| `Rider` | One per Dispatch account: `vehicle_type`, `vehicle`, `home_zone`, `first_shift_date`, `invite_note`, `job_hold` (+reason), `suspension_source` (`""`, `manual`, `documents`). |
| `Vehicle`, `VehicleHandover` | Plate, type, owner (`rider`/`ashantihub`), registration/roadworthy/insurance expiry; every move is recorded. |
| `RiderDocument` | A paper (`ghana_card`, `licence`, `vehicle_reg`, `roadworthy`, `insurance` are required; `okada_licence` is optional, pending DVLA). Private file, `status` uploaded/approved/rejected/expired, `expires_on`, reviewer. The number leaves the server only as `•••• 1234`. |
| `DeliveryZone` | Delivery zone with an optional `boundary` (ring of `[lng, lat]`), `express_offered`. Separate from `listings.Zone` (scouts). `services.zone_of(lat, lng)` is point-in-polygon; `None` means "unzoned". |
| `ShiftSession` | A rider's actual time on shift (one open per rider), `on_break`, cached last fix (`last_lat/lng/accuracy_m/last_fix_at`). |
| `LocationPing` | One fix; kept 48 h (`delivery.tasks.purge_old_pings`). Never in the activity log. |
| `orders.DeliveryAssignment` | Status `assigned -> accepted -> at_pickup -> picked_up -> at_customer -> delivered -> confirmed`, or `failed`. Stamps `accepted_at`, `arrived_pickup_at`, `picked_up_at`, `arrived_drop_at`, `delivered_at`, `failed_at`; `deadline_at` (null until time limits exist); `assignment_mode` (`manual/auto/forced/offer`); `pickup_code`, `drop_code` and their wrong-try counters; flag decision fields; `rider_note`. `ACTIVE_STATUSES` = assigned..at_customer. |
| `DeliveryEvent` | Append-only step stamp: `step`, `at`, `lat`, `lng`, `accuracy_m`, `distance_m` from the stop (null if the stop has no coordinates), `flagged` (> 150 m). |
| `DeliveryPhoto`, `DeliveryCall`, `RiderIssue` | Photos (private), logged calls (rider to customer, manager to rider; no durations), issues reported by a rider. |

## Rules the rider app relies on

* **Codes.** Four digits each, made when a rider is assigned. The business reads the *pickup* code to the rider (shown to
  that business on `GET /api/orders/owner/` as `pickup_code`, only for the order's first business, only until pickup). The customer
  reads the *drop* code to the rider (`delivery_code` on the customer's order, only while the job is on the road). The rider
  never receives either. Five wrong tries lock that step (`423 code_locked`) and notify the rider's manager.
* **Location.** Every step needs `lat`/`lng` (`400 location_needed` otherwise). A tap more than 150 m from its stop still works and
  is flagged for the manager. Pickup stop = the first business's pin (profile pin, else the listing's); drop stop = `Order.delivery_lat/lng`.
* **Order of steps** is enforced (`409 wrong_step`). `Order.delivery_status` is kept in step (`DeliveryAssignment.sync_order`).
* **Shift.** Starting needs every required paper approved and in date (`409 papers_missing`, with `missing`) and a live account.
  A rider cannot go off shift with a job on the road (`409 job_in_progress`). A fix older than 120 s is **stale** (`services.STALE_AFTER`).
* **Can't deliver.** Needs the goods in hand. "No answer" also needs the 10-minute wait at the door to have passed and two logged calls.
  It opens a `Dispute` (delivery issue) and a task for the rider's manager, and puts the order back in the manager's queue.
* **Pings** are exempt from the activity log and throttled (`rider_ping`, 30/min). Suggested cadence: 15 s on a job, 60 s idle.
  Only while the shift screen is open (a web page cannot track in the background).

## Rider endpoints (permission `delivery.dispatch`; always the caller's own data, another rider's job is 404)

| Method and path | Body | Notes |
|---|---|---|
| `GET rider/me/` | | Profile, manager (name and phone), open shift, `papers {missing, can_start_shift}`, `active_job_id`, today's counts, limits (`stale_after_seconds`, `flag_distance_m`, `wait_limit_seconds`). |
| `POST rider/shift/start/` | `lat, lng, accuracy_m` | 201 with the shift. |
| `POST rider/shift/end/` | | `{ended}`. |
| `POST rider/shift/break/` | `on` | Pauses new offers. |
| `POST rider/ping/` | `lat, lng, accuracy_m, speed_mps` | 409 `not_on_shift` when no shift is open. |
| `GET rider/jobs/?scope=active\|today\|week\|all` | | `{counts, results}`; each job is `payloads.rider_job` (customer first name and initial, address, pickup block, steps with stamps, wait timer, attempts left). |
| `GET rider/jobs/<id>/` | | One job. |
| `POST rider/jobs/<id>/accept/` | | `assigned -> accepted`. |
| `POST rider/jobs/<id>/arrive-pickup/` | `lat, lng, accuracy_m` | |
| `POST rider/jobs/<id>/pickup/` | `code, lat, lng, accuracy_m` | The business's code. `400 wrong_code` with `attempts_left`. |
| `POST rider/jobs/<id>/arrive-drop/` | `lat, lng, accuracy_m` | Starts the 10-minute wait; the customer gets an in-app notice. |
| `POST rider/jobs/<id>/deliver/` | `code, lat, lng, accuracy_m` | The customer's code. |
| `POST rider/jobs/<id>/cant-deliver/` | `reason, note, lat, lng, accuracy_m` | `reason`: `no_answer, wrong_address, refused, unsafe, other`. |
| `POST rider/jobs/<id>/call/` | | Logs the call, returns `{call_id, phone}` for a `tel:` link. The only place the customer's phone is given. |
| `POST rider/calls/<id>/outcome/` | `outcome: connected\|no_answer` | |
| `POST rider/jobs/<id>/photo/` | multipart `image, kind` | `pickup`, `drop` or `evidence`; JPEG or PNG, six per job. |
| `POST rider/jobs/<id>/note/` | `note` | The rider's own explanation. |
| `GET/POST rider/documents/` | multipart `kind, file, number, expires_on` | Upload or renew a paper; waits for the manager. |
| `GET/POST rider/issues/` | `kind, text, job, lat, lng, pause_offers` | Makes a task and a notice for the manager. |

Every step answers the refreshed job, or `{detail, code, ...}` with the status below. Codes: `location_needed` 400, `wrong_code` 400,
`wrong_step` 409, `papers_missing` 409, `job_in_progress` 409, `not_on_shift` 409, `wait_not_over` 409, `calls_needed` 409, `code_locked` 423,
`suspended` 403, `not_reassignable` 409.

The older panel's `POST /api/orders/delivery/<id>/pickup|deliver/` still works (accepts `code`; location-less) and
`POST /api/orders/<id>/assign-dispatch/` now goes through `delivery.services.assign` (makes the codes). Those are the Delivery
Manager's tools; a rider app should use the endpoints above.

## Delivery Manager endpoints

`delivery.manage`: `GET live/` (board: KPIs, pins with fix age and stale flag, queue, needs-you list, open disputes),
`GET active/?filter=all|at_customer|flagged|stale`, `GET jobs/<id>/` (record: timeline, codes matched, photos, calls, masked phone, fee `null`),
`POST jobs/<id>/flag-decision/ {decision: cleared|upheld, note, hold_wait_pay}`, `POST jobs/<id>/call-rider/`, `GET jobs/<id>/photos/<photo>/`.

`delivery.fleet`: `GET riders/` and `GET riders/<id>/` (+ `PATCH` vehicle type, home zone), `POST riders/<id>/job-hold/`, `POST riders/<id>/reinstate/`,
`GET documents/?bucket=waiting|expiring|expired|all`, `POST documents/<id>/review/ {decision, reject_reason, expires_on}`, `POST documents/<id>/remind/`,
`GET documents/<id>/file/`, `GET/POST vehicles/`, `GET/PATCH vehicles/<id>/`, `POST vehicles/<id>/assign/ {rider, note}`, `GET/POST zones/`,
`PATCH zones/<id>/`, `GET invites/`. Inviting a rider uses `POST /api/accounts/staff/invite/` with `role: "dispatch"` and the extra
fields `vehicle_type, home_zone, first_shift_date, invite_note`. Suspend, unsuspend and sign-out use the existing staff endpoints (sudo).

Papers: `delivery.tasks.run_paper_checks` runs hourly. It expires lapsed papers, sends 30/14/7-day reminders (in-app to the rider and the manager)
and suspends a rider whose required paper lapsed (`Rider.suspension_source = "documents"`), never while a job is on the road. `riders/<id>/reinstate/`
lifts only that kind of suspension once every required paper is approved and in date.
