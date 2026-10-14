# Multi-stop Delivery and Cart Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One rider collects a multi-shop order from every shop on one planned trip (per-shop codes, skip with refund case, per-stop privacy), the customer pays one delivery fee (base + extra pickups + detour beyond the allowance), and a shop-aware cart guard keeps delivery carts within the limits.

**Architecture:** A new `routing/planner.py` orders the shops (brute force over at most 6, food last) from one OSRM `table` (`routing.service.matrix`). Checkout stores that plan on `Order.route_plan` and prices from it. When the order is assigned, `delivery/stops.py` turns the plan into `PickupStop` rows (one per business, own code, fixed sequence); the rider's existing step endpoints act on the current stop, and every reader (rider payload, manager screens, tracking, vendor serializer) reads stops through `stops.stops_of()`, which shows an assignment made before this ships as its one old pickup without writing anything. `cart/guard.py` holds the limits check (add-to-cart, checkout, search tiers) with the limits on the rate card.

**Tech Stack:** Django/DRF, PostgreSQL, `routing.service` (OSRM or labelled estimate), React 19, React Query, Vitest + MSW, react-leaflet (stubbed under jsdom).

**Spec:** `docs/superpowers/specs/2026-10-14-multi-stop-delivery-and-cart-guard-design.md`, which amends `docs/superpowers/specs/2026-10-13-delivery-routing-dispatch-design.md` (read both). Style model: `docs/superpowers/plans/2026-10-13-delivery-maps.md`.

## Global Constraints

- One order, one rider, several pickup stops. No mixed-cart block.
- Sequence: planned by the system from the shops and the delivery point H, road distances from one OSRM `table`, brute force over at most 6 stops, route ends at H, food shops forced last. Once dispatched the sequence is fixed. OSRM down: straight-line distance x 1.3, labelled `estimate`.
- The rider nearest the first shop of the plan is dispatched (existing ranking, unchanged; `services.pickup_stop(order)` returns the plan's first shop).
- Each shop has its own 4-digit pickup code; one delivery code. Wrong tries are counted and locked per stop at `services.CODE_ATTEMPT_LIMIT` (5).
- Customer map goes live only after the last pickup. A vendor sees the rider only while its shop is the rider's current stop, and never the customer's address (tracking payloads). Shops are told "rider arrives about HH:MM" from the planned route.
- A shop that cannot hand over: the stop is skipped with a required note, the customer is told, that shop's items go to the existing dispute (delivery case) process. Every skip is evidence: the rider's GPS pin at that moment (lat, lng, accuracy), the time and the note are kept on the append-only `DeliveryEvent` for that stop. The manager sees all of it (queue row, job drawer). The shop sees only its own stop's report as "Rider reported at your shop at HH:MM: <note>", with no rider name, phone or position.
- Every stop skipped: the job fails as `all_stops_skipped` and the order goes BACK into the Delivery queue (`board.waiting_orders`) for the manager to re-dispatch. One refund case per skipped shop is kept. Requeue mechanism (owner ruling 2026-10-14): `DeliveryAssignment` stays OneToOne with `Order`, and the failed row is reset and reused, exactly as `services.assign` already does for a failed "Can't deliver" job (it resets status, rider and wrong tries on the same row). Reasons: every reader (`order.delivery_assignment`, cash, reports, tracking, serializers) assumes one row per order, so relaxing to many rows would touch dozens of call sites for no gain; and the evidence does not live on the row that is reset. It lives on `DeliveryEvent` rows (append-only, never reset, `stop` FK), which `stops.skip_history()` reads. On re-dispatch after `all_stops_skipped`, `stops.reopen_for_new_rider(..., all_skipped=True)` reopens the skipped stops (status pending, same codes, `skip_note` and the stop's `dispute` link cleared; the refund cases stay open as their own records for the manager to settle or withdraw). No separate attempt table is added: the events are the attempt record.
- Food places: a business with a listing in a `Category.is_food` category. Owner ruling: `food` ("Food", seeded in `listings` migration 0002, kind `service` via 0009) and a NEW `beverages` ("Beverages") category. No beverages category exists today (searched code, seeds, fixtures, frontend); Pubs & Bars (`pubs`) is a venue category and is left unchanged and unflagged. Migration 0020 creates `beverages` (`get_or_create`, idempotent, reversible, modelled on the seed pattern of 0002/0012: slug, icon, label, colour, explicit kind) and flags `food` and `beverages` (`FOOD_CATEGORY_SLUGS = ("food", "beverages")`). The frontend reads categories from `GET /api/listings/categories/`, so no frontend list needs the new entry. Beverages follow the food rules in full: counted toward `max_food_shops`, collected last, cart-able. Existing drink shops are NOT auto-moved: a manager or the owner reassigns those listings to Beverages.
- Shop-owner order list (`OwnerOrderSerializer`): keeps the customer's name, delivery address and pin (an existing contract test pins them) and exposes NO customer contact details: no `delivery_phone` (already stripped by `OWNER_DELIVERY_FIELDS`), no phone, email or contact field of any kind. Task 7 adds a test over every key.
- Pricing (option b): fee = base on road distance first pickup to H + `extra_pickup` per additional shop + detour charge (per-km rate on the km beyond `detour_limit_pct`). Pickup leg absorbed by AshantiHub. A business-funded free-delivery promo waives the fee only where every line is covered, as today.
- Rate card gains `max_shops_per_delivery` (default 4), `max_food_shops` (default 2), `near_shop_radius_km` (default 3), `detour_limit_pct` (default 40), changed through the existing rate-card approval flow. With no card in force the built-in defaults run and are named as such.
- Cart guard only once the cart already has an item. Messages, verbatim: "Your delivery can include up to 4 shops. Remove one to add this." and "Services are requested separately, and stays are booked separately." (the number comes from the limit in force). Nothing is ever deleted from a cart automatically.
- Services and stays are untouched (ServiceRequest and Booking flows). They are refused from the product cart and are not tiered in search.
- Distances only from `routing.service` (`backend/CLAUDE.md`); every figure carries its basis and the screen says it.
- No fabricated data: no arrival time without a rider fix and located stops; no detour charge when the route could not be planned; honest empty states.
- Frontend: inline `C`/`D` palette, no `useMutation`, `components/**` never imports `App.jsx`, Leaflet files stay stubbed in `frontend/test/setup.js`, new map behaviour is checked by hand in a browser.
- Backend tests in a worktree: `cp backend/.env.example backend/.env` once, write the override below once, then `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test <apps>`. One known unrelated failure: `delivery.tests.test_dispatch.OfferTests.test_short_time_forces_the_best_rider_without_asking`.

```bash
export OV=/tmp/ah-multistop-ov.yml
cat > $OV <<'EOF'
services:
  db:
    ports: !reset []
  web:
    ports: !reset []
EOF
```

- Frontend tests: `cd frontend && npm install; npx vitest run; npm run build` (always from `frontend/`).
- Out of scope: splitting the extra-pickup charge between businesses, re-planning after dispatch, more than 6 stops, different riders per shop, size-class vehicle choice (not built; the fee keeps the motorbike default as today), rider pay changes (stays first pickup to drop), the vendor order list's address field (an existing contract test pins it), dropping the legacy `pickup_code` fields, returning already-collected goods to a shop after a failed customer delivery (that stays with the existing Can't deliver process; `reopen_for_new_rider(failed=True)` only reopens the stops).

## Review Focus

- Carts and test fixtures that already hold service-kind lines (every cart test uses the service-kind "hotels" category): checkout must refuse with the plain message and delete nothing; the fixtures move to the product category "shops". Test: Task 8 `test_checkout_refuses_a_cart_that_predates_the_rules_and_keeps_it`, plus the fixture step in Task 8.
- An assignment in flight when this ships (it has a `pickup_code` and no `PickupStop` rows): reading it must write nothing and show its one old pickup; the next rider write keeps the same code and wrong tries. Tests: Task 3 `test_an_assignment_from_before_stops_is_read_as_one_stop_without_writing`, Task 5 `LegacyTests`.
- Missing coordinates: no drop pin, a shop with no pin, or a first shop sitting at the drop. The plan falls back to cart order with food last, no detour is charged, nothing divides by zero, and the fee is only charged when the first pickup to drop can be measured. Tests: Task 4 `test_no_drop_pin_*`, `test_a_shop_without_a_pin_*`, `test_a_single_shop_at_the_delivery_point_*`.
- Every stop skipped: nothing is left to deliver, so the job fails as `all_stops_skipped`, one refund case per shop is opened, and the order goes back into the Delivery queue for the manager to re-dispatch (the same row is reset; the skip evidence survives on `DeliveryEvent`). Tests: Task 5 `test_when_every_shop_is_skipped_the_order_goes_back_to_the_queue`, `test_a_returned_order_can_be_given_to_a_new_rider_and_the_evidence_survives`, `test_a_skip_keeps_the_riders_pin_time_and_note`; Task 6 `test_the_manager_sees_skip_evidence_in_the_queue_and_the_job`; Task 7 `test_a_shop_sees_the_riders_skip_report_for_its_own_stop_only`.
- Shop-owner privacy: the owner order list keeps the address and pin and never carries a customer phone, email or contact field. Test: Task 7 `test_the_owner_order_row_has_no_customer_contact_details` (the existing `test_owner_sees_customer_name_and_address_but_not_phone` stays).
- Beverages are food: `food` and the new `beverages` category are flagged, counted as food places, collected last; `pubs` is untouched. Tests: Task 3 `test_the_food_migration_marks_food_and_the_new_beverages_category`, `test_the_beverages_migration_is_idempotent`, `test_a_beverages_shop_is_a_food_stop_collected_last`; Task 8 `test_a_beverages_shop_counts_as_a_food_place`.
- A business that sells both food and goods: it is one stop and one shop toward the limit, counts as a food place once any food line is in the cart, and is collected last. Tests: Task 3 `test_a_shop_selling_food_and_goods_is_one_food_stop`, Task 8 `test_a_shop_selling_goods_and_food_counts_once_and_as_food`.

---

### Task 1: Delivery limits on the rate card (backend)

**Files:**
- Modify: `backend/delivery/models.py` (class `RateCard`, after `wait_per_min`)
- Create: `backend/delivery/migrations/0004_ratecard_delivery_limits.py` (generated)
- Modify: `backend/delivery/config.py` (`clean_rate_card`, `RATE_FIELDS`, new `_km`, `CART_LIMIT_DEFAULTS`, `effective_cart_limits`, `limits_json`)
- Modify: `backend/delivery/views_rules.py` (`RateCardView.extra`)
- Test: `backend/delivery/tests/test_cart_limits_config.py`

**Interfaces:**
- Consumes: the existing rate-card approval flow (`config.propose`, `_publish`, `RateCardView`).
- Produces:
  - `RateCard.max_shops_per_delivery: int`, `RateCard.max_food_shops: int`, `RateCard.near_shop_radius_km: Decimal`, `RateCard.detour_limit_pct: int`
  - `config.CART_LIMIT_DEFAULTS = {"max_shops_per_delivery": 4, "max_food_shops": 2, "near_shop_radius_km": "3.00", "detour_limit_pct": 40}`
  - `config.effective_cart_limits() -> {"source": "version"|"defaults", "version": int|None, "max_shops_per_delivery": int, "max_food_shops": int, "near_shop_radius_km": Decimal, "detour_limit_pct": int}`
  - `config.limits_json(limits) -> dict` (Decimals as strings)
  - `GET /api/delivery/rules/rate-card/` gains `"cart_limits": limits_json(effective_cart_limits())`; `current`/`history` rows carry the four fields.

- [ ] **Step 1: Write the failing test** `backend/delivery/tests/test_cart_limits_config.py`:

```python
from decimal import Decimal

from delivery import config
from delivery.models import RateCard

from .test_dispatch import CARD, EngineCase


class CartLimitConfigTests(EngineCase):
    def propose(self, **over):
        self.as_staff(self.admin, sudo=True)
        return self.client.post("/api/delivery/rules/rate-card/", {"values": {**CARD, **over}}, format="json")

    def test_built_in_defaults_run_until_a_card_is_in_force(self):
        limits = config.effective_cart_limits()
        self.assertEqual(limits["source"], "defaults")
        self.assertIsNone(limits["version"])
        self.assertEqual((limits["max_shops_per_delivery"], limits["max_food_shops"], limits["detour_limit_pct"]), (4, 2, 40))
        self.assertEqual(limits["near_shop_radius_km"], Decimal("3.00"))

    def test_a_card_proposed_without_the_limits_gets_the_defaults(self):
        self.assertEqual(self.propose().status_code, 201)
        card = config.live(RateCard)
        self.assertEqual((card.max_shops_per_delivery, card.max_food_shops, card.near_shop_radius_km, card.detour_limit_pct), (4, 2, Decimal("3.00"), 40))
        self.assertEqual(config.effective_cart_limits()["source"], "version")

    def test_the_manager_changes_the_limits_through_the_card(self):
        r = self.propose(max_shops_per_delivery=3, max_food_shops=1, near_shop_radius_km="2.5", detour_limit_pct=25)
        self.assertEqual(r.status_code, 201, r.content)
        limits = config.effective_cart_limits()
        self.assertEqual(
            (limits["max_shops_per_delivery"], limits["max_food_shops"], limits["near_shop_radius_km"], limits["detour_limit_pct"]),
            (3, 1, Decimal("2.50"), 25),
        )
        data = self.client.get("/api/delivery/rules/rate-card/").json()
        self.assertEqual(data["current"]["max_shops_per_delivery"], 3)
        self.assertEqual(data["current"]["near_shop_radius_km"], "2.50")
        self.assertEqual(data["cart_limits"], {"source": "version", "version": data["current"]["version"], "max_shops_per_delivery": 3,
                                               "max_food_shops": 1, "near_shop_radius_km": "2.50", "detour_limit_pct": 25})

    def test_bad_limits_are_refused_with_the_field(self):
        cases = (
            ({"max_shops_per_delivery": 7}, "max_shops_per_delivery"),
            ({"max_shops_per_delivery": 0}, "max_shops_per_delivery"),
            ({"max_shops_per_delivery": 2, "max_food_shops": 3}, "max_food_shops"),
            ({"near_shop_radius_km": "0.1"}, "near_shop_radius_km"),
            ({"near_shop_radius_km": "far"}, "near_shop_radius_km"),
            ({"detour_limit_pct": 301}, "detour_limit_pct"),
            ({"detour_limit_pct": "x"}, "detour_limit_pct"),
        )
        for over, field in cases:
            r = self.propose(**over)
            self.assertEqual(r.status_code, 400, (over, r.content))
            self.assertEqual(r.json()["field"], field)
        self.assertIsNone(config.live(RateCard))
```

- [ ] **Step 2: Run, expect FAIL**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test delivery.tests.test_cart_limits_config`
Expected: FAIL with `AttributeError: module 'delivery.config' has no attribute 'effective_cart_limits'`.

- [ ] **Step 3: Add the model fields.** In `RateCard` (after `wait_per_min`):

```python
    # Multi-stop delivery and the cart guard (spec 2026-10-14). Changed through this card's approval like every other
    # value; with no card in force config.CART_LIMIT_DEFAULTS run, named as built-in defaults.
    max_shops_per_delivery = models.PositiveSmallIntegerField(default=4)
    max_food_shops = models.PositiveSmallIntegerField(default=2)
    near_shop_radius_km = models.DecimalField(max_digits=5, decimal_places=2, default="3.00")
    detour_limit_pct = models.PositiveSmallIntegerField(default=40)
```

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py makemigrations delivery -n ratecard_delivery_limits`
Expected: `delivery/migrations/0004_ratecard_delivery_limits.py` with four `AddField` operations.

- [ ] **Step 4: Add the config code.** In `backend/delivery/config.py`, after `_clock`:

```python
def _km(data, name, lo, hi, default=None):
    raw = data.get(name, default)
    try:
        value = Decimal(str(raw)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        raise ConfigError("Enter a distance in km.", name)
    if not lo <= value <= hi:
        raise ConfigError(f"Enter a distance from {lo} to {hi} km.", name)
    return value
```

Replace the `return {...}` of `clean_rate_card` with:

```python
    limits = {
        "max_shops_per_delivery": _int(data, "max_shops_per_delivery", 1, 6, default=4),  # 6 = routing.planner.MAX_STOPS
        "max_food_shops": _int(data, "max_food_shops", 0, 6, default=2),
        "near_shop_radius_km": str(_km(data, "near_shop_radius_km", Decimal("0.5"), Decimal("20"), default="3.00")),
        "detour_limit_pct": _int(data, "detour_limit_pct", 0, 300, default=40),
    }
    if limits["max_food_shops"] > limits["max_shops_per_delivery"]:
        raise ConfigError("Food places cannot be more than the shops allowed per delivery.", "max_food_shops")
    return {
        "customer_base": str(_money(data, "customer_base")), "customer_per_km": str(_money(data, "customer_per_km")),
        "customer_min_fee": str(_money(data, "customer_min_fee")), "extra_pickup": str(_money(data, "extra_pickup", default="0")),
        "express_multiplier": str(_factor(data, "express_multiplier", default="1")), "round_up_to": str(_money(data, "round_up_to", Decimal("0"), Decimal("10"), default="0.50")),
        "vehicle_multipliers": cleaned, "rider_per_job": str(_money(data, "rider_per_job")), "rider_per_km": str(_money(data, "rider_per_km")),
        "wait_after_min": _int(data, "wait_after_min", 0, 120, default=10), "wait_per_min": str(_money(data, "wait_per_min", default="0")),
        **limits,
    }
```

Extend `RATE_FIELDS` with `"max_shops_per_delivery", "max_food_shops", "near_shop_radius_km", "detour_limit_pct"`, and add after `effective_limits`:

```python
CART_LIMIT_DEFAULTS = {"max_shops_per_delivery": 4, "max_food_shops": 2, "near_shop_radius_km": "3.00", "detour_limit_pct": 40}
CART_LIMIT_FIELDS = tuple(CART_LIMIT_DEFAULTS)


def effective_cart_limits():
    """The delivery limits in force: the live rate card's, else the built-in defaults (flagged, never shown as approved)."""
    row = live(RateCard)
    values = {f: getattr(row, f) for f in CART_LIMIT_FIELDS} if row else dict(CART_LIMIT_DEFAULTS)
    return {
        "source": "version" if row else "defaults", "version": row.version if row else None,
        "max_shops_per_delivery": int(values["max_shops_per_delivery"]), "max_food_shops": int(values["max_food_shops"]),
        "near_shop_radius_km": Decimal(str(values["near_shop_radius_km"])), "detour_limit_pct": int(values["detour_limit_pct"]),
    }


def limits_json(limits):
    return {k: (str(v) if isinstance(v, Decimal) else v) for k, v in limits.items()}
```

In `views_rules.RateCardView.extra`, add `"cart_limits": config.limits_json(config.effective_cart_limits()),` to the returned dict.

- [ ] **Step 5: Run, expect PASS**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test delivery`
Expected: PASS (except the known unrelated failure).

- [ ] **Step 6: Commit**

```bash
git add backend/delivery/models.py backend/delivery/migrations/0004_ratecard_delivery_limits.py backend/delivery/config.py backend/delivery/views_rules.py backend/delivery/tests/test_cart_limits_config.py
git commit -m "feat(delivery): shop, food, radius and detour limits on the rate card"
```

---

### Task 2: Distance table and route planner (backend)

**Files:**
- Modify: `backend/routing/client.py` (add `matrix`)
- Modify: `backend/routing/service.py` (add `matrix`)
- Create: `backend/routing/planner.py`
- Test: `backend/routing/tests/test_matrix.py`, `backend/routing/tests/test_planner.py`

**Interfaces:**
- Consumes: `client._get`, `client._coord`, `service._estimate`, `service._enabled`, `service._down`, `service._mark_down`, `service.leg`.
- Produces:
  - `client.matrix(points) -> list[list[{"distance_m": float, "duration_s": float} | None]]` (row i, column j: from point i to point j; one OSRM `table` call, no `sources`/`destinations`)
  - `service.matrix(points) -> {"km": list[list[float]], "basis": "road route" | "straight-line estimate x 1.3"}` (never raises; diagonal 0.0; any estimated cell labels the whole table an estimate)
  - `planner.MAX_STOPS = 6`
  - `planner.plan_route(shops, drop) -> {"order": [key, ...], "total_km": float, "direct_km": float, "legs_km": [float, ...], "basis": str}` where `shops = [{"key", "lat", "lng", "food": bool}]` (1..6, all located), `drop = (lat, lng)`. One shop uses `service.leg` (unchanged single-stop distance); several use one `service.matrix`. Raises `ValueError` for 0 or more than 6 shops.
  - `planner.detour_pct(total_km, direct_km) -> float | None` (None when either is None or direct is 0)

- [ ] **Step 1: Write the failing tests.** `backend/routing/tests/test_matrix.py`:

```python
from unittest import mock

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings

from delivery import services as delivery_services
from routing import client, service

A, B = (6.69, -1.62), (6.70, -1.60)


@override_settings(OSRM_URL="http://osrm:5000", OSRM_TIMEOUT_S=2.0)
class ClientMatrixTests(SimpleTestCase):
    def test_every_pair_in_one_call(self):
        body = {"code": "Ok", "durations": [[0, 60], [70, 0]], "distances": [[0, 1000], [1100, 0]]}
        with mock.patch("routing.client._http_get_json", return_value=body) as get:
            out = client.matrix([A, B])
        url = get.call_args[0][0]
        self.assertIn("/table/v1/driving/-1.62,6.69;-1.6,6.7?annotations=duration,distance", url)
        self.assertNotIn("sources=", url)
        self.assertEqual(out[0][1], {"distance_m": 1000.0, "duration_s": 60.0})
        self.assertEqual(out[1][0], {"distance_m": 1100.0, "duration_s": 70.0})

    def test_an_unroutable_pair_is_none(self):
        body = {"code": "Ok", "durations": [[0, None], [70, 0]], "distances": [[0, None], [1100, 0]]}
        with mock.patch("routing.client._http_get_json", return_value=body):
            self.assertIsNone(client.matrix([A, B])[0][1])

    def test_a_malformed_answer_is_an_error(self):
        with mock.patch("routing.client._http_get_json", return_value={"code": "Ok", "durations": "x", "distances": []}):
            with self.assertRaises(client.OsrmError):
                client.matrix([A, B])


class ServiceMatrixTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_road_table_in_km(self):
        rows = [[{"distance_m": 0.0, "duration_s": 0.0}, {"distance_m": 2500.0, "duration_s": 300.0}],
                [{"distance_m": 2600.0, "duration_s": 310.0}, {"distance_m": 0.0, "duration_s": 0.0}]]
        with mock.patch("routing.client.matrix", return_value=rows):
            self.assertEqual(service.matrix([A, B]), {"km": [[0.0, 2.5], [2.6, 0.0]], "basis": service.BASIS_ROAD})

    @override_settings(OSRM_URL="")
    def test_unconfigured_gives_the_labelled_estimate(self):
        with mock.patch("routing.client.matrix") as call:
            out = service.matrix([A, B])
        call.assert_not_called()
        self.assertEqual(out["basis"], service.BASIS_ESTIMATE)
        self.assertEqual(out["km"][0][1], delivery_services.distance_estimate_km(A[0], A[1], B[0], B[1]))
        self.assertEqual(out["km"][1][1], 0.0)

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_one_missing_pair_is_estimated_and_labels_the_table(self):
        rows = [[{"distance_m": 0.0, "duration_s": 0.0}, None], [{"distance_m": 2600.0, "duration_s": 310.0}, {"distance_m": 0.0, "duration_s": 0.0}]]
        with mock.patch("routing.client.matrix", return_value=rows):
            out = service.matrix([A, B])
        self.assertEqual(out["basis"], service.BASIS_ESTIMATE)
        self.assertEqual(out["km"][1][0], 2.6)
        self.assertEqual(out["km"][0][1], delivery_services.distance_estimate_km(A[0], A[1], B[0], B[1]))

    @override_settings(OSRM_URL="http://osrm:5000")
    def test_osrm_down_is_remembered_and_estimated(self):
        with mock.patch("routing.client.matrix", side_effect=client.OsrmUnavailable("timed out")), self.assertLogs("routing.service", "INFO"):
            out = service.matrix([A, B])
        self.assertEqual(out["basis"], service.BASIS_ESTIMATE)
        self.assertIs(cache.get(service.HEALTH_KEY), False)
```

`backend/routing/tests/test_planner.py`:

```python
from unittest import mock

from django.test import SimpleTestCase

from routing import planner, service

# Rows/columns: shop A, shop B, shop C, then the drop H. Best A-B-C-H = 2+3+1 = 6 km; A to H direct = 5 km.
K = [[0, 2, 9, 5], [2, 0, 3, 4], [9, 3, 0, 1], [5, 4, 1, 0]]
SHOPS = [
    {"key": "A", "lat": 6.700, "lng": -1.620, "food": False},
    {"key": "B", "lat": 6.705, "lng": -1.615, "food": False},
    {"key": "C", "lat": 6.710, "lng": -1.610, "food": False},
]
DROP = (6.69, -1.62)


def table(km=K, basis=service.BASIS_ROAD):
    return mock.patch("routing.planner.service.matrix", return_value={"km": km, "basis": basis})


class PlanRouteTests(SimpleTestCase):
    def test_the_shortest_order_ends_at_the_drop(self):
        with table() as call:
            got = planner.plan_route(SHOPS, DROP)
        self.assertEqual(got, {"order": ["A", "B", "C"], "total_km": 6, "direct_km": 5, "legs_km": [2, 3, 1], "basis": service.BASIS_ROAD})
        call.assert_called_once()
        self.assertEqual(call.call_args[0][0][-1], DROP)

    def test_food_shops_are_collected_last(self):
        shops = [{**SHOPS[0], "food": True}, SHOPS[1], SHOPS[2]]
        with table():
            got = planner.plan_route(shops, DROP)
        self.assertEqual(got["order"], ["C", "B", "A"])  # C-B-A-H = 3+2+5; A may not come before B or C
        self.assertEqual((got["total_km"], got["direct_km"]), (10, 1))

    def test_two_food_shops_both_follow_every_other_shop(self):
        shops = [{**SHOPS[0], "food": True}, {**SHOPS[1], "food": True}, SHOPS[2]]
        with table():
            self.assertEqual(planner.plan_route(shops, DROP)["order"], ["C", "B", "A"])

    def test_an_estimated_table_labels_the_plan(self):
        with table(basis=service.BASIS_ESTIMATE):
            self.assertEqual(planner.plan_route(SHOPS, DROP)["basis"], service.BASIS_ESTIMATE)

    def test_one_shop_uses_the_single_leg_and_no_table(self):
        leg = {"distance_km": 4.2, "duration_s": 600, "basis": service.BASIS_ROAD, "geometry": None}
        with mock.patch("routing.planner.service.leg", return_value=leg), table() as call:
            got = planner.plan_route(SHOPS[:1], DROP)
        call.assert_not_called()
        self.assertEqual(got, {"order": ["A"], "total_km": 4.2, "direct_km": 4.2, "legs_km": [4.2], "basis": service.BASIS_ROAD})

    def test_six_shops_are_brute_forced(self):
        shops = [{"key": n, "lat": 6.7 + n / 100, "lng": -1.62, "food": False} for n in range(1, 7)]
        positions = [1, 2, 3, 4, 5, 6, 0]  # shops on a line, the drop at 0
        km = [[abs(a - b) for b in positions] for a in positions]
        with table(km):
            got = planner.plan_route(shops, DROP)
        self.assertEqual(got["order"], [6, 5, 4, 3, 2, 1])
        self.assertEqual((got["total_km"], got["direct_km"]), (6, 6))

    def test_ties_go_to_the_earlier_shops(self):
        flat = [[0 if i == j else 1 for j in range(4)] for i in range(4)]
        with table(flat):
            self.assertEqual(planner.plan_route(SHOPS, DROP)["order"], ["A", "B", "C"])

    def test_no_shops_or_more_than_six_is_refused(self):
        with self.assertRaises(ValueError):
            planner.plan_route([], DROP)
        with self.assertRaises(ValueError):
            planner.plan_route([{**SHOPS[0], "key": n} for n in range(7)], DROP)

    def test_detour_pct(self):
        self.assertEqual(planner.detour_pct(6, 5), 20.0)
        self.assertEqual(planner.detour_pct(5, 5), 0.0)
        self.assertIsNone(planner.detour_pct(4, 0))
        self.assertIsNone(planner.detour_pct(None, 5))
```

- [ ] **Step 2: Run, expect FAIL**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test routing`
Expected: FAIL (`AttributeError: module 'routing.client' has no attribute 'matrix'`, `ModuleNotFoundError: routing.planner`).

- [ ] **Step 3: Implement.** Add to `backend/routing/client.py` after `table`:

```python
def matrix(points):
    """Every pair in one call: rows[i][j] = {"distance_m", "duration_s"} from point i to point j, or None when OSRM
    cannot route that pair."""
    points = list(points)
    if not points:
        return []
    coords = ";".join(_coord(p) for p in points)
    body = _get(f"/table/v1/driving/{coords}?annotations=duration,distance")
    durations, distances = body.get("durations") or [], body.get("distances") or []
    if not isinstance(durations, list) or not isinstance(distances, list):
        raise OsrmError("Malformed OSRM response.")
    out = []
    for i in range(len(points)):
        row = []
        for j in range(len(points)):
            try:
                d, m = durations[i][j], distances[i][j]
            except (IndexError, TypeError):
                d = m = None
            row.append(None if d is None or m is None else {"distance_m": float(m), "duration_s": float(d)})
        out.append(row)
    return out
```

Add to `backend/routing/service.py` after `legs_from`:

```python
def matrix(points):
    """Road km between every pair of points (km[i][j] from i to j, 0 on the diagonal) and one basis for the whole table.
    Never raises: OSRM off or down gives the straight-line estimate; a pair OSRM cannot route is estimated, and then the
    whole table is labelled an estimate, so a plan built on it never claims road distances."""
    points = [(float(p[0]), float(p[1])) for p in points]

    def estimated():
        return {"km": [[0.0 if i == j else _estimate(a, b)["distance_km"] for j, b in enumerate(points)] for i, a in enumerate(points)],
                "basis": BASIS_ESTIMATE}

    if len(points) < 2 or not _enabled() or _down():
        return estimated()
    try:
        rows = client.matrix(points)
    except client.OsrmError as exc:
        if isinstance(exc, client.OsrmUnavailable):
            _mark_down()
        logger.info("OSRM table failed (%s); using straight-line estimates.", exc)
        return estimated()
    except Exception:
        logger.exception("OSRM table failed unexpectedly; using straight-line estimates.")
        return estimated()
    basis, km = BASIS_ROAD, []
    for i, a in enumerate(points):
        row = []
        for j, b in enumerate(points):
            cell = rows[i][j] if i < len(rows) and j < len(rows[i]) else None
            if i == j:
                row.append(0.0)
            elif cell is None:
                row.append(_estimate(a, b)["distance_km"])
                basis = BASIS_ESTIMATE
            else:
                row.append(round(cell["distance_m"] / 1000, 2))
        km.append(row)
    return {"km": km, "basis": basis}
```

Create `backend/routing/planner.py`:

```python
"""The order one rider collects a delivery's shops in (spec 2026-10-14, section 2): brute force over every order with
the food shops last (at most MAX_STOPS shops, so at most 720 orders), from one distance table, ending at the delivery
point. Distances come from routing.service, which never raises: with OSRM down the table is the labelled estimate."""
from itertools import permutations

from . import service

MAX_STOPS = 6


def detour_pct(total_km, direct_km):
    """How much longer the planned route is than going straight from its first shop, in percent; None when either is
    unknown or the first shop is at the delivery point (nothing to compare with)."""
    if total_km is None or direct_km is None or direct_km <= 0:
        return None
    return round((total_km - direct_km) / direct_km * 100, 1)


def plan_route(shops, drop):
    """shops: [{"key", "lat", "lng", "food"}] (1..MAX_STOPS, every one located); drop: (lat, lng). Returns the shortest
    route through every shop, non-food shops first, ending at the drop: {"order", "total_km", "direct_km" (first shop to
    the drop), "legs_km", "basis"}. Ties go to the shops given first."""
    if not shops or len(shops) > MAX_STOPS:
        raise ValueError(f"plan_route needs 1 to {MAX_STOPS} shops, got {len(shops)}.")
    drop = (float(drop[0]), float(drop[1]))
    if len(shops) == 1:
        leg = service.leg((float(shops[0]["lat"]), float(shops[0]["lng"])), drop)
        km = round(float(leg["distance_km"]), 2)
        return {"order": [shops[0]["key"]], "total_km": km, "direct_km": km, "legs_km": [km], "basis": leg["basis"]}
    table = service.matrix([(float(s["lat"]), float(s["lng"])) for s in shops] + [drop])
    km, h = table["km"], len(shops)
    plain = [i for i, s in enumerate(shops) if not s.get("food")]
    food = [i for i, s in enumerate(shops) if s.get("food")]
    best = None
    for head in permutations(plain):
        for tail in permutations(food):
            seq = head + tail
            total = sum(km[a][b] for a, b in zip(seq, seq[1:])) + km[seq[-1]][h]
            candidate = (round(total, 6), seq)
            if best is None or candidate < best:
                best = candidate
    seq = best[1]
    legs = [km[a][b] for a, b in zip(seq, seq[1:])] + [km[seq[-1]][h]]
    return {
        "order": [shops[i]["key"] for i in seq], "total_km": round(sum(legs), 2), "direct_km": round(km[seq[0]][h], 2),
        "legs_km": [round(x, 2) for x in legs], "basis": table["basis"],
    }
```

- [ ] **Step 4: Run, expect PASS**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test routing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routing/client.py backend/routing/service.py backend/routing/planner.py backend/routing/tests/test_matrix.py backend/routing/tests/test_planner.py
git commit -m "feat(routing): distance table and multi-stop route planner, food last"
```

---

### Task 3: Pickup stops, the food flag and stop creation at assignment (backend)

**Files:**
- Modify: `backend/listings/models.py` (`Category.is_food`)
- Create: `backend/listings/migrations/0020_category_is_food.py` (hand-written, below)
- Modify: `backend/orders/models.py` (`Order.route_plan`, `DeliveryAssignment.route_plan`)
- Create: `backend/orders/migrations/0008_route_plan.py` (generated)
- Modify: `backend/delivery/models.py` (new `PickupStop`; `DeliveryEvent` steps `COLLECTED_STOP`, `SKIPPED_STOP` and FK `stop`)
- Create: `backend/delivery/migrations/0005_pickup_stops.py` (generated)
- Create: `backend/delivery/stops.py`
- Modify: `backend/delivery/services.py` (`new_code`, `ensure_codes`, `pickup_stop`, `assign`)
- Modify: `backend/delivery/tests/base.py` (helpers `make_shop`, `multi_order`)
- Test: `backend/delivery/tests/test_stops.py`

**Interfaces:**
- Consumes: `field.services.business_pin`, `services.valid_point`, `services.first_item`.
- Produces:
  - `Category.is_food: bool` (migration 0020 creates the `beverages` category and sets it on the slugs `food` and `beverages`; `pubs` is not flagged)
  - `Order.route_plan: dict | None` (written by Task 4), `DeliveryAssignment.route_plan: dict | None` (= the order's plan plus `owner_ids`, `stop_ids`, written once when stops are made)
  - `PickupStop` with `PENDING, ARRIVED, COLLECTED, SKIPPED`, `OPEN = (PENDING, ARRIVED)`, fields `assignment (related_name="stops"), sequence, business_owner, lat, lng, code, code_attempts, status, planned_arrival, arrived_at, collected_at, skip_note, skipped_by, dispute (OneToOne, related_name="pickup_stop")`
  - `DeliveryEvent.COLLECTED_STOP = "collected_stop"`, `DeliveryEvent.SKIPPED_STOP = "skipped_stop"`, `DeliveryEvent.stop` (FK, nullable)
  - `stops.shop_entries(lines) -> [{"key": owner_id, "owner", "name", "lat", "lng", "food": bool, "lines": [...]}]` (first-line order)
  - `stops.fallback_order(entries) -> [owner_id]` (non-food then food)
  - `stops.sequence_for_order(order) -> [owner_id]`
  - `stops.stops_of(assignment) -> [PickupStop]` (never writes; an assignment without rows reads as one unsaved stop)
  - `stops.ensure_stops(assignment) -> [PickupStop]` (writes once)
  - `stops.open_stops(a)`, `stops.current_stop(a) -> PickupStop | None`, `stops.stop_for_owner(a, owner_id)`, `stops.progress(a) -> {"total", "done", "skipped", "current": sequence | None}`, `stops.stop_lines(stop, order) -> [OrderItem]`, `stops.stop_name(stop) -> str`, `stops.reopen_for_new_rider(a, *, failed, all_skipped=False)`
  - `services.new_code(exclude=()) -> str`; `services.pickup_stop(order)` now returns the plan's first shop
  - Test helpers on `DeliveryCase`: `make_shop(name, phone, point=None, *, slug="shops") -> (owner, listing)`, `multi_order(*listings, **order_fields) -> Order`

- [ ] **Step 1: Add the test helpers** to `DeliveryCase` in `backend/delivery/tests/base.py` (after `make_order`):

```python
    def make_shop(self, name, phone, point=None, *, slug="shops"):
        """A business with one published listing (located at `point`, or with no location)."""
        owner = BusinessOwner.objects.create(full_name=name, login_phone=phone, password_hash="x")
        listing = Listing.objects.create(
            business_owner=owner, category=Category.objects.get(slug=slug), zone=Zone.objects.get(name="Manhyia"),
            name=f"{name} item", description="D.", contact_phone=phone, price_amount="10.00", status=Listing.PUBLISHED,
            lat=str(point[0]) if point else None, lng=str(point[1]) if point else None,
        )
        return owner, listing

    def multi_order(self, *listings, **kw):
        """A paid door-to-door order with one line per listing, in the order given."""
        order = Order.objects.create(
            customer=self.customer, status=Order.PAID, total_amount="100.00", delivery_method=Order.DOOR_TO_DOOR,
            delivery_address="12 Ash Road", delivery_phone="+233200882200", delivery_lat=DROP[0], delivery_lng=DROP[1], **kw,
        )
        for listing in listings:
            OrderItem.objects.create(order=order, listing=listing, quantity=1, unit_price="10.00", line_total="10.00")
        return order
```

- [ ] **Step 2: Write the failing tests** `backend/delivery/tests/test_stops.py`:

```python
from delivery import services, stops
from delivery.models import PickupStop
from listings.models import Category, Listing, Zone
from orders.models import DeliveryAssignment as DA

from .base import DeliveryCase

A, B, C = (6.70, -1.62), (6.705, -1.615), (6.71, -1.61)


class StopTests(DeliveryCase):
    def setUp(self):
        super().setUp()
        self.shop_a, self.item_a = self.make_shop("Shop A", "+233207000101", A)
        self.shop_b, self.item_b = self.make_shop("Shop B", "+233207000102", B)
        self.chop, self.item_food = self.make_shop("Chop Bar", "+233207000103", C, slug="food")

    def owners(self, assignment):
        return [s.business_owner_id for s in assignment.stops.all()]

    def test_the_food_migration_marks_food_and_the_new_beverages_category(self):
        self.assertEqual(sorted(Category.objects.filter(is_food=True).values_list("slug", flat=True)), ["beverages", "food"])
        bev = Category.objects.get(slug="beverages")
        self.assertEqual((bev.label, bev.kind), ("Beverages", Category.PRODUCT))
        self.assertFalse(Category.objects.get(slug="pubs").is_food)

    def test_the_beverages_migration_is_idempotent(self):
        from importlib import import_module

        from django.apps import apps as django_apps

        migration = import_module("listings.migrations.0020_category_is_food")
        migration.seed_beverages(django_apps, None)  # a second run changes nothing
        self.assertEqual(Category.objects.filter(slug="beverages").count(), 1)
        self.assertTrue(Category.objects.get(slug="beverages").is_food)

    def test_a_beverages_shop_is_a_food_stop_collected_last(self):
        bar, item_bar = self.make_shop("Akwaaba Drinks", "+233207000104", (6.702, -1.618), slug="beverages")
        a = self.assign(self.multi_order(item_bar, self.item_a, self.item_b))
        self.assertEqual(self.owners(a), [self.shop_a.pk, self.shop_b.pk, bar.pk])

    def test_a_new_assignment_gets_one_stop_per_shop_in_the_stored_plan(self):
        plan = {"owner_ids": [self.shop_b.pk, self.shop_a.pk, self.chop.pk], "planned": True, "total_km": 4.0}
        a = self.assign(self.multi_order(self.item_a, self.item_b, self.item_food, route_plan=plan))
        rows = list(a.stops.all())
        self.assertEqual(self.owners(a), [self.shop_b.pk, self.shop_a.pk, self.chop.pk])
        self.assertEqual([s.sequence for s in rows], [1, 2, 3])
        self.assertEqual(len({s.code for s in rows} | {a.drop_code}), 4)  # every code on one delivery differs
        self.assertEqual(a.pickup_code, rows[0].code)  # the legacy field mirrors stop 1
        self.assertEqual(a.route_plan["stop_ids"], [s.pk for s in rows])
        self.assertEqual(a.route_plan["total_km"], 4.0)
        self.assertEqual((rows[0].lat, rows[0].lng), B)
        self.assertEqual({s.status for s in rows}, {PickupStop.PENDING})

    def test_without_a_stored_plan_shops_follow_the_cart_with_food_last(self):
        a = self.assign(self.multi_order(self.item_food, self.item_a, self.item_b))
        self.assertEqual(self.owners(a), [self.shop_a.pk, self.shop_b.pk, self.chop.pk])
        self.assertFalse(a.route_plan["planned"])

    def test_a_stored_plan_for_other_shops_is_ignored(self):
        a = self.assign(self.multi_order(self.item_a, self.item_b, route_plan={"owner_ids": [999999], "planned": True}))
        self.assertEqual(self.owners(a), [self.shop_a.pk, self.shop_b.pk])

    def test_a_shop_selling_food_and_goods_is_one_food_stop(self):
        food_line = Listing.objects.create(
            business_owner=self.shop_a, category=Category.objects.get(slug="food"), zone=Zone.objects.get(name="Manhyia"),
            name="Shop A soup", description="D.", contact_phone="+233207000101", price_amount="10.00", status=Listing.PUBLISHED,
        )
        a = self.assign(self.multi_order(self.item_a, food_line, self.item_b))
        self.assertEqual(self.owners(a), [self.shop_b.pk, self.shop_a.pk])  # one stop per business; a food line makes it last

    def test_the_dispatch_point_is_the_first_planned_shop(self):
        order = self.multi_order(self.item_a, self.item_b, route_plan={"owner_ids": [self.shop_b.pk, self.shop_a.pk], "planned": True})
        lat, lng, name = services.pickup_stop(order)
        self.assertEqual(((lat, lng), name), (B, "Shop B"))

    def test_an_assignment_from_before_stops_is_read_as_one_stop_without_writing(self):
        a = self.assign(self.multi_order(self.item_a, self.item_b))
        a.stops.all().delete()
        DA.objects.filter(pk=a.pk).update(pickup_code="4321", pickup_code_attempts=2, status=DA.AT_PICKUP)
        a = DA.objects.get(pk=a.pk)
        rows = stops.stops_of(a)
        self.assertEqual(PickupStop.objects.filter(assignment=a).count(), 0)
        self.assertEqual([(s.pk, s.business_owner_id, s.code, s.code_attempts, s.status) for s in rows],
                         [(None, self.shop_a.pk, "4321", 2, PickupStop.ARRIVED)])
        made = stops.ensure_stops(a)
        self.assertEqual([(s.business_owner_id, s.code, s.code_attempts, s.status) for s in made],
                         [(self.shop_a.pk, "4321", 2, PickupStop.ARRIVED)])
        self.assertEqual(stops.ensure_stops(a)[0].pk, made[0].pk)  # made once

    def test_reassigning_mid_route_keeps_done_stops_and_codes(self):
        a = self.assign(self.multi_order(self.item_a, self.item_b))
        first, second = a.stops.all()
        first.status = PickupStop.COLLECTED
        first.save()
        second.status, second.code_attempts = PickupStop.ARRIVED, 3
        second.save()
        DA.objects.filter(pk=a.pk).update(status=DA.AT_PICKUP)
        again = self.assign(a.order, self.other_staff)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.status, second.status, second.code_attempts), (PickupStop.COLLECTED, PickupStop.PENDING, 0))
        self.assertEqual([s.code for s in again.stops.all()], [first.code, second.code])
        self.assertEqual((again.status, again.dispatch_id), (DA.ASSIGNED, self.other_staff.pk))

    def test_re_dispatching_after_every_shop_was_skipped_reopens_the_stops_but_keeps_the_evidence(self):
        a = self.assign(self.multi_order(self.item_a, self.item_b))
        codes = [s.code for s in a.stops.all()]
        for stop in a.stops.all():
            stop.status, stop.skip_note, stop.skipped_by = PickupStop.SKIPPED, "Shut", self.manager
            stop.save()
        DA.objects.filter(pk=a.pk).update(status=DA.FAILED, failed_reason="all_stops_skipped")
        again = self.assign(a.order, self.other_staff)
        self.assertEqual((again.pk, again.status, again.failed_reason), (a.pk, DA.ASSIGNED, ""))
        rows = list(again.stops.all())
        self.assertEqual([(s.status, s.skip_note, s.skipped_by_id, s.code) for s in rows],
                         [(PickupStop.PENDING, "", None, codes[0]), (PickupStop.PENDING, "", None, codes[1])])

    def test_re_dispatching_after_a_failed_delivery_keeps_a_skipped_shop_skipped(self):
        a = self.assign(self.multi_order(self.item_a, self.item_b))
        first, second = a.stops.all()
        first.status = PickupStop.SKIPPED
        first.save()
        second.status = PickupStop.COLLECTED
        second.save()
        DA.objects.filter(pk=a.pk).update(status=DA.FAILED, failed_reason="wrong_address")
        again = self.assign(a.order, self.other_staff)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.status, second.status), (PickupStop.SKIPPED, PickupStop.PENDING))

    def test_current_stop_and_progress(self):
        a = self.assign(self.multi_order(self.item_a, self.item_b, self.item_food))
        first, second, third = a.stops.all()
        self.assertEqual(stops.current_stop(a).pk, first.pk)
        first.status = PickupStop.COLLECTED
        first.save()
        second.status = PickupStop.SKIPPED
        second.save()
        self.assertEqual(stops.current_stop(a).pk, third.pk)
        self.assertEqual(stops.progress(a), {"total": 3, "done": 1, "skipped": 1, "current": 3})
        self.assertEqual([i.listing_id for i in stops.stop_lines(third, a.order)], [self.item_food.pk])
