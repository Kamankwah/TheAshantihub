import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useEventPricingTiersAdmin } from "../../../hooks/useEventPricingTiersAdmin.js";
import { usePromotionPrices } from "../../../hooks/useSettingsScreens.js";
import { useSubscriptionPlanPendingQueue } from "../../../hooks/useSubscriptionPlanPendingQueue.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, chip, dim, field } from "./panelStyles.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { errorStyle, money } from "./portfolioParts.jsx";
import { SimulatedBanner, Status, Title, page, section, sectionTitle } from "./insightsParts.jsx";

// ─── Super Admin 20 Plans & prices ───────────────────────────────────────────
// One screen over the two queues where price proposals actually exist today:
// subscription plans (billing) and event visibility prices (events). Accounting
// proposes, Super Admin approves or returns, and until then the live price
// stays. Listing promotion prices are fixed in the code, so they are shown
// read-only and said to be so: no proposal flow exists for them.
const PLAN_KIND = { product: "Products", service: "Services" };

function Waiting({ kind, title, now, next, detail, proposer, onApprove, onReturn }) {
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action) => {
    setBusy(true);
    setError("");
    try { await action(); } catch (err) { setError(apiErrorMessage(err, "Could not save that decision.")); } finally { setBusy(false); }
  };
  return (
    <div role="group" aria-label={title} style={{ ...glassCard, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={chip(D.amber)}>{kind}</span>
        {proposer && <span style={dim}>Proposed by {proposer}</span>}
      </div>
      <div style={{ fontWeight: 800, color: D.text }}>{title}</div>
      <div style={{ color: D.text, ...figures }}>{now ? `${now} → ` : "Proposed: "}<strong>{next}</strong></div>
      {detail && <div style={dim}>{detail}</div>}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      {returning ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input aria-label={`Note for ${title}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it is returned" style={{ ...field, flex: "1 1 200px" }} />
          <button type="button" disabled={busy || (onReturn.needsNote && !note.trim())} onClick={() => run(() => onReturn(note.trim()))} style={button(D.red, "#fff", busy || (onReturn.needsNote && !note.trim()))}>Confirm return</button>
          <button type="button" onClick={() => setReturning(false)} style={button(D.panelBg, D.text)}>Cancel</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" disabled={busy} onClick={() => run(onApprove)} style={button(D.green, "#fff", busy)}>Approve</button>
          <button type="button" disabled={busy} onClick={() => setReturning(true)} style={button(D.panelBg, D.text, busy)}>Return with note</button>
        </div>
      )}
    </div>
  );
}

export default function PlansPricesPanel() {
  const queryClient = useQueryClient();
  const pendingPlans = useSubscriptionPlanPendingQueue({ status: "pending" });
  const livePlans = useSubscriptionPlanPendingQueue({ status: "approved" });
  const tiers = useEventPricingTiersAdmin();
  const promotions = usePromotionPrices();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["subscription-plan-pending-queue"] });
    queryClient.invalidateQueries({ queryKey: ["event-pricing-tiers-admin"] });
  };
  const waitingPlans = pendingPlans.data || [];
  const waitingTiers = (tiers.data || []).filter((t) => t.pending_price);
  const waiting = waitingPlans.length + waitingTiers.length;

  const returnPlan = (plan) => Object.assign(async (reason) => { await apiPost(`/api/billing/plans/${plan.id}/reject/`, { reason }); refresh(); }, { needsNote: true });
  const returnTier = (tier) => async () => { await apiPost(`/api/events/pricing-tiers/${tier.id}/reject/`, {}); refresh(); };

  return (
    <div style={page}>
      <Title>Plans &amp; prices</Title>
      <SimulatedBanner simulated>Accounting proposes every price and you approve it; until you decide, the live price stays. Whether VAT applies to these fees is still with the accountant (see Tax tables).</SimulatedBanner>
      <Status isLoading={pendingPlans.isLoading || tiers.isLoading} isError={pendingPlans.isError || tiers.isError}>
        <section aria-labelledby="pp-waiting" style={section}>
          <h3 id="pp-waiting" style={sectionTitle}>{`Waiting for you · ${waiting}`}</h3>
          {waiting === 0 && <div style={dim}>No price is waiting for approval.</div>}
          {waitingPlans.map((plan) => (
            <Waiting
              key={`plan-${plan.id}`} kind="Subscription plan" title={`${plan.name} (${PLAN_KIND[plan.kind] || plan.kind})`} now="" next={`${money(plan.monthly_price)} a month`}
              detail={`Listings: ${plan.max_active_listings ?? "unlimited"} · hero days: ${plan.hero_days} · boost credits a month: ${plan.boost_credits_per_month}`}
              onApprove={async () => { await apiPost(`/api/billing/plans/${plan.id}/approve/`, {}); refresh(); }} onReturn={returnPlan(plan)}
            />
          ))}
          {waitingTiers.map((tier) => (
            <Waiting
              key={`tier-${tier.id}`} kind="Event visibility" title={`Shown for ${tier.duration_days} days`} now={money(tier.live_price)} next={money(tier.pending_price)}
              detail="Price for the whole visibility window." proposer={tier.proposed_by_name}
              onApprove={async () => { await apiPost(`/api/events/pricing-tiers/${tier.id}/approve/`, {}); refresh(); }} onReturn={returnTier(tier)}
            />
          ))}
        </section>

        <section aria-labelledby="pp-plans" style={section}>
          <h3 id="pp-plans" style={sectionTitle}>Subscription plans · live</h3>
          <div style={dim}>Paid for 1, 3, 6 or 12 months at a time.</div>
          {livePlans.isLoading && <div role="status" style={dim}>Loading…</div>}
          {livePlans.isError && <div role="alert" style={errorStyle}>Could not load the live plans.</div>}
          {livePlans.data && (
            <div style={scroll}>
              <table style={table}>
                <thead><tr><th style={th}>Plan</th><th style={th}>For</th><th style={th}>Includes</th><th style={th}>Per month</th></tr></thead>
                <tbody>
                  {livePlans.data.length === 0 && <tr><td style={td} colSpan={4}>No plan is live.</td></tr>}
                  {livePlans.data.map((plan) => (
                    <tr key={plan.id}>
                      <td style={{ ...td, fontWeight: 800 }}>{plan.name}</td>
                      <td style={td}>{PLAN_KIND[plan.kind] || plan.kind}</td>
                      <td style={td}>{`${plan.max_active_listings ?? "Unlimited"} listings · ${plan.hero_days} hero days · ${plan.boost_credits_per_month} boosts`}</td>
                      <td style={{ ...td, ...figures }}>{money(plan.monthly_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="pp-events" style={section}>
          <h3 id="pp-events" style={sectionTitle}>Event visibility · price for the whole window</h3>
          <div style={scroll}>
            <table style={table}>
              <thead><tr><th style={th}>Shown for</th><th style={th}>Live</th><th style={th}>Proposed</th></tr></thead>
              <tbody>
                {(tiers.data || []).map((tier) => (
                  <tr key={tier.id}>
                    <td style={{ ...td, fontWeight: 800 }}>{`${tier.duration_days} days`}</td>
                    <td style={{ ...td, ...figures }}>{money(tier.live_price)}</td>
                    <td style={{ ...td, ...figures }}>{tier.pending_price ? money(tier.pending_price) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="pp-promos" style={section}>
          <h3 id="pp-promos" style={sectionTitle}>Listing promotions · per day</h3>
          {promotions.isError && <div role="alert" style={errorStyle}>Could not load the promotion prices.</div>}
          {(promotions.data?.items || []).map((item) => (
            <div key={item.kind} style={{ display: "flex", justifyContent: "space-between", gap: 8, color: D.text }}>
              <span style={{ fontWeight: 700 }}>{item.label}</span>
              <span style={figures}>{money(item.per_day)}</span>
            </div>
          ))}
          {promotions.data?.set_in_code && (
            <div style={dim}>These prices are fixed in the code today, so they cannot be changed or proposed from this screen. A change needs a release; a proposal flow arrives when Accounting builds one.</div>
          )}
        </section>
      </Status>
    </div>
  );
}
