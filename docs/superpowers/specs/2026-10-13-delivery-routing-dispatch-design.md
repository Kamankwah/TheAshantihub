# Delivery routing, dispatch and live tracking — design

Date: 2026-10-13. Status: design approved section by section in conversation; awaiting spec review.
Builds on the delivery work already in the repo (`backend/delivery`: offers, auto-assign rules, rate card,
shifts, location pings, `DeliveryZone`). Read `docs/superpowers/specs/2026-10-07-staff-platform-overview-design.md`
first for roles and approvals.

## Goal

An Uber Eats-style delivery flow for AshantiHub. Each order has two legs: the rider goes to the business
(pickup), then to the customer (delivery). Both legs get a road distance and an arrival time on an
OpenStreetMap map. Riders are offered an order one at a time, closest first, with a 30–60 second window before
the offer passes to the next rider. Riders, the Delivery Manager and Dispatch, customers and businesses each
see live maps and arrival times, scoped to what each may see.

## Owner decisions (2026-10-13)

- Who sees the live map and arrival times: rider, Delivery Manager / Dispatch, customer, business.
- Routing: self-hosted OSRM on our own server, starting with the Ashanti Region (Kumasi and surroundings).
- Next rider: closest by road time to the pickup. Fairness and idle time are tie-breakers only.
- Rider alerts: Web Push from the installed staff PWA now; the React Native app later.
- Offer window: set by the Delivery Manager between 30 and 60 seconds, default 45 (approval as other rules).
- Customer map: live from pickup to delivery, signed-in owner of the order only.
- Prep time is a setting on each business, and the rider search starts as soon as an order arrives. Service
  businesses (hotels and the like) have no delivery options at all.
- Handover proof: a pickup code at the business and the existing delivery code at the customer.
- Zones control only the manager's busy-area alerts and heatmap. The service area is the whole Ashanti Region.
- Vehicles: motorbike, tricycle, car, truck, each priced differently. The vehicle is chosen automatically from
  item size; the customer may upgrade, never downgrade.
- Pricing: the customer pays for pickup point to delivery point only. AshantiHub absorbs the pickup leg for now.
- Architecture: approach A, extend the Django system (OSRM container, Celery dispatch, existing realtime
  service, Web Push, Leaflet + Leaflet Draw). The dispatch module stays separable in case volume outgrows it.
- Rider pay covers both legs (assumed; approved with section 4).
- Cash on delivery stays off. Delivery fees are on (`DELIVERY_FEE_ENABLED`) with the business-funded
  free-delivery promo built separately.

## 1. Data and routing

**Business and order data**
- Each business has one fixed pickup location, picked on a map and confirmed once.
- Each order stores a delivery point, which must fall inside the stored Ashanti Region polygon; an address
  outside it cannot order delivery.
- A business of a service type has no delivery settings and never appears in the delivery cart.
- Business settings: prep time in minutes (default, optional per-category override) and a delivery on/off
  switch.
- Each listing has a size class: small, medium, large, bulky.
- An order stores two legs (pickup, delivery), each with road distance, expected time, planned arrival, actual
  arrival and status.

**Routing (OSRM)**
- One OSRM container beside the existing services, built from the Geofabrik Ghana extract clipped to the
  Ashanti Region. A scheduled task refreshes it monthly. More regions can be added later.
- A single `routing` module is the only code that talks to OSRM: `route` (distance, time, line to draw),
  `table` (many riders to one pickup in one call) and a health check.
- ETAs begin as typical road speeds. Each completed leg stores predicted and actual time; a correction factor
  per time of day is learned from that history.
- Fallback: if OSRM is down or a point is outside its area, use the straight-line estimate (distance × 1.3,
  as today), label every ETA "estimate" and alert the manager.

## 2. Dispatch engine

1. Order placed and paid: status "Finding a rider"; the target pickup time is now plus the business prep time.
2. Rank: one OSRM `table` call gives road time from each eligible rider to the pickup. Eligible means on shift,
   not on a break, fresh location, vehicle type able to carry the order, no live offer on another order, under
   the max active jobs, papers valid. Sort by road time, then fairness, then idle time.
3. Offer: the closest rider gets the offer; an expiry task is scheduled for the exact second (Celery
   `apply_async` with an ETA), with a short sweeper as a safety net.
4. The rider sees pickup distance/time, delivery distance/time, pay and map; accept or decline.
5. Accept: other candidates are dropped. Decline or timeout: the offer is marked and the next rider is offered
   the order; a rider who declined or timed out is skipped for that order.
6. When the list is exhausted, re-rank (riders move, new ones come on shift). After a configured number of
   passes the order goes to the manager's queue with an alert, as today.

Concurrency: every order has its own dispatch job and many run at once; only the offers within one order are
serial. Database constraints and row locks give one live offer per order, one live offer per rider, and an
atomic accept so two accepts can never both win. Every offer, response and re-rank is written to the delivery
event log. Existing manager overrides and the max-active-jobs rule stay.

## 3. Live tracking and maps

- The rider app sends position on a fast tick during a job and a slow tick while idle on shift. The latest fix
  updates the shift record; history is kept 30 days for disputes and ETA learning, then deleted.
- A web app cannot track reliably in the background (especially iPhone): during a job the app keeps the screen
  awake and warns the rider if tracking pauses. Reliable background tracking is a reason for the native app.