```

- [ ] **Step 3: Run, expect FAIL**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test delivery.tests.test_stops`
Expected: FAIL (`ImportError: cannot import name 'stops' from 'delivery'` / `is_food` not a field).

- [ ] **Step 4: Models and migrations.** In `listings/models.py` `Category`, after `is_accommodation`:

```python
    # Prepared food (chop bars, restaurants): carted and delivered like a product, but one delivery collects from at most
    # RateCard.max_food_shops food places and collects them last (spec 2026-10-14). Set on the "food" and "beverages"
    # categories by migration 0020; `kind` stays as it was.
    is_food = models.BooleanField(default=False)
```

Create `backend/listings/migrations/0020_category_is_food.py`:

```python
from django.db import migrations, models


# Food (chop bars, restaurants) and the new Beverages category both follow the food rules. Pubs & Bars is not flagged.
FOOD_CATEGORY_SLUGS = ("food", "beverages")
# Seeded like 0002/0012: slug, icon, label, colour, plus an explicit kind. Existing drink shops are not moved here.
BEVERAGES = {"slug": "beverages", "icon": "🥤", "label": "Beverages", "color": "#0277BD", "kind": "product"}


def seed_beverages(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    Category.objects.get_or_create(slug=BEVERAGES["slug"], defaults={k: v for k, v in BEVERAGES.items() if k != "slug"})


def mark_food(apps, schema_editor):
    seed_beverages(apps, schema_editor)
    apps.get_model("listings", "Category").objects.filter(slug__in=FOOD_CATEGORY_SLUGS).update(is_food=True)


def unmark_food(apps, schema_editor):
    Category = apps.get_model("listings", "Category")
    Category.objects.filter(slug__in=FOOD_CATEGORY_SLUGS).update(is_food=False)
    Category.objects.filter(slug="beverages", listings__isnull=True).delete()  # only while nothing is listed under it


class Migration(migrations.Migration):
    dependencies = [("listings", "0019_listing_created_by_staff")]
    operations = [
        migrations.AddField(model_name="category", name="is_food", field=models.BooleanField(default=False)),
        migrations.RunPython(mark_food, unmark_food),
    ]
```

In `orders/models.py`, add to `Order` (after `rate_card`) and to `DeliveryAssignment` (after `cash_collected_at`):

```python
    # The pickup route planned at checkout (delivery.stops.plan_for_lines): businesses in collection order, road km and the
    # detour against the limit in force. Null for store pickup and for orders placed before multi-stop delivery.
    route_plan = models.JSONField(null=True, blank=True)
```

```python
    # The plan the stops were made from (the order's route_plan plus owner_ids and stop_ids); fixed once written.
    route_plan = models.JSONField(null=True, blank=True)
```

In `delivery/models.py`, extend `DeliveryEvent`:

```python
    ASSIGNED, ACCEPTED, ARRIVED_PICKUP, PICKED_UP, ARRIVED_DROP, DELIVERED, CANT_DELIVER = (
        "assigned", "accepted", "arrived_pickup", "picked_up", "arrived_drop", "delivered", "cant_deliver",
    )
    COLLECTED_STOP, SKIPPED_STOP = "collected_stop", "skipped_stop"
    STEP_CHOICES = [
        (ASSIGNED, "Assigned"), (ACCEPTED, "Accepted"), (ARRIVED_PICKUP, "Arrived at pickup"), (PICKED_UP, "Picked up"),
        (ARRIVED_DROP, "Arrived at customer"), (DELIVERED, "Delivered"), (CANT_DELIVER, "Can't deliver"),
        (COLLECTED_STOP, "Collected at a shop"), (SKIPPED_STOP, "Shop skipped"),
    ]
```

and add the field `stop = models.ForeignKey("delivery.PickupStop", null=True, blank=True, on_delete=models.SET_NULL, related_name="events")` to it. Add the new model after `DeliveryEvent`:

```python
class PickupStop(models.Model):
    """One business a delivery collects from (spec 2026-10-14). Made once per assignment in the planned order, which
    never changes after. Each stop has its own four-digit code (the business reads it to the rider) and its own wrong-try
    count; stop 1's are mirrored into DeliveryAssignment.pickup_code / pickup_code_attempts until those are removed.
    lat/lng are a snapshot of where the rider was sent (null when the business had no location)."""

    PENDING, ARRIVED, COLLECTED, SKIPPED = "pending", "arrived", "collected", "skipped"
    STATUS_CHOICES = [(PENDING, "Waiting"), (ARRIVED, "Rider at the shop"), (COLLECTED, "Collected"), (SKIPPED, "Skipped")]
    OPEN = (PENDING, ARRIVED)

    assignment = models.ForeignKey("orders.DeliveryAssignment", on_delete=models.CASCADE, related_name="stops")
    sequence = models.PositiveSmallIntegerField()
    business_owner = models.ForeignKey("accounts.BusinessOwner", on_delete=models.PROTECT, related_name="pickup_stops")
    lat = models.FloatField(null=True, blank=True)
    lng = models.FloatField(null=True, blank=True)
    code = models.CharField(max_length=4, blank=True)
    code_attempts = models.PositiveSmallIntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    planned_arrival = models.DateTimeField(null=True, blank=True)
    arrived_at = models.DateTimeField(null=True, blank=True)
    collected_at = models.DateTimeField(null=True, blank=True)
    skip_note = models.CharField(max_length=500, blank=True)
    skipped_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    dispute = models.OneToOneField("disputes.Dispute", null=True, blank=True, on_delete=models.SET_NULL, related_name="pickup_stop")

    class Meta:
        ordering = ["sequence"]
        constraints = [
            models.UniqueConstraint(fields=["assignment", "sequence"], name="one_stop_per_sequence"),
            models.UniqueConstraint(fields=["assignment", "business_owner"], name="one_stop_per_business"),
        ]
```

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py makemigrations orders -n route_plan` then `... makemigrations delivery -n pickup_stops`.
Expected: `orders/migrations/0008_route_plan.py` (two `AddField`) and `delivery/migrations/0005_pickup_stops.py` (`CreateModel PickupStop`, `AddField deliveryevent.stop`, `AlterField deliveryevent.step`).

- [ ] **Step 5: Create `backend/delivery/stops.py`:**

```python
"""The pickup stops of one delivery (spec 2026-10-14): which businesses one rider collects from, in which order, and how
each stands. The order is planned once (at checkout, on Order.route_plan) and fixed for the assignment.

Reads (stops_of, current_stop, stop_for_owner, progress) never write: an assignment made before multi-stop delivery has
no stop rows and reads as one unsaved stop for its first item's business, exactly as it was served. Writes call
ensure_stops first."""
from field.services import business_pin

from .models import PickupStop


def _point(lat, lng):
    from . import services

    return services.valid_point(lat, lng)


def shop_entries(lines):
    """One entry per business, in the order its first line was added: {"key": owner id, "owner", "name", "lat", "lng",
    "food", "lines"}. `lines` are cart items or order items. The point is the business pin, else the first located
    listing (None when neither). A business with any food line is a food shop."""
    shops = {}
    for line in sorted(lines, key=lambda l: l.pk):
        listing = line.listing
        owner = listing.business_owner
        entry = shops.get(owner.pk)
        if entry is None:
            entry = shops[owner.pk] = {"key": owner.pk, "owner": owner, "name": getattr(owner, "display_name", None) or owner.full_name,
                                       "lat": None, "lng": None, "food": False, "lines": []}
        entry["lines"].append(line)
        entry["food"] = entry["food"] or bool(listing.category.is_food)
    for entry in shops.values():
        pin = business_pin(entry["owner"])
        pin = _point(*pin) if pin else None
        if pin is None:
            pin = next((p for p in (_point(l.listing.lat, l.listing.lng) for l in entry["lines"]) if p), None)
        if pin is not None:
            entry["lat"], entry["lng"] = float(pin[0]), float(pin[1])
    return list(shops.values())


def fallback_order(entries):
    """Cart order with every food shop moved to the end: the order used when no route could be planned."""
    return [e["key"] for e in entries if not e["food"]] + [e["key"] for e in entries if e["food"]]


def sequence_for_order(order):
    """Business ids in collection order: the plan stored at checkout when it covers exactly this order's businesses,
    else the fallback order."""
    entries = shop_entries(order.items.all())
    keys = [e["key"] for e in entries]
    planned = list((order.route_plan or {}).get("owner_ids") or [])
    if planned and sorted(planned) == sorted(keys):
        return planned
    return fallback_order(entries)


def _legacy_status(assignment):
    from orders.models import DeliveryAssignment as DA

    if assignment.status == DA.AT_PICKUP:
        return PickupStop.ARRIVED
    if assignment.picked_up_at is not None or assignment.status in (DA.PICKED_UP, DA.AT_CUSTOMER, DA.DELIVERED, DA.CONFIRMED):
        return PickupStop.COLLECTED
    return PickupStop.PENDING


def _legacy_stop(assignment):
    """The single pickup an assignment from before multi-stop delivery is served with (its first item's business), unsaved."""
    from . import services

    item = services.first_item(assignment.order)
    if item is None:
        return None
    entry = shop_entries([item])[0]
    status = _legacy_status(assignment)
    return PickupStop(
        assignment=assignment, sequence=1, business_owner=entry["owner"], lat=entry["lat"], lng=entry["lng"],
        code=assignment.pickup_code, code_attempts=assignment.pickup_code_attempts, status=status,
        arrived_at=assignment.arrived_pickup_at if status == PickupStop.ARRIVED else None,
        collected_at=assignment.picked_up_at if status == PickupStop.COLLECTED else None,
    )


def stops_of(assignment):
    """The assignment's stops in sequence. Never writes."""
    rows = sorted(assignment.stops.all(), key=lambda s: s.sequence)
    if rows:
        return rows
    legacy = _legacy_stop(assignment)
    return [legacy] if legacy is not None else []


def ensure_stops(assignment):
    """Make the stops once and return them. A new assignment gets one stop per business in sequence_for_order, each
    with its own code (stop 1's mirrored into pickup_code). An assignment made before multi-stop delivery (it already has
    a pickup code) keeps its single first-item pickup, with its code and wrong tries, so nothing in flight changes."""
    from . import services

    rows = list(assignment.stops.order_by("sequence"))
    if rows:
        return rows
    order = assignment.order
    entries = {e["key"]: e for e in shop_entries(order.items.all())}
    if not entries:
        return []
    if assignment.pickup_code:
        stop = _legacy_stop(assignment)
        stop.save()
        rows, sequence = [stop], [stop.business_owner_id]
    else:
        sequence = sequence_for_order(order)
        used = {assignment.drop_code}
        for n, owner_id in enumerate(sequence, start=1):
            entry = entries[owner_id]
            code = services.new_code(exclude=used)
            used.add(code)
            rows.append(PickupStop.objects.create(assignment=assignment, sequence=n, business_owner=entry["owner"],
                                                  lat=entry["lat"], lng=entry["lng"], code=code))
        assignment.pickup_code = rows[0].code
    plan = dict(order.route_plan or {"planned": False})
    plan.update({"owner_ids": sequence, "stop_ids": [s.pk for s in rows]})
    assignment.route_plan = plan
    assignment.save(update_fields=["pickup_code", "route_plan"])
    return rows


def open_stops(assignment):
    return [s for s in stops_of(assignment) if s.status in PickupStop.OPEN]


def current_stop(assignment):
    """The stop the rider works now: the first open one in sequence; None once every stop is collected or skipped."""
    return next((s for s in stops_of(assignment) if s.status in PickupStop.OPEN), None)


def stop_for_owner(assignment, owner_id):
    return next((s for s in stops_of(assignment) if s.business_owner_id == owner_id), None)


def progress(assignment):
    rows = stops_of(assignment)
    current = next((s for s in rows if s.status in PickupStop.OPEN), None)
    return {
        "total": len(rows), "done": sum(1 for s in rows if s.status == PickupStop.COLLECTED),
        "skipped": sum(1 for s in rows if s.status == PickupStop.SKIPPED), "current": current.sequence if current else None,
    }


def stop_lines(stop, order):
    return [i for i in sorted(order.items.all(), key=lambda i: i.pk) if i.listing.business_owner_id == stop.business_owner_id]


def stop_name(stop):
    owner = stop.business_owner
    return getattr(owner, "display_name", None) or owner.full_name


def reopen_for_new_rider(assignment, *, failed, all_skipped=False):
    """A new rider takes the job. Collected and skipped stops stay done (after a failed delivery collected stops reopen:
    the goods went back); every open stop starts again with its code unchanged and its wrong tries cleared.
    `all_skipped` is true when the failed attempt ended because every shop was skipped: the manager is re-dispatching
    the order, so the skipped stops reopen too (same codes). What the skips recorded is not lost: it lives on the
    append-only DeliveryEvent rows (stops.skip_history), and each skipped shop's refund case stays open as its own
    record, only unlinked from the stop so a second skip can open a fresh case."""
    for stop in ensure_stops(assignment):
        if stop.status == PickupStop.SKIPPED:
            if not all_skipped:
                continue
            stop.status, stop.skip_note, stop.skipped_by, stop.dispute = PickupStop.PENDING, "", None, None
        if failed or stop.status == PickupStop.ARRIVED:
            stop.status, stop.arrived_at = PickupStop.PENDING, None
            if failed:
                stop.collected_at = None
        if stop.status in PickupStop.OPEN:
            stop.code_attempts, stop.planned_arrival = 0, None
        stop.save(update_fields=["status", "arrived_at", "collected_at", "code_attempts", "planned_arrival", "skip_note", "skipped_by", "dispute"])
    first = assignment.stops.filter(sequence=1).first()
    if first is not None:
        assignment.pickup_code_attempts = first.code_attempts
        assignment.save(update_fields=["pickup_code_attempts"])
