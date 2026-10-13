import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useAutoAssignRules, useDeliveryDispatchQueue, useRateCard, useTimeLimits } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { button, chip, dim, field } from "../panelStyles.js";
import { section, sectionTitle } from "../insightsParts.jsx";
import ConfigScreen, { labelled } from "./ConfigScreen.jsx";
import { Empty, ErrorLine, Note, money } from "./deliveryParts.jsx";

// ─── Delivery Manager 16 Delivery pricing, 17 Auto-assign rules, 18 Delivery time limits ───
// Each is a versioned setting the manager proposes and a Super Admin approves (a Super Admin's
// own change applies at once and is recorded). How distances were measured (road route or
// straight-line estimate) is never fixed here: it comes from the server's distance_basis.

// ── 17 Auto-assign rules ────────────────────────────────────────────────────────────────────
const RULE_FIELDS = [
  { key: "w_distance", label: "Distance weight", unit: "points of 100" },
  { key: "w_fairness", label: "Fairness weight", unit: "points of 100" },
  { key: "w_idle", label: "Idle-time weight", unit: "points of 100" },
  { key: "offer_timeout_s", label: "Offer timeout", unit: "seconds" },
  { key: "max_declines", label: "Declines before force-assign", unit: "offers" },
  { key: "force_slack_min", label: "Force-assign when slack is under", unit: "minutes" },
  { key: "radius_km", label: "Rider radius from the pickup", unit: "km (estimate)" },
  { key: "max_active_jobs", label: "Most active jobs per rider", unit: "jobs" },
  { key: "stale_s", label: "Location is stale after", unit: "seconds" },
  { key: "cash_cap", label: "Cash a rider may hold", unit: "GH₵" },
  { key: "batch_radius_km", label: "Batch drop-offs within", unit: "km", unenforced: true },
];

export function AutoAssignRulesPanel({ auth, onNavigate }) {
  const query = useAutoAssignRules();
  const queue = useDeliveryDispatchQueue();
  const [error, setError] = useState("");
  const isSa = auth?.user?.role === "super_admin";
  const toggle = async () => {
    setError("");
    try { await apiPost("/api/delivery/auto-assign/switch/", { on: !queue.data.auto_assign.on }); queue.refetch(); query.refetch(); } catch (err) { setError(apiErrorMessage(err, "Could not change auto-assign.")); }
  };
  const total = (form) => ["w_distance", "w_fairness", "w_idle"].reduce((n, k) => n + (Number(form[k]) || 0), 0);
  return (
    <ConfigScreen
      query={query} endpoint="/api/delivery/rules/auto-assign/" title="Auto-assign rules" isSuperAdmin={isSa} fields={RULE_FIELDS}
      canPropose={auth?.hasPermission?.("delivery.rates") ?? true}
      startFrom={(d) => ({ ...(d.defaults || {}), ...(d.current || {}) })}
      intro="Changes wait for a Super Admin's approval; the rules in force keep running until then. Switching auto-assign to manual takes effect at once, is logged, and a Super Admin is told."
      describe={(v) => Object.entries(v || {}).map(([k, x]) => `${k.replace(/_/g, " ")} ${x}`).join(", ")}
      headerRight={(d) => d && queue.data && (
        <>
          <span style={chip(queue.data.auto_assign.on ? D.green : D.amber)}>{queue.data.auto_assign.on ? "Auto-assign on" : "Auto-assign off"}</span>
          {(auth?.hasPermission?.("delivery.rates") ?? true) && <button type="button" onClick={toggle} style={button(D.panelBg, D.text)}>{queue.data.auto_assign.on ? "Switch to manual" : "Switch auto-assign on"}</button>}
        </>
      )}
    >
      {(data, form) => (
        <>
          <ErrorLine>{error}</ErrorLine>
          <section aria-label="How the score works" style={section}>
            <h3 style={sectionTitle}>How a rider is chosen</h3>
            <span style={{ fontSize: "0.82rem", color: D.text }}>Each eligible rider gets 0 to 100 for distance to the pickup, for fewer jobs today and for time since their last job. Each is multiplied by its weight; the highest total is offered the order first. The weights must add up to 100 (now {total(form)}). Riders who are off shift, on a break, stopped, stale, over the job limit, out of radius or missing a paper are left out and named on the Dispatch queue.</span>
            <span style={dim}>Rules in force: {data.effective.source === "version" ? `version ${data.effective.version}` : "the built-in defaults, never approved"}.</span>
          </section>
        </>
      )}
    </ConfigScreen>
  );
}

