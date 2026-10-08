import { useCallback, useEffect, useRef, useState } from "react";
import Flag from "../Flag.jsx";
import { SESSION_ENDED_EVENT, UNAUTHORIZED_EVENT, getStoredAuth } from "../../apiClient.js";
import { useIdleSignOut } from "../../hooks/useIdleSignOut.js";
import { useRealtime } from "../../hooks/useRealtime.js";
import { noteSignedOutReason } from "../../lib/signOutReason.js";
import LiveUpdatesIndicator from "./shell/LiveUpdatesIndicator.jsx";
import { useStaffBadges } from "../../hooks/useStaffBadges.js";
import { D, ROLE_ACCENTS } from "./theme.js";
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
import { buildNavGroups, makeBadgeFor, isPermittedTab } from "./shell/navModel.js";
import StaffNavList from "./shell/StaffNavList.jsx";
import { pickBottomBarItems } from "./shell/navModel.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import StaffHeader, { RoleChip } from "./shell/StaffHeader.jsx";
import StaffDrawer from "./shell/StaffDrawer.jsx";
import StaffBottomBar from "./shell/StaffBottomBar.jsx";
import TasksPanel from "./panels/TasksPanel.jsx";
import ActivityPanel from "./panels/ActivityPanel.jsx";
import CallLogPanel from "./panels/CallLogPanel.jsx";
import MyTeamPanel from "./panels/MyTeamPanel.jsx";
import ApprovalsPanel from "./panels/ApprovalsPanel.jsx";
import ReportsPanel from "./panels/ReportsPanel.jsx";
import TeamReportsPanel from "./panels/TeamReportsPanel.jsx";
import SecurityPanel from "./panels/SecurityPanel.jsx";
import SessionsPanel from "./panels/SessionsPanel.jsx";
import SudoPrompt from "./SudoPrompt.jsx";
import StaffShellStyles from "./shell/StaffShellStyles.jsx";
import InstallAppButton from "./shell/InstallAppButton.jsx";
import UpdateToast from "./shell/UpdateToast.jsx";
import OfflineBanner from "./shell/OfflineBanner.jsx";

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