```

- [ ] **Step 6: Wire it into `services.py`.** Replace `new_code` and `ensure_codes`:

```python
def new_code(exclude=()):
    """A four-digit code not in `exclude` (the other codes on the same delivery)."""
    while True:
        code = f"{secrets.randbelow(10000):04d}"
        if code not in exclude:
            return code


def ensure_codes(assignment):
    """The customer's delivery code, made once. Pickup codes live on the stops (stops.ensure_stops)."""
    if not assignment.drop_code:
        assignment.drop_code = new_code()
        return ["drop_code"]
    return []
```

Replace `pickup_stop`:

```python
def pickup_stop(order):
    """(lat, lng, business name) of the first business the planned route visits (the dispatch point), or
    (None, None, name) when it has no location."""
    from . import stops

    sequence = stops.sequence_for_order(order)
    if not sequence:
        return None, None, ""
    entry = next(e for e in stops.shop_entries(order.items.all()) if e["key"] == sequence[0])
    return (entry["lat"], entry["lng"], entry["name"]) if entry["lat"] is not None else (None, None, entry["name"])
```

In `assign`, keep the status check and resets, but capture why a failed attempt failed before the reset clears it: right after the line `existing = DeliveryAssignment.objects.select_for_update().filter(order=order).first()` add `previous_reason = existing.failed_reason if existing is not None else ""`. Then replace everything from `ensure_codes(assignment)` to the event with:

```python
    failed = existing is not None and existing.status == DeliveryAssignment.FAILED
    ensure_codes(assignment)
    if assignment.deadline_at is None:
        from .dispatching import deadline_for

        assignment.deadline_at = deadline_for(order)
    assignment.save()
    from . import stops

    stops.ensure_stops(assignment)
    if existing is not None and (swapped or failed):
        stops.reopen_for_new_rider(assignment, failed=failed, all_skipped=previous_reason == "all_stops_skipped")
    DeliveryEvent.objects.create(assignment=assignment, step=DeliveryEvent.ASSIGNED, at=now, by=assigned_by)
    return assignment
```

- [ ] **Step 7: Run, expect PASS**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test delivery orders listings`
Expected: PASS (except the known unrelated failure). The old single-shop tests keep passing because stop 1's code is mirrored into `pickup_code`.

- [ ] **Step 8: Commit**

```bash
git add backend/listings/models.py backend/listings/migrations/0020_category_is_food.py backend/orders/models.py backend/orders/migrations/0008_route_plan.py backend/delivery/models.py backend/delivery/migrations/0005_pickup_stops.py backend/delivery/stops.py backend/delivery/services.py backend/delivery/tests/base.py backend/delivery/tests/test_stops.py
git commit -m "feat(delivery): pickup stops per shop, made at assignment in the planned order"
```

---

### Task 4: Plan at checkout and the multi-stop fee (backend)

**Files:**
- Modify: `backend/delivery/stops.py` (add `plan_for_lines`)
- Modify: `backend/delivery/rates.py` (`detour_over_km`, `customer_fee(detour_km=)`, `checkout_fee(plan=)`)
- Modify: `backend/orders/views.py` (`OrderCheckoutView`: plan before the transaction, store `route_plan`)
- Modify: `backend/marketing/views_promos.py` (`_delivery_quote` returns `lines` and `route`)
- Test: `backend/delivery/tests/test_multistop_fee.py`

**Interfaces:**
- Consumes: `planner.plan_route`, `planner.detour_pct`, `planner.MAX_STOPS`, `stops.shop_entries`, `stops.fallback_order`, `config.effective_cart_limits`, `routing.service.leg`.
- Produces:
  - `stops.plan_for_lines(lines, drop_lat, drop_lng) -> dict | None` with keys `owner_ids, planned, total_km, direct_km, legs_km, detour_pct, limit_pct, over_limit, basis` (JSON-safe; `planned=False` gives `total_km/legs_km/detour_pct = None`, `over_limit = False`, `direct_km` from the first fallback shop when both ends are known)
  - `rates.detour_over_km(total_km, direct_km, limit_pct) -> Decimal` (km beyond `direct x (1 + limit/100)`, never negative, 0 when unknown)
  - `rates.customer_fee(card, km, *, vehicle="motorbike", express=False, extra_pickups=0, detour_km=0, basis=BASIS)` adds a line `"Detour {km} km"` at the per-km rate when `detour_km > 0`
  - `rates.checkout_fee(items, lat, lng, *, express=False, plan=None) -> (card, fee) | None`; `fee["route"] = {"stops", "planned", "total_km", "direct_km", "detour_pct", "limit_pct", "detour_charged_km", "basis"}`
  - `Order.route_plan` stored for every door-to-door checkout (fees on or off); the cart quote's `delivery` gains `lines` and `route`.

- [ ] **Step 1: Write the failing tests** `backend/delivery/tests/test_multistop_fee.py`:

```python
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.test import SimpleTestCase, override_settings
from django.utils import timezone

from accounts.authentication import issue_token
from accounts.models import BusinessOwner
from cart.models import Cart, CartItem
from delivery import rates
from marketing.models_waivers import DeliveryWaiver
from orders.models import Order
from routing import service as routing_service

from .base import DROP
from .test_dispatch import CARD, EngineCase

A, B, C = (6.70, -1.62), (6.705, -1.615), (6.71, -1.61)
UNDER = [[0, 2, 9, 5], [2, 0, 3, 4], [9, 3, 0, 1], [5, 4, 1, 0]]     # best A-B-C-H 6 km, direct 5 (20 %)
OVER = [[0, 4, 9, 5], [4, 0, 3, 9], [9, 3, 0, 3], [5, 9, 3, 0]]      # best A-B-C-H 10 km, direct 5 (100 %)
AT_LIMIT = [[0, 1, 9, 5], [1, 0, 3, 9], [9, 3, 0, 3], [5, 9, 3, 0]]  # best A-B-C-H 7 km, direct 5 (exactly 40 %)


def table(km, basis=routing_service.BASIS_ROAD):
    return mock.patch("routing.planner.service.matrix", return_value={"km": km, "basis": basis})


def leg(km):
    return {"distance_km": km, "duration_s": 600, "basis": routing_service.BASIS_ROAD, "geometry": None}


class Card:
    customer_base, customer_per_km, customer_min_fee, extra_pickup = "5", "1.5", "8", "2"
    express_multiplier, round_up_to, vehicle_multipliers = "1", "0.5", {}


class FeeLineTests(SimpleTestCase):
    def test_extra_pickups_and_the_detour_are_their_own_lines(self):
        fee = rates.customer_fee(Card, 5, extra_pickups=2, detour_km=Decimal("3"))
        self.assertEqual([l["label"] for l in fee["lines"]], ["Base", "Distance 5 km", "2 extra pickup(s)", "Detour 3 km"])
        self.assertEqual(fee["lines"][3]["amount"], "4.50")
        self.assertEqual(fee["total"], "21.00")

    def test_detour_over_km_counts_only_beyond_the_allowance(self):
        self.assertEqual(rates.detour_over_km(10, 5, 40), Decimal("3.00"))
        self.assertEqual(rates.detour_over_km(7, 5, 40), Decimal("0.00"))
        self.assertEqual(rates.detour_over_km(6, 5, 40), Decimal("0.00"))
        self.assertEqual(rates.detour_over_km(4, 0, 40), Decimal("4.00"))
        self.assertEqual(rates.detour_over_km(None, 5, 40), Decimal("0"))


@override_settings(DELIVERY_FEE_ENABLED=True)
class MultiStopCheckoutTests(EngineCase):
    def setUp(self):
        super().setUp()
        self.as_staff(self.admin, sudo=True)
        assert self.client.post("/api/delivery/rules/rate-card/", {"values": CARD}, format="json").status_code == 201
        self.shop_a, self.item_a = self.make_shop("Shop A", "+233207000201", A)
        self.shop_b, self.item_b = self.make_shop("Shop B", "+233207000202", B)
        self.shop_c, self.item_c = self.make_shop("Shop C", "+233207000203", C)

    def checkout(self, *listings, drop=DROP, method="door_to_door"):
        cart, _ = Cart.objects.get_or_create(customer=self.customer)
        cart.items.all().delete()
        for listing in listings:
            CartItem.objects.create(cart=cart, listing=listing, quantity=1, unit_price_snapshot="10.00")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        body = {"delivery_method": method, "delivery_address": "1 Road", "delivery_phone": "+233200000000"}
        if drop:
            body.update({"delivery_lat": drop[0], "delivery_lng": drop[1]})
        response = self.client.post("/api/orders/checkout/", body, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return Order.objects.get(pk=response.json()["id"])

    def lines(self, order):
        return {l["label"]: l["amount"] for l in order.delivery_fee_breakdown["lines"]}

    def test_three_shops_under_the_detour_limit(self):
        with table(UNDER):
            order = self.checkout(self.item_a, self.item_b, self.item_c)
        self.assertEqual(self.lines(order)["2 extra pickup(s)"], "4.00")  # CARD's extra_pickup is 2
        self.assertFalse(any(label.startswith("Detour") for label in self.lines(order)))
        self.assertEqual(order.delivery_fee, Decimal("16.50"))  # 5 + 5 km x 1.5 + 2 x 2, rounded to 0.50
        plan = order.route_plan
        self.assertEqual(plan["owner_ids"], [self.shop_a.pk, self.shop_b.pk, self.shop_c.pk])
        self.assertEqual((plan["total_km"], plan["direct_km"], plan["detour_pct"], plan["limit_pct"], plan["over_limit"]), (6, 5, 20.0, 40, False))
        self.assertEqual(order.delivery_fee_breakdown["route"]["stops"], 3)

    def test_over_the_limit_charges_only_the_km_beyond_the_allowance(self):
        with table(OVER):
            order = self.checkout(self.item_a, self.item_b, self.item_c)
        self.assertEqual(self.lines(order)["Detour 3.00 km"], "4.50")  # 10 - 5 x 1.4 = 3 km at 1.5
        self.assertEqual(order.delivery_fee, Decimal("21.00"))
        self.assertTrue(order.route_plan["over_limit"])
        self.assertEqual(order.delivery_fee_breakdown["route"]["detour_charged_km"], "3.00")

    def test_exactly_at_the_limit_adds_no_detour(self):
        with table(AT_LIMIT):
            order = self.checkout(self.item_a, self.item_b, self.item_c)
        self.assertFalse(any(label.startswith("Detour") for label in self.lines(order)))
        self.assertFalse(order.route_plan["over_limit"])

    def test_an_estimated_route_labels_the_fee(self):
        with table(UNDER, basis=routing_service.BASIS_ESTIMATE):
            order = self.checkout(self.item_a, self.item_b, self.item_c)
        self.assertEqual(order.delivery_fee_breakdown["distance_basis"], routing_service.BASIS_ESTIMATE)
        self.assertEqual(order.route_plan["basis"], routing_service.BASIS_ESTIMATE)

    def test_no_drop_pin_stores_a_fallback_plan_and_charges_nothing(self):
        chop, food = self.make_shop("Chop Bar", "+233207000204", C, slug="food")
        order = self.checkout(food, self.item_a, drop=None)
        self.assertIsNone(order.delivery_fee)
        self.assertEqual(order.route_plan["owner_ids"], [self.shop_a.pk, chop.pk])
        self.assertEqual((order.route_plan["planned"], order.route_plan["total_km"], order.route_plan["direct_km"]), (False, None, None))

    def test_a_shop_without_a_pin_falls_back_and_charges_from_the_first_shop(self):
        _, nowhere = self.make_shop("Shop X", "+233207000205", None)
        with mock.patch("delivery.stops.routing_service.leg", return_value=leg(4.0)):
            order = self.checkout(self.item_a, nowhere)
        self.assertFalse(order.route_plan["planned"])
        self.assertEqual(order.route_plan["direct_km"], 4.0)
        self.assertFalse(any(label.startswith("Detour") for label in self.lines(order)))
        self.assertEqual(order.delivery_fee, Decimal("13.00"))  # 5 + 4 km x 1.5 + 1 x 2

    def test_a_single_shop_at_the_delivery_point_does_not_divide_by_zero(self):
        with mock.patch("routing.planner.service.leg", return_value=leg(0.0)):
            order = self.checkout(self.item_a)
        self.assertIsNone(order.route_plan["detour_pct"])
        self.assertFalse(order.route_plan["over_limit"])
        self.assertEqual(order.delivery_fee, Decimal("8.00"))  # the card's minimum fee

    def test_store_pickup_stores_no_plan(self):
        self.assertIsNone(self.checkout(self.item_a, self.item_b, method="store_pickup").route_plan)

    def test_a_free_delivery_promo_from_one_of_three_shops_waives_nothing(self):
        BusinessOwner.objects.filter(pk=self.shop_a.pk).update(kyc_status=BusinessOwner.VERIFIED)
        now = timezone.now()
        DeliveryWaiver.objects.create(business_owner=self.shop_a, name="Free", status=DeliveryWaiver.ACTIVE, all_items=True,
                                      starts_at=now - timedelta(hours=1), ends_at=now + timedelta(days=1))
        with table(UNDER):
            order = self.checkout(self.item_a, self.item_b, self.item_c)
        self.assertNotIn("waived", order.delivery_fee_breakdown)
        self.assertEqual(order.delivery_fee, Decimal("16.50"))
```

- [ ] **Step 2: Run, expect FAIL**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test delivery.tests.test_multistop_fee`
Expected: FAIL (`TypeError: customer_fee() got an unexpected keyword argument 'detour_km'`, `AttributeError: ... detour_over_km`).

- [ ] **Step 3: Add `plan_for_lines` to `stops.py`** (and `from routing import service as routing_service` at the top):

```python
def plan_for_lines(lines, drop_lat, drop_lng):
    """The pickup route for a cart or an order, ready to store on Order.route_plan (JSON-safe); None for no lines.
    planned=True: every shop and the drop are located and there are at most planner.MAX_STOPS shops, so this is the
    shortest order with food last. Otherwise the fallback order, with direct_km measured from its first shop when both
    ends are known, and no total, detour or over-limit (none is made up)."""
    from routing import planner

    from . import config, rates

    entries = shop_entries(lines)
    if not entries:
        return None
    limit = config.effective_cart_limits()["detour_limit_pct"]
    drop = _point(drop_lat, drop_lng)
    plan = {"limit_pct": limit, "total_km": None, "direct_km": None, "legs_km": None, "detour_pct": None, "over_limit": False, "basis": None}
    if drop is not None and all(e["lat"] is not None for e in entries) and len(entries) <= planner.MAX_STOPS:
        got = planner.plan_route([{k: e[k] for k in ("key", "lat", "lng", "food")} for e in entries], drop)
        over = rates.detour_over_km(got["total_km"], got["direct_km"], limit)
        plan.update({"owner_ids": got["order"], "planned": True, "total_km": got["total_km"], "direct_km": got["direct_km"],
                     "legs_km": got["legs_km"], "detour_pct": planner.detour_pct(got["total_km"], got["direct_km"]),
                     "over_limit": over > 0, "basis": got["basis"]})
        return plan
    order = fallback_order(entries)
    plan.update({"owner_ids": order, "planned": False})
    first = next(e for e in entries if e["key"] == order[0])
    if drop is not None and first["lat"] is not None:
        leg = routing_service.leg((first["lat"], first["lng"]), drop)
        plan.update({"direct_km": float(leg["distance_km"]), "basis": leg["basis"]})
    return plan
```

- [ ] **Step 4: Pricing in `rates.py`.** Add `detour_over_km`, the `detour_km` line, and replace `checkout_fee`:

```python
def detour_over_km(total_km, direct_km, limit_pct):
    """Road km the planned route runs beyond the detour allowance (direct x (1 + limit%)); 0 within it or when unknown."""
    if total_km is None or direct_km is None:
        return Decimal("0")
    over = _d(total_km) - _d(direct_km) * (1 + _d(limit_pct) / 100)
    return max(Decimal("0"), over).quantize(CENT, ROUND_HALF_UP)
```

In `customer_fee`, change the signature to `customer_fee(card, km, *, vehicle="motorbike", express=False, extra_pickups=0, detour_km=0, basis=BASIS)` and right after the `extra_pickups` block add:

```python
    detour = _d(detour_km)
    if detour > 0:
        lines.append((f"Detour {detour} km", _d(card.customer_per_km) * detour))
```

```python
def checkout_fee(items, delivery_lat, delivery_lng, *, express=False, plan=None):
    """Fee for a door-to-door checkout, or None (no live card, or the first pickup to the drop cannot be measured). Base
    and distance are on the road km from the first planned shop to the drop, plus extra_pickup for every further shop,
    plus the km beyond the card's detour allowance at the per-km rate (spec 2026-10-14 section 4); fee["route"] says how
    it was planned. The caller adds it to the total only when settings.DELIVERY_FEE_ENABLED is on."""
    from . import stops

    card = config.live(config.RateCard)
    if card is None or not items:
        return None
    plan = plan if plan is not None else stops.plan_for_lines(items, delivery_lat, delivery_lng)
    if plan is None or plan["direct_km"] is None:
        return None
    detour = detour_over_km(plan["total_km"], plan["direct_km"], card.detour_limit_pct) if plan["planned"] else Decimal("0")
    fee = customer_fee(card, plan["direct_km"], express=express, extra_pickups=len(plan["owner_ids"]) - 1, detour_km=detour,
                       basis=plan["basis"] or BASIS)
    fee["route"] = {
        "stops": len(plan["owner_ids"]), "planned": plan["planned"], "total_km": plan["total_km"], "direct_km": plan["direct_km"],
        "detour_pct": plan["detour_pct"], "limit_pct": card.detour_limit_pct, "detour_charged_km": str(detour), "basis": plan["basis"],
    }
    return card, fee
```

- [ ] **Step 5: Checkout stores the plan.** In `OrderCheckoutView.post`:

```python
        items = list(cart.items.select_related("listing__business_owner__profile", "listing__category")) if cart is not None else []
```

and replace the fee-quote block (still before `db_transaction.atomic()`, so no network wait holds the transaction open):

```python
        # The pickup route and the fee may call the road-routing service (a network round trip), so both are worked out
        # before the transaction opens: they need no row lock and must not hold a database transaction open while they wait.
        plan = None
        if delivery_method == Order.DOOR_TO_DOOR:
            from delivery.stops import plan_for_lines

            plan = plan_for_lines(items, request.data.get("delivery_lat"), request.data.get("delivery_lng"))
        quoted = None
        if settings.DELIVERY_FEE_ENABLED and delivery_method == Order.DOOR_TO_DOOR:
            from delivery.rates import checkout_fee

            quoted = checkout_fee(items, request.data.get("delivery_lat"), request.data.get("delivery_lng"), plan=plan)
```

and pass `route_plan=plan,` to `Order.objects.create(...)`.

In `marketing/views_promos._delivery_quote`, after `out = {...}` add:

```python
    out["lines"] = quoted[1]["lines"] if quoted else None
    out["route"] = quoted[1].get("route") if quoted else None
```

- [ ] **Step 6: Run, expect PASS**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test delivery orders marketing`
Expected: PASS (the service-area tests still see the quote taken before the transaction, and `checkout_fee` is never called with fees off).

- [ ] **Step 7: Commit**

```bash
git add backend/delivery/stops.py backend/delivery/rates.py backend/orders/views.py backend/marketing/views_promos.py backend/delivery/tests/test_multistop_fee.py
git commit -m "feat(delivery): plan the pickup route at checkout and price extra pickups and detour"
```

---

### Task 5: The rider works one stop at a time (backend)

**Files:**
- Modify: `backend/delivery/stops.py` (add `rider_point`, `refresh_planned_arrivals`, `skip_history`)
- Modify: `backend/delivery/services.py` (`_stamp(at_stop=)`, `accept`, `arrive_pickup`, `pickup`, new `skip_stop`, `_after_stop`, `_check_stop_code`, `open_case_for_skipped_stop`, `ALL_STOPS_SKIPPED`, `open_case_for_failed_delivery` dedupe, `legacy_pickup`)
- Modify: `backend/delivery/board.py` (`queue_row` adds `returned_reason`, `skips`; `waiting_orders` is NOT changed: a job that failed as `all_stops_skipped` is already waiting, like any failed job)
- Modify: `backend/delivery/payloads.py` (`stop_row`, `stops_block` replace `pickup_block`; `rider_job`)
- Modify: `backend/delivery/views_live.py` (`manager_job` reads `stops_block`)
- Modify: `backend/delivery/views_rider.py` (`SkipStopView`; read path prefetches stops)
- Modify: `backend/delivery/views_queue.py` (`offer_payload` adds `stop_count`, `route_km`)
- Modify: `backend/delivery/urls.py`
- Test: `backend/delivery/tests/test_multistop_rider.py`