// ── 18 Delivery time limits ─────────────────────────────────────────────────────────────────
const LIMIT_FIELDS = [
  { key: "promise_standard_min", label: "Standard promise", unit: "minutes" },
  { key: "promise_express_min", label: "Express promise", unit: "minutes" },
  { key: "opens_at", label: "Deliveries open", type: "time" },
  { key: "closes_at", label: "Deliveries close", type: "time" },
  { key: "dispute_answer_hours", label: "Answer a dispute within", unit: "hours" },
  { key: "assign_within_min", label: "Assign within", unit: "minutes", unenforced: true },
  { key: "pickup_within_min", label: "Pick up within", unit: "minutes", unenforced: true },
  { key: "first_response_hours", label: "First response within", unit: "hours", unenforced: true },
];

export function TimeLimitsPanel({ auth }) {
  const query = useTimeLimits();
  const isSa = auth?.user?.role === "super_admin";
  return (
    <ConfigScreen
      query={query} endpoint="/api/delivery/rules/time-limits/" title="Delivery time limits" isSuperAdmin={isSa} fields={LIMIT_FIELDS}
      canPropose={auth?.hasPermission?.("delivery.rates") ?? true}
      intro="These limits give every new order its deliver-by time and every dispute its answer time. Changing one needs a Super Admin's approval because it changes what customers are promised. Orders already placed keep their deadline. Alerts arrive in the app; SMS alerts are not connected."
      describe={(v) => Object.entries(v || {}).map(([k, x]) => `${k.replace(/_/g, " ")} ${x}`).join(", ")}
    >
      {(data) => (
        <section aria-label="How the limits are doing" style={section}>
          <h3 style={sectionTitle}>On time · last 30 days</h3>
          {data.met_30d.of ? <span style={{ fontSize: "0.9rem", fontWeight: 800, color: D.text }}>{data.met_30d.met} of {data.met_30d.of} deliveries were on time ({Math.round(data.met_30d.met / data.met_30d.of * 100)}%)</span> : <Empty>No delivery has had a deliver-by time yet, so nothing is counted.</Empty>}
          {data.current && <span style={dim}>Deliveries run {data.current.opens_at}–{data.current.closes_at}. An order placed after closing is promised from the next opening time.</span>}
        </section>
      )}
    </ConfigScreen>
  );
}

// ── 16 Delivery pricing ─────────────────────────────────────────────────────────────────────
const CARD_FIELDS = [
  { key: "customer_base", label: "Customer base fee", unit: "GH₵" },
  { key: "customer_per_km", label: "Customer per km", unit: "GH₵" },
  { key: "customer_min_fee", label: "Minimum fee", unit: "GH₵" },
  { key: "extra_pickup", label: "Each extra pickup", unit: "GH₵" },
  { key: "express_multiplier", label: "Express multiplier", unit: "×" },
  { key: "round_up_to", label: "Round up to the next", unit: "GH₵" },
  { key: "rider_per_job", label: "Rider per job", unit: "GH₵" },
  { key: "rider_per_km", label: "Rider per km", unit: "GH₵" },
  { key: "wait_after_min", label: "Waiting pay starts after", unit: "minutes" },
  { key: "wait_per_min", label: "Waiting pay per minute", unit: "GH₵" },
];
const VEHICLES = [["motorbike", "Motorbike"], ["tricycle", "Tricycle"], ["car", "Car"], ["van", "Van"]];