- Positions travel over the existing realtime service in separate channels per audience:
  manager/dispatch see the whole fleet; the customer sees their own order's rider only after pickup (first name
  and vehicle, never a phone number); the business sees the rider approaching until the pickup code is
  confirmed and never the customer's address.
- Route and ETA recompute every 20–30 seconds or when the rider leaves the route, and are cached so many
  viewers cost one OSRM call.
- Maps use Leaflet on OpenStreetMap. The rider's turn-by-turn navigation opens in Google Maps or Waze from a
  button. The manager map adds the busy-area heatmap and zone drawing with Leaflet Draw (new dependency).
- Open item: OpenStreetMap's public tile servers forbid heavy production use, so a tile provider with a key or a
  self-hosted tile server must be chosen before launch.

## 4. Pricing and vehicle rules

- Customer fee: base + per-km rate × road distance (pickup point to delivery point only) × vehicle multiplier,
  with the minimum fee and rounding of the existing rate card. Rate card versioning and approvals are unchanged.
  Distance comes from OSRM, with the labelled straight-line fallback.
- The cart quotes the fee for each vehicle that can carry the order; the fee is locked at checkout.
- Size class to minimum vehicle: small is a motorbike, medium a tricycle or car, large a car, bulky a truck. The
  largest item decides. The customer may upgrade, never downgrade. Riders are offered only orders their vehicle
  can carry.
- Several businesses in one cart: the existing extra-pickup charge applies; pickups are visited nearest first;
  each pickup has its own code; the customer fee is measured from the first pickup to the delivery point.
- Free-delivery promos: the customer pays zero and the waived amount is charged to the business in the ledger.
- Rider pay: per-job amount, plus a per-km amount over both legs, plus waiting pay after the configured wait.
- Not in scope now: surge pricing, tips, per-zone prices.

## 5. Rider app and Web Push

- On going on shift the app asks for notification permission and registers a push subscription stored per
  device. The server sends Web Push with its own VAPID keys (no third-party service). The offer notification is
  high priority with a lifetime equal to the offer window and opens the offer screen.
- Android works with the installed PWA. iPhone works only when the PWA is added to the home screen (iOS 16.4+);
  the install flow says so.
- The offer screen shows the map, pickup and delivery distance and time, pay and vehicle needed, a countdown,
  Accept and Decline. It never shows the customer's name, phone or address before acceptance.
- Job steps: go to pickup, arrive, enter pickup code, go to customer, arrive, enter delivery code; each step
  records time and location. "Can't deliver" and "Report an issue" stay as built.
- Safety nets: the manager is alerted when location stops mid-job; several missed offers in a row pause the
  rider with a notice; a dead push subscription shows "Notifications are off" on the shift screen.
- The offer, location and job APIs are shared with the future native app.

## 6. Customer, business and manager screens

- Customer: order page states "Finding a rider", "Rider heading to the shop", "Order collected" (live map and
  ETA), "Arrived". Before pickup, a status and a rough arrival window (prep + pickup + delivery travel, shown as
  a range). The delivery code is shown prominently. "Contact Support" is the only contact route; there is no
  call button to the rider.
- Business: incoming order with prep target and pickup code; once a rider accepts, the rider's first name,
  vehicle and ETA to the shop with a mini map, hidden after the pickup code is confirmed; a "Running late"
  button adds minutes and moves the customer estimate and the offer's pickup target. The business never sees the
  customer's address or phone.
- Delivery Manager: live fleet map with status colours and late or stuck orders highlighted; an order drawer with
  offer history and planned versus actual leg times plus the existing manual assign and override tools; the
  busy-area heatmap; zones drawn with Leaflet Draw; alerts such as "5 orders waiting, 1 idle rider in this
  area"; a predicted-versus-actual ETA accuracy report.
- Super Admin can step into these views read-only, as for other roles.

## 7. Failure cases, testing, rollout

**Failure cases**
- OSRM down or out of area: labelled straight-line fallback, manager alert, dispatch keeps working.
- No rider accepts: manager's queue after the configured passes.
- Rider vanishes mid-job: manager alerted; manager reassigns; the old job is withdrawn.
- Business late: customer estimate and pickup target move. Cancellation after a rider is assigned stops the job
  and records compensation for the rider's wasted trip (amount is a rate-card setting; open item).
- Customer not at address: existing "Can't deliver" process.
- Delivery point outside the Ashanti Region: refused at the cart with a clear message.
- Push failure: see section 5. Two simultaneous accepts: the atomic claim lets one win.

**Testing**
- Dispatch tests use a stubbed routing module and cover concurrent orders, concurrent accepts, expiry timing,
  the per-rider offer lock and fairness tie-breaks. One integration check runs against a small OSRM extract.
- Privacy tests per audience (customer, business, manager, other riders).
- Map screens are verified by hand in a browser (Leaflet does not render under jsdom); push is verified on real
  Android and iPhone devices.

**Rollout (four shippable stages)**
1. Routing foundation: OSRM container, routing module, real distances and ETAs on manager screens and the cart.
2. Dispatch engine: road-time ranking, exact-time offers, per-rider lock.
3. Rider app: Web Push, offer screen, pickup and delivery codes.
4. Customer and business tracking: live maps, heatmap, Leaflet Draw zones.

## Open items

- Map tile provider (keyed provider or self-hosted).
- Rider compensation when an order is cancelled mid-job.
- Real-device verification on Android and iPhone.
- Whether the Ashanti region polygon comes from OSM administrative boundaries or is drawn by hand.
