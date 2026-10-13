import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Flag from "../Flag.jsx";
import { SESSION_ENDED_EVENT, UNAUTHORIZED_EVENT, getStoredAuth } from "../../apiClient.js";
import { useIdleSignOut } from "../../hooks/useIdleSignOut.js";
import { useRealtime } from "../../hooks/useRealtime.js";
import { noteSignedOutReason } from "../../lib/signOutReason.js";
import LiveUpdatesIndicator from "./shell/LiveUpdatesIndicator.jsx";
import { useStaffBadges } from "../../hooks/useStaffBadges.js";
import { D, ROLE_ACCENTS } from "./theme.js";
import OperationsOverviewPanel from "./panels/OperationsOverviewPanel.jsx";
import OverviewPanel from "./panels/OverviewPanel.jsx";
import SuperAdminOverviewPanel from "./panels/SuperAdminOverviewPanel.jsx";
import ServiceIssuesPanel from "./panels/ServiceIssuesPanel.jsx";
import DeliveriesReturnsPanel from "./panels/DeliveriesReturnsPanel.jsx";
import SupportTeamPanel from "./panels/SupportTeamPanel.jsx";
import ScreenBuildingPanel from "./panels/ScreenBuildingPanel.jsx";
import RevenueSalesPanel from "./panels/RevenueSalesPanel.jsx";
import CommissionsPanel from "./panels/CommissionsPanel.jsx";
import RefundsPanel from "./panels/RefundsPanel.jsx";
import SaAnalyticsPanel from "./panels/SaAnalyticsPanel.jsx";
import GrowthFunnelPanel from "./panels/GrowthFunnelPanel.jsx";
import ReportsHubPanel from "./panels/ReportsHubPanel.jsx";
import ScheduledExportsPanel from "./panels/ScheduledExportsPanel.jsx";
import KYCQueuePanel from "./panels/KYCQueuePanel.jsx";
import ListingsModerationPanel from "./panels/ListingsModerationPanel.jsx";
import HeroApprovalPanel from "./panels/HeroApprovalPanel.jsx";
import EventsModerationPanel from "./panels/EventsModerationPanel.jsx";
import HeroEventsPanel from "./panels/HeroEventsPanel.jsx";
import EventPricingPanel from "./panels/EventPricingPanel.jsx";
import ReviewsModerationPanel from "./panels/ReviewsModerationPanel.jsx";
import SubscriptionPlansManagePanel from "./panels/SubscriptionPlansManagePanel.jsx";
import SubscriptionPlanApprovalPanel from "./panels/SubscriptionPlanApprovalPanel.jsx";
import DeliveryManagementPanel from "./panels/DeliveryManagementPanel.jsx";
import ContactMessagesPanel from "./panels/ContactMessagesPanel.jsx";
import SupportContactPanel from "./panels/SupportContactPanel.jsx";
import SupportReviewsPanel from "./panels/SupportReviewsPanel.jsx";
import SupportDisputeIntakePanel from "./panels/SupportDisputeIntakePanel.jsx";
import SupportOrderStatusPanel from "./panels/SupportOrderStatusPanel.jsx";
import UsersPanel from "./panels/UsersPanel.jsx";
import CategoriesZonesPanel from "./panels/CategoriesZonesPanel.jsx";
import ZonesPanel from "./panels/ZonesPanel.jsx";
import SiteSettingsPanel from "./panels/SiteSettingsPanel.jsx";
import StaffManagementPanel from "./panels/StaffManagementPanel.jsx";
import StaffDirectoryPanel from "./panels/StaffDirectoryPanel.jsx";
import SaTeamsPanel from "./panels/SaTeamsPanel.jsx";
import SaInvitesPanel from "./panels/SaInvitesPanel.jsx";
import RolesPermissionsPanel from "./panels/RolesPermissionsPanel.jsx";
import SaSessionsPanel from "./panels/SaSessionsPanel.jsx";
import { startViewAs } from "../../hooks/useViewAs.js";
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
import { buildNavGroups, makeBadgeFor, isPermittedTab, overviewLabel, PLACEHOLDER_TABS, COUNT_ONLY_TABS } from "./shell/navModel.js";
import StaffNavList from "./shell/StaffNavList.jsx";
import { pickBottomBarItems } from "./shell/navModel.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import StaffHeader, { RoleChip } from "./shell/StaffHeader.jsx";
import StaffDrawer from "./shell/StaffDrawer.jsx";
import StaffBottomBar from "./shell/StaffBottomBar.jsx";
import ScoutBottomBar from "./shell/ScoutBottomBar.jsx";
import { ScoutDevices, ScoutProfileBlock } from "./shell/ScoutProfile.jsx";
import ScoutTodayPanel from "./panels/ScoutTodayPanel.jsx";
import FollowUpsPanel from "./panels/FollowUpsPanel.jsx";
import TasksPanel from "./panels/TasksPanel.jsx";
import ActivityPanel from "./panels/ActivityPanel.jsx";
import StaffActivityPanel from "./panels/StaffActivityPanel.jsx";
import TeamVisitMapPanel from "./panels/TeamVisitMapPanel.jsx";
import CallLogPanel from "./panels/CallLogPanel.jsx";
import SupportLogCallPage from "./panels/SupportLogCallPage.jsx";
import SupportInboxPanel from "./panels/SupportInboxPanel.jsx";
import SupportCannedPanel from "./panels/SupportCannedPanel.jsx";
import SupportTagsPanel from "./panels/SupportTagsPanel.jsx";
import SupportPeoplePanel from "./panels/SupportPeoplePanel.jsx";
import TargetsPanel from "./panels/TargetsPanel.jsx";
import CommissionPanel from "./panels/CommissionPanel.jsx";
import LeaderboardPanel from "./panels/LeaderboardPanel.jsx";
import CommissionPolicyPanel from "./panels/CommissionPolicyPanel.jsx";
import VisitsPanel from "./panels/VisitsPanel.jsx";
import ProspectsPanel from "./panels/ProspectsPanel.jsx";
import MyTeamPanel from "./panels/MyTeamPanel.jsx";
import InvitePanel from "./panels/InvitePanel.jsx";
import LeavePanel from "./panels/LeavePanel.jsx";
import OpsScoutsPanel from "./panels/OpsScoutsPanel.jsx";
import OpsTargetsPanel from "./panels/OpsTargetsPanel.jsx";
import ApprovalsPanel from "./panels/ApprovalsPanel.jsx";
import ApprovalRulesPanel from "./panels/ApprovalRulesPanel.jsx";
import PortfolioPanel from "./panels/PortfolioPanel.jsx";
import SubscriptionsDuePanel from "./panels/SubscriptionsDuePanel.jsx";
import FraudCasesPanel from "./panels/FraudCasesPanel.jsx";
import ReportsPanel from "./panels/ReportsPanel.jsx";
import SaBusinessesPanel from "./panels/SaBusinessesPanel.jsx";
import SaCustomersPanel from "./panels/SaCustomersPanel.jsx";
import SaListingsPanel from "./panels/SaListingsPanel.jsx";
import SaOrdersPanel from "./panels/SaOrdersPanel.jsx";
import SaEventsPanel from "./panels/SaEventsPanel.jsx";
import SaDisputesPanel from "./panels/SaDisputesPanel.jsx";
import TeamReportsPanel from "./panels/TeamReportsPanel.jsx";
import SecurityPanel from "./panels/SecurityPanel.jsx";
import SignInHistoryPanel from "./panels/SignInHistoryPanel.jsx";
import DataExportsLogPanel from "./panels/DataExportsLogPanel.jsx";
import FraudAlertsPanel from "./panels/FraudAlertsPanel.jsx";
import NotificationCenterPanel from "./panels/NotificationCenterPanel.jsx";
import StaffAnnouncementsPanel from "./panels/StaffAnnouncementsPanel.jsx";
import AnnouncementBanner from "./shell/AnnouncementBanner.jsx";
import SessionsPanel from "./panels/SessionsPanel.jsx";
import { DeliveryPricingPanel, PayoutsPayrollPanel, ReconciliationPanel, TaxTablesPanel } from "./panels/LaterPhasePanels.jsx";
import IntegrationsPanel from "./panels/IntegrationsPanel.jsx";
import SystemHealthPanel from "./panels/SystemHealthPanel.jsx";
import PlansPricesPanel from "./panels/PlansPricesPanel.jsx";
import TargetLimitsPanel from "./panels/TargetLimitsPanel.jsx";
import RegisterBusinessPanel, { clearRegisterDrafts } from "./panels/RegisterBusinessPanel.jsx";
import SudoPrompt from "./SudoPrompt.jsx";
import StaffShellStyles from "./shell/StaffShellStyles.jsx";
import InstallAppButton from "./shell/InstallAppButton.jsx";
import UpdateToast from "./shell/UpdateToast.jsx";
import OfflineBanner from "./shell/OfflineBanner.jsx";
import StepInGate from "./stepin/StepInGate.jsx";
import StepInPanel from "./stepin/StepInPanel.jsx";
import ViewAsBanner from "./stepin/ViewAsBanner.jsx";
import ViewAsSelect from "./stepin/ViewAsSelect.jsx";
import useViewOnlyControls from "./stepin/useViewOnlyControls.js";
import { setViewAsScreen } from "../../lib/viewAs.js";

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
// A Super Admin stepped into someone's workspace sees that person's real
// shell, read-only, under a banner (stepin/StepInGate.jsx); otherwise this is
// the shell as always.
const SUPPORT_INBOX_SCOPES = {
  "support-mine": "mine", "support-unassigned": "unassigned", "support-all-open": "all", "support-past-limit": "past",
  "support-snoozed": "snoozed", "support-resolved": "resolved",
};