// `onExit` is the dashboard's only real exit: a staff sign-out, labelled
// "Sign out" in the browser and the installed app alike. `onViewSite` is the
// optional keep-the-session alternative ("View site", browser only — App.jsx
// leaves it undefined inside the installed app, which has no marketplace).
export default function AdminCommandCenter({ auth, onExit, onViewSite, activeTab: activeTabProp, activeDetail, onTabChange, NotificationsSlot }) {
  const { data: staffBadges } = useStaffBadges();
  const badgeFor = makeBadgeFor(staffBadges);
  // Controlled by App.jsx's /staff/:panel route when activeTab is passed;
  // otherwise (StaffDashboard.test.jsx renders without a router) it owns the
  // tab itself, exactly as before.
  const isControlled = activeTabProp !== undefined;
  const [internalTab, setInternalTab] = useState("overview");
  // A record inside the active panel (e.g. one approval): from the
  // /staff/:panel/:detail URL when controlled, local state otherwise.
  const [internalDetail, setInternalDetail] = useState(null);
  const detail = isControlled ? (activeDetail ?? null) : internalDetail;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [saved, setSaved] = useState(false);
  const breakpoint = useBreakpoint();
  const isPhone = breakpoint === "phone";
  const isDesktop = breakpoint === "desktop";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef(null);
  const role = auth.user?.role;
  const roleColor = ROLE_ACCENTS[role] || D.gold;
  const showToast = () => { setSaved(true); setTimeout(() => setSaved(false), 2500); };
  // A forced reconnect means this staffer's permissions or team changed:
  // refetch them (GET /api/accounts/me/) so the menus follow.
  const authRef = useRef(auth);
  useEffect(() => { authRef.current = auth; }, [auth]);
  const refetchMe = useCallback(() => {
    authRef.current?.refreshUser?.()?.catch?.(() => {});
  }, []);
  const live = useRealtime(true, { onForceDisconnect: refetchMe });
  // Idle (30 min without input) and "the server ended this session" both
  // sign out through the normal staff sign-out, which clears cached data.
  const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);
  const signOutBecause = useCallback((reason) => {
    noteSignedOutReason(reason);
    onExitRef.current?.();
  }, []);
  useIdleSignOut(() => signOutBecause("idle"));
  useEffect(() => {
    const ended = () => signOutBecause("ended");
    window.addEventListener(SESSION_ENDED_EVENT, ended);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, ended);
  }, [signOutBecause]);
  // The session can end while the shell is not mounted ("View site", then a
  // 401 on the marketplace clears it): on mount, and on any 401 while mounted,
  // a shell with no stored staff session signs out instead of sitting there
  // with every panel failing.
  useEffect(() => {
    const signedOutUnderneath = () => {
      const stored = getStoredAuth();
      if (!stored?.token || stored.account_type !== "staff") signOutBecause("ended");
    };
    signedOutUnderneath();
    window.addEventListener(UNAUTHORIZED_EVENT, signedOutUnderneath);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, signedOutUnderneath);
  }, [signOutBecause]);
  // Another tab signed out (idle, or the Sign out button): the shared stored
  // session is gone, so this tab's next request would carry no token.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === "ashantihub.auth" && event.newValue === null) signOutBecause("ended");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [signOutBecause]);

  const navGroups = buildNavGroups(auth);
  const allItems = navGroups.flatMap(g => g.items);
  const requestedTab = isControlled ? activeTabProp : internalTab;
  const activeTab = isPermittedTab(navGroups, requestedTab) ? requestedTab : "overview";
  const activeLabel = activeTab === "overview" ? "Overview" : allItems.find(i => i.id === activeTab)?.label;

  // An unpermitted/unknown panel URL (or manifest shortcut) is sent back to
  // Overview by replacing the history entry, not pushing a new one.
  useEffect(() => {
    if (isControlled && requestedTab !== activeTab) onTabChange?.("overview", { replace: true });
  }, [isControlled, requestedTab, activeTab]);

  const selectTab = (id) => {
    setDrawerOpen(false);
    if (id === activeTab && detail == null) return;
    setInternalDetail(null);
    if (isControlled) onTabChange?.(id);
    else setInternalTab(id);
  };
  const openDetail = (id) => {
    if (isControlled) onTabChange?.(id == null ? activeTab : `${activeTab}/${id}`);
    else setInternalDetail(id);
  };

  // Each panel starts at the top; skipped on first mount so a reload keeps
  // the browser's own scroll restoration.
  const firstTabRender = useRef(true);
  useEffect(() => {
    if (firstTabRender.current) { firstTabRender.current = false; return; }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [activeTab]);

  // Rotating a tablet / widening a window to desktop retires the drawer
  // (and, via its cleanup, the scroll lock).
  useEffect(() => { if (isDesktop) setDrawerOpen(false); }, [isDesktop]);

  // A panel change from outside the drawer (Android back, a manifest
  // shortcut) retires it too, so the panel never changes behind it.
  useEffect(() => { setDrawerOpen(false); }, [activeTab]);

  const bottomItems = isPhone ? pickBottomBarItems(navGroups, badgeFor) : [];

  return (
    <div className="shadcn-scope command-center staff-shell" data-bp={breakpoint} style={{ display: "flex" }}>
      <StaffShellStyles />

      {/* Sidebar — full/collapsible on desktop, a fixed 64px icon rail on tablet, absent on phone */}
      {!isPhone && (
        <div className="staff-sidebar" style={{
          width: isDesktop ? (sidebarCollapsed ? 60 : 240) : 64, flexShrink: 0, position: "sticky", top: 0, overflowY: "auto", overscrollBehavior: "contain",
          // Landscape notch (spec §4.4): content-box so the left inset widens
          // the rail instead of squeezing its 64px of icons.
          boxSizing: "content-box", paddingLeft: "env(safe-area-inset-left, 0px)",
          background: "rgba(253,246,227,0.95)",
          borderRight: `1px solid ${D.cardBorder}`, transition: "width 0.2s",
        }}>
          <div style={{ padding: "16px 12px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${D.divider}` }}>
            <Flag w={28} h={19} />
            {isDesktop && !sidebarCollapsed && <div style={{ color: D.gold, fontWeight: 900, fontSize: "0.85rem" }}>AshantiHub Staff</div>}
          </div>
          {isDesktop && <button onClick={() => setSidebarCollapsed(s => !s)} style={{ background: "none", border: "none", color: D.textDim, cursor: "pointer", padding: "8px 12px", fontSize: "0.7rem", fontFamily: "inherit", width: "100%", textAlign: "left" }}>{sidebarCollapsed ? "→" : "← Collapse"}</button>}
          <StaffNavList navGroups={navGroups} activeTab={activeTab} onSelect={selectTab} collapsed={!isDesktop || sidebarCollapsed} badgeFor={badgeFor} roleColor={roleColor} />
        </div>
      )}

      {/* Main column — carries the right landscape inset, and the left one
          on phone where there is no sidebar to absorb it (spec §4.4). */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: "env(safe-area-inset-right, 0px)", ...(isPhone ? { paddingLeft: "env(safe-area-inset-left, 0px)" } : {}) }}>
        <StaffHeader status={<LiveUpdatesIndicator paused={live.paused} />} title={activeLabel} role={role} roleColor={roleColor} fullName={auth.user?.full_name}
          onExit={onExit} onViewSite={onViewSite} breakpoint={breakpoint}
          onOpenMenu={() => setDrawerOpen(true)} menuButtonRef={menuButtonRef} drawerOpen={drawerOpen}
          actions={<>{NotificationsSlot ? <NotificationsSlot user={auth.user} /> : null}{isPhone ? null : <InstallAppButton variant="header" />}</>}>
          <OfflineBanner bleed={isPhone ? 12 : 20} />
        </StaffHeader>

        {saved && <div role="status" style={{
          position: "fixed", zIndex: 999, background: D.green, color: "#fff", borderRadius: 12, padding: "10px 18px", fontSize: "0.8rem", fontWeight: 800, boxShadow: "0 6px 24px rgba(0,100,0,0.28)",
          ...(isPhone ? { left: 12, right: 12, bottom: "calc(80px + env(safe-area-inset-bottom, 0px))", textAlign: "center" } : { top: 74, right: 20 }),
        }}>✓ Saved!</div>}

        <main className="staff-content" style={{ padding: isPhone ? "16px 12px calc(88px + env(safe-area-inset-bottom, 0px))" : "22px 20px 72px" }}>
          {activeTab === "overview" && <OverviewPanel auth={auth} roleColor={roleColor} onNavigate={selectTab} />}
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
          {activeTab === "tasks" && <TasksPanel />}
          {activeTab === "activity" && <ActivityPanel />}
          {activeTab === "calls" && <CallLogPanel />}
          {activeTab === "reports" && <ReportsPanel auth={auth} />}
          {activeTab === "team-reports" && <TeamReportsPanel auth={auth} />}
          {activeTab === "security" && <SecurityPanel />}
          {activeTab === "sessions" && <SessionsPanel auth={auth} />}
          {activeTab === "my-team" && <MyTeamPanel currentStaffId={auth.user?.id} />}
          {activeTab === "approvals" && <ApprovalsPanel detailId={detail} onOpenDetail={openDetail} />}
        </main>
      </div>

      {isPhone && <StaffBottomBar items={bottomItems} activeTab={activeTab} onSelect={selectTab} onMore={() => setDrawerOpen(true)} badgeFor={badgeFor} roleColor={roleColor} />}

      <StaffDrawer open={drawerOpen && !isDesktop} onClose={() => setDrawerOpen(false)} returnFocusRef={menuButtonRef}>
        <div style={{ padding: "12px 8px 12px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${D.divider}` }}>
          <Flag w={28} h={19} />
          <div style={{ color: D.gold, fontWeight: 900, fontSize: "0.85rem", flex: 1 }}>AshantiHub Staff</div>
          <button type="button" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} style={{ minWidth: 44, minHeight: 44, background: "none", border: "none", color: D.textDim, fontSize: "1.1rem", cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${D.divider}`, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>{auth.user?.full_name}</span>
            <RoleChip role={role} roleColor={roleColor} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <InstallAppButton variant="drawer" />
            {onViewSite && <button type="button" onClick={onViewSite} style={{ minHeight: 44, background: "transparent", border: `1px solid ${D.divider}`, color: D.text, borderRadius: 20, padding: "0 16px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>View site</button>}
            <button type="button" onClick={onExit} style={{ minHeight: 44, background: "rgba(44,24,16,0.05)", border: `1px solid ${D.divider}`, color: D.text, borderRadius: 20, padding: "0 16px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Sign out</button>
          </div>
        </div>
        <StaffNavList navGroups={navGroups} activeTab={activeTab} onSelect={selectTab} collapsed={false} badgeFor={badgeFor} roleColor={roleColor} itemMinHeight={44} />
      </StaffDrawer>
      <SudoPrompt />
      <UpdateToast bottomOffset={isPhone ? "calc(80px + env(safe-area-inset-bottom, 0px))" : 20} />
    </div>
  );
}