**Interfaces:**
- Consumes: Task 3 `stops.*`, `PickupStop`, `DeliveryEvent.COLLECTED_STOP/SKIPPED_STOP`.
- Produces:
  - `services.skip_stop(assignment, by, note, *, stop=None, lat=None, lng=None, accuracy=None) -> DeliveryEvent` (rider: the current stop, status accepted/at_pickup, and the rider's GPS fix is REQUIRED, 400 `location_needed` without it, because the pin is the evidence; manager passes `stop`: any open stop, status assigned/accepted/at_pickup, no pin). Note required, at most 300 characters (400 `invalid`, `field: "note"`); done stop 409 `stop_done`. The event it writes (`step=skipped_stop`, `stop`, `lat`, `lng`, `accuracy_m`, `at`, `note`, `distance_m`, `flagged`) is the skip evidence.
  - `services.ALL_STOPS_SKIPPED = "all_stops_skipped"`; assignment status between stops is `accepted`, `picked_up` only after the last stop, `failed` with that reason when nothing was collected. That failed job is requeued: it appears in `board.waiting_orders()` with `returned: true`, and `services.assign` on it resets the same row (see Global Constraints).
  - `stops.skip_history(a) -> [{"stop_id", "sequence", "business_owner_id", "business_name", "at", "note", "pinned", "lat", "lng", "accuracy_m", "distance_m", "at_shop", "by": "rider"|"manager"}]` oldest first, read from the `skipped_stop` events (survives a reset and a new rider). `at_shop` is true for a rider skip whose pin is not flagged as far from the shop.
  - `services.open_case_for_skipped_stop(assignment, stop) -> Dispute`
  - `stops.rider_point(a) -> (lat, lng) | None`, `stops.refresh_planned_arrivals(a, origin=None, start=None)`
  - `payloads.stop_row(stop, order, skips=()) -> {"id", "sequence", "business_name", "phone", "lat", "lng", "status", "status_label", "planned_arrival", "arrived_at", "collected_at", "skip_note", "items": [str], "attempts_left", "wrong_tries"}` (never a code)
  - `payloads.stops_block(a, *, evidence=False) -> {"primary", "all", "current", "multi_pickup", "progress", "skip_history"}` (`evidence=True`, manager only: rows also carry `skips`, and `skip_history` is filled; the rider payload never carries a pin)
  - `rider_job` adds `current_stop`, `progress`; `pickups` are stop rows; `pickup_attempts_left` is the current stop's
  - `POST /api/delivery/rider/jobs/<pk>/skip-stop/ {note, lat?, lng?, accuracy_m?}` (name `delivery-rider-skip-stop`)
  - `offer_payload` adds `stop_count: int` and `route_km: float | None`

- [ ] **Step 1: Write the failing tests** `backend/delivery/tests/test_multistop_rider.py`:

```python
from datetime import timedelta
from unittest import mock

from django.utils import timezone

from delivery import board, stops
from delivery.models import PickupStop, ShiftSession
from disputes.models import Dispute
from notifications.models import Notification
from orders.models import DeliveryAssignment as DA, Order
from routing import service as routing_service

from .base import DROP, DeliveryCase

A, B, C = (6.70, -1.62), (6.705, -1.615), (6.71, -1.61)


def near(point):
    return (point[0] + 0.0001, point[1])


class MultiStopRiderCase(DeliveryCase):
    def setUp(self):
        super().setUp()
        self.shop_a, self.item_a = self.make_shop("Shop A", "+233207000301", A)
        self.shop_b, self.item_b = self.make_shop("Shop B", "+233207000302", B)
        self.shop_c, self.item_c = self.make_shop("Shop C", "+233207000303", C)
        self.order = self.multi_order(self.item_a, self.item_b, self.item_c)
        self.job = self.assign(self.order)
        self.first, self.second, self.third = self.job.stops.all()

    def code_of(self, stop):
        stop.refresh_from_db()
        return stop.code

    def collect(self, stop, point):
        self.assertEqual(self.step(self.job, "arrive-pickup", self.at(near(point))).status_code, 200)
        r = self.step(self.job, "pickup", {**self.at(near(point)), "code": self.code_of(stop)})
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def skip(self, note="Shop closed early", **extra):
        """A rider's skip: the rider's pin is required, so one is sent unless `extra` brings its own."""
        return self.step(self.job, "skip-stop", {"note": note, **self.at(near(A)), **extra})


class StopByStopTests(MultiStopRiderCase):
    def test_the_rider_collects_each_shop_in_turn_then_heads_to_the_customer(self):
        self.step(self.job, "accept")
        body = self.collect(self.first, A)
        self.assertEqual(body["status"], "accepted")
        self.assertEqual(body["current_stop"]["business_name"], "Shop B")
        self.assertEqual(body["progress"], {"total": 3, "done": 1, "skipped": 0, "current": 2})
        self.order.refresh_from_db()
        self.assertEqual(self.order.delivery_status, Order.PROCESSING)
        self.collect(self.second, B)
        body = self.collect(self.third, C)
        self.assertEqual(body["status"], "picked_up")
        self.assertIsNone(body["current_stop"])
        self.assertEqual(list(self.job.events.values_list("step", flat=True)), [
            "assigned", "accepted", "arrived_pickup", "collected_stop", "arrived_pickup", "collected_stop", "arrived_pickup", "picked_up",
        ])
        self.assertEqual(list(self.job.events.exclude(stop=None).values_list("stop__sequence", flat=True)), [1, 1, 2, 2, 3, 3])
        self.order.refresh_from_db()
        self.assertEqual(self.order.delivery_status, Order.OUT_FOR_DELIVERY)

    def test_each_shop_has_its_own_code_and_its_own_wrong_tries(self):
        self.step(self.job, "accept")
        self.collect(self.first, A)
        self.step(self.job, "arrive-pickup", self.at(near(B)))
        wrong = self.code_of(self.first)
        r = self.step(self.job, "pickup", {**self.at(near(B)), "code": wrong})
        self.assertEqual((r.status_code, r.json()["attempts_left"]), (400, 4))
        self.first.refresh_from_db()
        self.second.refresh_from_db()
        self.job.refresh_from_db()
        self.assertEqual((self.first.code_attempts, self.second.code_attempts, self.job.pickup_code_attempts), (0, 1, 0))
        for _ in range(4):
            self.step(self.job, "pickup", {**self.at(near(B)), "code": wrong})
        locked = self.step(self.job, "pickup", {**self.at(near(B)), "code": self.code_of(self.second)})
        self.assertEqual(locked.status_code, 423)

    def test_the_rider_payload_lists_every_stop_and_never_a_code(self):
        for stop, code in zip((self.first, self.second, self.third), ("QA11", "QB22", "QC33")):
            PickupStop.objects.filter(pk=stop.pk).update(code=code)
        DA.objects.filter(pk=self.job.pk).update(drop_code="QD44")
        r = self.as_staff(self.rider_staff).get(f"/api/delivery/rider/jobs/{self.job.pk}/")
        body = r.json()
        self.assertEqual([p["business_name"] for p in body["pickups"]], ["Shop A", "Shop B", "Shop C"])
        self.assertEqual(body["pickups"][1]["items"], ["Shop B item × 1"])
        self.assertTrue(body["multi_pickup"])
        self.assertEqual(body["current_stop"]["sequence"], 1)
        for code in ("QA11", "QB22", "QC33", "QD44"):
            self.assertNotIn(code, r.content.decode())

    def test_an_offer_says_how_many_shops(self):
        from delivery.models import Offer
        from delivery.views_queue import offer_payload

        order = self.multi_order(self.item_a, self.item_b)
        offer = Offer.objects.create(order=order, rider=self.rider, expires_at=timezone.now() + timedelta(seconds=45))
        self.assertEqual(offer_payload(offer)["stop_count"], 2)


class SkipTests(MultiStopRiderCase):
    def test_a_skip_needs_a_note_and_opens_one_case_for_that_shop_only(self):
        self.step(self.job, "accept")
        self.collect(self.first, A)
        self.step(self.job, "arrive-pickup", self.at(near(B)))
        self.assertEqual(self.skip("  ").status_code, 400)
        r = self.skip(**self.at(near(B)))
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "accepted")
        self.assertEqual(r.json()["current_stop"]["business_name"], "Shop C")
        case = Dispute.objects.get(order=self.order)
        self.assertEqual((case.case_type, case.reason, case.raised_by_id), (Dispute.NOT_RECEIVED, Dispute.DELIVERY_ISSUE, self.customer.pk))
        self.assertIn("Shop B item × 1", case.description)
        self.assertIn("GH₵ 10.00", case.description)
        self.assertNotIn("Shop A item", case.description)
        self.assertNotIn("Shop C item", case.description)
        self.second.refresh_from_db()
        self.assertEqual((self.second.status, self.second.dispute_id, self.second.skip_note), (PickupStop.SKIPPED, case.pk, "Shop closed early"))
        self.assertTrue(Notification.objects.filter(customer=self.customer, title="A shop could not hand over your items").exists())

    def test_skipping_the_last_open_shop_sends_the_rider_to_the_customer(self):
        self.step(self.job, "accept")
        self.collect(self.first, A)
        self.collect(self.second, B)
        r = self.skip()
        self.assertEqual(r.json()["status"], "picked_up")
        self.assertEqual(list(self.job.events.values_list("step", flat=True))[-2:], ["skipped_stop", "picked_up"])

    def test_when_every_shop_is_skipped_the_order_goes_back_to_the_queue(self):
        self.step(self.job, "accept")
        for _ in range(3):
            self.assertEqual(self.skip().status_code, 200)
        self.job.refresh_from_db()
        self.assertEqual((self.job.status, self.job.failed_reason), (DA.FAILED, "all_stops_skipped"))
        self.assertEqual(Dispute.objects.filter(order=self.order).count(), 3)  # one refund case per shop, as planned
        self.assertIn(self.order.pk, set(board.waiting_orders().values_list("pk", flat=True)))
        row = next(board.queue_row(o, timezone.now()) for o in board.waiting_orders() if o.pk == self.order.pk)
        self.assertEqual((row["returned"], row["returned_reason"]), (True, "all_stops_skipped"))
        self.assertEqual(len(row["skips"]), 3)

    def test_a_returned_order_can_be_given_to_a_new_rider_and_the_evidence_survives(self):
        self.step(self.job, "accept")
        for _ in range(3):
            self.skip(note="Closed")
        codes = {s.pk: s.code for s in self.job.stops.all()}
        again = self.assign(self.order, self.other_staff)
        self.assertEqual(DA.objects.filter(order=self.order).count(), 1)  # one row per order: the failed attempt is reset, not replaced
        self.assertEqual((again.pk, again.status, again.dispatch_id, again.failed_reason, again.failed_at),
                         (self.job.pk, DA.ASSIGNED, self.other_staff.pk, "", None))
        rows = list(again.stops.all())
        self.assertEqual({s.status for s in rows}, {PickupStop.PENDING})
        self.assertEqual({s.pk: s.code for s in rows}, codes)
        self.assertEqual({(s.skip_note, s.dispute_id) for s in rows}, {("", None)})
        self.assertEqual(Dispute.objects.filter(order=self.order).count(), 3)  # the refund cases stay for the manager to settle
        self.assertEqual(self.job.events.filter(step="skipped_stop").count(), 3)
        self.assertEqual([h["note"] for h in stops.skip_history(again)], ["Closed"] * 3)
        self.assertNotIn(self.order.pk, set(board.waiting_orders().values_list("pk", flat=True)))

    def test_a_skip_keeps_the_riders_pin_time_and_note(self):
        self.step(self.job, "accept")
        refused = self.step(self.job, "skip-stop", {"note": "Door locked"})  # no location sent
        self.assertEqual((refused.status_code, refused.json()["code"]), (400, "location_needed"))
        before = timezone.now()
        self.assertEqual(self.skip(note="Door locked", lat=A[0] + 0.0001, lng=A[1], accuracy_m=7).status_code, 200)
        event = self.job.events.get(step="skipped_stop")
        self.assertEqual((event.stop_id, event.note, event.accuracy_m), (self.first.pk, "Door locked", 7.0))
        self.assertEqual((round(event.lat, 4), round(event.lng, 4)), (round(A[0] + 0.0001, 4), round(A[1], 4)))
        self.assertGreaterEqual(event.at, before)
        history = stops.skip_history(self.job)
        self.assertEqual([(h["business_name"], h["note"], h["pinned"], h["by"], h["at_shop"]) for h in history], [("Shop A", "Door locked", True, "rider", True)])
        self.assertFalse(self.skip(note="x" * 301).status_code == 200)  # the note is capped at 300 characters

    def test_a_later_can_t_deliver_still_opens_its_own_case(self):
        self.step(self.job, "accept")
        self.collect(self.first, A)
        self.skip()
        self.collect(self.third, C)
        self.step(self.job, "arrive-drop", self.at(near(DROP)))
        r = self.step(self.job, "cant-deliver", {**self.at(near(DROP)), "reason": "wrong_address", "note": "No such house"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(Dispute.objects.filter(order=self.order).count(), 2)


class LegacyTests(DeliveryCase):
    def test_a_job_from_before_stops_carries_on_with_its_one_pickup_and_code(self):
        _, item_a = self.make_shop("Shop A", "+233207000311", (6.70, -1.62))
        _, item_b = self.make_shop("Shop B", "+233207000312", (6.705, -1.615))
        job = self.assign(self.multi_order(item_a, item_b))
        job.stops.all().delete()
        DA.objects.filter(pk=job.pk).update(pickup_code="4321", status=DA.ACCEPTED)
        body = self.as_staff(self.rider_staff).get(f"/api/delivery/rider/jobs/{job.pk}/").json()
        self.assertEqual([(p["id"], p["business_name"]) for p in body["pickups"]], [(None, "Shop A")])
        self.assertEqual(PickupStop.objects.filter(assignment=job).count(), 0)  # a read writes nothing
        self.assertEqual(self.step(job, "arrive-pickup", self.at((6.7001, -1.62))).status_code, 200)
        self.assertEqual(PickupStop.objects.filter(assignment=job).count(), 1)
        r = self.step(job, "pickup", {**self.at((6.7001, -1.62)), "code": "4321"})
        self.assertEqual((r.status_code, r.json()["status"]), (200, "picked_up"))

    def test_the_old_pickup_button_refuses_a_multi_shop_job(self):
        _, item_a = self.make_shop("Shop A", "+233207000313", (6.70, -1.62))
        _, item_b = self.make_shop("Shop B", "+233207000314", (6.705, -1.615))
        job = self.assign(self.multi_order(item_a, item_b))
        r = self.as_staff(self.rider_staff).post(f"/api/orders/delivery/{job.id}/pickup/", {"code": job.pickup_code}, format="json")
        self.assertEqual((r.status_code, r.json()["code"]), (409, "multi_stop"))


class PlannedArrivalTests(DeliveryCase):
    def test_accepting_plans_an_arrival_per_shop_along_the_sequence(self):
        _, item_a = self.make_shop("Shop A", "+233207000321", (6.70, -1.62))
        _, item_b = self.make_shop("Shop B", "+233207000322", (6.705, -1.615))
        _, item_c = self.make_shop("Shop C", "+233207000323", None)
        job = self.assign(self.multi_order(item_a, item_b, item_c))
        ShiftSession.objects.create(rider=self.rider, last_lat=6.69, last_lng=-1.62, last_fix_at=timezone.now())
        road = {"distance_km": 1.0, "duration_s": 300, "basis": routing_service.BASIS_ROAD, "geometry": None}
        with mock.patch("delivery.stops.routing_service.leg", return_value=road):
            self.step(job, "accept")
        job.refresh_from_db()
        a, b, c = job.stops.all()
        self.assertEqual(a.planned_arrival, job.accepted_at + timedelta(seconds=300))
        self.assertEqual(b.planned_arrival - a.planned_arrival, timedelta(seconds=300))
        self.assertIsNone(c.planned_arrival)  # no location, so no time is made up

    def test_without_a_rider_location_no_time_is_made_up(self):
        _, item_a = self.make_shop("Shop A", "+233207000324", (6.70, -1.62))
        job = self.assign(self.multi_order(item_a))
        self.step(job, "accept")
        self.assertIsNone(job.stops.get().planned_arrival)
```

- [ ] **Step 2: Run, expect FAIL**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test delivery.tests.test_multistop_rider`
Expected: FAIL (`skip-stop` 404, `KeyError: 'current_stop'`, stop codes not checked).

- [ ] **Step 3: Planned arrivals in `stops.py`** (add `from datetime import timedelta` and `from django.utils import timezone` at the top):

```python
def rider_point(assignment):
    """The rider's last fix from their open shift, or None."""
    from . import services

    rider = getattr(assignment.dispatch, "rider", None) if assignment.dispatch_id else None
    shift = services.open_shift(rider) if rider else None
    if shift is None or shift.last_lat is None or shift.last_lng is None:
        return None
    return (float(shift.last_lat), float(shift.last_lng))


def refresh_planned_arrivals(assignment, origin=None, start=None):
    """Planned arrival at each open stop, chained along the fixed sequence by road time from `origin` (the rider's fix,
    or the stop just finished) starting at `start`. No origin, or a stop without a location, leaves that stop and every
    later one without a time (none is made up). Shops are shown it as "about HH:MM"."""
    at = start or timezone.now()
    here = origin
    for stop in [s for s in ensure_stops(assignment) if s.status in PickupStop.OPEN]:
        if here is None or stop.lat is None:
            stop.planned_arrival, here = None, None
        else:
            leg = routing_service.leg(here, (stop.lat, stop.lng))
            at = at + timedelta(seconds=int(leg["duration_s"]))
            stop.planned_arrival, here = at, (stop.lat, stop.lng)
        stop.save(update_fields=["planned_arrival"])


def skip_history(assignment):
    """Every skip on this delivery, oldest first, read from the append-only `skipped_stop` events. It outlives a failed
    attempt: re-dispatching resets the assignment and reopens the stops, but never touches these events. `by` is "rider"
    when the rider's own pin was recorded and "manager" for a manager's skip (no pin). `at_shop` is true for a rider skip
    whose pin is not flagged as far from the shop (or the shop has no pin to compare with)."""
    from .models import DeliveryEvent

    by_id = {s.pk: s for s in stops_of(assignment) if s.pk}
    events = DeliveryEvent.objects.filter(assignment=assignment, step=DeliveryEvent.SKIPPED_STOP, stop__isnull=False).order_by("at", "id")
    out = []
    for e in events:
        stop = by_id.get(e.stop_id)
        if stop is None:
            continue
        rider = e.lat is not None
        out.append({
            "stop_id": e.stop_id, "sequence": stop.sequence, "business_owner_id": stop.business_owner_id, "business_name": stop_name(stop),
            "at": e.at, "note": e.note, "pinned": rider, "lat": e.lat, "lng": e.lng, "accuracy_m": e.accuracy_m,
            "distance_m": e.distance_m, "at_shop": rider and not e.flagged, "by": "rider" if rider else "manager",
        })
    return out
```

- [ ] **Step 4: The rider's steps in `services.py`.** Add `from decimal import Decimal` and `from .models import PickupStop` (with the other model imports). Give `_stamp` a keyword `at_stop=None` and pass `stop=at_stop` to `DeliveryEvent.objects.create`. Then:

```python
ALL_STOPS_SKIPPED = "all_stops_skipped"
```

At the end of `accept` (after `_sync`):

```python
    from . import stops

    stops.ensure_stops(assignment)
    stops.refresh_planned_arrivals(assignment, origin=stops.rider_point(assignment), start=assignment.accepted_at)
```

Replace `arrive_pickup` and `pickup`:

```python
def arrive_pickup(assignment, rider_staff, lat, lng, accuracy):
    from orders.models import DeliveryAssignment

    from . import stops

    if assignment.status not in (DeliveryAssignment.ASSIGNED, DeliveryAssignment.ACCEPTED):
        raise DeliveryError("You can only arrive at the pickup before collecting the order.", 409, "wrong_step")
    lat, lng, accuracy = _fix(lat, lng, accuracy)
    stops.ensure_stops(assignment)
    stop = stops.current_stop(assignment)
    if stop is None:
        raise DeliveryError("Every shop on this delivery is done.", 409, "wrong_step")
    event = _stamp(assignment, DeliveryEvent.ARRIVED_PICKUP, rider_staff, (stop.lat, stop.lng), lat, lng, accuracy, at_stop=stop)
    stop.status, stop.arrived_at = PickupStop.ARRIVED, event.at
    stop.save(update_fields=["status", "arrived_at"])
    assignment.status = DeliveryAssignment.AT_PICKUP
    assignment.arrived_pickup_at = event.at
    assignment.save(update_fields=["status", "arrived_pickup_at"])
    if event.flagged:
        _alert_managers(assignment, "A rider tapped far from the pickup", f"Order #{assignment.order_id}: {event.distance_m} m from the stop.")
    return event


def pickup(assignment, rider_staff, code, lat, lng, accuracy):
    """Collect the current stop with its own code. The last open stop sends the job to the customer."""
    from orders.models import DeliveryAssignment

    from . import stops

    if assignment.status != DeliveryAssignment.AT_PICKUP:
        raise DeliveryError("Tap 'I've arrived' at the pickup first.", 409, "wrong_step")
    lat, lng, accuracy = _fix(lat, lng, accuracy)
    stops.ensure_stops(assignment)
    stop = stops.current_stop(assignment)
    if stop is None or stop.status != PickupStop.ARRIVED:
        raise DeliveryError("Tap 'I've arrived' at the pickup first.", 409, "wrong_step")
    _check_stop_code(assignment, stop, code)
    last = len(stops.open_stops(assignment)) == 1
    step = DeliveryEvent.PICKED_UP if last else DeliveryEvent.COLLECTED_STOP
    event = _stamp(assignment, step, rider_staff, (stop.lat, stop.lng), lat, lng, accuracy, at_stop=stop)
    stop.status, stop.collected_at = PickupStop.COLLECTED, event.at
    stop.save(update_fields=["status", "collected_at"])
    _after_stop(assignment, stop, rider_staff, event.at, left_shop=True)
    return event


def _after_stop(assignment, stop, by, at, *, left_shop, summary_event=False):
    """Move a job on once `stop` is collected or skipped: to the next stop, to the customer, or (nothing was collected
    at all) to failed. `left_shop` is true when the rider was at that shop; `summary_event` writes the picked-up stamp
    when a skip, not a collection, ended the pickups."""
    from orders.models import DeliveryAssignment

    from . import stops

    if stops.open_stops(assignment):
        if left_shop:
            assignment.status, assignment.arrived_pickup_at = DeliveryAssignment.ACCEPTED, None
            assignment.save(update_fields=["status", "arrived_pickup_at"])
        if assignment.accepted_at is not None:
            origin = (stop.lat, stop.lng) if left_shop and stop.lat is not None else stops.rider_point(assignment)
            stops.refresh_planned_arrivals(assignment, origin=origin, start=at)
        return
    if not assignment.stops.filter(status=PickupStop.COLLECTED).exists():
        assignment.status, assignment.failed_at, assignment.failed_reason = DeliveryAssignment.FAILED, at, ALL_STOPS_SKIPPED
        assignment.failed_note = "No shop on this delivery could hand over its items."
        assignment.save(update_fields=["status", "failed_at", "failed_reason", "failed_note"])
        # The order is back in the Delivery queue (board.waiting_orders takes any failed job); say so to the managers.
        _alert_managers(assignment, "Every shop skipped: order is back in the queue", f"Order #{assignment.order_id}: no shop could hand over. Check the skip notes and give it to a rider again.")
        return
    if summary_event:
        DeliveryEvent.objects.create(assignment=assignment, step=DeliveryEvent.PICKED_UP, at=at, by=by, note="The last shop was skipped.")
    assignment.status, assignment.picked_up_at = DeliveryAssignment.PICKED_UP, at
    assignment.save(update_fields=["status", "picked_up_at"])
    _sync(assignment)


def skip_stop(assignment, by, note, *, stop=None, lat=None, lng=None, accuracy=None):
    """A shop cannot hand over: its stop is skipped with a note (required), the customer is told, and a delivery case
    asks for that shop's lines only to be refunded. The skip event keeps the evidence (rider pin, time, note). A rider skips the stop they are working; a manager passes `stop`
    (any open stop, for a shop that closed or cancelled after dispatch)."""
    from orders.models import DeliveryAssignment as DA

    from . import stops

    note = note.strip() if isinstance(note, str) else ""
    if not note:
        raise DeliveryError("Say why this shop cannot hand over.", 400, "invalid", field="note")
    if len(note) > 300:
        raise DeliveryError("Keep the note to 300 characters.", 400, "invalid", field="note")
    by_manager = stop is not None
    allowed = (DA.ASSIGNED, DA.ACCEPTED, DA.AT_PICKUP) if by_manager else (DA.ACCEPTED, DA.AT_PICKUP)
    if assignment.status not in allowed:
        raise DeliveryError("A shop can only be skipped before the order leaves for the customer.", 409, "wrong_step")
    stops.ensure_stops(assignment)
    stop = stop or stops.current_stop(assignment)
    if stop is None or stop.status not in PickupStop.OPEN:
        raise DeliveryError("This shop is already done.", 409, "stop_done")
    left_shop = stop.status == PickupStop.ARRIVED
    if by_manager:  # a manager's skip has no pin: it is the manager's word, not the rider's report
        event = DeliveryEvent.objects.create(assignment=assignment, step=DeliveryEvent.SKIPPED_STOP, at=timezone.now(), by=by, note=note, stop=stop)
    else:  # the rider's pin, time and note are the evidence, so the location is required
        lat, lng, accuracy = _fix(lat, lng, accuracy)
        event = _stamp(assignment, DeliveryEvent.SKIPPED_STOP, by, (stop.lat, stop.lng), lat, lng, accuracy, note=note, at_stop=stop)
    stop.status, stop.skip_note, stop.skipped_by = PickupStop.SKIPPED, note, by
    stop.dispute = open_case_for_skipped_stop(assignment, stop)
    stop.save(update_fields=["status", "skip_note", "skipped_by", "dispute"])
    notify_customer(
        assignment.order.customer, "order_status", "A shop could not hand over your items",
        body=f"{stops.stop_name(stop)} could not hand over its part of Order #{assignment.order_id}. Those items will be refunded; AshantiHub Support will be in touch.",
        link="/my-account", icon="🧾",
    )
    _after_stop(assignment, stop, by, event.at, left_shop=left_shop, summary_event=True)
    return event


def open_case_for_skipped_stop(assignment, stop):
    """The delivery case a skipped stop opens: that shop's lines only, with their total, for the usual case decision
    (a manager records the refund; payments are simulated)."""
    from disputes.models import Dispute

    from . import config, stops

    order = assignment.order
    lines = stops.stop_lines(stop, order)
    total = sum((i.line_total for i in lines), Decimal("0.00"))
    listed = "; ".join(f"{i.listing.name} × {i.quantity} (GH₵ {i.line_total})" for i in lines)
    limits = config.effective_limits()
    return Dispute.objects.create(
        order=order, raised_by=order.customer, reason=Dispute.DELIVERY_ISSUE, case_type=Dispute.NOT_RECEIVED, rider=assignment.dispatch,
        answer_due_at=timezone.now() + timedelta(hours=limits.dispute_answer_hours) if limits else None,
        description=f"{stops.stop_name(stop)} could not hand over its items (stop {stop.sequence}): {listed}. "
                    f"Refund these lines only: GH₵ {total}. Note: {stop.skip_note}",
        status=Dispute.OPEN,
    )


def _check_stop_code(assignment, stop, code):
    """A stop's own code, counted and locked per stop. Stop 1's count is mirrored into the assignment's legacy field.
    The count is saved before the refusal is raised (the request does not roll back)."""
    from . import stops

    if stop.code == "":
        return
    if stop.code_attempts >= CODE_ATTEMPT_LIMIT:
        raise DeliveryError("Too many wrong codes. A manager has been told; ask them to help.", 423, "code_locked")
    if _code_matches(stop.code, code):
        return
    stop.code_attempts += 1
    stop.save(update_fields=["code_attempts"])
    if stop.sequence == 1:
        assignment.pickup_code_attempts = stop.code_attempts
        assignment.save(update_fields=["pickup_code_attempts"])
    if stop.code_attempts >= CODE_ATTEMPT_LIMIT:
        _alert_managers(assignment, "A delivery code was entered wrongly 5 times", f"Order #{assignment.order_id} (pickup code at {stops.stop_name(stop)}).")
    raise DeliveryError("That code is not right.", 400, "wrong_code", attempts_left=max(0, CODE_ATTEMPT_LIMIT - stop.code_attempts))
```

In `open_case_for_failed_delivery`, add `pickup_stop__isnull=True` to the `existing` filter so a skipped shop's case is never mistaken for the failed delivery's. In `legacy_pickup`, after the status check:

```python
    from . import stops

    rows = stops.ensure_stops(assignment)
    if len(rows) > 1:
        raise DeliveryError(f"This delivery collects from {len(rows)} shops. Use the rider app, which takes each shop in turn.", 409, "multi_stop")
    if rows:
        _check_stop_code(assignment, rows[0], code)
    now = timezone.now()
    if rows:
        rows[0].status, rows[0].collected_at = PickupStop.COLLECTED, now
        rows[0].save(update_fields=["status", "collected_at"])
```

(and drop its old `_check_code(assignment, "pickup", code)` and `now = ...` lines). `board.waiting_orders` is left as it is: it already lists any failed job, so an `all_stops_skipped` job is requeued with no change. In `board.queue_row`, inside the returned dict, add:

```python
        "returned_reason": assignment.failed_reason if assignment and assignment.status == DeliveryAssignment.FAILED else "",
        "skips": stops.skip_history(assignment) if assignment else [],
```

(and `from . import payloads, services, stops` at the top of `board.py`; Task 6 reuses the same import).

- [ ] **Step 5: Payloads.** In `payloads.py` replace `pickup_block` with:

```python
def stop_row(stop, order, skips=()):
    """One pickup stop for the rider and the manager: the shop, where it is, what to collect and how it stands. Never its
    code. `skips` is that stop's skip evidence (the manager's payload passes it; the rider's never does, so a rider's
    screen carries no pins of earlier attempts)."""
    from . import stops

    lines = stops.stop_lines(stop, order)
    return {
        "id": stop.pk, "sequence": stop.sequence, "business_name": stops.stop_name(stop),
        "phone": lines[0].listing.contact_phone if lines else None, "lat": stop.lat, "lng": stop.lng,
        "status": stop.status, "status_label": stop.get_status_display(), "planned_arrival": stop.planned_arrival,
        "arrived_at": stop.arrived_at, "collected_at": stop.collected_at, "skip_note": stop.skip_note,
        "items": [f"{i.listing.name} × {i.quantity}" for i in lines],
        "attempts_left": max(0, services.CODE_ATTEMPT_LIMIT - stop.code_attempts), "wrong_tries": stop.code_attempts,
        **({"skips": list(skips)} if skips != () else {}),
    }


def stops_block(assignment, *, evidence=False):
    """Every stop in sequence, the one being worked, and the progress counts. `evidence=True` (the manager's job record)
    adds each stop's `skips` and the whole `skip_history`."""
    from . import stops

    history = stops.skip_history(assignment) if evidence else []
    rows = [stop_row(s, assignment.order, [h for h in history if h["stop_id"] == s.pk] if evidence else ()) for s in stops.stops_of(assignment)]
    progress = stops.progress(assignment)
    current = next((r for r in rows if r["sequence"] == progress["current"]), None)
    return {"primary": current or (rows[0] if rows else None), "all": rows, "current": current, "multi_pickup": len(rows) > 1, "progress": progress, "skip_history": history}
```

In `rider_job`, replace `pickups = pickup_block(order)` with `block = stops_block(assignment)` and in the returned dict use:

```python
        "pickup": block["primary"], "pickups": block["all"], "multi_pickup": block["multi_pickup"],
        "current_stop": block["current"], "progress": block["progress"],
        "pickup_attempts_left": block["current"]["attempts_left"] if block["current"] else max(0, services.CODE_ATTEMPT_LIMIT - assignment.pickup_code_attempts),
```

In `views_live.manager_job`, replace `pickups = payloads.pickup_block(order)` with `block = payloads.stops_block(assignment, evidence=True)` and use `"pickup": block["primary"], "multi_pickup": block["multi_pickup"],`.

- [ ] **Step 6: Endpoints.** In `views_rider.py`, make the read path prefetch the stops (never the locked write path, whose stops are created during the request):

```python
    def job(self, request, pk, *, lock=False):
        queryset = DeliveryAssignment.objects.select_related("order", "order__customer", "dispatch", "dispatch__manager")
        queryset = queryset.prefetch_related("order__items__listing__business_owner__profile", "order__items__listing__category", "events", "calls", "photos")
        if lock:
            queryset = queryset.select_for_update(of=("self",))
        else:
            queryset = queryset.prefetch_related("stops__business_owner__profile")
        return get_object_or_404(queryset, pk=pk, dispatch=request.user)
```

```python
class SkipStopView(_StepView):
    """POST rider/jobs/<id>/skip-stop/ {note, lat?, lng?, accuracy_m?} — the shop being worked cannot hand over."""

    def run(self, a, staff, d):
        services.skip_stop(a, staff, d.get("note", ""), lat=d.get("lat"), lng=d.get("lng"), accuracy=d.get("accuracy_m"))
```

Register `path("rider/jobs/<int:pk>/skip-stop/", views_rider.SkipStopView.as_view(), name="delivery-rider-skip-stop"),` after `cant-deliver`. In `views_queue.offer_payload`, add to the returned dict (with `from . import stops` at the top of the function):

```python
        "stop_count": len(stops.sequence_for_order(order)), "route_km": (order.route_plan or {}).get("total_km"),
```

- [ ] **Step 7: Run, expect PASS**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test delivery orders`
Expected: PASS (except the known unrelated failure).

- [ ] **Step 8: Commit**

```bash
git add backend/delivery/stops.py backend/delivery/services.py backend/delivery/board.py backend/delivery/payloads.py backend/delivery/views_live.py backend/delivery/views_rider.py backend/delivery/views_queue.py backend/delivery/urls.py backend/delivery/tests/test_multistop_rider.py
git commit -m "feat(delivery): rider collects each shop with its own code, skip opens a refund case"
```

---

### Task 6: Manager per-stop controls and the detour warning (backend)

**Files:**
- Modify: `backend/delivery/views_live.py` (`manager_job` adds `stops`, `progress`, `route_plan`; `UnlockCodeView` per stop; new `StopSkipView`; detail/map views prefetch stops)
- Modify: `backend/delivery/board.py` (`queue_row` adds `stops`, `route_plan`, `detour_warning`, beside Task 5's `returned_reason` and `skips`; `live()` adds detour rows to `needs_you`)
- Modify: `backend/delivery/urls.py`
- Modify: `backend/delivery/tests/test_fleet.py` (`UnlockCodeTests.locked` fixture)
- Test: `backend/delivery/tests/test_multistop_manager.py`

**Interfaces:**
- Consumes: Task 5 `services.skip_stop`, `payloads.stops_block`; Task 3 `stops.*`.
- Produces:
  - `GET /api/delivery/jobs/<pk>/` adds `stops` (stop rows incl. `wrong_tries` and `skips`, never a code), `progress`, `route_plan`, `skip_history` (every skip with the rider's pin `lat`/`lng`/`accuracy_m`, time and note)
  - `POST /api/delivery/jobs/<pk>/unlock-code/ {which, note, stop?}`: `stop` names a stop id; without it the current stop (else stop 1); response unchanged `{"which", "attempts": 0}`; an unknown stop is 404
  - `POST /api/delivery/jobs/<pk>/stops/<stop_id>/skip/ {note}` (name `delivery-job-stop-skip`) → `{"stop": id, "status": "skipped", "assignment_status": str}`
  - `board.detour_warning(plan) -> str | None`; queue rows carry `stops: int`, `route_plan: dict | None`, `detour_warning: str | None`, and (Task 5) `returned_reason`, `skips`; `live()["needs_you"]` gets `{"kind": "detour", "order_id", "text"}`

- [ ] **Step 1: Update the unlock fixture** in `backend/delivery/tests/test_fleet.py`, `UnlockCodeTests.locked`:

```python
    def locked(self, which="pickup"):
        assignment = self.assign()
        field = "pickup_code_attempts" if which == "pickup" else "drop_code_attempts"
        setattr(assignment, field, 5)
        assignment.save(update_fields=[field])
        if which == "pickup":  # the stop holds the count since multi-stop delivery; the assignment field mirrors stop 1
            assignment.stops.filter(sequence=1).update(code_attempts=5)
        return assignment
```

- [ ] **Step 2: Write the failing tests** `backend/delivery/tests/test_multistop_manager.py`:

```python
from delivery.models import PickupStop
from disputes.models import Dispute
from orders.models import DeliveryAssignment as DA

from .base import DeliveryCase

A, B, C = (6.70, -1.62), (6.705, -1.615), (6.71, -1.61)
OVER = {"owner_ids": None, "planned": True, "total_km": 10.0, "direct_km": 5.0, "detour_pct": 100.0, "limit_pct": 40,
        "over_limit": True, "basis": "road route", "legs_km": [4, 3, 3]}


class ManagerStopTests(DeliveryCase):
    def setUp(self):
        super().setUp()
        self.shop_a, self.item_a = self.make_shop("Shop A", "+233207000501", A)
        self.shop_b, self.item_b = self.make_shop("Shop B", "+233207000502", B)
        self.shop_c, self.item_c = self.make_shop("Shop C", "+233207000503", C)
        self.job = self.assign(self.multi_order(self.item_a, self.item_b, self.item_c))
        self.first, self.second, self.third = self.job.stops.all()
        for stop, code in zip((self.first, self.second, self.third), ("QA11", "QB22", "QC33")):
            PickupStop.objects.filter(pk=stop.pk).update(code=code)

    def detail(self):
        r = self.as_staff(self.manager).get(f"/api/delivery/jobs/{self.job.pk}/")
        self.assertEqual(r.status_code, 200, r.content)
        return r

    def test_the_job_record_lists_each_stop_and_never_a_code(self):
        PickupStop.objects.filter(pk=self.second.pk).update(code_attempts=2)
        r = self.detail()
        rows = r.json()["stops"]
        self.assertEqual([(s["sequence"], s["business_name"], s["status"], s["wrong_tries"]) for s in rows],
                         [(1, "Shop A", "pending", 0), (2, "Shop B", "pending", 2), (3, "Shop C", "pending", 0)])
        self.assertEqual(r.json()["progress"]["total"], 3)
        for code in ("QA11", "QB22", "QC33"):
            self.assertNotIn(code, r.content.decode())

    def test_unlock_reopens_only_the_stop_named(self):
        PickupStop.objects.filter(pk__in=[self.second.pk, self.third.pk]).update(code_attempts=5)
        r = self.as_staff(self.manager, sudo=True).post(f"/api/delivery/jobs/{self.job.pk}/unlock-code/",
                                                        {"which": "pickup", "stop": self.second.pk, "note": "Shop confirmed"}, format="json")
        self.assertEqual((r.status_code, r.json()), (200, {"which": "pickup", "attempts": 0}))
        self.assertEqual([s.code_attempts for s in self.job.stops.all()], [0, 0, 5])
        missing = self.client.post(f"/api/delivery/jobs/{self.job.pk}/unlock-code/", {"which": "pickup", "stop": 999999, "note": "x"}, format="json")
        self.assertEqual(missing.status_code, 404)

    def test_unlock_without_a_stop_takes_the_current_one(self):
        PickupStop.objects.filter(pk=self.first.pk).update(status=PickupStop.COLLECTED)
        PickupStop.objects.filter(pk=self.second.pk).update(code_attempts=5)
        r = self.as_staff(self.manager, sudo=True).post(f"/api/delivery/jobs/{self.job.pk}/unlock-code/", {"which": "pickup", "note": "ok"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.second.refresh_from_db()
        self.assertEqual(self.second.code_attempts, 0)

    def test_the_manager_sees_skip_evidence_in_the_queue_and_the_job(self):
        from delivery import services

        DA.objects.filter(pk=self.job.pk).update(status=DA.ACCEPTED)
        for stop, point in ((self.first, A), (self.second, B), (self.third, C)):
            services.skip_stop(DA.objects.get(pk=self.job.pk), self.rider_staff, f"Closed {stop.sequence}", lat=point[0] + 0.0001, lng=point[1], accuracy=9)
        self.as_staff(self.manager)
        row = {r["order_id"]: r for r in self.client.get("/api/delivery/queue/").json()["results"]}[self.job.order_id]
        self.assertEqual((row["returned"], row["returned_reason"]), (True, "all_stops_skipped"))
        self.assertEqual([(s["business_name"], s["note"], s["pinned"], s["accuracy_m"]) for s in row["skips"]],
                         [("Shop A", "Closed 1", True, 9.0), ("Shop B", "Closed 2", True, 9.0), ("Shop C", "Closed 3", True, 9.0)])
        self.assertEqual((round(row["skips"][1]["lat"], 4), round(row["skips"][1]["lng"], 4)), (round(B[0] + 0.0001, 4), round(B[1], 4)))
        self.assertIsNotNone(row["skips"][0]["at"])
        job = self.detail().json()
        self.assertEqual([h["note"] for h in job["skip_history"]], ["Closed 1", "Closed 2", "Closed 3"])
        self.assertEqual(job["stops"][2]["skips"][0]["note"], "Closed 3")

    def test_a_manager_skips_a_shop_that_closed(self):
        url = f"/api/delivery/jobs/{self.job.pk}/stops/{self.third.pk}/skip/"
        self.assertEqual(self.as_staff(self.manager).post(url, {"note": ""}, format="json").status_code, 400)
        r = self.client.post(url, {"note": "Shop C closed for the day"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], "skipped")
        self.third.refresh_from_db()
        self.assertEqual((self.third.status, self.third.skipped_by_id), (PickupStop.SKIPPED, self.manager.pk))
        self.assertEqual(self.client.get(f"/api/delivery/jobs/{self.job.pk}/").json()["skip_history"][0]["by"], "manager")  # no rider pin
        self.assertIn("Shop C item", Dispute.objects.get(order=self.job.order).description)
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, DA.ASSIGNED)  # the rider still starts at stop 1
        self.assertTrue(self.rider_staff.notifications.filter(kind="delivery_alert").exists())
        again = self.client.post(url, {"note": "again"}, format="json")
        self.assertEqual((again.status_code, again.json()["code"]), (409, "stop_done"))


class DetourWarningTests(DeliveryCase):
    def test_a_waiting_order_over_the_detour_limit_warns_the_manager(self):
        _, item_a = self.make_shop("Shop A", "+233207000511", A)
        owner_b, item_b = self.make_shop("Shop B", "+233207000512", B)
        order = self.multi_order(item_a, item_b, route_plan={**OVER, "owner_ids": [item_a.business_owner_id, owner_b.pk]})
        self.as_staff(self.manager)
        rows = {r["order_id"]: r for r in self.client.get("/api/delivery/queue/").json()["results"]}
        row = rows[order.pk]
        self.assertEqual(row["stops"], 2)
        self.assertEqual(row["detour_warning"], "Planned route is 100% longer than going direct from the first shop (allowance 40%).")
        needs = self.client.get("/api/delivery/live/").json()["needs_you"]
        self.assertIn({"kind": "detour", "order_id": order.pk, "text": f"Order #{order.pk}: {row['detour_warning']}"}, needs)

    def test_an_estimated_plan_says_so(self):
        from delivery import board

        text = board.detour_warning({**OVER, "basis": "straight-line estimate x 1.3"})
        self.assertTrue(text.endswith("(straight-line estimate)."))
        self.assertIsNone(board.detour_warning({**OVER, "over_limit": False}))
        self.assertIsNone(board.detour_warning(None))
```

- [ ] **Step 3: Run, expect FAIL**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test delivery.tests.test_multistop_manager delivery.tests.test_fleet`
Expected: FAIL (`KeyError: 'stops'`, skip URL 404, `detour_warning` missing; the fleet unlock tests fail until Step 4).

- [ ] **Step 4: Implement the manager views.** In `views_live.py` (add `from . import stops` and `from .models import DeliveryCall, DeliveryPhoto, PickupStop`; the job record uses `payloads.stops_block(assignment, evidence=True)`, Task 5), add to `manager_job`'s dict:

```python
        "stops": block["all"], "progress": block["progress"], "route_plan": assignment.route_plan or order.route_plan, "skip_history": block["skip_history"],
```

Add `"stops__business_owner__profile"` to the `prefetch_related` of `JobDetailView` and `JobMapView`. Replace `UnlockCodeView.post`:

```python
    def post(self, request, pk):
        which = request.data.get("which")
        if which not in ("pickup", "drop"):
            return Response({"detail": "Choose the pickup or the drop code."}, status=400)
        note = request.data.get("note")
        note = note.strip() if isinstance(note, str) else ""
        if not note:
            return Response({"detail": "Say why you are unlocking this code."}, status=400)
        with transaction.atomic():
            assignment = get_object_or_404(DeliveryAssignment.objects.select_for_update(of=("self",)), pk=pk)
            stop = None
            if which == "pickup":
                rows = stops.ensure_stops(assignment)
                wanted = request.data.get("stop")
                if wanted not in (None, ""):
                    stop = next((s for s in rows if str(s.pk) == str(wanted)), None)
                    if stop is None:
                        raise Http404
                else:
                    stop = stops.current_stop(assignment) or (rows[0] if rows else None)
            before = stop.code_attempts if stop is not None else getattr(assignment, f"{which}_code_attempts")
            if before < services.CODE_ATTEMPT_LIMIT:
                return Response({"detail": "This code is not locked.", "code": "not_locked"}, status=409)
            if stop is not None:
                stop.code_attempts = 0
                stop.save(update_fields=["code_attempts"])
            if stop is None or stop.sequence == 1:
                setattr(assignment, f"{which}_code_attempts", 0)
                assignment.save(update_fields=[f"{which}_code_attempts"])
            label = f"the pickup code at {stops.stop_name(stop)}" if stop is not None else f"the {which} code"
            # Last, because record() holds the activity chain lock until commit.
            record(
                request.user, "delivery-job-unlock-code", target=assignment, method="POST",
                summary=f"Unlocked {label} on order #{assignment.order_id}: {note[:200]}",
                before={"which": which, "stop": stop.sequence if stop else None, "wrong_tries": before},
                after={"which": which, "stop": stop.sequence if stop else None, "wrong_tries": 0, "note": note[:300]}, request=request,
            )
        return Response({"which": which, "attempts": 0})
```

```python
class StopSkipView(ManageView):
    """POST jobs/<id>/stops/<stop_id>/skip/ {note} — a shop closed or cancelled after dispatch: skip its stop (the same
    refund case as a rider's skip). Any open stop, before the order leaves for the customer. The rider is told."""

    def post(self, request, pk, stop_id):
        from notifications.services import notify_staff

        with transaction.atomic():
            assignment = get_object_or_404(DeliveryAssignment.objects.select_for_update(of=("self",)), pk=pk)
            stop = get_object_or_404(PickupStop, pk=stop_id, assignment=assignment)
            try:
                services.skip_stop(assignment, request.user, request.data.get("note"), stop=stop)
            except services.DeliveryError as exc:
                return Response(exc.body(), status=exc.status_code)
        if assignment.dispatch_id:
            notify_staff(assignment.dispatch, "delivery_alert", f"Skip {stops.stop_name(stop)} on Order #{assignment.order_id}",
                         body="Your manager took this shop off the delivery. Open the job for the next stop.", link="/staff/jobs", icon="🛵")
        return Response({"stop": stop.pk, "status": stop.status, "assignment_status": assignment.status})
```

Register `path("jobs/<int:pk>/stops/<int:stop_id>/skip/", views_live.StopSkipView.as_view(), name="delivery-job-stop-skip"),` after `unlock-code`.

- [ ] **Step 5: The queue warning.** In `board.py` (add `from . import payloads, services, stops`):

```python
def detour_warning(plan):
    """The manager's warning for an order whose planned route runs over the detour allowance (spec section 4)."""
    if not plan or not plan.get("over_limit"):
        return None
    pct = plan.get("detour_pct")
    longer = f"{pct:g}% longer than going direct" if pct is not None else "longer than going direct"
    estimate = " (straight-line estimate)" if plan.get("basis") == routing_service.BASIS_ESTIMATE else ""
    return f"Planned route is {longer} from the first shop (allowance {plan.get('limit_pct')}%){estimate}."
```

In `queue_row`'s returned dict add:

```python
        "stops": len(stops.sequence_for_order(order)), "route_plan": order.route_plan, "detour_warning": detour_warning(order.route_plan),
```

In `live()`, after the `for row in waiting[:5]` loop:

```python
    for row in waiting:
        if row["detour_warning"]:
            needs.append({"kind": "detour", "order_id": row["order_id"], "text": f"Order #{row['order_id']}: {row['detour_warning']}"})
```

- [ ] **Step 6: Run, expect PASS**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test delivery`
Expected: PASS (except the known unrelated failure); `test_a_manager_unlocks_a_locked_pickup_step_and_it_is_logged` still finds "pickup" in the summary.

- [ ] **Step 7: Commit**

```bash
git add backend/delivery/views_live.py backend/delivery/board.py backend/delivery/urls.py backend/delivery/tests/test_fleet.py backend/delivery/tests/test_multistop_manager.py
git commit -m "feat(delivery): manager unlocks and skips per stop, detour warning in the queue"
```

---

### Task 7: Tracking and privacy per stop (backend)

**Files:**
- Modify: `backend/delivery/tracking.py` (`_pickup` = current stop, `_pickups`, `business_map` per stop, `customer_map.stops`, `manager_job_map.pickups`, `queue_map.pickups`)
- Modify: `backend/delivery/services.py` (delete `pickup_owner`, now unused)
- Modify: `backend/orders/serializers.py` (`OwnerOrderSerializer` per own stop, `pickup_eta`, `pickup_status`, `rider_report`; `OrderSerializer.delivery_stops`)
- Modify: `backend/orders/views.py` (prefetch stops for `OwnerOrderListView`, the tracking views and `DispatchMapView`)
- Modify: `backend/orders/tests/test_code_privacy.py` (`coded` fixture)
- Test: `backend/orders/tests/test_multistop_privacy.py`

**Interfaces:**
- Consumes: Task 3 `stops.stops_of`, `current_stop`, `stop_for_owner`, `progress`, `stop_name`; Task 5 `planned_arrival`.
- Produces:
  - `tracking.manager_job_map(a)` adds `pickups: [{"id", "sequence", "name", "lat", "lng", "status", "planned_arrival"}]`; `pickup` is the current stop (first stop once all are done)
  - `tracking.queue_map(order)` adds `pickups: [{"sequence", "name", "lat", "lng"}]` in planned order
  - `tracking.customer_map(a)` adds `stops: {"total", "done", "skipped"}` (counts only)
  - `tracking.business_map(a, owner)` returns `{"stage", "pickup", "stop": {"status", "planned_arrival"} | None, "rider", "leg", "route", "rider_busy", "rider_elsewhere"}`: the rider only while the owner's stop is the current stop; `rider_elsewhere: True` while another shop is being worked; nothing once its stop is collected or skipped
  - `OwnerOrderSerializer`: `pickup_code` (own open stop only), `rider_heading_here` (own stop is current and this is the rider's current job), `pickup_eta` (own pending stop's `planned_arrival`), `pickup_status`
  - `OrderSerializer.delivery_stops: {"total", "done", "skipped"} | null` (null for one shop)
  - `OwnerOrderSerializer.rider_report: {"at", "text"} | null`: for THIS owner's stop only, when a rider skipped it at the shop: `"Rider reported at your shop at HH:MM: <note>"`. Keys are exactly `at` and `text`: no rider name, phone, pin or accuracy. A manager's skip and another shop's skip never appear. The row still carries no customer phone, email or contact field.

- [ ] **Step 1: Update the code-privacy fixture** in `orders/tests/test_code_privacy.py`, `CodePrivacyTests.coded`, after `a.save()`:

```python
        a.stops.filter(sequence=1).update(code=PICKUP_CODE)  # the stop holds the code since multi-stop delivery; the field mirrors it
```

- [ ] **Step 2: Write the failing tests** `backend/orders/tests/test_multistop_privacy.py`:

```python
from datetime import timedelta
from unittest import mock

from django.utils import timezone

from accounts.authentication import issue_token
from delivery.models import PickupStop, ShiftSession
from delivery.tests.base import DeliveryCase
from orders.models import DeliveryAssignment as DA
from routing import service as routing_service

A, B, C = (6.70, -1.62), (6.705, -1.615), (6.71, -1.61)
ROAD = {"distance_km": 1.2, "duration_s": 240, "basis": routing_service.BASIS_ROAD, "geometry": [[-1.62, 6.7], [-1.62, 6.69]]}
CODES = ("QA11", "QB22", "QC33")


class MultiStopPrivacyTests(DeliveryCase):
    def setUp(self):
        super().setUp()
        self.rider_staff.full_name = "Yaw Mensah"
        self.rider_staff.save()
        self.shop_a, item_a = self.make_shop("Shop A", "+233207000401", A)
        self.shop_b, item_b = self.make_shop("Shop B", "+233207000402", B)
        self.shop_c, item_c = self.make_shop("Shop C", "+233207000403", C)
        self.a = self.assign(self.multi_order(item_a, item_b, item_c))
        DA.objects.filter(pk=self.a.pk).update(status=DA.ACCEPTED, drop_code="QD44")
        self.s1, self.s2, self.s3 = self.a.stops.all()
        for stop, code in zip((self.s1, self.s2, self.s3), CODES):
            PickupStop.objects.filter(pk=stop.pk).update(code=code)
        ShiftSession.objects.create(rider=self.rider, last_lat=6.701, last_lng=-1.62, last_fix_at=timezone.now())

    def set(self, stop, **fields):
        PickupStop.objects.filter(pk=stop.pk).update(**fields)

    def as_owner(self, owner):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(owner, 'business_owner')}")

    def owner_row(self, owner):
        self.as_owner(owner)
        return {o["id"]: o for o in self.client.get("/api/orders/owner/").json()["results"]}[self.a.order_id]

    def owner_map(self, owner):
        self.as_owner(owner)
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            r = self.client.get(f"/api/orders/owner/{self.a.order_id}/tracking/")
        self.assertEqual(r.status_code, 200, r.content)
        return r

    def customer_map(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            return self.client.get(f"/api/orders/{self.a.order_id}/tracking/")

    def test_the_shop_being_worked_sees_the_rider_and_only_its_own_code(self):
        first = self.owner_map(self.shop_a).json()
        self.assertEqual(first["rider"]["first_name"], "Yaw")
        row = self.owner_row(self.shop_a)
        self.assertEqual((row["pickup_code"], row["rider_heading_here"]), ("QA11", True))
        later = self.owner_map(self.shop_b)
        body = later.json()
        self.assertIsNone(body["rider"])
        self.assertTrue(body["rider_elsewhere"])
        self.assertEqual((body["pickup"]["lat"], body["pickup"]["lng"]), B)
        for needle in ("QA11", "QC33", "QD44", "12 Ash Road", "Mensah"):
            self.assertNotIn(needle, later.content.decode())
        row = self.owner_row(self.shop_b)
        self.assertEqual((row["pickup_code"], row["rider_heading_here"]), ("QB22", False))
        self.assertNotIn("QA11", str(row))
        self.assertNotIn("QC33", str(row))

    def test_a_later_shop_is_told_when_the_rider_should_arrive(self):
        eta = (timezone.now() + timedelta(minutes=12)).replace(microsecond=0)  # DRF prints milliseconds only
        self.set(self.s2, planned_arrival=eta)
        self.assertEqual(self.owner_row(self.shop_b)["pickup_eta"], eta.isoformat().replace("+00:00", "Z"))
        self.assertIsNotNone(self.owner_map(self.shop_b).json()["stop"]["planned_arrival"])

    def test_a_shop_sees_the_riders_skip_report_for_its_own_stop_only(self):
        from delivery import services

        a = DA.objects.get(pk=self.a.pk)
        services.skip_stop(a, self.rider_staff, "Shop was shut", lat=A[0] + 0.0001, lng=A[1], accuracy=8)
        report = self.owner_row(self.shop_a)["rider_report"]
        self.assertEqual(set(report), {"at", "text"})
        self.assertRegex(report["text"], r"^Rider reported at your shop at \d{2}:\d{2}: Shop was shut$")
        shown = str(self.owner_row(self.shop_a))
        for needle in ("Yaw", "Mensah", "+233244000002", "6.7001", "accuracy"):
            self.assertNotIn(needle, shown)
        self.assertIsNone(self.owner_row(self.shop_b)["rider_report"])
        self.assertIsNone(self.owner_row(self.shop_c)["rider_report"])

    def test_a_managers_skip_is_not_shown_to_the_shop_as_a_rider_report(self):
        from delivery import services

        services.skip_stop(DA.objects.get(pk=self.a.pk), self.manager, "Shop closed for the day", stop=self.s2)
        self.assertIsNone(self.owner_row(self.shop_b)["rider_report"])

    def test_the_owner_order_row_has_no_customer_contact_details(self):
        row = self.owner_row(self.shop_a)

        def keys(value):  # every key at every depth
            if isinstance(value, dict):
                for key, inner in value.items():
                    yield key
                    yield from keys(inner)
            elif isinstance(value, list):
                for inner in value:
                    yield from keys(inner)

        contactish = [k for k in keys(row) if any(w in k.lower() for w in ("phone", "email", "contact", "mobile"))]
        self.assertEqual(contactish, [])
        self.assertNotIn("delivery_phone", row)
        self.assertNotIn("+233200882200", str(row))  # the customer's number on this order
        self.assertNotIn(self.customer.phone, str(row))
        # What the contract test pins stays: the address and the pin.
        self.assertEqual(row["delivery_address"], "12 Ash Road")
        self.assertIsNotNone(row["delivery_lat"])

    def test_a_collected_shop_sees_nothing_more(self):
        self.set(self.s1, status=PickupStop.COLLECTED)
        row = self.owner_row(self.shop_a)
        self.assertEqual((row["pickup_code"], row["rider_heading_here"], row["pickup_eta"], row["pickup_status"]), (None, False, None, "collected"))
        body = self.owner_map(self.shop_a).json()
        self.assertEqual((body["rider"], body["pickup"]), (None, None))
        self.assertEqual(self.owner_map(self.shop_b).json()["rider"]["first_name"], "Yaw")

    def test_a_skipped_shop_gets_no_code_or_rider(self):
        self.set(self.s2, status=PickupStop.SKIPPED)
        row = self.owner_row(self.shop_b)
        self.assertEqual((row["pickup_code"], row["pickup_status"]), (None, "skipped"))

    def test_the_customer_sees_the_rider_only_after_the_last_shop(self):
        self.set(self.s1, status=PickupStop.COLLECTED)
        self.set(self.s2, status=PickupStop.COLLECTED)
        r = self.customer_map()
        self.assertIsNone(r.json()["rider"])
        self.assertEqual(r.json()["stops"], {"total": 3, "done": 2, "skipped": 0})
        for needle in ("Shop A", "Shop B", *CODES):
            self.assertNotIn(needle, r.content.decode())
        self.set(self.s3, status=PickupStop.COLLECTED)
        DA.objects.filter(pk=self.a.pk).update(status=DA.PICKED_UP)
        self.assertEqual(self.customer_map().json()["rider"]["first_name"], "Yaw")

    def test_the_customer_order_counts_the_stops(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        order = self.client.get(f"/api/orders/{self.a.order_id}/").json()
        self.assertEqual(order["delivery_stops"], {"total": 3, "done": 0, "skipped": 0})
        single = self.assign(self.make_order())
        self.assertIsNone(self.client.get(f"/api/orders/{single.order_id}/").json()["delivery_stops"])

    def test_the_manager_map_draws_every_shop(self):
        from delivery import tracking

        with mock.patch("delivery.tracking.routing_service.leg", return_value=dict(ROAD)):
            payload = tracking.manager_job_map(DA.objects.get(pk=self.a.pk))
        self.assertEqual([p["name"] for p in payload["pickups"]], ["Shop A", "Shop B", "Shop C"])
        self.assertEqual(payload["pickup"]["name"], "Shop A")
```

- [ ] **Step 3: Run, expect FAIL**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test orders.tests.test_multistop_privacy`
Expected: FAIL (`KeyError: 'rider_elsewhere'`, `'pickup_eta'`, `'delivery_stops'`, `'pickups'`, `'rider_report'`).

- [ ] **Step 4: Tracking.** In `tracking.py` add `from . import config, dispatching, services, stops` and `from .models import PickupStop, ShiftSession`, then replace `_pickup` and `business_map`, and extend the other builders:

```python
def _point_of(stop):
    return {"lat": stop.lat, "lng": stop.lng, "name": stops.stop_name(stop)} if stop is not None and stop.lat is not None else None


def _pickup(a):
    """The stop the rider is heading to or at; once every stop is done, the first one (the manager's map keeps it)."""
    rows = stops.stops_of(a)
    return _point_of(stops.current_stop(a) or (rows[0] if rows else None))


def _pickups(a):
    return [{"id": s.pk, "sequence": s.sequence, "name": stops.stop_name(s), "lat": s.lat, "lng": s.lng, "status": s.status,
             "planned_arrival": s.planned_arrival} for s in stops.stops_of(a)]


def business_map(a, owner, now=None):
    """The business sees its own stop only: the rider while its shop is the stop being worked, the planned arrival
    before that, and nothing once its stop is collected or skipped. Never anything about the customer."""
    out = {"stage": a.status, "pickup": None, "stop": None, "rider": None, "leg": None, "route": None, "rider_busy": False, "rider_elsewhere": False}
    own = stops.stop_for_owner(a, owner.pk)
    if own is None:
        return out
    out["stop"] = {"status": own.status, "planned_arrival": own.planned_arrival if own.status == PickupStop.PENDING else None}
    if own.status not in PickupStop.OPEN or a.status not in TO_PICKUP:
        return out
    pickup = _point_of(own)
    out["pickup"] = pickup
    current = stops.current_stop(a)
    if current is None or current.business_owner_id != owner.pk:
        out["rider_elsewhere"] = True
        return out
    if not is_current(a):
        out["rider_busy"] = True
        return out
    fix = rider_fix(a, now)
    if fix:
        parts = (a.dispatch.full_name or "").split()
        out["rider"] = {**fix, "first_name": parts[0] if parts else "The rider", "vehicle_type": _rider(a).vehicle_type}
    out["leg"], out["route"] = _leg(a, fix, pickup, None)
    return out
```

In `manager_job_map`'s return add `"pickups": _pickups(a)`. In `customer_map`, after building `out`, add `p = stops.progress(a); out["stops"] = {"total": p["total"], "done": p["done"], "skipped": p["skipped"]}` (before the first `return`). In `queue_map`, add before the return:

```python
    entries = {e["key"]: e for e in stops.shop_entries(order.items.all())}
    pickups = [{"sequence": n, "name": entries[k]["name"], "lat": entries[k]["lat"], "lng": entries[k]["lng"]}
               for n, k in enumerate(stops.sequence_for_order(order), start=1)]
```

and return `"pickups": pickups` with the rest. Delete `services.pickup_owner` (its only caller was the old `business_map`).

- [ ] **Step 5: Serializers.** In `orders/serializers.py`, `OwnerOrderSerializer`: add `pickup_eta = serializers.SerializerMethodField()`, `pickup_status = serializers.SerializerMethodField()` and `rider_report = serializers.SerializerMethodField()`, add the three names to `Meta.fields` (do not touch `OWNER_DELIVERY_FIELDS`: it keeps `delivery_phone` out), and replace `_heading_assignment`, `get_pickup_code`, `get_rider_heading_here` with:

```python
    def _own_stop(self, obj):
        """(assignment, this owner's stop) while the delivery is still collecting; else (assignment or None, None)."""
        from delivery import stops

        assignment = getattr(obj, "delivery_assignment", None)
        if assignment is None or assignment.status not in (DeliveryAssignment.ASSIGNED, DeliveryAssignment.ACCEPTED, DeliveryAssignment.AT_PICKUP):
            return assignment, None
        return assignment, stops.stop_for_owner(assignment, self.context["owner"].id)

    def get_pickup_code(self, obj):
        from delivery.models import PickupStop

        _, stop = self._own_stop(obj)
        return (stop.code or None) if stop is not None and stop.status in PickupStop.OPEN else None

    def get_rider_heading_here(self, obj):
        # Only while this shop is the stop being worked and this is the job the rider is on; a rider at another shop
        # or finishing another delivery is not heading here, and the vendor must not be shown their position.
        from delivery import services, stops
        from delivery.models import PickupStop

        assignment, stop = self._own_stop(obj)
        if stop is None or stop.status not in PickupStop.OPEN or assignment.dispatch_id is None:
            return False
        current = stops.current_stop(assignment)
        if current is None or current.business_owner_id != stop.business_owner_id:
            return False
        job = services.current_job(assignment.dispatch)
        return job is not None and job.pk == assignment.pk

    def get_pickup_eta(self, obj):
        from delivery.models import PickupStop

        _, stop = self._own_stop(obj)
        return stop.planned_arrival if stop is not None and stop.status == PickupStop.PENDING else None

    def get_pickup_status(self, obj):
        from delivery import stops

        assignment = getattr(obj, "delivery_assignment", None)
        stop = stops.stop_for_owner(assignment, self.context["owner"].id) if assignment is not None else None
        return stop.status if stop is not None else None

    def get_rider_report(self, obj):
        """What the rider reported at THIS shop when it could not hand over: the time and their note, and nothing about the
        rider (no name, phone or position). Only this owner's own stop, only a rider's skip made at the shop."""
        from django.utils import timezone

        from delivery import stops

        assignment = getattr(obj, "delivery_assignment", None)
        if assignment is None:
            return None
        mine = [h for h in stops.skip_history(assignment) if h["business_owner_id"] == self.context["owner"].id and h["by"] == "rider" and h["at_shop"]]
        if not mine:
            return None
        last = mine[-1]
        return {"at": last["at"], "text": f"Rider reported at your shop at {timezone.localtime(last['at']).strftime('%H:%M')}: {last['note']}"}
```

Update the class comments that say "the order's first, v1 delivers one pickup per order" to "this owner's own stop". In `OrderSerializer`, add `delivery_stops = serializers.SerializerMethodField()`, `"delivery_stops"` to `Meta.fields`, and:

```python
    def get_delivery_stops(self, obj):
        """How many shops the rider collects from and how many are done, for a delivery from several shops (counts only)."""
        from delivery import stops

        assignment = getattr(obj, "delivery_assignment", None)
        if assignment is None:
            return None
        p = stops.progress(assignment)
        return {"total": p["total"], "done": p["done"], "skipped": p["skipped"]} if p["total"] > 1 else None
```

In `orders/views.py`, add `"delivery_assignment__stops__business_owner__profile"` to the `prefetch_related` of `OwnerOrderListView.get_queryset` and of `DispatchMapView`, and to `_assignment_of` add `.prefetch_related("stops__business_owner__profile", "order__items__listing__business_owner__profile")`.

- [ ] **Step 6: Run, expect PASS**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test orders delivery`
Expected: PASS (except the known unrelated failure); the existing single-shop privacy tests are unchanged in outcome.

- [ ] **Step 7: Commit**

```bash
git add backend/delivery/tracking.py backend/delivery/services.py backend/orders/serializers.py backend/orders/views.py backend/orders/tests/test_code_privacy.py backend/orders/tests/test_multistop_privacy.py
git commit -m "feat(orders): per-stop tracking and codes; customer map only after the last shop"
```

---

### Task 8: The cart guard and search tiers (backend)

**Files:**
- Create: `backend/cart/guard.py`
- Modify: `backend/cart/views.py` (`CartItemCreateView` guard; new `CartGuardView`), `backend/cart/urls.py`
- Modify: `backend/orders/views.py` (`OrderCheckoutView` calls `guard.check_checkout`)
- Modify: `backend/listings/serializers.py` (`CategorySerializer.is_food`; new `CartTieredListingSerializer`)
- Modify: `backend/listings/views.py` (`PublicListingListView` `?cart_tiers=1`)
- Modify (fixtures, service-kind "hotels" to product "shops"): `backend/cart/tests/test_cart.py`, `backend/orders/tests/test_checkout.py`, `backend/orders/tests/test_fulfilment_spine.py`, `backend/orders/tests/test_new_order_alerts.py`, `backend/payments/tests/test_process_payment_hubtel_mode.py`, `backend/payments/tests/test_process_payment_simulated.py`, `backend/listings/tests/test_hidden_business.py`, `backend/marketing/tests/test_promos.py`, `backend/accounts/tests/test_staff_marketplace_lockout.py`, `backend/delivery/tests/base.py`
- Test: `backend/cart/tests/test_guard.py`, `backend/listings/tests/test_cart_tiers.py`

**Interfaces:**
- Consumes: `config.effective_cart_limits`, `config.limits_json`, `stops.shop_entries`, `routing.service.legs_from`, `listings.visibility.hidden_business_q`.
- Produces:
  - `guard.SERVICE_STAY_MESSAGE`, `guard.DELIVERABLE = ("product", "food")`, `guard.kind_of(listing) -> "product"|"food"|"service"|"stay"|"event"`, `guard.deliverable_q(prefix="") -> Q`
  - `guard.GuardError(message, code)` with `.body() -> {"detail", "code"}`; codes `not_deliverable`, `shop_limit`, `food_limit`, `food_far`, `food_unlocated`
  - `guard.context(lines) -> {"limits", "shops", "ids", "food_ids", "near": None}`, `guard.near(ctx) -> {owner_id: {"km", "basis", "from_id", "from_name"}}` (cached 60 s per cart-shop set and radius)
  - `guard.blocked_reason(ctx, listing) -> (message, code) | None`, `guard.check_add(lines, listing)`, `guard.check_checkout(lines, delivery_method)`, `guard.summary(lines, listing=None) -> dict`
  - `POST /api/cart/items/` 400 `{"detail", "code"}` when blocked; `GET /api/cart/guard/?listing=<id>` (name `cart-guard`) → `{"active", "limits", "shops": [{"id", "name", "food"}], "food_shops", "at_shop_limit", "at_food_limit", "checkout": {"any": {...}|null, "door_to_door": {...}|null}, "listing"?: {"id", "blocked": {...}|null}}`
  - `POST /api/orders/checkout/` 400 `{"detail", "code"}`: a service/stay line refuses every method; shop/food limits refuse door-to-door only
  - `GET /api/listings/?cart_tiers=1` for a customer with a non-empty cart: rows ordered tier 1, tier 2 nearest first, then the rest; each row adds `cart_tier` (1|2|3, null for services/stays/events), `cart_label` ("In your cart", "1.2 km from Shop A", "... (estimate)"), `cart_blocked` ({detail, code} | null). Anyone else, or no flag: unchanged.
  - `CategorySerializer` exposes `is_food`.

- [ ] **Step 1: Write the failing tests** `backend/cart/tests/test_guard.py`:

```python
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from cart.guard import SERVICE_STAY_MESSAGE
from cart.models import Cart, CartItem
from delivery.models import RateCard
from listings.models import Category, Listing, Zone
from routing import service as routing_service

KUMASI = (6.6885, -1.6244)


def leg(km):
    return {"distance_km": km, "duration_s": 600, "basis": routing_service.BASIS_ROAD, "geometry": None}


class GuardCase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.customer = Customer.objects.create(full_name="Ama Buyer", phone="+233200771001", password_hash="x")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.customer, 'customer')}")
        self.n = 0

    def listing(self, slug="shops", point=KUMASI, owner=None, name=None, category=None):
        self.n += 1
        owner = owner or BusinessOwner.objects.create(full_name=name or f"Shop {self.n}", login_phone=f"+23320777{self.n:04d}", password_hash="x")
        return Listing.objects.create(
            business_owner=owner, category=category or Category.objects.get(slug=slug), zone=Zone.objects.get(name="Manhyia"),
            name=f"{owner.full_name} item {self.n}", description="D.", contact_phone="+233207770000", price_amount="10.00",
            status=Listing.PUBLISHED, lat=str(point[0]) if point else None, lng=str(point[1]) if point else None,
        )

    def add(self, listing):
        return self.client.post("/api/cart/items/", {"listing": listing.id, "quantity": 1}, format="json")

    def put(self, *listings):
        """Rows written straight to the cart, as rows from before the guard would be."""
        cart, _ = Cart.objects.get_or_create(customer=self.customer)
        for listing in listings:
            CartItem.objects.create(cart=cart, listing=listing, quantity=1, unit_price_snapshot="10.00")

    def guard(self, listing=None):
        return self.client.get("/api/cart/guard/", {"listing": listing.id} if listing else {}).json()


class AddToCartTests(GuardCase):
    def test_services_stays_and_events_are_refused_with_the_plain_message(self):
        stay = Category.objects.create(slug="stay-test", icon="🏠", label="Stays", color="#000000", kind=Category.SERVICE, is_accommodation=True)
        for listing in (self.listing(slug="tours"), self.listing(category=stay), self.listing(slug="festivals")):
            r = self.add(listing)
            self.assertEqual(r.status_code, 400, r.content)
            self.assertEqual(r.json(), {"detail": SERVICE_STAY_MESSAGE, "code": "not_deliverable"})
        self.assertFalse(CartItem.objects.exists())

    def test_products_and_food_go_in(self):
        self.assertEqual(self.add(self.listing()).status_code, 201)
        self.assertEqual(self.add(self.listing(slug="food")).status_code, 201)

    def test_a_fifth_shop_is_refused_but_more_from_a_shop_in_the_cart_is_fine(self):
        first = self.listing()
        for listing in (first, self.listing(), self.listing(), self.listing()):
            self.assertEqual(self.add(listing).status_code, 201)
        r = self.add(self.listing())
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json(), {"detail": "Your delivery can include up to 4 shops. Remove one to add this.", "code": "shop_limit"})
        self.assertEqual(self.add(self.listing(owner=first.business_owner)).status_code, 201)

    def test_a_beverages_shop_counts_as_a_food_place(self):
        self.assertEqual(self.add(self.listing(slug="food")).status_code, 201)
        self.assertEqual(self.add(self.listing(slug="beverages")).status_code, 201)
        r = self.add(self.listing(slug="beverages"))
        self.assertEqual(r.json()["code"], "food_limit")
        self.assertEqual(self.guard()["food_shops"], 2)

    def test_a_third_food_place_is_refused(self):
        self.assertEqual(self.add(self.listing(slug="food")).status_code, 201)
        self.assertEqual(self.add(self.listing(slug="food")).status_code, 201)
        r = self.add(self.listing(slug="food"))
        self.assertEqual(r.json(), {"detail": "Your delivery can include food from up to 2 places. Remove one to add this.", "code": "food_limit"})

    def test_food_must_be_within_the_radius_of_a_cart_shop(self):
        self.put(self.listing())
        inside = self.listing(slug="food", point=(6.7065, -1.6244))  # about 2.0 km as the crow flies
        outside = self.listing(slug="food", point=(6.7075, -1.6244))  # about 2.1 km as the crow flies
        with mock.patch("cart.guard.routing_service.legs_from", return_value=[leg(3.0), leg(3.01)]) as legs:
            self.assertIsNone(self.guard(inside)["listing"]["blocked"])
            far = self.guard(outside)["listing"]["blocked"]
        self.assertEqual(far, {"detail": "This food place is more than 3 km from the shops in your cart, so one rider cannot collect it on the same trip.", "code": "food_far"})
        self.assertEqual(legs.call_count, 1)  # the near-shop map is measured once per cart and cached

    def test_a_food_place_without_a_location_cannot_join_a_cart(self):
        self.put(self.listing())
        r = self.add(self.listing(slug="food", point=None))
        self.assertEqual(r.json()["code"], "food_unlocated")

    def test_a_shop_selling_goods_and_food_counts_once_and_as_food(self):
        mixed = self.listing()
        self.put(self.listing(slug="food"), self.listing(slug="food"), mixed)
        r = self.add(self.listing(slug="food", owner=mixed.business_owner))
        self.assertEqual(r.json()["code"], "food_limit")
        self.assertEqual(self.add(self.listing(owner=mixed.business_owner)).status_code, 201)
        summary = self.guard()
        self.assertEqual((len(summary["shops"]), summary["food_shops"]), (3, 2))


class CheckoutGuardTests(GuardCase):
    def checkout(self, method):
        body = {"delivery_method": method, "delivery_address": "1 Road", "delivery_phone": "+233200000000"}
        return self.client.post("/api/orders/checkout/", body, format="json")

    def test_checkout_refuses_a_cart_that_predates_the_rules_and_keeps_it(self):
        self.put(self.listing(slug="tours"), self.listing())
        for method in ("store_pickup", "door_to_door"):
            r = self.checkout(method)
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json(), {"detail": f"{SERVICE_STAY_MESSAGE} Remove them from your cart to check out.", "code": "not_deliverable"})
        self.assertEqual(CartItem.objects.count(), 2)

    def test_a_cart_over_a_lowered_limit_is_blocked_for_door_to_door_only(self):
        self.put(*(self.listing() for _ in range(4)))
        RateCard.objects.create(version=1, status=RateCard.LIVE, customer_base="5", customer_per_km="1.5", customer_min_fee="8",
                                rider_per_job="3", rider_per_km="1", max_shops_per_delivery=3)
        r = self.checkout("door_to_door")
        self.assertEqual(r.json(), {"detail": "Your delivery can include up to 3 shops. Your cart has 4. Remove 1 to check out.", "code": "shop_limit"})
        self.assertEqual(CartItem.objects.count(), 4)
        self.assertEqual(self.guard()["checkout"]["door_to_door"]["code"], "shop_limit")
        self.assertEqual(self.checkout("store_pickup").status_code, 201)

    def test_the_guard_endpoint_describes_the_cart(self):
        self.assertEqual(self.guard()["active"], False)
        self.put(self.listing(name="Kente House"))
        summary = self.guard(self.listing(slug="tours"))
        self.assertEqual(summary["shops"][0]["name"], "Kente House")
        self.assertEqual(summary["limits"]["max_shops_per_delivery"], 4)
        self.assertEqual(summary["listing"]["blocked"]["code"], "not_deliverable")
        self.assertEqual(summary["checkout"], {"any": None, "door_to_door": None})
        self.client.credentials()
        self.assertEqual(self.client.get("/api/cart/guard/").status_code, 401)
```

`backend/listings/tests/test_cart_tiers.py`:

```python
from accounts.authentication import issue_token
from cart.tests.test_guard import GuardCase


class CartTierSearchTests(GuardCase):
    def setUp(self):
        super().setUp()
        self.mine = self.listing(name="Shop A")
        self.close = self.listing(point=(6.6975, -1.6244), name="Shop B")  # about 1 km: 1.3 km as the estimate
        self.far = self.listing(point=(6.80, -1.6244), name="Shop C")  # about 12 km
        self.tour = self.listing(slug="tours", point=(6.689, -1.6244), name="Tour Co")
        self.put(self.mine)

    def search(self, **params):
        r = self.client.get("/api/listings/", {"cart_tiers": "1", **params})
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["results"]

    def test_cart_shops_then_near_shops_then_everyone_else(self):
        rows = self.search()
        self.assertEqual([r["id"] for r in rows[:2]], [self.mine.id, self.close.id])
        self.assertEqual((rows[0]["cart_tier"], rows[0]["cart_label"]), (1, "In your cart"))
        self.assertEqual((rows[1]["cart_tier"], rows[1]["cart_label"]), (2, "1.3 km from Shop A (estimate)"))
        rest = {r["id"]: r for r in rows[2:]}
        self.assertEqual(set(rest), {self.far.id, self.tour.id})
        self.assertEqual(rest[self.far.id]["cart_tier"], 3)
        self.assertEqual((rest[self.tour.id]["cart_tier"], rest[self.tour.id]["cart_label"], rest[self.tour.id]["cart_blocked"]), (None, None, None))

    def test_at_the_shop_limit_other_shops_say_so(self):
        self.put(self.listing(), self.listing(), self.listing())
        rows = {r["id"]: r for r in self.search()}
        self.assertIsNone(rows[self.mine.id]["cart_blocked"])
        self.assertEqual(rows[self.close.id]["cart_blocked"]["code"], "shop_limit")
        self.assertEqual(rows[self.far.id]["cart_blocked"]["code"], "shop_limit")
        self.assertIsNone(rows[self.tour.id]["cart_blocked"])

    def test_without_the_flag_or_with_an_empty_cart_search_is_unchanged(self):
        from cart.models import CartItem

        self.assertNotIn("cart_tier", self.client.get("/api/listings/").json()["results"][0])
        CartItem.objects.all().delete()
        self.assertNotIn("cart_tier", self.search()[0])

    def test_anonymous_and_business_callers_get_plain_search(self):
        self.client.credentials()
        self.assertNotIn("cart_tier", self.search()[0])
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(self.mine.business_owner, 'business_owner')}")
        self.assertNotIn("cart_tier", self.search()[0])
```

- [ ] **Step 2: Run, expect FAIL**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test cart.tests.test_guard listings.tests.test_cart_tiers`
Expected: FAIL (`ModuleNotFoundError: No module named 'cart.guard'`).

- [ ] **Step 3: Create `backend/cart/guard.py`:**

```python
"""The shop-aware cart guard (spec 2026-10-14, section 5). A delivery cart holds products and food only (services are
requested and stays booked through their own flows), from at most max_shops_per_delivery businesses, of which at most
max_food_shops sell food, and a new food place must be within near_shop_radius_km of a business already in the cart.
Limits come from delivery.config.effective_cart_limits(). Search uses the same context to put the cart's shops first,
then shops near them (road km, labelled when estimated), then everyone else. Nothing here deletes a cart row."""
from decimal import Decimal

from django.core.cache import cache
from django.db.models import Q

from delivery import config
from delivery.services import valid_point
from delivery.stops import shop_entries
from field.services import business_pin, haversine_m
from listings.models import Category, Listing
from listings.visibility import hidden_business_q
from routing import service as routing_service

PRODUCT, FOOD, SERVICE, STAY, EVENT = "product", "food", "service", "stay", "event"
DELIVERABLE = (PRODUCT, FOOD)
SERVICE_STAY_MESSAGE = "Services are requested separately, and stays are booked separately."
FOOD_UNLOCATED_MESSAGE = "This food place has no location on the map yet, so it cannot join a delivery with other shops."
NEAR_TTL_S = 60


class GuardError(Exception):
    def __init__(self, message, code):
        super().__init__(message)
        self.message, self.code = message, code

    def body(self):
        return {"detail": self.message, "code": self.code}


def kind_of(listing):
    category = listing.category
    if category.is_accommodation:
        return STAY
    if category.is_food:
        return FOOD
    if category.kind == Category.PRODUCT:
        return PRODUCT
    return EVENT if category.kind == Category.EVENT else SERVICE


def deliverable_q(prefix=""):
    """Listings a delivery cart may hold: food, or a product that is not a stay."""
    return Q(**{f"{prefix}category__is_food": True}) | (
        Q(**{f"{prefix}category__kind": Category.PRODUCT}) & Q(**{f"{prefix}category__is_accommodation": False})
    )


def _plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


def shop_limit_message(limits, action="Remove one to add this."):
    return f"Your delivery can include up to {_plural(limits['max_shops_per_delivery'], 'shop')}. {action}"


def food_limit_message(limits, action="Remove one to add this."):
    return f"Your delivery can include food from up to {_plural(limits['max_food_shops'], 'place')}. {action}"


def food_far_message(limits):
    km = f"{Decimal(limits['near_shop_radius_km']).normalize():f}"
    return f"This food place is more than {km} km from the shops in your cart, so one rider cannot collect it on the same trip."


def _listing_point(listing):
    pin = business_pin(listing.business_owner)
    pin = valid_point(*pin) if pin else None
    return pin or valid_point(listing.lat, listing.lng)


def _candidates(exclude):
    """{owner id: (lat, lng)} for every visible business with a deliverable published listing and a known location."""
    rows = (Listing.objects.filter(status=Listing.PUBLISHED).filter(deliverable_q()).exclude(hidden_business_q())
            .exclude(business_owner_id__in=exclude).select_related("business_owner__profile").order_by("business_owner_id", "pk"))
    points = {}
    for listing in rows:
        if points.get(listing.business_owner_id) is None:
            points[listing.business_owner_id] = _listing_point(listing)
    return {k: (float(v[0]), float(v[1])) for k, v in points.items() if v is not None}


def near_map(shops, limits):
    """{owner id: {"km", "basis", "from_id", "from_name"}} for every business within the radius (road km, or the labelled
    estimate) of any located cart shop, the nearest cart shop winning; cart shops are left out. A road is never shorter
    than the straight line, so only businesses within the radius as the crow flies are measured."""
    radius = float(limits["near_shop_radius_km"])
    located = sorted((s for s in shops if s["lat"] is not None), key=lambda s: s["key"])
    if not located:
        return {}
    key = "cartguard:near:%s:%s" % (radius, "|".join(f"{s['key']}@{s['lat']:.5f},{s['lng']:.5f}" for s in located))
    cached = cache.get(key)
    if cached is not None:
        return cached
    candidates = _candidates({s["key"] for s in shops})
    out = {}
    for shop in located:
        close = sorted((oid, p) for oid, p in candidates.items() if haversine_m(shop["lat"], shop["lng"], p[0], p[1]) / 1000 <= radius)
        if not close:
            continue
        for (oid, _), got in zip(close, routing_service.legs_from([p for _, p in close], (shop["lat"], shop["lng"]))):
            km = float(got["distance_km"])
            if km <= radius and (oid not in out or km < out[oid]["km"]):
                out[oid] = {"km": round(km, 2), "basis": got["basis"], "from_id": shop["key"], "from_name": shop["name"]}
    cache.set(key, out, NEAR_TTL_S)
    return out


def context(lines, *, limits=None):
    """What the guard knows about a cart: its shops (stops.shop_entries), the limits, and (lazily, see near) the shops near them."""
    limits = limits or config.effective_cart_limits()
    shops = shop_entries(lines)
    return {"limits": limits, "shops": shops, "ids": {s["key"] for s in shops}, "food_ids": {s["key"] for s in shops if s["food"]}, "near": None}


def near(ctx):
    if ctx["near"] is None:
        ctx["near"] = near_map(ctx["shops"], ctx["limits"])
    return ctx["near"]


def blocked_reason(ctx, listing):
    """None when `listing` may join this cart now, else (message, code)."""
    kind = kind_of(listing)
    if kind not in DELIVERABLE:
        return SERVICE_STAY_MESSAGE, "not_deliverable"
    limits, owner_id = ctx["limits"], listing.business_owner_id
    if owner_id not in ctx["ids"] and len(ctx["ids"]) + 1 > limits["max_shops_per_delivery"]:
        return shop_limit_message(limits), "shop_limit"
    if kind == FOOD and owner_id not in ctx["food_ids"] and len(ctx["food_ids"]) + 1 > limits["max_food_shops"]:
        return food_limit_message(limits), "food_limit"
    if kind == FOOD and owner_id not in ctx["ids"] and ctx["ids"] and owner_id not in near(ctx):
        return (food_far_message(limits), "food_far") if _listing_point(listing) else (FOOD_UNLOCATED_MESSAGE, "food_unlocated")
    return None


def check_add(lines, listing):
    reason = blocked_reason(context(lines), listing)
    if reason:
        raise GuardError(*reason)


def check_checkout(lines, delivery_method):
    """Refuse a cart that cannot be checked out: any service or stay line (every method), or more shops or food places
    than one delivery allows (door-to-door only: a store pickup has no rider). Nothing is removed from the cart."""
    if any(kind_of(line.listing) not in DELIVERABLE for line in lines):
        raise GuardError(f"{SERVICE_STAY_MESSAGE} Remove them from your cart to check out.", "not_deliverable")
    if delivery_method != "door_to_door":
        return
    ctx = context(lines)
    limits = ctx["limits"]
    extra = len(ctx["ids"]) - limits["max_shops_per_delivery"]
    if extra > 0:
        raise GuardError(shop_limit_message(limits, f"Your cart has {len(ctx['ids'])}. Remove {extra} to check out."), "shop_limit")
    extra = len(ctx["food_ids"]) - limits["max_food_shops"]
    if extra > 0:
        raise GuardError(food_limit_message(limits, f"Your cart has {len(ctx['food_ids'])}. Remove {extra} to check out."), "food_limit")


def _blocked(fn):
    try:
        fn()
    except GuardError as exc:
        return exc.body()
    return None


def summary(lines, listing=None):
    """GET /api/cart/guard/: the cart's shops, the limits, whether checkout is blocked, and optionally one listing."""
    ctx = context(lines)
    limits = ctx["limits"]
    out = {
        "active": bool(lines), "limits": config.limits_json(limits),
        "shops": [{"id": s["key"], "name": s["name"], "food": s["food"]} for s in ctx["shops"]],
        "food_shops": len(ctx["food_ids"]),
        "at_shop_limit": len(ctx["ids"]) >= limits["max_shops_per_delivery"],
        "at_food_limit": len(ctx["food_ids"]) >= limits["max_food_shops"],
        "checkout": {"any": _blocked(lambda: check_checkout(lines, "store_pickup")),
                     "door_to_door": _blocked(lambda: check_checkout(lines, "door_to_door"))},
    }
    if listing is not None:
        reason = blocked_reason(ctx, listing)
        out["listing"] = {"id": listing.pk, "blocked": {"detail": reason[0], "code": reason[1]} if reason else None}
    return out
```

- [ ] **Step 4: Views and serializers.** In `cart/views.py` (add `from listings.models import Listing` and `from . import guard`), in `CartItemCreateView.post` after `cart, _ = Cart.objects.get_or_create(...)`:

```python
        lines = list(cart.items.select_related("listing__business_owner__profile", "listing__category"))
        try:
            guard.check_add(lines, listing)
        except guard.GuardError as exc:
            return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
```

```python
class CartGuardView(APIView):
    """GET /api/cart/guard/?listing=<id> — the delivery limits for the caller's cart: its shops, whether checkout is
    blocked and why, and with ?listing= whether that listing may be added now. Writes nothing."""

    permission_classes = [IsAuthenticated, IsCustomer]

    def get(self, request):
        cart = Cart.objects.filter(customer=request.user).first()
        lines = list(cart.items.select_related("listing__business_owner__profile", "listing__category")) if cart else []
        listing = None
        raw = request.query_params.get("listing")
        if raw:
            if not str(raw).isdigit():
                return Response({"detail": "Name a listing by its number."}, status=status.HTTP_400_BAD_REQUEST)
            listing = generics.get_object_or_404(Listing.objects.select_related("category", "business_owner__profile"), pk=raw, status=Listing.PUBLISHED)
        return Response(guard.summary(lines, listing))
```

Register `path("guard/", views.CartGuardView.as_view(), name="cart-guard"),` in `cart/urls.py`. In `OrderCheckoutView.post`, right after the `delivery_method` choice check:

```python
        from cart import guard

        try:
            guard.check_checkout(items, delivery_method)
        except guard.GuardError as exc:
            return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
```

In `listings/serializers.py`, add `"is_food"` to `CategorySerializer.Meta.fields` and, after `PublicListingSerializer`:

```python
class CartTieredListingSerializer(PublicListingSerializer):
    """Search for a customer whose cart holds something (?cart_tiers=1, cart.guard): the tier of the listing's shop
    (1 in the cart, 2 near it, 3 everyone else; null for services, stays and events, which are not tiered), the distance
    label for tier 2, and why the cart cannot take it now, if so."""

    cart_tier = serializers.SerializerMethodField()
    cart_label = serializers.SerializerMethodField()
    cart_blocked = serializers.SerializerMethodField()

    class Meta(PublicListingSerializer.Meta):
        fields = [*PublicListingSerializer.Meta.fields, "cart_tier", "cart_label", "cart_blocked"]

    @staticmethod
    def _deliverable(obj):
        from cart import guard

        return guard.kind_of(obj) in guard.DELIVERABLE

    def get_cart_tier(self, obj):
        return getattr(obj, "cart_tier", None) if self._deliverable(obj) else None

    def get_cart_label(self, obj):
        from routing import service as routing_service

        tier = self.get_cart_tier(obj)
        if tier == 1:
            return "In your cart"
        if tier == 2:
            near = self.context["cart_guard"]["near"][obj.business_owner_id]
            text = f"{near['km']:.1f} km from {near['from_name']}"
            return text if near["basis"] == routing_service.BASIS_ROAD else f"{text} (estimate)"
        return None

    def get_cart_blocked(self, obj):
        from cart import guard

        if not self._deliverable(obj):
            return None
        reason = guard.blocked_reason(self.context["cart_guard"], obj)
        return {"detail": reason[0], "code": reason[1]} if reason else None
```

In `listings/views.py` (import `CartTieredListingSerializer`; add `Case, F, FloatField, IntegerField, Value, When` to the `django.db.models` import), extend `PublicListingListView`:

```python
    def _cart_guard(self):
        """The cart guard context for ?cart_tiers=1 from a customer whose cart has something in it; else None."""
        if not hasattr(self, "_guard_ctx"):
            self._guard_ctx = None
            if self.request.query_params.get("cart_tiers") in ("1", "true"):
                from accounts.models import Customer
                from cart import guard
                from cart.models import CartItem

                if isinstance(self.request.user, Customer):
                    lines = list(CartItem.objects.filter(cart__customer=self.request.user)
                                 .select_related("listing__business_owner__profile", "listing__category"))
                    if lines:
                        ctx = guard.context(lines)
                        guard.near(ctx)
                        self._guard_ctx = ctx
        return self._guard_ctx

    @staticmethod
    def _with_tiers(queryset, ctx):
        from cart import guard

        whens = [When(~guard.deliverable_q(), then=Value(3)), When(business_owner_id__in=list(ctx["ids"]), then=Value(1))]
        if ctx["near"]:
            whens.append(When(business_owner_id__in=list(ctx["near"]), then=Value(2)))
        km = [When(business_owner_id=oid, then=Value(v["km"])) for oid, v in ctx["near"].items()]
        return queryset.annotate(
            cart_tier=Case(*whens, default=Value(3), output_field=IntegerField()),
            cart_km=Case(*km, default=Value(None), output_field=FloatField()),
        )

    def get_serializer_class(self):
        return CartTieredListingSerializer if self._cart_guard() is not None else PublicListingSerializer

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "cart_guard": self._cart_guard()}
```

In `get_queryset`, before `return _with_rating_annotations(queryset)`:

```python
        ctx = self._cart_guard()
        if ctx is not None:
            queryset = self._with_tiers(queryset, ctx)
```

and in `filter_queryset` replace the final return with:

```python
        if self._cart_guard() is not None:
            return queryset.order_by("cart_tier", F("cart_km").asc(nulls_last=True), "-is_promoted", *existing_order)
        return queryset.order_by("-is_promoted", *existing_order)
```

- [ ] **Step 5: Move cart fixtures off the service-kind "hotels" category.** Every cart and checkout test used "hotels" (kind service); the guard now refuses it, which is the point. Run from `backend/`:

```bash
sed -i 's/self\.hotels = Category\.objects\.get(slug="hotels")/self.shops = Category.objects.get(slug="shops")/; s/category=self\.hotels/category=self.shops/g' \
  cart/tests/test_cart.py orders/tests/test_checkout.py orders/tests/test_fulfilment_spine.py \
  payments/tests/test_process_payment_hubtel_mode.py payments/tests/test_process_payment_simulated.py listings/tests/test_hidden_business.py
sed -i 's/category = Category\.objects\.get(slug="hotels")/category = Category.objects.get(slug="shops")/' orders/tests/test_new_order_alerts.py
sed -i 's/self\.cat = Category\.objects\.get(slug="hotels")/self.cat = Category.objects.get(slug="shops")/; s/cat, zone = Category\.objects\.get(slug="hotels")/cat, zone = Category.objects.get(slug="shops")/g' marketing/tests/test_promos.py
sed -i '33s/slug="hotels"/slug="shops"/' accounts/tests/test_staff_marketplace_lockout.py
sed -i 's/business_owner=self\.owner, category=Category\.objects\.get(slug="hotels")/business_owner=self.owner, category=Category.objects.get(slug="shops")/' delivery/tests/base.py
grep -n 'slug="hotels"' cart/tests/test_cart.py orders/tests/test_checkout.py orders/tests/test_fulfilment_spine.py orders/tests/test_new_order_alerts.py \
  payments/tests/test_process_payment_hubtel_mode.py payments/tests/test_process_payment_simulated.py listings/tests/test_hidden_business.py \
  marketing/tests/test_promos.py delivery/tests/base.py
```

Expected: the final `grep` prints nothing. Other test files that still use "hotels" build orders directly, never a cart, so they are left alone. (`accounts/tests/test_staff_marketplace_lockout.py:100` keeps `"category": "hotels"` in a staff listing body that is refused before any cart.)

- [ ] **Step 6: Run, expect PASS**

Run: `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test`
Expected: the whole backend suite passes except the known unrelated failure.

- [ ] **Step 7: Commit**

```bash
git add backend/cart backend/orders/views.py backend/listings/serializers.py backend/listings/views.py backend/listings/tests/test_cart_tiers.py \
  backend/orders/tests backend/payments/tests backend/listings/tests/test_hidden_business.py backend/marketing/tests/test_promos.py \
  backend/accounts/tests/test_staff_marketplace_lockout.py backend/delivery/tests/base.py
git commit -m "feat(cart): shop and food limits on add and checkout, services refused, tiered search"
```

---

### Task 9: Rider app, stop by stop (frontend; check the map by hand)

**Files:**
- Create: `frontend/components/maps/shopMarkers.js`
- Modify: `frontend/components/maps/TrackMap.jsx` (style `stop`; `stop` pins frame the map)
- Modify: `frontend/components/admin/panels/rider/JobFlow.jsx` (stop N of M, per-stop items and tries, `SkipStop`, all-skipped failure text)
- Modify: `frontend/components/admin/panels/rider/JobMap.jsx` (all open shops)
- Modify: `frontend/components/admin/panels/rider/ShiftPanel.jsx` (offer says how many shops)
- Test: `frontend/components/maps/shopMarkers.test.js`, `frontend/components/admin/panels/rider/__tests__/MultiStop.test.jsx`, one case added to `RiderApp.test.jsx`

**Interfaces:**
- Consumes: Task 5 rider payload (`pickups`, `current_stop`, `progress`, `failed_reason`), Task 5 `POST rider/jobs/<id>/skip-stop/`, Task 7 map payload `pickups`, offer `stop_count`.
- Produces:
  - `shopMarkers(data) -> [{id, kind: "pickup"|"stop", lat, lng, label}]` (first open shop gold `pickup`, later open shops `stop`, collected/skipped not drawn; one shop: the old single `pickup` pin) and `unpinnedShops(data) -> [name]`
  - TrackMap marker kind `stop` (white fill, gold ring)
  - `SkipStop({ job, onBack, onDone })` exported from `JobFlow.jsx`

- [ ] **Step 1: Write the failing tests.** `frontend/components/maps/shopMarkers.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { shopMarkers, unpinnedShops } from './shopMarkers.js'

const S = (sequence, status, lat = 6.7 + sequence / 100) => ({ id: sequence, sequence, name: `Shop ${sequence}`, lat, lng: -1.62, status })

describe('shopMarkers', () => {
  it('draws the shop being worked in gold, later open shops ringed, and no finished shop', () => {
    const got = shopMarkers({ pickups: [S(1, 'collected'), S(2, 'arrived'), S(3, 'pending'), S(4, 'skipped')] })
    expect(got.map((m) => [m.id, m.kind])).toEqual([['stop-2', 'pickup'], ['stop-3', 'stop']])
    expect(got[0].label).toBe('2. Shop 2')
  })
  it('keeps the current shop current even when it has no pin', () => {
    const got = shopMarkers({ pickups: [S(1, 'pending', null), S(2, 'pending')] })
    expect(got.map((m) => m.kind)).toEqual(['stop'])
    expect(unpinnedShops({ pickups: [S(1, 'pending', null), S(2, 'pending')] })).toEqual(['Shop 1'])
  })
  it('one shop is the old single pin, and none without coordinates', () => {
    expect(shopMarkers({ pickup: { lat: 6.7, lng: -1.62, name: 'Kente House' }, pickups: [] })).toEqual([{ id: 'pickup', kind: 'pickup', lat: 6.7, lng: -1.62, label: 'Kente House' }])
    expect(shopMarkers({ pickup: null })).toEqual([])
  })
})
```

`frontend/components/admin/panels/rider/__tests__/MultiStop.test.jsx`:

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import { resetRiderTrackingForTests } from '../../../../../lib/riderTracking.js'
import JobMap from '../JobMap.jsx'
import { ActiveJobForTest } from './helpers.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const FIX = { coords: { latitude: 6.7, longitude: -1.62, accuracy: 12, speed: null }, timestamp: Date.now() }

beforeEach(() => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: vi.fn((ok) => { ok({ ...FIX, timestamp: Date.now() }); return 7 }), clearWatch: vi.fn(), getCurrentPosition: vi.fn((ok) => ok({ ...FIX, timestamp: Date.now() })) },
  })
})
afterEach(() => resetRiderTrackingForTests())

const STOPS = [
  { id: 1, sequence: 1, business_name: 'Kente House', lat: 6.7001, lng: -1.62, status: 'collected', items: ['Kente × 1'], attempts_left: 5, planned_arrival: null },
  { id: 2, sequence: 2, business_name: 'Adwoa Beads', lat: 6.705, lng: -1.615, status: 'arrived', items: ['Beads × 2'], attempts_left: 3, planned_arrival: null },
  { id: 3, sequence: 3, business_name: 'Chop Corner', lat: 6.71, lng: -1.61, status: 'pending', items: ['Waakye × 1'], attempts_left: 5, planned_arrival: null },
]
const steps = ['accepted', 'arrived_pickup', 'picked_up', 'arrived_drop', 'delivered'].map((s, i) => ({ step: s, label: s, done: i < 2, event: i < 2 ? { at: '2026-10-14T11:00:00Z', flagged: false } : null }))
const job = (over = {}) => ({
  id: 5, order_id: 18, status: 'at_pickup', status_label: 'Arrived at pickup', accepted_at: '2026-10-14T11:00:00Z', arrived_pickup_at: '2026-10-14T11:20:00Z',
  picked_up_at: null, arrived_drop_at: null, delivered_at: null, deadline_at: null, customer_name: 'Yaw M.', delivery_address: 'Ahodwo',
  delivery_lat: 6.69, delivery_lng: -1.62, pickups: STOPS, current_stop: STOPS[1], pickup: STOPS[1], multi_pickup: true,
  progress: { total: 3, done: 1, skipped: 0, current: 2 }, payment: { label: 'Paid online (simulated)', cash_due: null }, wait: null,
  steps, calls: 0, flagged: false, pickup_attempts_left: 3, drop_attempts_left: 5, failed_reason: '', ...over,
})
const serve = (body, extra = []) => server.use(
  http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json({ rider: { id: 1, manager: null }, shift: null })),
  http.get(`${API}/api/delivery/rider/jobs/5/`, () => HttpResponse.json(body)),
  http.get(`${API}/api/orders/dispatch/5/map/`, () => HttpResponse.json({ stage: body.status, pickup: null, pickups: [], drop: null, rider: null, leg: null, route: null })),
  http.post(`${API}/api/delivery/rider/ping/`, () => HttpResponse.json({ ok: true })),
  ...extra,
)

describe('A delivery from several shops', () => {
  it('at a stop: names the shop, says stop 2 of 3, and shows only its items and tries', async () => {
    serve(job())
    wrap(<ActiveJobForTest id={5} />)
    expect(await screen.findByText('Order #18 · at pickup · stop 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('Beads × 2')).toBeInTheDocument()
    expect(screen.queryByText('Kente × 1')).not.toBeInTheDocument()
    expect(screen.getByText(/3 tries left\./)).toBeInTheDocument()
  })

  it("collects with that shop's code", async () => {
    let body
    serve(job(), [http.post(`${API}/api/delivery/rider/jobs/5/pickup/`, async ({ request }) => { body = await request.json(); return HttpResponse.json(job({ status: 'accepted' })) })])
    wrap(<ActiveJobForTest id={5} />)
    fireEvent.change(await screen.findByLabelText('Pickup code'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Picked up' }))
    await waitFor(() => expect(body).toEqual({ code: '1234', lat: 6.7, lng: -1.62, accuracy_m: 12 }))
  })

  it('skips a shop only with a note', async () => {
    let body
    serve(job(), [http.post(`${API}/api/delivery/rider/jobs/5/skip-stop/`, async ({ request }) => { body = await request.json(); return HttpResponse.json(job({ status: 'accepted' })) })])
    wrap(<ActiveJobForTest id={5} />)
    fireEvent.click(await screen.findByRole('button', { name: "Can't hand over?" }))
    const confirm = screen.getByRole('button', { name: 'Confirm: skip this shop' })
    expect(confirm).toBeDisabled()
    expect(screen.getByText(/AshantiHub Support refunds this shop's items/)).toBeInTheDocument()
    expect(screen.getByText(/Your location is sent with this report/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Closed for a funeral' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(body).toEqual({ note: 'Closed for a funeral', lat: 6.7, lng: -1.62, accuracy_m: 12 }))
  })

  it('on the way: the next shop is named, then the customer', async () => {
    const heading = [STOPS[0], { ...STOPS[1], status: 'pending' }, STOPS[2]]
    serve(job({ status: 'accepted', pickups: heading, current_stop: heading[1], pickup: heading[1] }))
    wrap(<ActiveJobForTest id={5} />)
    expect(await screen.findByText('Order #18 · to pickup · stop 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('Adwoa Beads')).toBeInTheDocument()
    expect(screen.getByText('Chop Corner')).toBeInTheDocument() // "Then to"
  })

  it('a delivery where no shop could hand over says so', async () => {
    serve(job({ status: 'failed', failed_reason: 'all_stops_skipped' }))
    wrap(<ActiveJobForTest id={5} />)
    expect(await screen.findByText(/No shop could hand over the items. The order has gone back to your manager/)).toBeInTheDocument()
  })
})

describe('JobMap with several shops', () => {
  it('draws the shop being worked in gold and later shops ringed, never a collected one', async () => {
    server.use(http.get(`${API}/api/orders/dispatch/5/map/`, () => HttpResponse.json({
      stage: 'at_pickup', pickup: { lat: 6.705, lng: -1.615, name: 'Adwoa Beads' },
      pickups: STOPS.map((s) => ({ id: s.id, sequence: s.sequence, name: s.business_name, lat: s.lat, lng: s.lng, status: s.status })),
      drop: { lat: 6.69, lng: -1.62 }, rider: { lat: 6.704, lng: -1.616, age_s: 10, stale: false }, leg: null, route: null,
    })))
    wrap(<JobMap jobId={5} />)
    await screen.findByTestId('track-map')
    const kinds = screen.getAllByRole('button').map((b) => b.getAttribute('data-kind')).filter(Boolean)
    expect(kinds).toEqual(['pickup', 'stop', 'drop', 'rider'])
    expect(screen.queryByText(/pin 1\. Kente House/)).not.toBeInTheDocument()
    expect(screen.getByText(/Ringed: later shops/)).toBeInTheDocument()
  })
})
```

In `RiderApp.test.jsx`, inside the `describe` that defines `const offer` (around line 90), add:

```jsx
  it('says how many shops an offer collects from', async () => {
    server.use(...base([http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json(me({ shift: onShift }))), http.get(`${API}/api/delivery/rider/offers/`, () => HttpResponse.json({ results: [offer({ stop_count: 3 })], acceptance_30d: { accepted: 0, of: 0 } }))]))
    wrap(<ShiftPanel />)
    expect(await screen.findByText('Then 2 more shops on the same trip')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd frontend && npx vitest run components/maps/shopMarkers.test.js components/admin/panels/rider`
Expected: FAIL (`shopMarkers.js` missing, no "stop 2 of 3", no skip button, no shop count).

- [ ] **Step 3: Create `frontend/components/maps/shopMarkers.js`:**

```js
// Pins for the shops on one delivery, from a tracking payload's `pickups` (several shops) or `pickup` (one shop).
// The shop being worked (the first open one) is gold ("pickup"); later open shops are ringed ("stop"); collected and
// skipped shops are not drawn; a shop without coordinates is not drawn and never faked at 0,0.
const OPEN = ['pending', 'arrived']
const has = (p) => p && p.lat !== null && p.lng !== null && p.lat !== undefined && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
const open = (data) => (data?.pickups || []).filter((s) => !s.status || OPEN.includes(s.status))

export function shopMarkers(data) {
  const pickups = data?.pickups || []
  if (pickups.length <= 1) {
    const p = data?.pickup
    return has(p) ? [{ id: 'pickup', kind: 'pickup', lat: p.lat, lng: p.lng, label: p.name || 'Shop' }] : []
  }
  const rows = open(data)
  return rows.filter(has).map((s) => ({ id: `stop-${s.sequence}`, kind: s === rows[0] ? 'pickup' : 'stop', lat: s.lat, lng: s.lng, label: `${s.sequence}. ${s.name}` }))
}

// Open shops with no map pin, by name, so a screen can say which ones it cannot draw.
export function unpinnedShops(data) {
  return open(data).filter((s) => !has(s)).map((s) => s.name)
}
```

In `TrackMap.jsx` add to `STYLE`: `stop: { color: "#D4A017", weight: 3, fillColor: "#FFFFFF", fillOpacity: 1 },` and in `fitSignature` use `const stops = pins.filter((m) => m.kind === "pickup" || m.kind === "drop" || m.kind === "stop");`.

- [ ] **Step 4: The job screen.** In `JobFlow.jsx`, add near the top:

```jsx
// "stop 2 of 3" when a delivery collects from several shops; nothing extra for one shop.
const titled = (job, base) => (job.progress?.total > 1 && job.progress?.current ? `${base} · stop ${job.progress.current} of ${job.progress.total}` : base);
const OPEN = ["pending", "arrived"];
const nextShop = (job) => {
  const cur = job.current_stop;
  return (job.pickups || []).find((s) => cur && s.sequence > cur.sequence && OPEN.includes(s.status)) || null;
};
```

In `ToPickup`: use `const p = job.current_stop || job.pickup;`, title `titled(job, accepted ? "to pickup" : "new job")`, the "Then to" cell `{next ? next.business_name : (job.delivery_address || "No address")}` with `const next = nextShop(job);`, the Info line "At the shop, ask for <b>Order #{job.order_id}</b>. Each shop reads you its own 4-digit pickup code from its AshantiHub order screen.", and when accepted and `onSkip` is given, a `<button type="button" onClick={onSkip} style={quietButton(false)}>Can&apos;t hand over?</button>` under the arrive button. In `AtPickup`: `const p = job.current_stop || job.pickup;` for the name and items, the tries text from `p?.attempts_left ?? job.pickup_attempts_left`, title `titled(job, "at pickup")`, and below "Picked up" add `<button type="button" onClick={onSkip} style={quietButton(false)}>Can&apos;t hand over?</button>`. Add the skip screen:

```jsx
export function SkipStop({ job, onBack, onDone }) {
  const [note, setNote] = useState("");
  const step = useStep(job, (out) => onDone(out));
  const p = job.current_stop || job.pickup;
  const left = (job.progress?.total || 1) - (job.progress?.done || 0) - (job.progress?.skipped || 0);
  const ends = left <= 1 && !(job.progress?.done > 0);
  return (
    <>
      <section aria-label="Shop cannot hand over" style={card}>
        <h1 style={h2}>Order #{job.order_id} · {p?.business_name || "this shop"} can&apos;t hand over</h1>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", fontWeight: 800, color: D.text }}>
          What happened? (required)
          <textarea aria-label="What happened" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} style={field} />
        </label>
        <Info>
          {ends ? "Nothing has been collected and this is the last shop, so you stop here. The order goes back to your manager to send out again." : left > 1 ? "You move on to the next shop." : "You go on to the customer with what you collected."}{" "}
          The customer is told, and AshantiHub Support refunds this shop&apos;s items. Your location is sent with this report as proof you were there; the shop sees only the time and your note.
        </Info>
      </section>
      <Err>{step.error}</Err>
      <button type="button" disabled={!note.trim() || step.busy} onClick={() => step.run("skip-stop", { note: note.trim() })} style={bigButton(!note.trim() || step.busy)}>Confirm: skip this shop</button>
      <button type="button" onClick={onBack} style={quietButton(false)}>Back to the job</button>
    </>
  );
}
```

In `ActiveJob`: add `const [skip, setSkip] = useState(false);`, render `if (skip) return <div style={screen}><SkipStop job={job} onBack={() => setSkip(false)} onDone={(out) => { setSkip(false); changed(out); }} /></div>;` before the step switch, pass `onSkip={() => setSkip(true)}` to `ToPickup` and `AtPickup`, and in the failed branch show `job.failed_reason === "all_stops_skipped" ? "No shop could hand over the items. The order has gone back to your manager to send out again; nothing goes to the customer." : <>Reason: ...existing text...</>`.

- [ ] **Step 5: The rider map and the offer.** In `rider/JobMap.jsx` (import `shopMarkers, unpinnedShops` from `../../../maps/shopMarkers.js`), build `const shops = shopMarkers(data);` and `markers = [...shops, ...drop pin..., ...rider pin...]`; the missing-pin line names `unpinnedShops(data)` (or "shop" when one shop has no pin, as today); the legend adds `shops.some((m) => m.kind === "stop") && "Ringed: later shops"`. In `ShiftPanel.jsx`, under the shop name in the offer card:

```jsx
          {offer.stop_count > 1 && <div style={dim}>Then {offer.stop_count - 1} more shop{offer.stop_count === 2 ? "" : "s"} on the same trip</div>}
```

- [ ] **Step 6: Run, expect PASS**

Run: `cd frontend && npx vitest run components/maps components/admin/panels/rider && npx vitest run`
Expected: PASS (the existing `JobMap.test.jsx` single-shop cases are unchanged).

- [ ] **Step 7: Commit**

```bash
git add frontend/components/maps/shopMarkers.js frontend/components/maps/shopMarkers.test.js frontend/components/maps/TrackMap.jsx frontend/components/admin/panels/rider
git commit -m "feat(frontend): rider works one shop at a time, skip with a note, every shop on the map"
```

Hand check (Task 13): the gold/ringed pins and the framing are Leaflet, so they are verified in a browser, not here.

---

### Task 10: Vendor and customer screens (frontend)

**Files:**
- Modify: `frontend/components/dashboard/panels/DeliveriesPanel.jsx` (rider arrives about HH:MM; rider at another shop; collected line; the rider's report when this shop could not hand over)
- Modify: `frontend/components/OrderTrackingMap.jsx` (`stops` prop)
- Modify: `frontend/App.jsx` (pass `stops={o.delivery_stops ?? null}` to `OrderTrackingMap`, at the order card near line 2161; render only)
- Test: additions to `frontend/components/dashboard/panels/DeliveriesPanel.test.jsx` and `frontend/components/__tests__/OrderTrackingMap.test.jsx`

**Interfaces:**
- Consumes: Task 7 `OwnerOrderSerializer.pickup_eta`, `pickup_status`, `rider_report`, `business_map.rider_elsewhere`, `business_map.stop`, `OrderSerializer.delivery_stops`.
- Produces: `<OrderTrackingMap orderId assignmentStatus deliveryStatus stops />` where `stops = {total, done, skipped} | null`.

- [ ] **Step 1: Write the failing tests.** Append to `DeliveriesPanel.test.jsx` (inside `describe('DeliveriesPanel rider tracking (vendor)'`, which has `trackWith`, `HEADING_ORDER`):

```jsx
  it('tells a later shop when the rider should arrive, with its own code and no map yet', async () => {
    renderPanel([{ ...DOOR_TO_DOOR_ORDER, pickup_code: '4821', pickup_eta: '2026-10-14T14:35:00Z', rider_heading_here: false }])
    expect(await screen.findByText(/Rider arrives about \d{2}:\d{2}/)).toBeInTheDocument()
    expect(screen.getByLabelText('Pickup code 4 8 2 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Rider on the way/ })).not.toBeInTheDocument()
  })

  it("shows the rider's report when this shop could not hand over, with no rider details", async () => {
    renderPanel([{ ...DOOR_TO_DOOR_ORDER, pickup_status: 'skipped', rider_report: { at: '2026-10-14T14:35:00Z', text: 'Rider reported at your shop at 14:35: Door was locked' } }])
    expect(await screen.findByText('Rider reported at your shop at 14:35: Door was locked')).toBeInTheDocument()
    expect(screen.queryByText(/\+233/)).not.toBeInTheDocument()
  })

  it('says the rider is at another shop first, with no map', async () => {
    trackWith({ stage: 'accepted', pickup: { lat: 5.6037, lng: -0.187, name: 'Akosua Ntoma' }, stop: { status: 'pending', planned_arrival: null }, rider: null, leg: null, route: null, rider_elsewhere: true })
    renderPanel([HEADING_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    expect(await screen.findByText('The rider is collecting from another shop first.')).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
  })

  it('says its items are collected once its own stop is done, even while the rider is at the next shop', async () => {
    trackWith({ stage: 'accepted', pickup: null, stop: { status: 'collected', planned_arrival: null }, rider: null, leg: null, route: null, rider_elsewhere: false })
    renderPanel([HEADING_ORDER])
    fireEvent.click(await screen.findByRole('button', { name: /Rider on the way/ }))
    expect(await screen.findByText('The rider has collected your items.')).toBeInTheDocument()
  })
```

Append to `OrderTrackingMap.test.jsx`:

```jsx
describe('OrderTrackingMap with several shops', () => {
  it('counts the shops before the last pickup, with no map', async () => {
    const calls = track(PICKED_UP)
    mount(<OrderTrackingMap orderId={7} assignmentStatus="accepted" deliveryStatus="processing" stops={{ total: 3, done: 1, skipped: 0 }} />)
    expect(screen.getByText('Collecting from 3 shops: 1 done.')).toBeInTheDocument()
    expect(screen.queryByTestId('track-map')).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 60))
    expect(calls).toHaveLength(0)
  })

  it('says a shop that could not hand over is refunded, before and after pickup', async () => {
    track(PICKED_UP)
    const { rerender } = mount(<OrderTrackingMap orderId={7} assignmentStatus="accepted" deliveryStatus="processing" stops={{ total: 3, done: 1, skipped: 1 }} />)
    expect(screen.getByText('Collecting from 3 shops: 1 done, 1 could not hand over.')).toBeInTheDocument()
    expect(screen.getByText(/refunded\. AshantiHub Support will be in touch/)).toBeInTheDocument()
    rerender(<QueryClientProvider client={new QueryClient()}><OrderTrackingMap orderId={7} assignmentStatus="picked_up" deliveryStatus="out_for_delivery" stops={{ total: 3, done: 2, skipped: 1 }} /></QueryClientProvider>)
    expect(screen.getByText(/refunded\. AshantiHub Support will be in touch/)).toBeInTheDocument()
  })

  it('adds nothing for a single shop', () => {
    mount(<OrderTrackingMap orderId={7} assignmentStatus="accepted" deliveryStatus="processing" stops={null} />)
    expect(screen.queryByText(/Collecting from/)).not.toBeInTheDocument()
  })
})
```

(add `import { QueryClient, QueryClientProvider } from '@tanstack/react-query'` at the top of that file if not already imported).

- [ ] **Step 2: Run, expect FAIL**

Run: `cd frontend && npx vitest run components/dashboard/panels/DeliveriesPanel.test.jsx components/__tests__/OrderTrackingMap.test.jsx`
Expected: FAIL (texts not found).

- [ ] **Step 3: Implement.** In `DeliveriesPanel.jsx`, `RiderOnTheWay`, after the `failed` branch:

```jsx
    else if (data.stop?.status === "collected") body = <p style={line}>The rider has collected your items.</p>;
    else if (data.rider_elsewhere) body = <p style={line}>The rider is collecting from another shop first.</p>;
```

and in `OrderRow`, above `PickupCodeBox`:

```jsx
      {doorToDoor && order.rider_report?.text && <div role="note" style={{ color: D.text, fontSize: "0.74rem", fontWeight: 700, marginTop: 8 }}>{order.rider_report.text}</div>}
      {doorToDoor && order.pickup_eta && (
        <div style={{ color: D.text, fontSize: "0.74rem", fontWeight: 700, marginTop: 8 }}>
          🛵 Rider arrives about {new Date(order.pickup_eta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          <span style={{ color: D.textDim, fontWeight: 400 }}> · an estimate from the planned route; it moves if the rider is held up.</span>
        </div>
      )}
```

In `OrderTrackingMap.jsx`:

```jsx
// A delivery from several shops: how many are collected, and (only when one could not hand over) that its items are
// refunded. Counts only: the customer is never shown shop positions or codes.
function StopsLine({ stops, full }) {
  if (!stops || stops.total < 2) return null;
  return (
    <>
      {full && <p style={note}>Collecting from {stops.total} shops: {stops.done} done{stops.skipped ? `, ${stops.skipped} could not hand over` : ""}.</p>}
      {stops.skipped > 0 && <p style={note}>Items from a shop that could not hand over are refunded. AshantiHub Support will be in touch.</p>}
    </>
  );
}
```

and change the default export to `export default function OrderTrackingMap({ orderId, assignmentStatus, deliveryStatus, stops = null })` with the before-pickup branch returning `processing ? <><p style={note}>{BEFORE_PICKUP_COPY[assignmentStatus]}</p><StopsLine stops={stops} full /></> : null` and the live branch returning `<><StopsLine stops={stops} full={false} /><LiveMap orderId={orderId} /></>`. In `App.jsx`, pass `stops={o.delivery_stops ?? null}` to `OrderTrackingMap`.

- [ ] **Step 4: Run, expect PASS**

Run: `cd frontend && npx vitest run components/dashboard components/__tests__/OrderTrackingMap.test.jsx && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/dashboard/panels/DeliveriesPanel.jsx frontend/components/dashboard/panels/DeliveriesPanel.test.jsx frontend/components/OrderTrackingMap.jsx frontend/components/__tests__/OrderTrackingMap.test.jsx frontend/App.jsx
git commit -m "feat(frontend): shops see their own stop and arrival time, customers see shop progress"
```

---

### Task 11: Delivery Manager screens (frontend; check the maps by hand)

**Files:**
- Modify: `frontend/components/admin/panels/delivery/ActiveDeliveriesPanel.jsx` (shops section, per-stop `CodeLine`, skip control, route line)
- Modify: `frontend/components/admin/panels/delivery/deliveryMaps.jsx` (all shops on the queue and job maps)
- Modify: `frontend/components/admin/panels/delivery/DispatchQueuePanel.jsx` (shop count, detour warning)
- Modify: `frontend/components/admin/panels/delivery/RulesPanels.jsx` (four limit fields, limits in force)
- Test: `frontend/components/admin/panels/delivery/__tests__/DeliveryMultiStop.test.jsx`; one case added to `DeliveryCashRules.test.jsx`

**Interfaces:**
- Consumes: Task 6 job detail `stops` (each with `skips`), `skip_history`, `route_plan`, `POST jobs/<id>/unlock-code/ {stop}`, `POST jobs/<id>/stops/<stop>/skip/`, queue rows `stops`, `detour_warning`, `returned_reason`, `skips` (Task 5); Task 7 map `pickups`; Task 1 `cart_limits`; Task 9 `shopMarkers`.
- Produces: `CodeLine` accepts `stopId` (sent as `stop` only when given).

- [ ] **Step 1: Write the failing tests** `frontend/components/admin/panels/delivery/__tests__/DeliveryMultiStop.test.jsx`:

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import ActiveDeliveries from '../ActiveDeliveriesPanel.jsx'
import DispatchQueuePanel from '../DispatchQueuePanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const auth = { user: { full_name: 'Adwoa Sarpong', role: 'delivery_manager' }, hasPermission: () => true }
const stop = (sequence, name, status, over = {}) => ({ id: 70 + sequence, sequence, business_name: name, status, wrong_tries: 0, planned_arrival: null, collected_at: null, skip_note: '', items: [], ...over })
const detail = (over = {}) => ({
  id: 55, order_id: 8, status: 'accepted', status_label: 'Accepted', rider: { id: 1, full_name: 'Kofi Appiah', vehicle: 'Motorbike', plate: 'AS 4471-22' },
  customer: { name: 'Akua B', phone_masked: '•••• 0381' }, payment: { label: 'Paid online (simulated)' }, total_amount: '120.00', deadline_at: null, delivered_at: null,
  timeline: [], codes: { pickup: { matched: false, wrong_tries: 0 }, drop: { matched: false, wrong_tries: 0 } }, wait: null, failed: null, rider_note: '',
  photos: [], calls: [], flag: { decision: '', flagged_steps: [], wait_pay_held: false }, cases: [],
  stops: [stop(1, 'Kente House', 'collected', { collected_at: '2026-10-14T10:02:00Z' }), stop(2, 'Adwoa Beads', 'pending', { wrong_tries: 5 }), stop(3, 'Chop Corner', 'pending')],
  progress: { total: 3, done: 1, skipped: 0, current: 2 },
  route_plan: { planned: true, total_km: 7.2, direct_km: 5, detour_pct: 44, limit_pct: 40, over_limit: true, basis: 'road route' }, ...over,
})

describe('A delivery from several shops (manager)', () => {
  it('lists each shop with its state and warns about the detour', async () => {
    server.use(http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail())))
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    const shops = await screen.findByRole('region', { name: 'Shops on this delivery' })
    expect(within(shops).getByRole('group', { name: 'Stop 1: Kente House' })).toHaveTextContent('Collected')
    expect(within(shops).getByText('Planned route 7.2 km through 3 shops (road route).')).toBeInTheDocument()
    expect(within(shops).getByText('Detour 44% (allowance 40%)')).toBeInTheDocument()
    expect(screen.getByText('Customer code: not entered yet')).toBeInTheDocument() // the one delivery code stays in the codes row
  })

  it('unlocks the code of the shop named, sending its stop', async () => {
    let body
    server.use(
      http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail())),
      http.post(`${API}/api/delivery/jobs/55/unlock-code/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ which: 'pickup', attempts: 0 }) }),
    )
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    const beads = await screen.findByRole('group', { name: 'Stop 2: Adwoa Beads' })
    fireEvent.click(within(beads).getByRole('button', { name: 'Unlock code' }))
    fireEvent.change(within(beads).getByLabelText(/Why are you unlocking/), { target: { value: 'Shop confirmed by phone' } })
    fireEvent.click(within(beads).getByRole('button', { name: 'Confirm unlock' }))
    await waitFor(() => expect(body).toEqual({ which: 'pickup', note: 'Shop confirmed by phone', stop: 72 }))
  })

  it('skips a shop that closed only with a reason', async () => {
    let body
    server.use(
      http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail())),
      http.post(`${API}/api/delivery/jobs/55/stops/73/skip/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ stop: 73, status: 'skipped', assignment_status: 'accepted' }) }),
    )
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    const chop = await screen.findByRole('group', { name: 'Stop 3: Chop Corner' })
    fireEvent.click(within(chop).getByRole('button', { name: 'Skip this shop' }))
    const confirm = within(chop).getByRole('button', { name: 'Confirm skip' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(chop).getByLabelText(/Why is this shop skipped/), { target: { value: 'Closed for the day' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(body).toEqual({ note: 'Closed for the day' }))
    expect(within(screen.getByRole('group', { name: 'Stop 1: Kente House' })).queryByRole('button', { name: 'Skip this shop' })).not.toBeInTheDocument()
  })

  it('keeps the one-shop layout when there is a single stop', async () => {
    server.use(http.get(`${API}/api/delivery/jobs/55/`, () => HttpResponse.json(detail({ stops: [stop(1, 'Kente House', 'pending')], route_plan: null }))))
    wrap(<ActiveDeliveries detailId="55" onOpenDetail={() => {}} />)
    await screen.findByText('Customer code: not entered yet')
    expect(screen.queryByRole('region', { name: 'Shops on this delivery' })).not.toBeInTheDocument()
  })
})