export default function AdminCommandCenter(props) {
  return <StepInGate Shell={StaffShell} {...props} />;
}

// `viewAs` is set only inside a step-in: `auth` is then the viewed person's.
function StaffShell({ auth, onExit, onViewSite, activeTab: activeTabProp, activeDetail, onTabChange, NotificationsSlot, viewAs }) {
  const { data: staffBadges } = useStaffBadges();
  const badgeFor = makeBadgeFor(staffBadges, auth.user?.role);
  // A scout's Reports item carries a neutral "Due 19:00" while today's day report is unsubmitted.
  const noteFor = (id) => {
    if (auth.user?.role !== "scout" || id !== "reports" || !staffBadges?.report_due_at) return null;
    return `Due ${new Date(staffBadges.report_due_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  };
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
  // The reporting line from GET /api/accounts/me/ (a scout's Operations lead).
  const leadName = auth.user?.manager?.full_name;
  const showToast = () => { setSaved(true); setTimeout(() => setSaved(false), 2500); };
  // A forced reconnect means this staffer's permissions or team changed:
  // refetch them (GET /api/accounts/me/) so the menus follow.
  const authRef = useRef(auth);
  useEffect(() => { authRef.current = auth; }, [auth]);
  const refetchMe = useCallback(() => {
    authRef.current?.refreshUser?.()?.catch?.(() => {});
  }, []);
  // No live socket inside a step-in: its ticket is a write, which a view refuses.
  const live = useRealtime(!viewAs, { onForceDisconnect: refetchMe });
  // Idle (30 min without input) and "the server ended this session" both
  // sign out through the normal staff sign-out, which clears cached data.
  const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);
  // Once per mount: an idle timer, a session-ended event, a 401 and another
  // tab's sign-out can all arrive together, and the first one decides.
  const signedOut = useRef(false);
  const signOutBecause = useCallback((reason) => {
    if (signedOut.current) return;
    signedOut.current = true;
    noteSignedOutReason(reason);
    onExitRef.current?.();
  }, []);
  useIdleSignOut(() => signOutBecause("idle"));
  // The Sign out buttons: an explicit sign-out also clears any registration
  // draft from this phone (idle and "ended" sign-outs keep it).
  const signOut = useCallback(() => {
    clearRegisterDrafts();
    onExitRef.current?.();
  }, []);
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
  const activeLabel = activeTab === "overview" ? overviewLabel(auth.user?.role) : allItems.find(i => i.id === activeTab)?.label;
  // Inside a step-in: each request names the screen open (one audit event per
  // screen), and controls that would change data are switched off.
  useLayoutEffect(() => { if (viewAs) setViewAsScreen(activeTab); }, [viewAs, activeTab]);
  const mainRef = useRef(null);
  useViewOnlyControls(mainRef, Boolean(viewAs));
  const canViewAs = role === "super_admin" && auth.hasPermission("staff.view_as");

  // An unpermitted/unknown panel URL (or manifest shortcut) is sent back to
  // Overview by replacing the history entry, not pushing a new one.
  useEffect(() => {
    if (isControlled && requestedTab !== activeTab) onTabChange?.("overview", { replace: true });
  }, [isControlled, requestedTab, activeTab]);

  // The scoreboard's Open / View: All portfolios filtered to one scout.
  const [scoutFilter, setScoutFilter] = useState(null);
  const openScoutPortfolio = (scoutId) => { selectTab("all-portfolios"); setScoutFilter(scoutId); };
  // Support: a profile opened from a conversation, a conversation linked into Log a call, an order opened
  // from a profile or thread. Each is cleared when its tab is chosen from the menu.
  const [supportProfile, setSupportProfile] = useState(null);
  const [callLink, setCallLink] = useState(null);
  const [supportOrder, setSupportOrder] = useState(null);
  const selectTab = (id) => {
    setScoutFilter(null);
    if (id === "users") setSupportProfile(null);
    if (id === "support-log-call") setCallLink(null);
    if (id === "support-order-status") setSupportOrder(null);
    setDrawerOpen(false);
    if (id === activeTab && detail == null) return;
    setInternalDetail(null);
    if (isControlled) onTabChange?.(id);
    else setInternalTab(id);
  };
  const supportNavigate = (id, params) => { selectTab(id); if (params?.order) setSupportOrder(params.order); };
  const openSupportProfile = (kind, id) => { selectTab("users"); setSupportProfile({ kind, id }); };
  const openSupportLog = (link) => { selectTab("support-log-call"); setCallLink(link || null); };
  const openDetail = (id) => {
    if (isControlled) onTabChange?.(id == null ? activeTab : `${activeTab}/${id}`);
    else setInternalDetail(id);
  };
  // "Open" on Subscriptions due and Fraud cases shows the business page under
  // All portfolios (/staff/all-portfolios/<id>).
  const openBusiness = (id) => {
    setDrawerOpen(false);
    if (isControlled) onTabChange?.(`all-portfolios/${id}`);
    else { setInternalTab("all-portfolios"); setInternalDetail(String(id)); }
  };

  // A person's profile opens under Staff directory (/staff/staff/<id>).
  const openStaff = (id) => {
    setDrawerOpen(false);
    if (isControlled) onTabChange?.(`staff/${id}`);
    else { setInternalTab("staff"); setInternalDetail(String(id)); }
  };

  // A follow-up's business opens its page under My businesses (/staff/portfolio/<id>).
  const openMyBusiness = (id) => {
    if (isControlled) onTabChange?.(`portfolio/${id}`);
    else { setInternalTab("portfolio"); setInternalDetail(String(id)); }
  };

  // "Check in" on a business page opens the check-in screen with that
  // business picked (/staff/visits/check-in-<id>).
  const openCheckIn = (id) => {
    if (isControlled) onTabChange?.(`visits/check-in-${id}`);
    else { setInternalTab("visits"); setInternalDetail(`check-in-${id}`); }
  };

  // "Register" on a prospect opens the wizard filled in from it
  // (/staff/register-business/prospect-<id>).
  const openRegisterFromProspect = (prospect) => {
    if (isControlled) onTabChange?.(`register-business/prospect-${prospect.id}`);
    else { setInternalTab("register-business"); setInternalDetail(`prospect-${prospect.id}`); }
  };

  // Today's "Check in" opens the check-in screen (/staff/visits/check-in) and
  // "See all" on Waiting for <lead> opens the Made by me box (/staff/approvals/made).
  const openCheckInScreen = () => {
    if (isControlled) onTabChange?.("visits/check-in");
    else { setInternalTab("visits"); setInternalDetail("check-in"); }
  };
  const openMadeApprovals = () => {
    setDrawerOpen(false);
    if (isControlled) onTabChange?.("approvals/made");
    else { setInternalTab("approvals"); setInternalDetail("made"); }
  };

  // The overview's "Open request" shows the request under Approvals (/staff/approvals/<id>).
  const openApproval = (id) => {
    setDrawerOpen(false);
    if (isControlled) onTabChange?.(`approvals/${id}`);
    else { setInternalTab("approvals"); setInternalDetail(String(id)); }
  };

  // A scout's "Sent for approval" is the Made by me box.
  const navSelect = (id) => (role === "scout" && id === "approvals" ? openMadeApprovals() : selectTab(id));

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

  // A scout's phone gets the field bar (Businesses · Register · Calls · Menu);
  // every other role keeps Overview, three panels and More.
  const scoutBar = isPhone && role === "scout";
  const isScout = role === "scout";
  const bottomItems = isPhone && !scoutBar ? pickBottomBarItems(navGroups, badgeFor) : [];

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
          <StaffNavList navGroups={navGroups} activeTab={activeTab} onSelect={navSelect} collapsed={!isDesktop || sidebarCollapsed} badgeFor={badgeFor} roleColor={roleColor} overviewLabel={overviewLabel(role)} noteFor={noteFor} countOnly={COUNT_ONLY_TABS[role]} />
        </div>
      )}

      {/* Main column — carries the right landscape inset, and the left one
          on phone where there is no sidebar to absorb it (spec §4.4). */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: "env(safe-area-inset-right, 0px)", ...(isPhone ? { paddingLeft: "env(safe-area-inset-left, 0px)" } : {}) }}>
        <StaffHeader status={<LiveUpdatesIndicator paused={live.paused} />} title={activeLabel} role={role} roleColor={roleColor} fullName={auth.user?.full_name}
          onExit={signOut} onViewSite={onViewSite} breakpoint={breakpoint}
          onOpenMenu={() => setDrawerOpen(true)} menuButtonRef={menuButtonRef} drawerOpen={drawerOpen}
          actions={<>{!isPhone && (viewAs || canViewAs) ? <ViewAsSelect viewAs={viewAs} /> : null}{NotificationsSlot ? <NotificationsSlot user={auth.user} /> : null}{isPhone ? null : <InstallAppButton variant="header" />}</>}>
          {viewAs && <ViewAsBanner viewAs={viewAs} compact={isPhone} />}
          <OfflineBanner bleed={isPhone ? 12 : 20} />
        </StaffHeader>

        {saved && <div role="status" style={{
          position: "fixed", zIndex: 999, background: D.green, color: "#fff", borderRadius: 12, padding: "10px 18px", fontSize: "0.8rem", fontWeight: 800, boxShadow: "0 6px 24px rgba(0,100,0,0.28)",
          ...(isPhone ? { left: 12, right: 12, bottom: "calc(80px + env(safe-area-inset-bottom, 0px))", textAlign: "center" } : { top: 74, right: 20 }),
        }}>✓ Saved!</div>}

        <main ref={mainRef} className="staff-content" style={{ padding: isPhone ? "16px 12px calc(88px + env(safe-area-inset-bottom, 0px))" : "22px 20px 72px" }}>
          <AnnouncementBanner />
          {activeTab === "overview" && role !== "cosigner" && (role === "scout"
            ? <ScoutTodayPanel auth={auth} onNavigate={selectTab} onCheckIn={openCheckInScreen} onRegister={() => selectTab("register-business")} onSeeApprovals={openMadeApprovals} onOpenBusiness={openMyBusiness} />
            : role === "super_admin"
              ? <SuperAdminOverviewPanel auth={auth} onNavigate={selectTab} onOpenApproval={openApproval} />
            : role === "operations" && auth.hasPermission("portfolio.manage")
              ? <OperationsOverviewPanel auth={auth} onNavigate={selectTab} onOpenApproval={openApproval} onOpenBusiness={openBusiness} />
              : <OverviewPanel auth={auth} roleColor={roleColor} onNavigate={selectTab} />)}
          {activeTab === "kyc" && <KYCQueuePanel auth={auth} />}
          {activeTab === "moderation" && (role === "super_admin" ? <SaListingsPanel auth={auth} onOpenBusiness={openBusiness} /> : <ListingsModerationPanel />)}
          {activeTab === "hero" && <HeroApprovalPanel />}
          {activeTab === "events-moderation" && (role === "super_admin" ? <SaEventsPanel /> : <EventsModerationPanel />)}
          {activeTab === "event-pricing" && <EventPricingPanel auth={auth} />}
          {activeTab === "reviews" && (role === "support" ? <SupportReviewsPanel /> : <ReviewsModerationPanel auth={auth} />)}
          {activeTab === "subscription-plans" && <SubscriptionPlansManagePanel />}
          {activeTab === "subscription-plans-approval" && (role === "super_admin" ? <PlansPricesPanel /> : <SubscriptionPlanApprovalPanel />)}
          {activeTab === "delivery" && (role === "super_admin" ? <SaOrdersPanel /> : <DeliveryManagementPanel />)}
          {activeTab === "contact-messages" && (role === "support" ? <SupportContactPanel auth={auth} onNavigate={selectTab} /> : <ContactMessagesPanel auth={auth} />)}
          {activeTab === "users" && (role === "super_admin" ? <SaCustomersPanel auth={auth} /> : role === "support" ? <SupportPeoplePanel profile={supportProfile} onOpenProfile={openSupportProfile} onBack={() => setSupportProfile(null)} onLogCall={openSupportLog} onNavigate={supportNavigate} /> : <UsersPanel auth={auth} />)}
          {activeTab === "categories-zones" && <CategoriesZonesPanel auth={auth} />}
          {activeTab === "site-settings" && <SiteSettingsPanel showToast={showToast} />}
          {activeTab === "staff" && (role === "super_admin" ? <StaffDirectoryPanel auth={auth} detailId={detail} onOpenDetail={openDetail} onNavigate={selectTab} onViewAs={auth.hasPermission("staff.view_as") ? startViewAs : undefined} /> : <StaffManagementPanel />)}
          {activeTab === "teams-reporting" && <SaTeamsPanel onOpenStaff={openStaff} />}
          {activeTab === "roles-permissions" && <RolesPermissionsPanel />}
          {activeTab === "escrow" && <EscrowLedgerPanel auth={auth} />}
          {activeTab === "disputes" && (role === "super_admin" ? <SaDisputesPanel auth={auth} /> : role === "support" ? <SupportDisputeIntakePanel /> : <DisputesPanel auth={auth} />)}
          {activeTab === "support-order-status" && role === "support" && <SupportOrderStatusPanel key={supportOrder || "none"} orderId={supportOrder} />}
          {activeTab === "transactions" && (role === "super_admin" ? <RevenueSalesPanel /> : <TransactionsReportPanel />)}
          {activeTab === "credit" && <CreditPanel />}
          {activeTab === "scout-assignments" && <ScoutAssignmentsPanel />}
          {activeTab === "field-verification" && <ScoutPanel />}
          {activeTab === "delivery-coordination" && <DeliveryManagerPanel />}
          {activeTab === "my-deliveries" && <DispatchPanel />}
          {activeTab === "promotions" && <PromotionsPanel auth={auth} />}
          {activeTab === "analytics" && (role === "super_admin" ? <SaAnalyticsPanel /> : <AnalyticsPanel />)}
          {activeTab === "messaging" && <MessagingPanel />}
          {activeTab === "tasks" && (role === "scout"
            ? <FollowUpsPanel onOpenBusiness={openMyBusiness} onOpenProspects={() => selectTab("prospects")} leadName={leadName} />
            : <TasksPanel auth={auth} />)}
          {activeTab === "activity" && (role === "operations" || role === "super_admin" ? <StaffActivityPanel live={live.live} superAdmin={role === "super_admin"} /> : <ActivityPanel />)}
          {activeTab === "visit-map" && <TeamVisitMapPanel onOpenBusiness={openBusiness} />}
          {activeTab === "calls" && <CallLogPanel auth={auth} onLogCall={() => selectTab("support-log-call")} />}
          {activeTab === "support-log-call" && <SupportLogCallPage presetLink={callLink} onDone={() => selectTab("calls")} onSeeLog={() => selectTab("calls")} />}
          {activeTab === "prospects" && <ProspectsPanel onRegister={openRegisterFromProspect} />}
          {activeTab === "targets" && (role === "super_admin" ? <TargetLimitsPanel onOpenApproval={openApproval} /> : role !== "super_admin" && auth.hasPermission("businesses.manage_portfolio") ? <TargetsPanel /> : auth.hasPermission("targets.manage") ? <OpsTargetsPanel /> : <ScreenBuildingPanel title="Team targets" />)}
          {activeTab === "ops-scouts" && <OpsScoutsPanel auth={auth} onNavigate={selectTab} onOpenScout={openScoutPortfolio} />}
          {activeTab === "leave" && <LeavePanel auth={auth} />}
          {activeTab === "support-issues" && <ServiceIssuesPanel auth={auth} onOpenBusiness={openBusiness} />}
          {activeTab === "deliveries-returns" && <DeliveriesReturnsPanel auth={auth} />}
          {activeTab === "support-team" && <SupportTeamPanel onNavigate={selectTab} />}
          {role === "support" && SUPPORT_INBOX_SCOPES[activeTab] && <SupportInboxPanel key={activeTab} scope={SUPPORT_INBOX_SCOPES[activeTab]} auth={auth} onNavigate={supportNavigate} onOpenProfile={openSupportProfile} onLogCall={openSupportLog} />}
          {activeTab === "support-canned" && role === "support" && <SupportCannedPanel />}
          {activeTab === "support-tags" && role === "support" && <SupportTagsPanel />}
          {PLACEHOLDER_TABS[role]?.has(activeTab) && <ScreenBuildingPanel title={activeLabel} />}
          {activeTab.startsWith("step-in-") && <StepInPanel teamId={activeTab.slice("step-in-".length)} auth={auth} />}
          {activeTab === "hero-events" && <HeroEventsPanel auth={auth} />}
          {activeTab === "zones" && <ZonesPanel />}
          {activeTab === "commission" && <CommissionPanel />}
          {activeTab === "leaderboard" && <LeaderboardPanel />}
          {activeTab === "commission-policy" && <CommissionPolicyPanel canPropose={auth.hasPermission("commission.policy")} showTaxRuling={role === "super_admin" || auth.hasPermission("commission.tax_ruling")} onOpenApproval={role === "super_admin" ? openApproval : undefined} />}
          {activeTab === "payouts-payroll" && <PayoutsPayrollPanel onNavigate={selectTab} />}
          {activeTab === "reconciliation" && <ReconciliationPanel />}
          {activeTab === "delivery-pricing" && <DeliveryPricingPanel />}
          {activeTab === "tax-tables" && <TaxTablesPanel onNavigate={selectTab} />}
          {activeTab === "integrations" && <IntegrationsPanel />}
          {activeTab === "system-health" && <SystemHealthPanel />}
          {activeTab === "visits" && <VisitsPanel auth={auth} detailId={detail} onOpenDetail={openDetail} leadName={leadName} />}
          {activeTab === "reports" && <ReportsPanel auth={auth} />}
          {activeTab === "team-reports" && (role === "super_admin" ? <ReportsHubPanel /> : <TeamReportsPanel auth={auth} />)}
          {activeTab === "commissions" && <CommissionsPanel onNavigate={selectTab} />}
          {activeTab === "refunds" && <RefundsPanel />}
          {activeTab === "growth-funnel" && <GrowthFunnelPanel />}
          {activeTab === "scheduled-exports" && <ScheduledExportsPanel />}
          {activeTab === "security" && <SecurityPanel isSuperAdmin={role === "super_admin"} />}
          {activeTab === "sign-in-history" && <SignInHistoryPanel />}
          {activeTab === "data-exports-log" && <DataExportsLogPanel />}
          {activeTab === "notification-center" && <NotificationCenterPanel onNavigate={selectTab} knownScreens={new Set(navGroups.flatMap((g) => g.items.map((i) => i.id)))} />}
          {activeTab === "staff-announcements" && <StaffAnnouncementsPanel />}
          {activeTab === "sessions" && (role === "super_admin" ? <SaSessionsPanel /> : <SessionsPanel auth={auth} />)}
          {activeTab === "invites" && <SaInvitesPanel />}
          {activeTab === "my-team" && (role === "operations" ? <InvitePanel auth={auth} /> : <MyTeamPanel currentStaffId={auth.user?.id} />)}
          {activeTab === "approvals" && <ApprovalsPanel detailId={detail} onOpenDetail={openDetail} />}
          {activeTab === "approval-rules" && <ApprovalRulesPanel onNavigate={selectTab} />}
          {/* The external co-signer has one screen: the requests waiting for their second approval. */}
          {activeTab === "overview" && role === "cosigner" && <ApprovalsPanel detailId={detail} onOpenDetail={openDetail} />}
          {activeTab === "portfolio" && <PortfolioPanel mode="mine" auth={auth} detailId={detail} onOpenDetail={openDetail} onCheckIn={openCheckIn} />}
          {activeTab === "all-portfolios" && role === "super_admin" && <SaBusinessesPanel auth={auth} detailId={detail} onOpenDetail={openDetail} />}
          {activeTab === "all-portfolios" && role !== "super_admin" && <PortfolioPanel key={scoutFilter ?? "any"} mode="all" initialScout={scoutFilter} auth={auth} detailId={detail} onOpenDetail={openDetail} onCheckIn={openCheckIn} />}
          {activeTab === "at-risk" && <PortfolioPanel mode="at-risk" auth={auth} detailId={detail} onOpenDetail={openDetail} onCheckIn={openCheckIn} />}
          {activeTab === "subscriptions-due" && <SubscriptionsDuePanel auth={auth} onOpenBusiness={openBusiness} />}
          {activeTab === "fraud-cases" && (role === "super_admin" ? <FraudAlertsPanel auth={auth} onOpenBusiness={openBusiness} /> : <FraudCasesPanel auth={auth} onOpenBusiness={openBusiness} />)}
          {activeTab === "register-business" && <RegisterBusinessPanel auth={auth} detailId={detail} onOpenDetail={openDetail} />}
        </main>
      </div>

      {isPhone && (scoutBar
        ? <ScoutBottomBar navGroups={navGroups} activeTab={activeTab} onSelect={navSelect} onMenu={() => setDrawerOpen(true)} badgeFor={badgeFor} roleColor={roleColor} />
        : <StaffBottomBar items={bottomItems} activeTab={activeTab} onSelect={selectTab} onMore={() => setDrawerOpen(true)} badgeFor={badgeFor} roleColor={roleColor} />)}

      <StaffDrawer open={drawerOpen && !isDesktop} onClose={() => setDrawerOpen(false)} returnFocusRef={menuButtonRef}>
        <div style={{ padding: "12px 8px 12px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${D.divider}` }}>
          <Flag w={28} h={19} />
          <div style={{ color: D.gold, fontWeight: 900, fontSize: "0.85rem", flex: 1 }}>AshantiHub Staff</div>
          <button type="button" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} style={{ minWidth: 44, minHeight: 44, background: "none", border: "none", color: D.textDim, fontSize: "1.1rem", cursor: "pointer", fontFamily: "inherit" }}>✕</button>
        </div>
        {isScout ? <ScoutProfileBlock user={auth.user} roleColor={roleColor} /> : <div style={{ padding: "12px 14px", borderBottom: `1px solid ${D.divider}`, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>{auth.user?.full_name}</span>
            <RoleChip role={role} roleColor={roleColor} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <InstallAppButton variant="drawer" />
            {onViewSite && <button type="button" onClick={onViewSite} style={{ minHeight: 44, background: "transparent", border: `1px solid ${D.divider}`, color: D.text, borderRadius: 20, padding: "0 16px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>View site</button>}
            <button type="button" onClick={signOut} style={{ minHeight: 44, background: "rgba(44,24,16,0.05)", border: `1px solid ${D.divider}`, color: D.text, borderRadius: 20, padding: "0 16px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Sign out</button>
          </div>
        </div>}
        <StaffNavList navGroups={navGroups} activeTab={activeTab} onSelect={navSelect} collapsed={false} badgeFor={badgeFor} roleColor={roleColor} itemMinHeight={44} overviewLabel={overviewLabel(role)} noteFor={noteFor} countOnly={COUNT_ONLY_TABS[role]} />
        {isScout && <ScoutDevices />}
        {isScout && (
          <div style={{ padding: "0 14px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <InstallAppButton variant="drawer" />
            {onViewSite && <button type="button" onClick={onViewSite} style={{ minHeight: 44, background: "transparent", border: `1px solid ${D.divider}`, color: D.text, borderRadius: 20, padding: "0 16px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>View site</button>}
            <button type="button" onClick={signOut} style={{ minHeight: 44, background: "rgba(44,24,16,0.05)", border: `1px solid ${D.divider}`, color: D.text, borderRadius: 20, padding: "0 16px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Sign out</button>
          </div>
        )}
      </StaffDrawer>
      <SudoPrompt />
      <UpdateToast bottomOffset={isPhone ? "calc(80px + env(safe-area-inset-bottom, 0px))" : 20} />
    </div>
  );
}
