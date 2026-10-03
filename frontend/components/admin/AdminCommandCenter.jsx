import { useState } from "react";
import Flag from "../Flag.jsx";
import { useStaffBadges } from "../../hooks/useStaffBadges.js";
import { D, ROLE_ACCENTS, ROLE_BADGE_TEXT } from "./theme.js";
import OverviewPanel from "./panels/OverviewPanel.jsx";
import KYCQueuePanel from "./panels/KYCQueuePanel.jsx";
import ListingsModerationPanel from "./panels/ListingsModerationPanel.jsx";
import HeroApprovalPanel from "./panels/HeroApprovalPanel.jsx";
import EventsModerationPanel from "./panels/EventsModerationPanel.jsx";
import EventPricingPanel from "./panels/EventPricingPanel.jsx";
import ReviewsModerationPanel from "./panels/ReviewsModerationPanel.jsx";
import SubscriptionPlansManagePanel from "./panels/SubscriptionPlansManagePanel.jsx";
import SubscriptionPlanApprovalPanel from "./panels/SubscriptionPlanApprovalPanel.jsx";
import DeliveryManagementPanel from "./panels/DeliveryManagementPanel.jsx";
import ContactMessagesPanel from "./panels/ContactMessagesPanel.jsx";
import UsersPanel from "./panels/UsersPanel.jsx";
import CategoriesZonesPanel from "./panels/CategoriesZonesPanel.jsx";
import SiteSettingsPanel from "./panels/SiteSettingsPanel.jsx";
import StaffManagementPanel from "./panels/StaffManagementPanel.jsx";
import EscrowLedgerPanel from "./panels/EscrowLedgerPanel.jsx";
import DisputesPanel from "./panels/DisputesPanel.jsx";
import TransactionsReportPanel from "./panels/TransactionsReportPanel.jsx";
import CreditPanel from "./panels/CreditPanel.jsx";
import ScoutPanel from "./panels/ScoutPanel.jsx";
import ScoutAssignmentsPanel from "./panels/ScoutAssignmentsPanel.jsx";
import DeliveryManagerPanel from "./panels/DeliveryManagerPanel.jsx";
import DispatchPanel from "./panels/DispatchPanel.jsx";
import MessagingPanel from "./panels/MessagingPanel.jsx";
import PromotionsPanel from "./panels/PromotionsPanel.jsx";
import AnalyticsPanel from "./panels/AnalyticsPanel.jsx";
import { buildNavGroups, makeBadgeFor } from "./shell/navModel.js";

// ─── Admin Command Center ─────────────────────────────────────────────────────
// The staff dashboard's shell, restyled to match the Business Command
// Center's dark "mission-control" visual system (frontend/components/
// dashboard/*) — same header chrome, glass-card panels, gold/kente accents —
// while keeping every panel's actual behavior/text unchanged from the old
// inline-in-App.jsx StaffDashboard (see frontend/StaffDashboard.test.jsx,
// the behavioral contract this file must keep passing). Unlike
// BusinessCommandCenter's single top tab strip, this shell uses a grouped,
// collapsible LEFT sidebar — 21 possible nav items is too many for one row.
// No light/dark theme toggle here (a pre-approved, deliberate removal) — the
// admin dashboard is always-dark, matching BusinessCommandCenter's convention.

