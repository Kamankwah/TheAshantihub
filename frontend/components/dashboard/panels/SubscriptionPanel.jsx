import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useSubscriptionPlans } from "../../../hooks/useSubscriptionPlans.js";
import { useMySubscription } from "../../../hooks/useMySubscription.js";
import { D, glassCard } from "../theme.js";

// Cycle-length options a business owner can pick — SubscriptionPlan no longer
// has a separate annual_price, so every cycle's price is a flat multiple of
// plan.monthly_price (no discount baked in server-side for longer cycles).
const CYCLE_OPTIONS = [
  { months: 1, label: "1 month" },
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "12 months" },
];

// Subscription panel — ported from App.jsx's BusinessDashboard "subscription"
// tab, re-themed dark. Owns cycle-length + selected-plan + pay-modal state; the
// simulated-pay modal is the injected `PaymentComponent` (App.jsx's MoMoPayment).
export default function SubscriptionPanel({ user, PaymentComponent, showToast }) {
  const [cycleMonths, setCycleMonths] = useState(1);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [actionError, setActionError] = useState(null);

  const { data: subPlans, isLoading: plansLoading, isError: plansError } = useSubscriptionPlans();
  const { data: subscription, isLoading: subLoading, isError: subError, refetch: refetchSubscription } = useMySubscription();

  const recordSubscriptionPayment = async (ref) => {
    setShowPayModal(false);
    if (!selectedPlan) return;
    setActionError(null);
    const amount = Number(selectedPlan.monthly_price) * cycleMonths;
    try {
      await apiPost("/api/billing/transactions/mine/", {
        amount: amount.toFixed(2),
        purpose: `AshantiHub ${selectedPlan.name} Plan — ${cycleMonths} month${cycleMonths === 1 ? "" : "s"}`,
        reference: ref, status: "success",
      });
      // Same endpoint handles both "change plan" and "renew" — always sets
      // is_trial=false server-side.
      await apiPost("/api/billing/subscriptions/me/", { plan: selectedPlan.tier, cycle_months: cycleMonths });
      if (showToast) showToast();
      refetchSubscription();
    } catch (err) {
      setActionError("Payment was confirmed but we couldn't record it on your account. Please contact support with reference " + ref + ".");
    }
  };

  const isExpired = !!(subscription?.id && subscription.current_period_end && new Date(subscription.current_period_end) < new Date());

  const handleRenewClick = () => {
    if (!subscription?.plan) return;
    // Match against the fetched plans list (by tier, falling back to id) so
    // the pre-selected plan object is the same shape/identity every other
    // plan card in the grid below uses — falls back to the subscription's
    // own embedded plan object if it isn't (still) in the active plans list.
    const matched = (subPlans || []).find(p => p.tier === subscription.plan.tier || p.id === subscription.plan.id) || subscription.plan;
    setSelectedPlan(matched);
    setCycleMonths(subscription.cycle_months || 1);
    setShowPayModal(true);
  };

  return (
    <>
      {showPayModal && selectedPlan && PaymentComponent && (
        <PaymentComponent amount={Number(selectedPlan.monthly_price) * cycleMonths} purpose={`AshantiHub ${selectedPlan.name} Plan`} businessName={user?.fullName || "Your Business"} onSuccess={recordSubscriptionPayment} onClose={() => setShowPayModal(false)} />
      )}
      <h2 style={{ margin: "0 0 14px", color: D.text, fontWeight: 900, fontSize: "0.98rem" }}>💳 Subscription</h2>
      {actionError && <div style={{ background: "rgba(248,113,113,0.12)", color: D.red, borderRadius: 12, padding: "10px 14px", fontSize: "0.78rem", marginBottom: 14 }}>{actionError}</div>}
      {subLoading && <div style={{ color: D.textDim, fontSize: "0.8rem", marginBottom: 16 }}>Loading your subscription…</div>}
      {subError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 16 }}>Could not load your subscription. Make sure you're signed in as a business owner.</div>}
      {!subLoading && !subError && (
        subscription?.id ? (
          <div style={{ ...glassCard, padding: "18px", marginBottom: 16, background: "linear-gradient(135deg, rgba(52,211,153,0.18), rgba(20,40,30,0.6))", border: `1px solid rgba(52,211,153,0.3)` }}>
            <div style={{ fontWeight: 900, fontSize: "1rem", color: D.gold, marginBottom: 4 }}>💳 {subscription.plan?.name} Plan — {subscription.status}{subscription.is_trial && <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 800, color: D.textDim, background: D.panelBg2, borderRadius: 20, padding: "2px 10px", verticalAlign: "middle" }}>🎁 Free trial</span>}</div>
            <div style={{ fontSize: "0.78rem", color: D.textDim }}>Billing: every {subscription.cycle_months} month{subscription.cycle_months === 1 ? "" : "s"} • Renews <strong style={{ color: D.text }}>{subscription.current_period_end?.slice(0, 10)}</strong></div>
          </div>
        ) : (
          <div style={{ ...glassCard, padding: "18px", marginBottom: 16, background: "linear-gradient(135deg, rgba(52,211,153,0.14), rgba(20,40,30,0.55))", border: `1px solid rgba(52,211,153,0.25)` }}>
            <div style={{ fontWeight: 900, fontSize: "1rem", color: D.gold, marginBottom: 4 }}>🎁 No Active Subscription</div>
            <div style={{ fontSize: "0.78rem", color: D.textDim }}>Choose a plan below to activate your listings.</div>
          </div>
        )
      )}
      {isExpired && (
        <div style={{ ...glassCard, padding: "18px", marginBottom: 16, background: "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(40,20,20,0.6))", border: `1px solid rgba(248,113,113,0.35)`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: "0.95rem", color: D.red, marginBottom: 4 }}>⏰ Your subscription has expired</div>
            <div style={{ fontSize: "0.78rem", color: D.textDim }}>Renew now to keep creating new listings.</div>
          </div>
          <button onClick={handleRenewClick} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "9px 18px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem", whiteSpace: "nowrap" }}>Renew Now</button>
        </div>
      )}
      <div style={{ display: "inline-flex", background: D.panelBg2, borderRadius: 30, padding: 3, gap: 3, marginBottom: 16, flexWrap: "wrap" }}>
        {CYCLE_OPTIONS.map(c => (
          <button key={c.months} onClick={() => setCycleMonths(c.months)} style={{ background: cycleMonths === c.months ? D.gold : "transparent", border: "none", borderRadius: 28, padding: "6px 16px", fontWeight: cycleMonths === c.months ? 800 : 600, fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit", color: cycleMonths === c.months ? "#1a1205" : D.textDim }}>
            {c.label}
          </button>
        ))}
      </div>
      {plansLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading plans…</div>}
      {plansError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load subscription plans.</div>}
      {!plansLoading && !plansError && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
          {(subPlans || []).map(plan => (
            <div key={plan.id} style={{ ...glassCard, padding: "18px", border: `2px solid ${plan.is_recommended ? D.cardBorderStrong : D.cardBorder}`, position: "relative" }}>
              {plan.is_recommended && <div style={{ position: "absolute", top: -9, left: "50%", transform: "translateX(-50%)", background: D.gold, color: "#1a1205", borderRadius: 20, padding: "2px 12px", fontSize: "0.58rem", fontWeight: 900, whiteSpace: "nowrap" }}>⭐ MOST POPULAR</div>}
              <div style={{ fontWeight: 900, color: D.text, marginBottom: 2 }}>{plan.name}{plan.kind && <span style={{ marginLeft: 8, fontSize: "0.6rem", fontWeight: 800, color: D.textDim, background: D.panelBg2, borderRadius: 12, padding: "2px 8px", verticalAlign: "middle" }}>{plan.kind === "service" ? "Service" : "Product"}</span>}</div>
              <div style={{ fontWeight: 900, fontSize: "1.5rem", color: D.text, marginBottom: 10 }}>GHS {(Number(plan.monthly_price) * cycleMonths).toLocaleString()}<span style={{ fontSize: "0.7rem", fontWeight: 400, color: D.textFaint }}>/{cycleMonths} mo{cycleMonths === 1 ? "" : "s"}</span></div>
              {plan.max_active_listings != null && <div style={{ fontSize: "0.68rem", color: D.textFaint, marginBottom: 6 }}>Up to {plan.max_active_listings} active listings</div>}
              {(plan.features || []).map(f => <div key={f} style={{ fontSize: "0.7rem", color: D.textDim, marginBottom: 4 }}>✓ {f}</div>)}
              <button onClick={() => { setSelectedPlan(plan); setShowPayModal(true); }} style={{ width: "100%", marginTop: 12, background: plan.is_recommended ? D.gold : D.panelBg2, color: plan.is_recommended ? "#1a1205" : D.textDim, border: plan.is_recommended ? "none" : `1px solid ${D.divider}`, borderRadius: 20, padding: "9px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem" }}>💰 Pay with MoMo</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
