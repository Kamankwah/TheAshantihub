# Multi-stop delivery and the shop-aware cart guard — design

Date: 2026-10-14. Status: BUILT on branch `feature/multi-stop-delivery` (backend and frontend; staging and hand check pending). Decisions settled in conversation (2026-10-13/14).
Amends section 4 ("Several businesses in one cart") and sections 2, 3, 5, 6 of
`2026-10-13-delivery-routing-dispatch-design.md`. Read that spec first.

## Goal

A customer may buy from several shops in one delivery order. One rider collects from all of them on
one trip, and the customer pays for one delivery. A guard keeps such carts sensible: shops near each
other are offered first, and the number of shops per delivery is capped.

## Today (what the code does, so the gap is clear)

- `services.pickup_stop` / `first_item` send the rider to the **first item's shop only**. Other shops'
  goods are never collected.
- `RateCard.extra_pickup` and `rates.customer_fee(extra_pickups=...)` exist, but checkout never passes
  `extra_pickups`; only the manager's fee calculator does.
- `DeliveryAssignment` has one `pickup_code`, one set of attempts, one `AT_PICKUP`/`PICKED_UP` status.
- `CartItemCreateView` checks only that the listing has a price. Service and stay listings can enter
  the product cart.
- Until this ships, any multi-shop delivery order is under-served. This is a known gap, not a new bug.

## Settled decisions

1. **One order, one rider, several pickup stops.** No mixed-cart block.
2. **Sequence is planned by the system** from the shops and the delivery point H, using road
   distances (OSRM `table`, brute force over at most 6 stops, route ends at H). Food shops are forced
   last (see Food). The rider nearest the first shop is dispatched. Once dispatched the sequence is
   fixed.
3. **Each shop has its own 4-digit pickup code; one delivery code** for the customer.
4. **Customer map goes live only after the last pickup.** A vendor sees the rider only while its shop
   is the rider's current stop, and never the customer's address.
5. **Shops are told "rider arrives about HH:MM"**, computed from the planned route.
6. **A shop that cannot hand over:** the rider skips that stop, the customer is told, and that
   shop's items are refunded through the existing dispute process.
7. **Pricing (option b).** Fee = base fee on road distance from the first pickup to H (as today) +
   `extra_pickup` per additional shop (rate card value set to 0 now) + a **detour charge**. If the
   planned route is more than `detour_limit_pct` longer than first-pickup→H, the manager sees a
   warning and the extra distance is charged at the per-km rate. The pickup leg stays absorbed by
   AshantiHub. The vehicle follows the largest item in the cart. A business-funded free-delivery
   promo covers only that business's own share; splitting the extra-pickup charge between
   businesses is **not** settled and is out of scope (the waiver covers the fee only where every
   line is covered, as today).
8. **Cart guard** (below), enforced in search ordering and server-side.
9. **Services and stays are untouched** (Fiverr-style requests, Airbnb-style bookings).

## 1. Data model

- New `PickupStop` (one per shop per assignment): `assignment` FK, `sequence` (1..n), `business_owner`
  FK, `lat`/`lng` snapshot, `code` (4 digits), `code_attempts`, `status`
  (`pending` / `arrived` / `collected` / `skipped`), `planned_arrival`, `arrived_at`, `collected_at`,
  `skip_note`.
- `DeliveryAssignment.pickup_code` and `pickup_code_attempts` stay for existing orders and for
  single-shop orders (one stop, mirrored into it) so nothing in flight breaks. New assignments always
  create stops, including the single-shop case; the legacy fields are written only as a mirror of
  stop 1 until a later cleanup removes them.
- Assignment status stays the rider-facing summary: `at_pickup` / `picked_up` mean "at the current
  stop" / "all stops done". The customer sees `picked_up` only after the last stop is collected or
  skipped.
- The planned route is stored on the assignment (`route_plan`: ordered stop ids, total km, detour
  %, `basis` road|estimate) and is immutable after dispatch.
- Rate card gains `max_shops_per_delivery` (default 4), `max_food_shops` (default 2),
  `near_shop_radius_km` (default 3) and `detour_limit_pct` (value to be proposed with the plan;
  adjustable by the Delivery Manager under the existing approval rules).

## 2. Planning

`routing.plan_route(shops, drop)` returns the best order and total road km (brute force, ≤ 6 stops,
OSRM `table` once). Food shops are collected after non-food shops: only orderings with all food
shops last are considered. If OSRM is down, fall back to straight-line distance × 1.3, label the
plan `estimate`, and alert the manager as for single-stop routing.

The first shop of the plan is the dispatch pickup point: candidate riders are ranked by road time to
it (existing ranking, unchanged).

## 3. Rider flow