export default function AdminCommandCenter({ auth, onExit }) {
  const { data: staffBadges } = useStaffBadges();
  const badgeFor = makeBadgeFor(staffBadges);
  const [activeTab, setActiveTab] = useState("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [saved, setSaved] = useState(false);
  const role = auth.user?.role;
  const roleColor = ROLE_ACCENTS[role] || D.gold;
  const showToast = () => { setSaved(true); setTimeout(() => setSaved(false), 2500); };

  const navGroups = buildNavGroups(auth);
  const allItems = navGroups.flatMap(g => g.items);
  const activeLabel = activeTab === "overview" ? "Overview" : allItems.find(i => i.id === activeTab)?.label;

  return (
    <div className="shadcn-scope command-center" style={{ minHeight: "100vh", display: "flex" }}>
      {/* Sidebar */}
      <div style={{
        width: sidebarCollapsed ? 60 : 240, flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflowY: "auto",
        background: "rgba(253,246,227,0.95)",
        borderRight: `1px solid ${D.cardBorder}`, transition: "width 0.2s",
      }}>
        <div style={{ padding: "16px 12px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${D.divider}` }}>
          <Flag w={28} h={19} />
          {!sidebarCollapsed && <div style={{ color: D.gold, fontWeight: 900, fontSize: "0.85rem" }}>AshantiHub Staff</div>}
        </div>
        <button onClick={() => setSidebarCollapsed(s => !s)} style={{ background: "none", border: "none", color: D.textDim, cursor: "pointer", padding: "8px 12px", fontSize: "0.7rem", fontFamily: "inherit", width: "100%", textAlign: "left" }}>{sidebarCollapsed ? "→" : "← Collapse"}</button>

        <nav>
          {/* Overview — pinned, ungrouped, no permission gate */}
          <button onClick={() => setActiveTab("overview")} style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%",
            background: activeTab === "overview" ? `${roleColor}22` : "none",
            border: "none", borderLeft: activeTab === "overview" ? `3px solid ${roleColor}` : "3px solid transparent",
            color: D.text, padding: "10px 12px", fontSize: "0.78rem",
            fontWeight: activeTab === "overview" ? 800 : 600, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
          }}>
            <span>📊</span>{!sidebarCollapsed && <span>Overview</span>}
          </button>

          {navGroups.map(group => (
            <div key={group.id} style={{ marginTop: 10 }}>
              {!sidebarCollapsed && <div style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "6px 12px" }}>{group.label}</div>}
              {group.items.map(item => {
                const badgeCount = badgeFor(item.id);
                return (
                <button key={item.id} onClick={() => setActiveTab(item.id)} style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  background: activeTab === item.id ? `${roleColor}22` : "none",
                  border: "none", borderLeft: activeTab === item.id ? `3px solid ${roleColor}` : "3px solid transparent",
                  color: D.text, padding: "10px 12px", fontSize: "0.78rem",
                  fontWeight: activeTab === item.id ? 800 : 600, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                }}>
                  <span style={{ position: "relative", flexShrink: 0 }}>
                    {item.icon}
                    {/* Collapsed sidebar: a dot on the icon since the label (and its inline badge) is hidden. */}
                    {sidebarCollapsed && badgeCount > 0 && (
                      <span style={{ position: "absolute", top: -4, right: -6, background: D.red, borderRadius: "50%", width: 8, height: 8 }} />
                    )}
                  </span>
                  {!sidebarCollapsed && <span style={{ flex: 1 }}>{item.label}</span>}
                  {!sidebarCollapsed && badgeCount > 0 && (
                    <span aria-label={`${badgeCount} pending`} style={{ background: D.red, color: "#fff", borderRadius: 10, minWidth: 18, height: 18, fontSize: "0.62rem", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", flexShrink: 0 }}>
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      {/* Main column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header */}
        <div style={{ background: "rgba(253,246,227,0.9)", padding: "0 20px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(44,24,16,0.08)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${D.cardBorder}` }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#CC0000 33%,#D4A017 33%,#D4A017 66%,#006400 66%)" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 60, gap: 10 }}>
            <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem" }}>{activeLabel}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ background: roleColor, color: ROLE_BADGE_TEXT[role] || "#fff", borderRadius: 20, padding: "3px 10px", fontSize: "0.62rem", fontWeight: 800, textTransform: "capitalize" }}>{role?.replace("_", " ")}</span>
              <span style={{ color: D.text, fontSize: "0.78rem", fontWeight: 700, whiteSpace: "nowrap" }}>{auth.user?.full_name}</span>
              <button onClick={onExit} style={{ background: "rgba(44,24,16,0.05)", border: `1px solid ${D.divider}`, color: D.textDim, borderRadius: 20, padding: "5px 13px", fontSize: "0.68rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>← Exit</button>
            </div>
          </div>
        </div>

        {saved && <div style={{ position: "fixed", top: 74, right: 20, background: D.green, color: "#fff", borderRadius: 12, padding: "10px 18px", fontSize: "0.8rem", fontWeight: 800, zIndex: 999, boxShadow: "0 6px 24px rgba(0,100,0,0.28)" }}>✓ Saved!</div>}

        <div style={{ padding: "22px 20px 72px" }}>
          {activeTab === "overview" && <OverviewPanel auth={auth} roleColor={roleColor} />}
          {activeTab === "kyc" && <KYCQueuePanel />}
          {activeTab === "moderation" && <ListingsModerationPanel />}
          {activeTab === "hero" && <HeroApprovalPanel />}
          {activeTab === "events-moderation" && <EventsModerationPanel />}
          {activeTab === "event-pricing" && <EventPricingPanel auth={auth} />}
          {activeTab === "reviews" && <ReviewsModerationPanel auth={auth} />}
          {activeTab === "subscription-plans" && <SubscriptionPlansManagePanel />}
          {activeTab === "subscription-plans-approval" && <SubscriptionPlanApprovalPanel />}
          {activeTab === "delivery" && <DeliveryManagementPanel />}
          {activeTab === "contact-messages" && <ContactMessagesPanel />}
          {activeTab === "users" && <UsersPanel auth={auth} />}
          {activeTab === "categories-zones" && <CategoriesZonesPanel auth={auth} />}
          {activeTab === "site-settings" && <SiteSettingsPanel showToast={showToast} />}
          {activeTab === "staff" && <StaffManagementPanel />}
          {activeTab === "escrow" && <EscrowLedgerPanel auth={auth} />}
          {activeTab === "disputes" && <DisputesPanel auth={auth} />}
          {activeTab === "transactions" && <TransactionsReportPanel />}
          {activeTab === "credit" && <CreditPanel />}
          {activeTab === "scout-assignments" && <ScoutAssignmentsPanel />}
          {activeTab === "field-verification" && <ScoutPanel />}
          {activeTab === "delivery-coordination" && <DeliveryManagerPanel />}
          {activeTab === "my-deliveries" && <DispatchPanel />}
          {activeTab === "promotions" && <PromotionsPanel auth={auth} />}
          {activeTab === "analytics" && <AnalyticsPanel />}
          {activeTab === "messaging" && <MessagingPanel />}
        </div>
      </div>
    </div>
  );
}