describe('Dispatch queue', () => {
  it('shows how many shops an order has and the detour warning', async () => {
    const row = { order_id: 7, waiting_minutes: 12, route: { from: 'Kente House', to: 'Ahodwo' }, zone: 'Adum', unzoned: false, returned: false, payment: { label: 'Paid online (simulated)' }, deadline_at: null, minutes_to_spare: 30, offer: null, held_until: null, refusals: 0, suggested: null, eligible: 2, pickup_located: true, stops: 3, detour_warning: 'Planned route is 52% longer than going direct from the first shop (allowance 40%).' }
    server.use(http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json({ results: [row], total: 1, auto_assign: { on: true, rules: {}, updated_at: null }, recent: [], deadlines: 'none', routing: { factor: 1.3 } })))
    wrap(<DispatchQueuePanel auth={auth} />)
    expect(await screen.findByText('3 shops')).toBeInTheDocument()
    expect(screen.getByText(/52% longer than going direct/)).toBeInTheDocument()
  })

  it('shows an order sent back because every shop was skipped, with each rider report and pin', async () => {
    const row = { order_id: 9, waiting_minutes: 4, route: { from: 'Kente House', to: 'Ahodwo' }, zone: 'Adum', unzoned: false, returned: true, returned_reason: 'all_stops_skipped', payment: { label: 'Paid online (simulated)' }, deadline_at: null, minutes_to_spare: 30, offer: null, held_until: null, refusals: 0, suggested: null, eligible: 2, pickup_located: true, stops: 2, detour_warning: null,
      skips: [{ stop_id: 71, sequence: 1, business_name: 'Kente House', at: '2026-10-14T10:02:00Z', note: 'Door locked', by: 'rider', pinned: true, lat: 6.7001, lng: -1.62, accuracy_m: 9, distance_m: 12, at_shop: true }] }
    server.use(http.get(`${API}/api/delivery/queue/`, () => HttpResponse.json({ results: [row], total: 1, auto_assign: { on: true, rules: {}, updated_at: null }, recent: [], deadlines: 'none', routing: { factor: 1.3 } })))
    wrap(<DispatchQueuePanel auth={auth} />)
    expect(await screen.findByText(/Every shop skipped, sent back to you/)).toBeInTheDocument()
    expect(screen.getByText(/Kente House: Door locked/)).toBeInTheDocument()
    expect(screen.getByText(/Pin 6.70010, -1.62000/)).toBeInTheDocument()
  })
})
```

In `DeliveryCashRules.test.jsx`, inside `describe('Delivery pricing'`, add:

```jsx
  it('shows the delivery limits in force and offers them for change', async () => {
    server.use(http.get(`${API}/api/delivery/rules/rate-card/`, () => HttpResponse.json(base({ cart_limits: { source: 'defaults', version: null, max_shops_per_delivery: 4, max_food_shops: 2, near_shop_radius_km: '3.00', detour_limit_pct: 40 } }))))
    wrap(<DeliveryPricingPanel auth={auth} />)
    expect(await screen.findByText(/up to 4 shops, 2 food places, nearby within 3\.00 km, detour allowance 40%/)).toBeInTheDocument()
    expect(screen.getByText(/built-in defaults/)).toBeInTheDocument()
    expect(screen.getByLabelText('Shops per delivery (most)')).toBeInTheDocument()
    expect(screen.getByLabelText('Detour allowance')).toBeInTheDocument()
  })
```

(`base`, `auth`, `wrap`, `API`, `DeliveryPricingPanel` are already defined/imported in that file; check the import line and add `DeliveryPricingPanel` if missing.)

- [ ] **Step 2: Run, expect FAIL**

Run: `cd frontend && npx vitest run components/admin/panels/delivery`
Expected: FAIL (no "Shops on this delivery" region, no shop count, no limit fields).

- [ ] **Step 3: Implement the job record.** In `ActiveDeliveriesPanel.jsx`, give `CodeLine` a `stopId` prop and post `{ which, note: note.trim(), ...(stopId != null ? { stop: stopId } : {}) }`. Add:

```jsx
const STOP_LABEL = { pending: "Waiting", arrived: "Rider at the shop", collected: "Collected", skipped: "Skipped" };
const SKIPPABLE = ["assigned", "accepted", "at_pickup"];

function StopRow({ jobId, stop, canSkip, onDone }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const openStop = stop.status === "pending" || stop.status === "arrived";
  const skip = async () => {
    setError("");
    setBusy(true);
    try {
      await apiPost(`/api/delivery/jobs/${jobId}/stops/${stop.id}/skip/`, { note: note.trim() });
      setOpen(false);
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not skip this shop."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="group" aria-label={`Stop ${stop.sequence}: ${stop.business_name}`} style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${D.divider}`, paddingTop: 8, fontSize: "0.82rem", color: D.text }}>
      <span><b>{stop.sequence}. {stop.business_name}</b> · {STOP_LABEL[stop.status] || stop.status}{stop.collected_at ? ` ${clock(stop.collected_at)}` : ""}{stop.status === "pending" && stop.planned_arrival ? ` · expected about ${clock(stop.planned_arrival)}` : ""}</span>
      {stop.skip_note && <span style={dim}>Skipped: {stop.skip_note}</span>}
      {(stop.skips || []).map((k) => (
        <span key={k.at} style={dim}>
          {k.by === "rider" ? `Rider reported ${clock(k.at)}: ${k.note}. Pin ${Number(k.lat).toFixed(5)}, ${Number(k.lng).toFixed(5)}${k.accuracy_m != null ? ` (±${Math.round(k.accuracy_m)} m)` : ""}${k.at_shop ? "" : `, ${k.distance_m != null ? `${k.distance_m} m from the shop` : "far from the shop"}`}.` : `Skipped by a manager ${clock(k.at)}: ${k.note}.`}
        </span>
      ))}
      {stop.id != null && <CodeLine label="Pickup code" which="pickup" jobId={jobId} stopId={stop.id} state={{ matched: stop.status === "collected", wrong_tries: stop.wrong_tries || 0 }} onDone={onDone} />}
      {canSkip && openStop && stop.id != null && !open && <button type="button" onClick={() => setOpen(true)} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Skip this shop</button>}
      {open && (
        <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <ErrorLine>{error}</ErrorLine>
          <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700 }}>
            Why is this shop skipped? (required; the customer is told and a case asks for this shop&apos;s items to be refunded)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} style={field} />
          </label>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={!note.trim() || busy} onClick={skip} style={button(D.gold, D.text, !note.trim() || busy)}>Confirm skip</button>
            <button type="button" disabled={busy} onClick={() => { setOpen(false); setError(""); }} style={button(D.panelBg, D.text)}>Cancel</button>
          </span>
        </span>
      )}
    </div>
  );
}

