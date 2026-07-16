import { useEffect, useRef, useState } from "react";
import Flag from "../Flag.jsx";
import BusinessRegistrationFlow from "../BusinessRegistrationFlow.jsx";
import { useBusinessProfile } from "../../hooks/useBusinessProfile.js";
import { D, glassCard } from "./theme.js";
import AnalyticsPanel from "./panels/AnalyticsPanel.jsx";
import ListingsPanel from "./panels/ListingsPanel.jsx";
import DeliveriesPanel from "./panels/DeliveriesPanel.jsx";
import PaymentsPanel from "./panels/PaymentsPanel.jsx";
import CreditPanel from "./panels/CreditPanel.jsx";
import SubscriptionPanel from "./panels/SubscriptionPanel.jsx";
import EventsPanel from "./panels/EventsPanel.jsx";
import ProfilePanel from "./panels/ProfilePanel.jsx";

// ─── Business Command Center ─────────────────────────────────────────────────
// The unified "mission-control" dashboard for a business owner, rebuilt onto a
// light "artisan" theme (see theme.js) with a persistent sidebar-nav shell
// (docs/superpowers/specs business-dashboard-rebuild) replacing the old
// sticky-top-tab-bar layout. Replaces the three separate full-screen
// dashboards (BusinessDashboard / PaymentDashboard / CreditDashboard) with one
// shell; the old routes (/business-dashboard, /payments, /credit) deep-link in
// via `initialTab`. The shell owns the sidebar, KYC gating, and the "✓ Saved!"
// toast; each tab's body is a self-contained panel that calls its own hooks.
// The simulated-pay modal (App.jsx's MoMoPayment) is injected as
// `PaymentComponent` so components/ never imports back into App.jsx.

const TABS = [
  { id: "analytics", icon: "📊", label: "Overview" },
  { id: "listings", icon: "🏷️", label: "Listings & Prices" },
  { id: "events", icon: "🎉", label: "Events" },
  { id: "deliveries", icon: "🚚", label: "Deliveries" },
  { id: "payments", icon: "💳", label: "Payments" },
  { id: "credit", icon: "🏅", label: "Credit" },
  { id: "subscription", icon: "⭐", label: "Subscription" },
];

