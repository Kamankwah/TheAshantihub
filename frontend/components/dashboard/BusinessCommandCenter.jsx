import { useState } from "react";
import Flag from "../Flag.jsx";
import BusinessRegistrationFlow from "../BusinessRegistrationFlow.jsx";
import { useBusinessProfile } from "../../hooks/useBusinessProfile.js";
import { D } from "./theme.js";
import AnalyticsPanel from "./panels/AnalyticsPanel.jsx";
import ListingsPanel from "./panels/ListingsPanel.jsx";
import DeliveriesPanel from "./panels/DeliveriesPanel.jsx";
import PaymentsPanel from "./panels/PaymentsPanel.jsx";
import CreditPanel from "./panels/CreditPanel.jsx";
import SubscriptionPanel from "./panels/SubscriptionPanel.jsx";

// ─── Business Command Center ─────────────────────────────────────────────────
// The unified, always-dark "mission-control" dashboard for a business owner.
// Replaces the three separate full-screen dashboards (BusinessDashboard /
// PaymentDashboard / CreditDashboard) with one tabbed shell; the old routes
// (/business-dashboard, /payments, /credit) deep-link in via `initialTab`.
// The shell owns the header, tab nav, KYC gating, and the "✓ Saved!" toast;
// each tab's body is a self-contained panel that calls its own hooks. The
// simulated-pay modal (App.jsx's MoMoPayment) is injected as `PaymentComponent`
// so components/ never imports back into App.jsx.

const TABS = [
  { id: "analytics", icon: "📊", label: "Analytics" },
  { id: "listings", icon: "🏷️", label: "Listings & Prices" },
  { id: "deliveries", icon: "🚚", label: "Deliveries" },
  { id: "payments", icon: "💳", label: "Payments" },
  { id: "credit", icon: "🏅", label: "Credit" },
  { id: "subscription", icon: "⭐", label: "Subscription" },
];