function RouteLine({ plan, count }) {
  if (!plan) return null;
  return (
    <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: "0.82rem", color: D.text }}>
      {plan.total_km != null ? `Planned route ${plan.total_km} km through ${count} shops (${plan.basis}).` : "No route could be planned (a shop or the drop-off has no map pin), so the shops are in cart order."}
      {plan.over_limit && <span style={chip(D.amber)}>Detour {plan.detour_pct ?? "?"}% (allowance {plan.limit_pct}%)</span>}
    </span>
  );
}
```

In `DeliveryDetail`, compute `const multi = (job.stops || []).length > 1;` and, after the map section:

```jsx
            {multi && (
              <section aria-label="Shops on this delivery" style={section}>
                <h3 style={sectionTitle}>Shops on this delivery</h3>
                <RouteLine plan={job.route_plan} count={job.stops.length} />
                {job.stops.map((s) => <StopRow key={s.sequence} jobId={id} stop={s} canSkip={SKIPPABLE.includes(job.status)} onDone={refetch} />)}
              </section>
            )}
```

and in the codes row render the single `<CodeLine label="Pickup code" ... />` only when `!multi`.

- [ ] **Step 4: Maps, queue and pricing.** In `deliveryMaps.jsx` (import `shopMarkers, unpinnedShops` from `../../../maps/shopMarkers.js`): in `QueueMap` use `const shops = shopMarkers(data);` (`if (!shops.length)` keeps the existing "No map pin for this pickup" text), markers `[...shops, drop, riders]`, `onSelect={(id) => { if (typeof id === "number") onSelectRider?.(id); }}`, legend adds "Ringed: later shops" when any `stop` pin; in `JobMap` the same `shops` plus a line naming `unpinnedShops(data)` when not empty. In `DispatchQueuePanel.jsx`, in the route cell after the zone line:

```jsx
                            {o.stops > 1 && <span style={chip(D.blue)}>{o.stops} shops</span>}
                            {o.detour_warning && <div role="note" style={{ ...dim, color: D.amber, fontWeight: 700 }}>⚠ {o.detour_warning}</div>}
                            {o.returned_reason === "all_stops_skipped" && (
                              <div role="note" style={{ ...dim, color: D.amber, fontWeight: 700 }}>
                                Every shop skipped, sent back to you. Check the notes, then give it to a rider again.
                                {(o.skips || []).map((k) => (
                                  <div key={k.stop_id + k.at} style={{ fontWeight: 400 }}>
                                    {k.business_name}: {k.note}
                                    {k.pinned ? ` · Pin ${Number(k.lat).toFixed(5)}, ${Number(k.lng).toFixed(5)} (±${Math.round(k.accuracy_m ?? 0)} m)` : " · skipped by a manager"}
                                  </div>
                                ))}
                              </div>
                            )}