Stops are worked in sequence. At each stop: go → arrive → enter that shop's code → collected. The
rider app shows one stop at a time with "stop 2 of 3", and the map shows the current stop plus the
route ahead. "Can't hand over" at a stop skips it with a required note (creating the refund
dispute for that shop's lines). After the last stop the flow is the existing go-to-customer →
arrive → delivery code.

## 4. Fee at checkout

Checkout plans the route, then prices: `customer_fee(card, km_first_to_H, extra_pickups=n-1)` plus
the detour charge when over the limit. The breakdown lists base, extra pickups and detour as
separate lines. The fee is locked on the order as today. The detour warning to the manager is raised
when an order whose plan exceeds the limit reaches the queue.

## 5. Cart guard

**When:** only once the cart already has an item; an empty cart sees normal search.

**Search tiers** (products and food, listings with a delivery option):
1. Shops already in the cart.
2. Shops within `near_shop_radius_km` (road distance; labelled estimate on fallback) of **any** cart
   shop, nearest first, each labelled e.g. "1.2 km from Shop A".
3. Everyone else, behind an always-available **"See other shops too"** expander.

Tiers 2 and 3 show "Delivery limit reached" instead of an add button when the cart is at the limit.
Services and stays are excluded from these tiers.

**Limits** (Delivery Manager adjustable): at most `max_shops_per_delivery` shops per delivery; food:
at most `max_food_shops` food shops, within the same radius of the cart's shops, collected last.

**Server-side, not just search** (decided): add-to-cart and checkout both enforce the limits with a
plain message, e.g. "Your delivery can include up to 4 shops. Remove one to add this." An existing
over-limit cart gets the same message at checkout; nothing is deleted automatically.

**Service/stay check:** add-to-cart rejects service and stay listings with "Services are requested
separately, and stays are booked separately." Checkout re-checks (a cart row may predate the rule).

## 6. Screens

- Customer cart/search: tiers, distance labels, expander, limit message.
- Customer order page: unchanged states, but "Order collected" starts after the last stop; before
  that the rough arrival window covers all stops.
- Vendor: pickup code box and "Rider on the way" appear per its own stop only; a shop that has
  already been collected sees nothing.
- Rider app: stop N of M, per-stop code entry, skip with note.
- Delivery Manager: queue and job drawers show the stop sequence, per-stop status and the detour
  warning; the existing unlock-code button works per stop; a control to edit the three limits and
  the detour percentage.

## 7. Failure cases

- OSRM down: estimate-labelled plan and fee, manager alert.
- Shop closes or cancels after dispatch: manager can mark that stop skipped (same refund path).
- Rider reassigned mid-route: the new rider inherits the remaining stops, with codes unchanged;
  completed stops are not repeated.
- A cart over the limit at checkout (limit lowered after items were added): blocked with a message.

## 8. Testing

- Planner: ordering (known small fixtures with stubbed table), food last, ≤ 6 brute force, estimate
  fallback.
- Fee: base + extra + detour lines; detour charged only over the limit; waiver unaffected.
- Stops: per-stop code lock/unlock, skip creates one dispute for only that shop, customer map
  gated on the last stop, vendor privacy per stop.
- Cart: tier ordering, 3 km boundary, limit messages server-side on add and on checkout,
  over-limit legacy cart, service/stay rejection.
- Map screens are checked by hand in a browser.

## Out of scope

Splitting the extra-pickup charge between businesses; automatic re-planning after dispatch; more
than 6 stops; different riders per shop; any change to the service request or stay booking flows.

## Built

Migrations: `listings 0020_category_is_food`, `orders 0008_route_plan`, `delivery 0004_ratecard_delivery_limits`,
`delivery 0005_pickup_stops`, `delivery 0006_deliveryevent_dispute`.

Owner rulings made during the build:

- The Food flag is set on `food` and on a new `beverages` category. Pubs & Bars are not food.
- The detour charge applies only to km beyond the 40% allowance.
- Deliveries assigned before release keep their single stop and old code (no migration of in-flight jobs).
- Shop and food limits apply door-to-door only, checked at checkout; service and stay refusal applies at every checkout.
- The 3 km food radius is enforced on add and again at checkout.
- A job where every shop is skipped fails with reason `all_stops_skipped` and is re-queued by resetting the same
  OneToOne row. Skip evidence (rider pin, time, note) lives on append-only `skipped_stop` `DeliveryEvent` rows and
  survives the reset; `DeliveryEvent.dispute` links the event to its case.
- A vendor sees the delivery address but no contact details; a rider's skip note has phone numbers and emails
  scrubbed on the shop's copy.
- A shop sees its own pickup code from the start; the rider appears on a shop's screen only for that shop's stop.
- `routing.service.legs_between` (one OSRM call) returns the legs between an ordered list of points.
- No store pickup exists yet (it will be at the AshantiHub office, later), so shop limits apply to door-to-door only; there is no contact between vendor and customer at all.
- Customer-side MoMo payment runs before `POST checkout`, so the UI blocks Pay until the cart guard has loaded.

## Known follow-ups

- Rider pay distance (`rates.route_km`) still measures first shop to drop and understates multi-stop trips.
  OPEN pay-policy decision for the owner.
- Cart tiers sort above paid featured placement.
- Rider pay for multi-stop trips is deferred to the payments phase (all payments will be in-app; AshantiHub-employed salaried riders and external per-job riders are both wanted).
- Guard: false `food_unlocated` when a cart shop has no location but the added listing has one; add can pass
  where checkout later refuses for a pinless business; checkout can refuse on an estimate while OSRM is down;
  tier-2 cache is 60 s per process; the routing matrix is uncached.
- Planner has no input validation (callers guarantee located shops and unique keys); mixed-unit partial
  tables can pick a suboptimal (labelled estimate) order; missing boundary-value tests for the limits.
- Rider skip note is shown to the shop with phone numbers scrubbed only by pattern.
- StopsLine and the refund notice disappear once an order is delivered or confirmed.
- Hand check in a real browser (Leaflet, phone width) is still owed.

## Open items

- Detour default 40% and food radius 3 km adopted as built; owner may still change them in the rate card.
- Legacy `pickup_code` fields are still mirrored from stop 1; dropping them is a follow-up migration.