export default function BusinessCommandCenter({ initialTab = "analytics", onExit, user, auth, PaymentComponent }) {
  const [tab, setTab] = useState(TABS.some(t => t.id === initialTab) ? initialTab : "analytics");
  const [saved, setSaved] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);

  // /business-dashboard (and /payments, /credit) render this component
  // regardless of who's signed in — unlike /staff, they don't verify the
  // session first. So data hooks must not fire until auth has settled and
  // the session is actually a business owner, otherwise a signed-out visit
  // (or the brief window before auth.isLoading resolves) fires
  // unauthenticated requests that just 401.
  const isBusinessOwner = user?.accountType === "business_owner";
  const dataReady = !auth.isLoading && isBusinessOwner;
  const { data: profile } = useBusinessProfile(dataReady);

  const isVerified = user?.kycStatus === "verified";
  const isRejected = user?.kycStatus === "rejected";
  const showToast = () => { setSaved(true); setTimeout(() => setSaved(false), 2500); };

  if (auth.isLoading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: D.pageBg, color: D.textDim }}>Loading…</div>;
  }

  if (!isBusinessOwner) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 20, textAlign: "center" }}>
        <div style={{ fontSize: "1.15rem", fontWeight: 700, color: D.text }}>Sign in with a business owner account to view this dashboard.</div>
        <button onClick={onExit} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: D.gold, color: "#1a1205", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" }}>← Back to AshantiHub</button>
      </div>
    );
  }

  // Rejected-KYC "fix and resubmit" flow — full replacement, like the original.
  if (resubmitting) {
    return <BusinessRegistrationFlow
      user={user} auth={auth} initialStep="business_info" prefill={profile}
      setPage={() => setResubmitting(false)} setShowBizDash={() => setResubmitting(false)}
    />;
  }

  return (
    <div className="shadcn-scope command-center" style={{ minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, rgba(10,14,26,0.96), rgba(19,26,46,0.96))", padding: "0 16px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 24px rgba(0,0,0,0.5)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${D.cardBorder}` }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#CC0000 33%,#D4A017 33%,#D4A017 66%,#006400 66%)" }} />
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60, gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <Flag w={44} h={30} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: D.gold, fontWeight: 900, fontSize: "0.95rem", lineHeight: 1 }}>AshantiHub</div>
              <div style={{ color: D.textDim, fontSize: "0.6rem", letterSpacing: "0.06em", textTransform: "uppercase" }}>Business Command Center</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ color: D.text, fontWeight: 700, fontSize: "0.75rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>{user?.fullName || "Your Business"}</div>
            <button onClick={onExit} style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${D.divider}`, color: D.textDim, borderRadius: 20, padding: "5px 13px", fontSize: "0.68rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>← Exit</button>
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div style={{ background: "rgba(10,14,26,0.7)", borderBottom: `1px solid ${D.divider}`, padding: "0 16px", overflowX: "auto", position: "sticky", top: 60, zIndex: 99, backdropFilter: "blur(6px)" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex" }}>
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <button key={t.id} disabled={!isVerified} onClick={() => isVerified && setTab(t.id)} style={{
                background: "none", border: "none",
                borderBottom: active ? `3px solid ${D.gold}` : "3px solid transparent",
                color: !isVerified ? D.textFaint : active ? D.gold : D.textDim,
                padding: "13px 15px", fontSize: "0.75rem", fontWeight: active ? 800 : 600,
                cursor: isVerified ? "pointer" : "not-allowed", whiteSpace: "nowrap", fontFamily: "inherit",
                textShadow: active ? `0 0 16px ${D.gold}66` : "none",
              }}>{t.icon} {t.label}</button>
            );
          })}
        </div>
      </div>

      {saved && <div style={{ position: "fixed", top: 74, right: 20, background: D.green, color: "#04210f", borderRadius: 12, padding: "10px 18px", fontSize: "0.8rem", fontWeight: 800, zIndex: 999, boxShadow: "0 6px 24px rgba(52,211,153,0.4)" }}>✓ Saved!</div>}

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "22px 16px 72px" }}>
        {!isVerified ? (
          <div style={{ background: D.panelBg, border: `1px solid ${D.cardBorder}`, borderRadius: 16, padding: "30px 24px", textAlign: "center", backdropFilter: "blur(10px)", boxShadow: D.shadow }}>
            {isRejected ? (
              <>
                <div style={{ fontSize: "2rem", marginBottom: 10 }}>⚠️</div>
                <div style={{ fontWeight: 900, color: D.red, fontSize: "1.05rem", marginBottom: 8 }}>Your application needs changes</div>
                <div style={{ color: D.textDim, fontSize: "0.85rem", lineHeight: 1.6, marginBottom: 18, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>{user?.kycRejectionReason || "Our team found an issue with your submission."}</div>
                <button onClick={() => setResubmitting(true)} style={{ background: D.gold, color: "#1a1205", border: "none", borderRadius: 30, padding: "11px 24px", fontWeight: 900, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>Fix and Resubmit</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: "2rem", marginBottom: 10 }}>⏳</div>
                <div style={{ fontWeight: 900, color: D.text, fontSize: "1.05rem", marginBottom: 8 }}>Your application is under review</div>
                <div style={{ color: D.textDim, fontSize: "0.85rem", lineHeight: 1.6 }}>Our team is verifying your Ghana Card and business details. This usually takes 1-2 business days — you'll be able to manage listings, enquiries and your subscription here as soon as you're approved.</div>
              </>
            )}
          </div>
        ) : (
          <>
            {tab === "analytics" && <AnalyticsPanel user={user} />}
            {tab === "listings" && <ListingsPanel user={user} PaymentComponent={PaymentComponent} showToast={showToast} />}
            {tab === "deliveries" && <DeliveriesPanel />}
            {tab === "payments" && <PaymentsPanel user={user} PaymentComponent={PaymentComponent} />}
            {tab === "credit" && <CreditPanel user={user} />}
            {tab === "subscription" && <SubscriptionPanel user={user} PaymentComponent={PaymentComponent} showToast={showToast} />}
          </>
        )}
      </div>
    </div>
  );
}