```

In `RulesPanels.jsx`, append to `CARD_FIELDS`:

```js
  { key: "max_shops_per_delivery", label: "Shops per delivery (most)", unit: "shops" },
  { key: "max_food_shops", label: "Food places per delivery (most)", unit: "places" },
  { key: "near_shop_radius_km", label: "Nearby shop distance", unit: "km (road)" },
  { key: "detour_limit_pct", label: "Detour allowance", unit: "% longer than going direct" },
```

and inside `DeliveryPricingPanel`'s children, before `TryRoute`:

```jsx
          {data.cart_limits && (
            <section aria-label="Delivery limits" style={section}>
              <h3 style={sectionTitle}>Shops per delivery</h3>
              <span style={{ fontSize: "0.82rem", color: D.text }}>
                In force{data.cart_limits.source === "defaults" ? " (built-in defaults; no card approved yet)" : ""}: up to {data.cart_limits.max_shops_per_delivery} shops, {data.cart_limits.max_food_shops} food places, nearby within {data.cart_limits.near_shop_radius_km} km, detour allowance {data.cart_limits.detour_limit_pct}%.
              </span>
              <span style={dim}>One rider collects from every shop in an order. Food places are collected last. A route longer than going direct from the first shop by more than the allowance warns you, and the km beyond it are charged at the per-km rate.</span>
            </section>
          )}