function TryRoute({ form, multipliers, hasCard }) {
  const [km, setKm] = useState("");
  const [vehicle, setVehicle] = useState("motorbike");
  const [express, setExpress] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const run = async (proposed) => {
    setError("");
    setResult(null);
    try {
      const body = { km: Number(km), vehicle, express };
      if (proposed) body.values = { ...form, vehicle_multipliers: multipliers };
      setResult(await apiPost("/api/delivery/rules/rate-card/quote/", body));
    } catch (err) {
      setError(apiErrorMessage(err, "Could not work this out."));
    }
  };
  return (
    <section aria-label="Try a route" style={section}>
      <h3 style={sectionTitle}>Try a route</h3>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        {labelled("Road distance (km)", <input aria-label="Road distance (km)" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} style={{ ...field, maxWidth: 120 }} />)}
        {labelled("Vehicle", <select value={vehicle} onChange={(e) => setVehicle(e.target.value)} style={field}>{VEHICLES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>)}
        <label style={{ fontSize: "0.8rem", color: D.text }}><input type="checkbox" checked={express} onChange={(e) => setExpress(e.target.checked)} /> Express</label>
        {hasCard && <button type="button" disabled={!km} onClick={() => run(false)} style={button(D.panelBg, D.text, !km)}>Work out with the card in force</button>}
        <button type="button" disabled={!km} onClick={() => run(true)} style={button(D.panelBg, D.text, !km)}>Work out with the values above</button>
      </div>
      <ErrorLine>{error}</ErrorLine>
      {result && (
        <div role="status" style={{ fontSize: "0.82rem", color: D.text }}>
          <b>{result.source === "proposed" ? "With the proposed values" : "With the card in force"}:</b> customer pays <b>{money(result.customer.total)}</b>, rider earns <b>{money(result.rider.total)}</b> ({result.customer.distance_km} km, {result.customer.distance_basis}).
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{result.customer.lines.map((l) => <li key={l.label}>{l.label}: {money(l.amount)}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

export function DeliveryPricingPanel({ auth }) {
  const query = useRateCard();
  const isSa = auth?.user?.role === "super_admin";
  const [mult, setMult] = useState(null);
  const current = query.data?.current;
  const multipliers = mult || (current?.vehicle_multipliers ? Object.fromEntries(VEHICLES.map(([id]) => [id, current.vehicle_multipliers[id] ?? "1"])) : Object.fromEntries(VEHICLES.map(([id]) => [id, "1"])));
  return (
    <ConfigScreen
      query={query} endpoint="/api/delivery/rules/rate-card/" title="Delivery pricing" isSuperAdmin={isSa} fields={CARD_FIELDS}
      canPropose={auth?.hasPermission?.("delivery.rates") ?? true}
      valuesOf={(form) => ({ ...form, vehicle_multipliers: multipliers })}
      intro="Fee = base + distance. The system works out every order's fee from these rates; nobody types a fee by hand. No VAT is charged on delivery fees. New rates apply only to orders placed after they go live."
      describe={(v) => `Customer base ${v?.customer_base}, per km ${v?.customer_per_km}; rider per job ${v?.rider_per_job}, per km ${v?.rider_per_km}.`}
    >
      {(data, form) => (
        <>
          <section aria-label="Charging" style={section}>
            <h3 style={sectionTitle}>Is the customer charged?</h3>
            <span style={{ fontSize: "0.82rem", color: D.text }}>{data.fee_charging.enabled ? "Delivery fees are switched on: new door-to-door orders carry the fee from the card in force." : "Delivery fees are switched off. The card is recorded and used to work out rider pay and the figures on this page; no customer is charged a delivery fee."} {data.fee_charging.note}</span>
          </section>
          <section aria-label="Vehicle multipliers" style={section}>
            <h3 style={sectionTitle}>Vehicle multipliers</h3>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {VEHICLES.map(([id, text]) => labelled(text, <input key={id} aria-label={`${text} multiplier`} inputMode="decimal" value={multipliers[id]} onChange={(e) => setMult({ ...multipliers, [id]: e.target.value })} style={{ ...field, maxWidth: 100 }} />, "×"))}
            </div>
          </section>
          <TryRoute form={form} multipliers={multipliers} hasCard={Boolean(data.current)} />
          <span style={dim}>Distance basis: {data.distance_basis}.</span>
        </>
      )}
    </ConfigScreen>
  );
}