export default function BusinessCommandCenter({ initialTab = "analytics", onExit, user, auth, PaymentComponent }) {
  const [tab, setTab] = useState(TABS.some(t => t.id === initialTab) ? initialTab : "analytics");
  const [saved, setSaved] = useState(false);
  const [resubmitting, setResubmitting] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);

  // Close the avatar dropdown on an outside click — same convention as
  // Navbar.jsx's own profile menu.
  useEffect(() => {
    if (!profileMenuOpen) return;
    const onClick = (e) => { if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) setProfileMenuOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [profileMenuOpen]);

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
  const activeLabel = TABS.find(t => t.id === tab)?.label || "Overview";

  const selectTab = (id) => { if (!isVerified) return; setTab(id); setMobileNavOpen(false); setShowProfile(false); };

  if (auth.isLoading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: D.pageBg, color: D.textDim }}>Loading…</div>;
  }

  if (!isBusinessOwner) {
    return (
      <div style={{ minHeight: "100vh", background: D.pageBg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 20, textAlign: "center" }}>
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
      <div className="cc-shell" style={{ display: "flex", minHeight: "100vh" }}>

        {/* Mobile backdrop */}
        <div
          className="cc-backdrop"
          onClick={() => setMobileNavOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(44,24,16,0.45)", zIndex: 998, display: mobileNavOpen ? "block" : "none" }}
        />

        {/* Sidebar */}
        <aside className={`cc-sidebar${mobileNavOpen ? " cc-sidebar-open" : ""}`} style={{
          width: 236, flexShrink: 0, background: "#1F140C", color: D.pageBg,
          display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh", overflowY: "auto",
        }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#CC0000 33%,#D4A017 33%,#D4A017 66%,#006400 66%)" }} />
          <div style={{ padding: "20px 18px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            <Flag w={40} h={27} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: D.gold, fontWeight: 900, fontSize: "0.92rem", lineHeight: 1 }}>AshantiHub</div>
              <div style={{ color: "rgba(253,246,227,0.55)", fontSize: "0.58rem", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4 }}>Business Command Center</div>
            </div>
            {mobileNavOpen && <button onClick={() => setMobileNavOpen(false)} aria-label="Close menu" style={{ marginLeft: "auto", background: "rgba(255,255,255,0.08)", color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: "0.85rem" }}>✕</button>}
          </div>

          <nav style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
            {TABS.map(t => {
              const active = tab === t.id;
              return (
                <button key={t.id} disabled={!isVerified} onClick={() => selectTab(t.id)} style={{
                  display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                  background: active ? "rgba(212,160,23,0.16)" : "transparent",
                  border: "none", borderLeft: active ? `3px solid ${D.gold}` : "3px solid transparent",
                  color: !isVerified ? "rgba(253,246,227,0.3)" : active ? D.gold : "rgba(253,246,227,0.75)",
                  borderRadius: "0 10px 10px 0", padding: "10px 12px", fontSize: "0.8rem",
                  fontWeight: active ? 800 : 600, cursor: isVerified ? "pointer" : "not-allowed",
                  fontFamily: "inherit", whiteSpace: "nowrap",
                }}>
                  <span style={{ fontSize: "1rem" }}>{t.icon}</span>{t.label}
                </button>
              );
            })}
          </nav>

          <div style={{ padding: 14, borderTop: "1px solid rgba(253,246,227,0.12)" }}>
            <div style={{ color: D.pageBg, fontWeight: 700, fontSize: "0.75rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 8 }}>{user?.fullName || "Your Business"}</div>
            <button onClick={onExit} style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(253,246,227,0.18)", color: "rgba(253,246,227,0.75)", borderRadius: 20, padding: "8px 13px", fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit" }}>← Exit</button>
          </div>
        </aside>

        {/* Main column */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* Top bar */}
          <div style={{ background: "rgba(253,246,227,0.9)", backdropFilter: "blur(6px)", borderBottom: `1px solid ${D.divider}`, padding: "0 18px", position: "sticky", top: 0, zIndex: 100, display: "flex", alignItems: "center", height: 56, gap: 12 }}>
            <button onClick={() => setMobileNavOpen(true)} className="cc-hamburger" aria-label="Open menu" style={{ background: "none", border: `1.5px solid ${D.cardBorderStrong}`, color: D.text, borderRadius: 8, width: 34, height: 34, cursor: "pointer", fontSize: "1rem" }}>☰</button>
            <div style={{ fontWeight: 900, color: D.text, fontSize: "0.98rem" }}>{showProfile ? "Profile & Settings" : activeLabel}</div>

            {/* Avatar dropdown — back to the main site / profile / sign out */}
            <div ref={profileMenuRef} style={{ position: "relative", marginLeft: "auto" }}>
              <button
                onClick={() => setProfileMenuOpen(o => !o)}
                aria-label="Account menu"
                aria-expanded={profileMenuOpen}
                style={{ background: D.gold, color: "#1a1205", border: "none", borderRadius: "50%", width: 34, height: 34, padding: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "0.85rem", fontWeight: 900, flexShrink: 0 }}
              >
                {user?.avatar
                  ? <img src={user.avatar} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                  : (user?.fullName?.[0]?.toUpperCase() || "B")}
              </button>
              {profileMenuOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "#fff", borderRadius: 14, boxShadow: "0 10px 40px rgba(44,24,16,0.25)", padding: 10, display: "flex", flexDirection: "column", gap: 6, minWidth: 210, zIndex: 200 }}>
                  <div style={{ padding: "4px 8px 8px", borderBottom: `1px solid ${D.divider}`, marginBottom: 2 }}>
                    <div style={{ fontWeight: 800, color: D.text, fontSize: "0.82rem" }}>{user?.fullName || "Your Business"}</div>
                    <div style={{ color: D.textFaint, fontSize: "0.68rem" }}>Business Owner</div>
                  </div>
                  <button onClick={() => { setProfileMenuOpen(false); onExit(); }} style={profileMenuItemStyle}>🏠 Back to AshantiHub</button>
                  <button onClick={() => { setProfileMenuOpen(false); setShowProfile(true); }} style={profileMenuItemStyle}>🪪 Profile &amp; Settings</button>
                  <button onClick={() => { setProfileMenuOpen(false); auth.logout(); onExit(); }} style={{ ...profileMenuItemStyle, color: D.red }}>⏻ Sign Out</button>
                </div>
              )}
            </div>
          </div>

          {saved && <div style={{ position: "fixed", top: 70, right: 20, background: D.green, color: "#fff", borderRadius: 12, padding: "10px 18px", fontSize: "0.8rem", fontWeight: 800, zIndex: 999, boxShadow: "0 6px 24px rgba(0,100,0,0.28)" }}>✓ Saved!</div>}

          <div style={{ maxWidth: 1080, width: "100%", margin: "0 auto", padding: "22px 18px 72px", flex: 1 }}>
            {showProfile ? (
              <ProfilePanel user={user} />
            ) : !isVerified ? (
              <div style={{ ...glassCard, padding: "30px 24px", textAlign: "center" }}>
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
                {tab === "analytics" && <AnalyticsPanel user={user} onNavigate={selectTab} />}
                {tab === "listings" && <ListingsPanel user={user} PaymentComponent={PaymentComponent} showToast={showToast} />}
                {tab === "events" && <EventsPanel user={user} PaymentComponent={PaymentComponent} />}
                {tab === "deliveries" && <DeliveriesPanel />}
                {tab === "payments" && <PaymentsPanel user={user} PaymentComponent={PaymentComponent} />}
                {tab === "credit" && <CreditPanel user={user} />}
                {tab === "subscription" && <SubscriptionPanel user={user} PaymentComponent={PaymentComponent} showToast={showToast} />}
              </>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .cc-backdrop { display: none; }
        .cc-hamburger { display: none; }
        @media (max-width: 760px) {
          .cc-sidebar {
            position: fixed !important;
            top: 0; left: 0; bottom: 0; height: 100vh !important;
            width: 82vw; max-width: 300px;
            z-index: 999;
            transform: translateX(-100%);
            transition: transform 250ms ease-out;
          }
          .cc-sidebar.cc-sidebar-open { transform: translateX(0); }
          .cc-hamburger { display: inline-flex !important; align-items: center; justify-content: center; }
        }
        @media (min-width: 761px) {
          .cc-backdrop { display: none !important; }
          .cc-hamburger { display: none !important; }
        }
      `}</style>
    </div>
  );
}

const profileMenuItemStyle = {
  background: "#f6f6f6",
  color: D.text,
  border: "1px solid #e5e5e5",
  borderRadius: 12,
  padding: "8px 12px",
  fontSize: "0.78rem",
  fontWeight: 700,
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
};