```

- [ ] **Step 5: Run, expect PASS**

Run: `cd frontend && npx vitest run components/admin/panels/delivery && npx vitest run`
Expected: PASS (the existing `DeliveryLive.test.jsx` unlock test still sends exactly `{ which, note }`).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/admin/panels/delivery
git commit -m "feat(frontend): manager sees every shop, unlocks and skips per stop, sets delivery limits"
```

---

### Task 12: Cart guard in the cart, search and listing page (frontend)

**Files:**
- Create: `frontend/hooks/useCartGuard.js`
- Create: `frontend/components/CartTieredResults.jsx`
- Modify: `frontend/hooks/useListings.js` (`cartTiers`)
- Modify: `frontend/App.jsx` (tiered search for a customer with a non-empty cart; refresh guard and listings after add)
- Modify: `frontend/components/ListingDetailPage.jsx` (food is carted; limit state instead of the button; server message on a refused add)
- Modify: `frontend/components/CartDrawer.jsx` (checkout block; fee lines for several shops; refresh guard after changes)
- Modify: `frontend/mocks/handlers.js` (default `GET /api/cart/guard/`)
- Test: `frontend/components/__tests__/CartTieredResults.test.jsx`; additions to `frontend/hooks/__tests__/useListings.test.jsx`, `frontend/ListingDetailPage.test.jsx`, `frontend/CartDrawer.test.jsx`

**Interfaces:**
- Consumes: Task 8 `GET /api/cart/guard/`, `GET /api/listings/?cart_tiers=1` (`cart_tier`, `cart_label`, `cart_blocked`), `CategorySerializer.is_food`, the 400 `{detail, code}` from add and checkout; Task 4 quote `delivery.lines`, `delivery.route`.
- Produces: `useCartGuard(listingId = null, { enabled = true })` (query key `['cart-guard', listingId]`); `<CartTieredResults listings renderCard />`; `useListings({ ..., cartTiers: true })` sends `cart_tiers=1`.

- [ ] **Step 1: Write the failing tests.** `frontend/components/__tests__/CartTieredResults.test.jsx`:

```jsx
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CartTieredResults from '../CartTieredResults.jsx'

const row = (id, name, over) => ({ id, name, cart_tier: 3, cart_label: null, cart_blocked: null, ...over })
const LISTINGS = [
  row(1, 'Kente stole', { cart_tier: 1, cart_label: 'In your cart' }),
  row(2, 'Beads', { cart_tier: 2, cart_label: '1.2 km from Kente House' }),
  row(3, 'Sandals', { cart_tier: 3 }),
  row(4, 'City tour', { cart_tier: null }),
  row(5, 'Bag', { cart_tier: 2, cart_label: '2.6 km from Kente House (estimate)', cart_blocked: { detail: 'Your delivery can include up to 4 shops. Remove one to add this.', code: 'shop_limit' } }),
]
const renderCard = (item) => <div>{item.name}</div>

describe('CartTieredResults', () => {
  it('puts cart shops first, then near shops with their distance, and services on their own', () => {
    render(<CartTieredResults listings={LISTINGS} renderCard={renderCard} />)
    const cart = screen.getByRole('region', { name: 'From shops in your cart' })
    expect(within(cart).getByText('Kente stole')).toBeInTheDocument()
    expect(within(cart).getByText('In your cart')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Near the shops in your cart' })).getByText('1.2 km from Kente House')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Services and stays' })).getByText('City tour')).toBeInTheDocument()
  })

  it('keeps everyone else behind "See other shops too"', () => {
    render(<CartTieredResults listings={LISTINGS} renderCard={renderCard} />)
    expect(screen.queryByText('Sandals')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'See other shops too (1)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByText('Sandals')).toBeInTheDocument()
  })

  it('shows "Delivery limit reached" and the reason instead of hiding the shop', () => {
    render(<CartTieredResults listings={LISTINGS} renderCard={renderCard} />)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('Delivery limit reached')
    expect(note).toHaveTextContent('up to 4 shops')
    expect(screen.getByText('Bag')).toBeInTheDocument()
  })

  it('always offers the expander, and says so when nothing else is loaded', () => {
    render(<CartTieredResults listings={LISTINGS.slice(0, 1)} renderCard={renderCard} />)
    fireEvent.click(screen.getByRole('button', { name: 'See other shops too' }))
    expect(screen.getByText('No other shops in these results.')).toBeInTheDocument()
  })
})
```

Append to `hooks/__tests__/useListings.test.jsx`:

```jsx
  it('asks for cart tiers only when told to', async () => {
    let url
    server.use(http.get('http://localhost:8000/api/listings/', ({ request }) => { url = new URL(request.url); return HttpResponse.json({ count: 0, next: null, previous: null, results: [] }) }))
    const { result } = renderWithClient(() => useListings({ search: 'bead', cartTiers: true }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(url.searchParams.get('cart_tiers')).toBe('1')
    expect(url.searchParams.get('search')).toBe('bead')
  })
```

Append to `ListingDetailPage.test.jsx`:

```jsx
describe('ListingDetailPage and the delivery cart', () => {
  const CUSTOMER = { fullName: 'Ama Boateng', accountType: 'customer' }
  const guard = (blocked) => http.get('http://localhost:8000/api/cart/guard/', () => HttpResponse.json({ active: true, limits: {}, shops: [], food_shops: 0, at_shop_limit: true, at_food_limit: false, checkout: { any: null, door_to_door: null }, listing: { id: 1, blocked } }))

  it('a customer at the delivery limit sees the reason instead of Add to Cart', async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)), guard({ detail: 'Your delivery can include up to 4 shops. Remove one to add this.', code: 'shop_limit' }))
    renderPage({ user: CUSTOMER })
    expect(await screen.findByText('Delivery limit reached')).toBeInTheDocument()
    expect(screen.getByText('Your delivery can include up to 4 shops. Remove one to add this.')).toBeInTheDocument()
    expect(screen.queryByText('Add to Cart')).not.toBeInTheDocument()
  })

  it('food is added to the cart, not requested as a service', async () => {
    const food = { ...LISTING, category: { slug: 'food', icon: '🍲', label: 'Food', color: '#CC0000', kind: 'service', is_food: true } }
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(food)), guard(null))
    renderPage({ user: CUSTOMER })
    expect(await screen.findByText('Add to Cart')).toBeInTheDocument()
    expect(screen.queryByText('Request this service')).not.toBeInTheDocument()
  })

  it("a refused add shows the server's reason", async () => {
    server.use(http.get('http://localhost:8000/api/listings/1/', () => HttpResponse.json(LISTING)), guard(null))
    const err = Object.assign(new Error('API request to /api/cart/items/ failed with status 400'), { status: 400, body: { detail: 'Your delivery can include food from up to 2 places. Remove one to add this.', code: 'food_limit' } })
    renderPage({ user: CUSTOMER, onAddToCart: vi.fn().mockRejectedValue(err) })
    fireEvent.click(await screen.findByText('Add to Cart'))
    expect(await screen.findByText('Your delivery can include food from up to 2 places. Remove one to add this.')).toBeInTheDocument()
  })
})
```

Append to `CartDrawer.test.jsx`:

```jsx
describe('CartDrawer and the delivery limits', () => {
  const guard = (checkout) => http.get('http://localhost:8000/api/cart/guard/', () => HttpResponse.json({ active: true, limits: {}, shops: [], food_shops: 0, at_shop_limit: true, at_food_limit: false, checkout }))

  it('a cart over the limit cannot be paid for door-to-door, and says why', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)), guard({ any: null, door_to_door: { detail: 'Your delivery can include up to 4 shops. Your cart has 5. Remove 1 to check out.', code: 'shop_limit' } }))
    renderDrawer()
    fireEvent.click(await screen.findByText('Checkout →'))
    await screen.findByText('Confirm your order')
    expect(screen.getByText('Confirm & Pay')).toBeEnabled() // store pickup has no rider
    fireEvent.click(screen.getByText('🚚 Door-to-door'))
    fireEvent.change(screen.getByPlaceholderText('Delivery address'), { target: { value: '12 Ash Road, Kumasi' } })
    fireEvent.change(screen.getByPlaceholderText('Contact phone for delivery'), { target: { value: '+233200112233' } })
    expect(await screen.findByTestId('cart-guard-block')).toHaveTextContent('Remove 1 to check out')
    expect(screen.getByText('Confirm & Pay')).toBeDisabled()
  })

  it('a service line blocks checkout whatever the method', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)), guard({ any: { detail: 'Services are requested separately, and stays are booked separately. Remove them from your cart to check out.', code: 'not_deliverable' }, door_to_door: null }))
    renderDrawer()
    fireEvent.click(await screen.findByText('Checkout →'))
    expect(await screen.findByTestId('cart-guard-block')).toHaveTextContent('Services are requested separately')
    expect(screen.getByText('Confirm & Pay')).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd frontend && npx vitest run components/__tests__/CartTieredResults.test.jsx hooks/__tests__/useListings.test.jsx ListingDetailPage.test.jsx CartDrawer.test.jsx`
Expected: FAIL (`CartTieredResults.jsx` missing; `cart_tiers` not sent; no limit state; no block).

- [ ] **Step 3: The hook, the default mock and the listings param.** Create `frontend/hooks/useCartGuard.js`:

```js
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/cart/guard/?listing= (backend cart/guard.py): the delivery limits for the signed-in customer's cart — its
// shops, whether checkout is blocked and why, and (with a listing id) whether that listing may be added now. The
// server decides; screens only show what it says.
export function useCartGuard(listingId = null, { enabled = true } = {}) {
  const path = listingId != null ? `/api/cart/guard/?listing=${encodeURIComponent(listingId)}` : '/api/cart/guard/'
  return useQuery({ queryKey: ['cart-guard', listingId], queryFn: () => apiFetch(path), enabled })
}
```

In `mocks/handlers.js`, beside the cart handlers:

```js
  http.get('http://localhost:8000/api/cart/guard/', () => HttpResponse.json({
    active: false, limits: { source: 'defaults', version: null, max_shops_per_delivery: 4, max_food_shops: 2, near_shop_radius_km: '3.00', detour_limit_pct: 40 },
    shops: [], food_shops: 0, at_shop_limit: false, at_food_limit: false, checkout: { any: null, door_to_door: null },
  })),
```

In `useListings.js` `buildQueryString`, add `if (filters.cartTiers) params.set('cart_tiers', '1')`.

- [ ] **Step 4: Create `frontend/components/CartTieredResults.jsx`:**

```jsx
import { useState } from "react";
import { C } from "../theme.js";

// Search results for a customer whose cart already holds something (GET /api/listings/?cart_tiers=1, backend
// cart/guard.py). The server orders and labels every row; this only groups them: shops in the cart, shops near them
// (each labelled "1.2 km from Shop A"), services and stays (requested or booked separately, never tiered or limited),
// and everyone else behind an always-available "See other shops too". A shop the cart cannot take now stays visible
// with the server's reason.
const heading = { margin: "18px 0 8px", color: C.lightGold, fontSize: "0.82rem", fontWeight: 900 };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(215px,1fr))", gap: 14 };
const tag = { marginTop: 6, fontSize: "0.7rem", fontWeight: 700, color: C.lightGold };

function Row({ item, renderCard }) {
  const blocked = item.cart_blocked;
  return (
    <div>
      {renderCard(item)}
      {item.cart_label && <div style={tag}>{item.cart_label}</div>}
      {blocked && (
        <div role="note" style={{ ...tag, color: C.kente1 }}>
          {blocked.code === "food_far" || blocked.code === "food_unlocated" ? "Too far for this delivery" : "Delivery limit reached"}
          <div style={{ fontWeight: 400 }}>{blocked.detail}</div>
        </div>
      )}
    </div>
  );
}

function Group({ title, rows, renderCard }) {
  if (!rows.length) return null;
  return (
    <section aria-label={title}>
      <h3 style={heading}>{title}</h3>
      <div style={grid}>{rows.map((item) => <Row key={item.id} item={item} renderCard={renderCard} />)}</div>
    </section>
  );
}

export default function CartTieredResults({ listings, renderCard }) {
  const [showOthers, setShowOthers] = useState(false);
  const inCart = listings.filter((l) => l.cart_tier === 1);
  const near = listings.filter((l) => l.cart_tier === 2);
  const others = listings.filter((l) => l.cart_tier === 3);
  const separate = listings.filter((l) => l.cart_tier == null);
  return (
    <div>
      <Group title="From shops in your cart" rows={inCart} renderCard={renderCard} />
      <Group title="Near the shops in your cart" rows={near} renderCard={renderCard} />
      {!inCart.length && !near.length && <div style={{ color: "#aaa", fontSize: "0.8rem", margin: "12px 0" }}>Nothing in these results from the shops in your cart or shops near them.</div>}
      {separate.length > 0 && (
        <section aria-label="Services and stays">
          <h3 style={heading}>Services and stays (requested or booked separately)</h3>
          <div style={grid}>{separate.map((item) => <Row key={item.id} item={item} renderCard={renderCard} />)}</div>
        </section>
      )}
      <button type="button" aria-expanded={showOthers} onClick={() => setShowOthers((v) => !v)}
        style={{ marginTop: 16, background: "none", border: `1px solid ${C.gold}`, color: C.lightGold, borderRadius: 20, padding: "7px 16px", fontWeight: 800, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}>
        {showOthers ? "Hide other shops" : `See other shops too${others.length ? ` (${others.length})` : ""}`}
      </button>
      {showOthers && (others.length === 0
        ? <div style={{ color: "#aaa", fontSize: "0.8rem", marginTop: 10 }}>No other shops in these results.</div>
        : <div style={{ ...grid, marginTop: 12 }}>{others.map((item) => <Row key={item.id} item={item} renderCard={renderCard} />)}</div>)}
      <div style={{ color: "#999", fontSize: "0.7rem", marginTop: 10 }}>One rider collects from every shop in your cart on one trip, so shops near each other come first.</div>
    </div>
  );
}
```

- [ ] **Step 5: Wire App, the listing page and the cart.** In `App.jsx`: import `CartTieredResults` from `./components/CartTieredResults.jsx`; just before the `useListings(filters)` call add

```jsx
  // A customer whose cart has something in it gets cart-aware search (GET /api/listings/?cart_tiers=1). Same ['cart']
  // query as the navbar badge further down, so this costs no extra request.
  const { data: tierCart } = useCart(user?.accountType === "customer");
  const cartTiers = user?.accountType === "customer" && (tierCart?.items?.length ?? 0) > 0;
```

and call `useListings(cartTiers ? { ...filters, cartTiers: true } : filters)`. In the results branch, render `listings.some((l) => "cart_tier" in l) ? <CartTieredResults listings={listings} renderCard={(item) => <Card item={item} accentColor={activeCatObj?.color||C.gold} user={user} favourites={favourites} onFavourite={toggleFav} currency={currency} onMessage={(biz)=>{setMessagingBusiness(biz);setShowMessaging(true);}} onOpen={(id)=>setSelectedListingId(id)}/>} /> : <the existing grid>`. In `handleAddToCart`, after `refetchCart();` add `queryClient.invalidateQueries({ queryKey: ["cart-guard"] }); queryClient.invalidateQueries({ queryKey: ["listings"] });` (the `queryClient` already defined in this component).

In `ListingDetailPage.jsx`: import `useCartGuard` and `apiErrorMessage`; with the other hooks at the top add `const guard = useCartGuard(id, { enabled: user?.accountType === "customer" && id != null });`; set `const isFood = !!item.category?.is_food;` and `const isService = item.category?.kind === "service" && !isFood;`; in the add-to-cart branch render, when `const blocked = guard.data?.listing?.blocked;` is set:

```jsx
          <div role="status" style={{ marginTop: 16, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "white", borderRadius: 14, padding: "12px 14px", fontSize: "0.78rem", lineHeight: 1.5 }}>
            <div style={{ fontWeight: 900, marginBottom: 4 }}>{blocked.code === "food_far" || blocked.code === "food_unlocated" ? "Too far for this delivery" : "Delivery limit reached"}</div>
            {blocked.detail}
          </div>
```

instead of the button (keep the button otherwise); and in its `catch` use `setCartError(apiErrorMessage(err, err?.message || "Could not add this item to your cart."));`.

In `CartDrawer.jsx`: import `useQueryClient` and `useCartGuard`; add

```jsx
  const queryClient = useQueryClient();
  const { data: guard } = useCartGuard(null, { enabled: user?.accountType === "customer" });
  const guardBlock = guard?.checkout?.any || (deliveryMethod === "door_to_door" ? guard?.checkout?.door_to_door : null) || null;
  const payReady = doorToDoorReady && !guardBlock;
  const refreshGuard = () => { queryClient.invalidateQueries({ queryKey: ["cart-guard"] }); queryClient.invalidateQueries({ queryKey: ["listings"] }); };
```

call `refreshGuard()` after `await refetch()` in `updateQuantity` and `removeItem`; in the confirm step, before the `checkoutError` line, render `{guardBlock && <div data-testid="cart-guard-block" role="alert" style={{ background: "#fee2e2", color: "#dc2626", borderRadius: 10, padding: "8px 12px", fontSize: "0.72rem", marginBottom: 12 }}>{guardBlock.detail}</div>}`; use `payReady` instead of `doorToDoorReady` for the Confirm & Pay `disabled`, `background` and `cursor`; and inside the `cart-delivery` block, after the fee line:

```jsx
                {delivery.route?.stops > 1 && delivery.lines && (
                  <ul aria-label="Delivery fee breakdown" style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                    {delivery.lines.map((l) => <li key={l.label}>{l.label}: {formatAmount(l.amount)}</li>)}
                  </ul>
                )}
```

- [ ] **Step 6: Run, expect PASS**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all tests PASS and the build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/hooks/useCartGuard.js frontend/hooks/useListings.js frontend/hooks/__tests__/useListings.test.jsx frontend/components/CartTieredResults.jsx frontend/components/__tests__/CartTieredResults.test.jsx frontend/App.jsx frontend/components/ListingDetailPage.jsx frontend/ListingDetailPage.test.jsx frontend/components/CartDrawer.jsx frontend/CartDrawer.test.jsx frontend/mocks/handlers.js
git commit -m "feat(frontend): cart-aware search tiers, delivery limit states and checkout block"
```

---

### Task 13: Docs, full verification, staging and the hand check

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-multi-stop-delivery-and-cart-guard-design.md` (status line; a "Built" section listing what landed and the rulings in this plan's report; open items: detour default 40 % adopted, legacy fields still mirrored)
- Modify: `docs/superpowers/specs/2026-10-13-delivery-routing-dispatch-design.md` (section 4: point the several-businesses bullet at the 2026-10-14 spec as built)
- Modify: `backend/CLAUDE.md` (one bullet under correctness cores: stop codes and wrong tries live on `PickupStop`, stop 1 mirrored into the assignment; `stops.stops_of` never writes; write paths call `ensure_stops` first and must not prefetch `stops` on a locked row; skip evidence (rider pin, time, note) lives on the append-only `skipped_stop` `DeliveryEvent` rows and survives a reset, and an `all_stops_skipped` job is requeued by resetting the same OneToOne row)

- [ ] **Step 1: Full suites.** Run `docker compose -f docker-compose.yml -f $OV run --rm -e POSTGRES_HOST=db web python manage.py test` (only the known unrelated failure), `... python manage.py makemigrations --check --dry-run` (expect "No changes detected"), and `cd frontend && npx vitest run && npm run build`.
- [ ] **Step 2: Write the doc updates above and commit** — `docs: multi-stop delivery and cart guard built`.
- [ ] **Step 3: Staging only.** Merge to `righteoushack`, push, merge to `main` and deploy staging per the `deploy` skill (`/opt/ashantihub-staging`); migrations `listings 0020`, `orders 0008`, `delivery 0004`/`0005` run there. Production waits for an explicit instruction from the user.
- [ ] **Step 4: Hand check in a real browser on test.theashantihub.com** (Leaflet and layout cannot be checked under jsdom), with the demo data plus two extra demo shops near the Akosua Ntoma store, and record what was checked and what could not be:
  - Search as the demo customer with one item in the cart: tiers, distance labels, "See other shops too", "Delivery limit reached" at four shops; also at 360 px width (no horizontal scroll).
  - Listing page at the limit; a food listing shows Add to Cart; the cart's checkout block for door-to-door.
  - Rider app on a phone: stop 2 of 3, per-shop code, skip with a note; the map shows the gold current shop, ringed later shops, no collected shop.
  - Manager: queue map with every shop and the detour warning; job drawer shops section, per-stop unlock and skip; pricing screen limits.
  - Every-shop skip: skip all shops as a rider with the location allowed; the order reappears in the Delivery queue marked "Every shop skipped, sent back to you" with each note and pin; give it to another rider and confirm the shops reopen with the same codes and the evidence is still listed in the job drawer; the shop that was skipped sees "Rider reported at your shop at HH:MM: <note>" and no other shop does, and no rider name or phone appears on the vendor screen. A vendor's order list shows no customer phone.
  - Vendor: a later shop sees "Rider arrives about" and its own code only; a collected shop sees nothing more. Customer: "Collecting from 3 shops" before the last pickup, live map only after.
  - Seed a rider fix with a one-off `manage.py shell` call to see the rider on the maps; remove it afterwards.
