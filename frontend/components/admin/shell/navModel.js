// The staff side menu. NAV_ITEMS is every panel the shell can open; each
// role's menu (ROLE_MENUS) only places ids into the groups drawn on the
// approved staff design canvases (2026-10-07). Canvas items whose screens
// don't exist yet are simply not listed — the phase that builds a screen adds
// it to NAV_ITEMS and the menus. An id a menu lists but NAV_ITEMS lacks is
// skipped, and anything a staffer may open that their role's menu doesn't
// place (an individual grant) lands in "More tools", so a permission never
// loses its screen.
//
// Every id, label and permission check below is byte-for-byte what
// StaffDashboard.test.jsx relies on; only the grouping varies by role.
//
// The Operations canvas (2026-10-12) draws screens that are not built yet. Each
// has its NAV_ITEMS entry now, marked `placeholder: true`, so the menu is exactly
// the canvas and AdminCommandCenter opens a clearly-marked "This screen is being
// built" panel; the package that builds a screen swaps the panel and drops the
// flag. They are shown to Operations only (opsOnly) so no other role's menu or
// "More tools" list gains a placeholder.
const opsOnly = (auth, ...perms) => auth.user?.role === "operations" && perms.some((perm) => auth.hasPermission(perm));
// The Super Admin canvases (2026-10-07, 47 screens) draw screens that are not
// built yet. Each has a NAV_ITEMS entry now with `placeholder: "super_admin"`, so
// the menu is exactly the canvas and the panel switch opens the "being built"
// panel; the package that builds a screen swaps the panel in and drops the flag.
// They are Super Admin's alone (saOnly), so no other role's menu gains one.
const saOnly = (auth) => auth.user?.role === "super_admin";
// Step-in needs the Super Admin role and staff.view_as, as the server does (accounts/view_as.py).
const canStepIn = (auth) => saOnly(auth) && auth.hasPermission("staff.view_as");
// The Accounting canvas (2026-10-07, 31 screens). Its ledger, payout, payroll and tax screens
// have no records behind them yet, so each is a built, honest "arrives with the Accounting
// phase" panel (AccountingShellPanel), not a placeholder. They are the Accountant's alone
// (acctOnly); Refunds, Commissions and Reconciliation are Super Admin's panels, opened to the
// Accountant too (saOrAcct) because the money endpoints behind them already allow it.
const acctOnly = (auth, perm = "transactions.report") => auth.user?.role === "accountant" && auth.hasPermission(perm);
const saOrAcct = (auth, acctPerm = "transactions.report") => saOnly(auth) || acctOnly(auth, acctPerm);
// The Support canvas (2026-10-07, 17 screens + All open) is fully built; a screen not built yet would have a NAV_ITEMS entry with `placeholder: "support"` (like the Operations and Super
// Admin ones), shown to Support only, so the menu is exactly the canvas; the package that
// builds a screen swaps its panel in and drops the flag.
const supportOnly = (auth, ...perms) => auth.user?.role === "support" && perms.some((perm) => auth.hasPermission(perm));
// The Marketing canvas (2026-10-13, 22 screens): its own screens are Marketing's alone. A
// screen not built yet is a placeholder (`placeholder: "marketing"`) until its package lands.
const mkOnly = (auth, ...perms) => auth.user?.role === "marketing" && perms.some((perm) => auth.hasPermission(perm));
const opsOrSa = (auth, ...perms) => ["operations", "super_admin"].includes(auth.user?.role) && perms.some((perm) => auth.hasPermission(perm));

export const NAV_ITEMS = [
  { id: "kyc", icon: "🪪", label: "KYC Queue", show: (auth) => auth.hasPermission("kyc.approve") },
  { id: "moderation", icon: "📋", label: "Listings Moderation", show: (auth) => auth.hasPermission("listings.moderate") },
  { id: "hero", icon: "🌟", label: "Hero Approval", show: (auth) => auth.hasPermission("hero_media.approve") },
  { id: "events-moderation", icon: "🎉", label: "Events Moderation", show: (auth) => auth.hasPermission("event.approve") },
  { id: "reviews", icon: "⭐", label: "Reviews", show: (auth) => auth.hasPermission("reviews.moderate") },
  { id: "event-pricing", icon: "💵", label: "Event Pricing", show: (auth) => auth.hasPermission("event_pricing.manage") || auth.hasPermission("event_pricing.approve") },
  { id: "subscription-plans", icon: "💳", label: "Subscription Plans", show: (auth) => auth.hasPermission("subscription_plans.manage") },
  { id: "subscription-plans-approval", icon: "✅", label: "Plan Approvals", show: (auth) => auth.hasPermission("subscription_plans.approve") },
  { id: "escrow", icon: "💰", label: "Escrow Ledger", show: (auth) => auth.hasPermission("escrow.view") || auth.hasPermission("escrow.release") || auth.hasPermission("escrow.refund") },
  { id: "disputes", icon: "⚖️", label: "Disputes", show: (auth) => auth.hasPermission("disputes.resolve_financial") || auth.hasPermission("disputes.flag") },
  { id: "transactions", icon: "📈", label: "Transactions Report", show: (auth) => auth.hasPermission("transactions.report") },
  { id: "credit", icon: "💳", label: "Credit & Lending", show: (auth) => auth.hasPermission("credit.manage") },
  { id: "users", icon: "👥", label: "Users", show: (auth) => auth.hasPermission("users.view") },
  { id: "staff", icon: "🛡️", label: "Staff Management", show: (auth) => auth.hasPermission("staff.manage") },
  { id: "sessions", icon: "💻", label: "Sessions & Devices", show: (auth) => auth.hasPermission("staff.manage") },
  { id: "scout-assignments", icon: "🧭", label: "Scout Assignments", show: (auth) => auth.hasPermission("scouts.assign") },
  { id: "field-verification", icon: "📋", label: "Field Verification", show: (auth) => auth.hasPermission("scouts.verify") },
  { id: "targets", icon: "🎯", label: "Targets", show: (auth) => auth.hasPermission("businesses.manage_portfolio") || auth.hasPermission("targets.manage") },
  { id: "commission", icon: "💷", label: "Commission", show: (auth) => auth.hasPermission("commission.view_own") },
  { id: "leaderboard", icon: "🏆", label: "Leaderboard", show: (auth) => auth.hasPermission("businesses.manage_portfolio") },
  { id: "commission-policy", icon: "🧾", label: "Commission policy", show: (auth) => auth.hasPermission("commission.policy") || auth.hasPermission("commission.view_all") },
  { id: "prospects", icon: "🌱", label: "Prospects", show: (auth) => auth.hasPermission("businesses.register") && auth.hasPermission("businesses.manage_portfolio") },
  { id: "register-business", icon: "➕", label: "Register a business", show: (auth) => auth.hasPermission("businesses.register") },
  { id: "portfolio", icon: "🏪", label: "Portfolio", show: (auth) => auth.hasPermission("businesses.manage_portfolio") },
  { id: "all-portfolios", icon: "🗂️", label: "All portfolios", show: (auth) => auth.hasPermission("portfolio.manage") },
  { id: "at-risk", icon: "⚠️", label: "At risk", show: (auth) => auth.hasPermission("portfolio.manage") },
  { id: "subscriptions-due", icon: "⏳", label: "Subscriptions due", show: (auth) => auth.hasPermission("portfolio.manage") },
  { id: "fraud-cases", icon: "🚩", label: "Fraud cases", show: (auth) => auth.hasPermission("fraud.manage") || auth.hasPermission("fraud.flag") },
  { id: "delivery-coordination", icon: "🚚", label: "Delivery Coordination", show: (auth) => auth.hasPermission("delivery.manage") },
  { id: "my-deliveries", icon: "📦", label: "My Deliveries", show: (auth) => auth.hasPermission("delivery.dispatch") },
  { id: "categories-zones", icon: "🗂️", label: "Categories & Zones", show: (auth) => auth.hasPermission("categories.manage") || auth.hasPermission("zones.manage") },
  { id: "promotions", icon: "🎯", label: "Promotions", show: (auth) => auth.hasPermission("promotions.manage") },
  { id: "site-settings", icon: "🧭", label: "Site Settings", show: (auth) => auth.hasPermission("site_settings.manage") },
  { id: "delivery", icon: "🚚", label: "Delivery Management", show: (auth) => auth.hasPermission("orders.manage_delivery") },
  { id: "contact-messages", icon: "✉️", label: "Contact Messages", show: (auth) => auth.hasPermission("contact_messages.manage") },
  { id: "messaging", icon: "💬", label: "Messaging / Tickets", show: (auth) => auth.hasPermission("messaging.manage") },
  { id: "analytics", icon: "📊", label: "Analytics", show: (auth) => auth.hasPermission("analytics.view") },
  { id: "approvals", icon: "🗳️", label: "Approvals", show: () => true },
  { id: "tasks", icon: "✅", label: "Tasks", show: () => true },
  { id: "calls", icon: "📞", label: "Call Log", show: (auth) => auth.hasPermission("calls.log") },
  { id: "visits", icon: "🧭", label: "Visits", show: (auth) => auth.hasPermission("businesses.manage_portfolio") || auth.hasPermission("scouts.verify") },
  { id: "reports", icon: "📝", label: "My Reports", show: () => true },
  { id: "team-reports", icon: "🗂️", label: "Team Reports", show: (auth) => auth.hasPermission("staff.invite_team") || auth.hasPermission("reports.view_all") },
  { id: "activity", icon: "🕘", label: "Activity", show: () => true },
  // The Delivery Manager's "Invite a rider" (dm-invite) is their invite screen when they hold delivery.fleet; My Team stays for a manager without it.
  { id: "my-team", icon: "👥", label: "My Team", show: (auth) => auth.hasPermission("staff.invite_team") && !(auth.user?.role === "delivery_manager" && auth.hasPermission("delivery.fleet")) },
  { id: "security", icon: "🔐", label: "Sign-in & Security", show: () => true },
  // Delivery Manager canvas screens (2026-10-07, 20 screens). Each is the manager's alone: it needs the
  // permission the server checks, so a Super Admin (who holds all) sees them too.
  { id: "dm-queue", icon: "📥", label: "Dispatch queue", show: (auth) => auth.hasPermission("delivery.manage") && auth.user?.role === "delivery_manager" },
  { id: "dm-active", icon: "🚚", label: "Active deliveries", show: (auth) => auth.hasPermission("delivery.manage") && auth.user?.role === "delivery_manager" },
  { id: "dm-cases", icon: "⚖️", label: "Disputes & returns", show: (auth) => auth.hasPermission("delivery.manage") && auth.user?.role === "delivery_manager" },
  { id: "dm-riders", icon: "🛵", label: "Riders & drivers", show: (auth) => auth.user?.role === "delivery_manager" && auth.hasPermission("delivery.fleet") },
  { id: "dm-documents", icon: "🪪", label: "Documents", show: (auth) => auth.user?.role === "delivery_manager" && auth.hasPermission("delivery.fleet") },
  { id: "dm-vehicles", icon: "🚐", label: "Vehicles", show: (auth) => auth.user?.role === "delivery_manager" && auth.hasPermission("delivery.fleet") },
  { id: "dm-invite", icon: "✉️", label: "Invite a rider", show: (auth) => auth.user?.role === "delivery_manager" && auth.hasPermission("delivery.fleet") },
  { id: "dm-shifts", icon: "📅", label: "Shifts", show: (auth) => auth.user?.role === "delivery_manager" && auth.hasPermission("delivery.fleet") },
  { id: "dm-zones", icon: "📍", label: "Zones", show: (auth) => auth.user?.role === "delivery_manager" && auth.hasPermission("delivery.fleet") },
  { id: "dm-cash", icon: "💷", label: "Cash on delivery", show: (auth) => auth.user?.role === "delivery_manager" && auth.hasPermission("delivery.cash") },
  { id: "dm-payouts", icon: "🧾", label: "Rider payouts", show: (auth) => auth.user?.role === "delivery_manager" && auth.hasPermission("delivery.cash") },
  { id: "dm-pricing", icon: "🛵", label: "Delivery pricing", show: (auth) => auth.user?.role === "delivery_manager" && auth.hasPermission("delivery.rates") },
  { id: "dm-autoassign", icon: "🤖", label: "Auto-assign rules", show: (auth) => auth.user?.role === "delivery_manager" && auth.hasPermission("delivery.rates") },
  { id: "dm-limits", icon: "⏱️", label: "Delivery time limits", show: (auth) => auth.user?.role === "delivery_manager" && auth.hasPermission("delivery.rates") },
  // Dispatch (rider) canvas screens (2026-10-07, 16 screens): the rider's alone.
  { id: "dr-jobs", icon: "📦", label: "Jobs", show: (auth) => auth.user?.role === "dispatch" && auth.hasPermission("delivery.dispatch") },
  { id: "dr-earnings", icon: "💷", label: "Earnings", show: (auth) => auth.user?.role === "dispatch" && auth.hasPermission("delivery.dispatch") },
  { id: "dr-cash", icon: "🪙", label: "Cash", show: (auth) => auth.user?.role === "dispatch" && auth.hasPermission("delivery.dispatch") },
  { id: "dr-menu", icon: "☰", label: "Menu", show: (auth) => auth.user?.role === "dispatch" && auth.hasPermission("delivery.dispatch") },
  { id: "dr-issue", icon: "🚨", label: "Report an issue", show: (auth) => auth.user?.role === "dispatch" && auth.hasPermission("delivery.dispatch") },
  { id: "dr-documents", icon: "🪪", label: "Documents & vehicle", show: (auth) => auth.user?.role === "dispatch" && auth.hasPermission("delivery.dispatch") },
  // Operations canvas screens (see the note above NAV_ITEMS).
  { id: "ops-scouts", icon: "🧑‍🌾", label: "Scouts", show: (auth) => opsOnly(auth, "portfolio.manage") },
  { id: "support-team", icon: "🎧", label: "Support team", show: (auth) => opsOnly(auth, "staff.invite_team") },
  { id: "leave", icon: "🏖️", label: "Leave & calendar", show: (auth) => opsOrSa(auth, "leave.record") },
  { id: "hero-events", icon: "🌟", label: "Hero & events", show: (auth) => opsOnly(auth, "hero_media.approve", "event.approve") },
  { id: "support-issues", icon: "🛎️", label: "Support issues", show: (auth) => opsOnly(auth, "service_issues.view") },
  { id: "deliveries-returns", icon: "📦", label: "Deliveries & returns", show: (auth) => opsOnly(auth, "service_issues.view") },
  { id: "visit-map", icon: "🗺️", label: "Visit map", show: (auth) => opsOnly(auth, "portfolio.manage") },
  { id: "zones", icon: "📍", label: "Zones", show: (auth) => opsOnly(auth, "zones.manage") },
  // Support canvas screens (see supportOnly).
  { id: "support-mine", icon: "📥", label: "Mine", show: (auth) => supportOnly(auth, "messaging.manage") },
  { id: "support-unassigned", icon: "🙋", label: "Unassigned", show: (auth) => supportOnly(auth, "messaging.manage") },
  { id: "support-all-open", icon: "📂", label: "All open", show: (auth) => supportOnly(auth, "messaging.manage") },
  { id: "support-past-limit", icon: "⏰", label: "Past time limit", show: (auth) => supportOnly(auth, "messaging.manage") },
  { id: "support-snoozed", icon: "😴", label: "Snoozed", show: (auth) => supportOnly(auth, "messaging.manage") },
  { id: "support-resolved", icon: "✔️", label: "Resolved", show: (auth) => supportOnly(auth, "messaging.manage") },
  { id: "support-log-call", icon: "☎️", label: "Log a call", show: (auth) => supportOnly(auth, "calls.log") },
  { id: "support-order-status", icon: "🚚", label: "Order status", show: (auth) => supportOnly(auth, "orders.support_update") },
  { id: "support-canned", icon: "💡", label: "Canned replies", show: (auth) => supportOnly(auth, "messaging.manage") },
  { id: "support-tags", icon: "🏷️", label: "Tags", show: (auth) => supportOnly(auth, "messaging.manage") },
  // Super Admin canvas screens; the ones not built yet are placeholders (see saOnly).
  { id: "invites", icon: "✉️", label: "Invites", show: saOnly },
  { id: "teams-reporting", icon: "🌳", label: "Teams & reporting lines", show: saOnly },
  { id: "roles-permissions", icon: "🔑", label: "Roles & permissions", show: saOnly },
  // Marketing canvas screens (see mkOnly).
  { id: "mk-campaigns", icon: "📣", label: "Campaigns", show: (auth) => mkOnly(auth, "campaigns.manage") },
  { id: "mk-new-campaign", icon: "✍️", label: "New campaign", show: (auth) => mkOnly(auth, "campaigns.manage") },
  { id: "mk-calendar", icon: "🗓️", label: "Calendar", show: (auth) => mkOnly(auth, "campaigns.manage") },
  { id: "mk-templates", icon: "🧩", label: "Templates", show: (auth) => mkOnly(auth, "campaigns.manage") },
  { id: "mk-segments", icon: "🎯", label: "Segments", show: (auth) => mkOnly(auth, "campaigns.manage") },
  { id: "mk-consent", icon: "✅", label: "Consent & opt-outs", show: (auth) => mkOnly(auth, "consent.view") },
  { id: "mk-flash-sales", icon: "⚡", label: "Flash sales", show: (auth) => mkOnly(auth, "site_promo.manage") },
  { id: "mk-coupons", icon: "🏷️", label: "Coupons", show: (auth) => mkOnly(auth, "coupons.manage") },
  { id: "mk-delivery-promos", icon: "🚚", label: "Free delivery", show: (auth) => mkOnly(auth, "site_promo.manage") },
  { id: "mk-banners", icon: "🖼️", label: "Banners", show: (auth) => mkOnly(auth, "site_promo.manage") },
  { id: "mk-featured", icon: "⭐", label: "Featured listings", show: (auth) => mkOnly(auth, "site_promo.manage") },
  { id: "mk-results", icon: "📈", label: "Campaign results", show: (auth) => mkOnly(auth, "campaigns.manage") },
  { id: "mk-senders", icon: "📡", label: "Sender IDs & providers", show: (auth) => mkOnly(auth, "campaigns.manage") },
  { id: "mk-quiet-hours", icon: "🌙", label: "Quiet hours & limits", show: (auth) => mkOnly(auth, "campaigns.manage", "promotions.manage", "analytics.view") },
  // Teams (step in): read-only views of a team member's workspace (components/admin/stepin/).
  { id: "step-in-operations", icon: "👁️", label: "Operations & scouts", show: canStepIn },
  { id: "step-in-support", icon: "👁️", label: "Support", show: canStepIn },
  { id: "step-in-delivery", icon: "👁️", label: "Delivery & dispatch", show: canStepIn },
  { id: "step-in-marketing", icon: "👁️", label: "Marketing", show: canStepIn },
  { id: "step-in-accounting", icon: "👁️", label: "Accounting", show: canStepIn },
  { id: "payouts-payroll", icon: "🏦", label: "Payouts & payroll", show: saOnly },
  { id: "commissions", icon: "💷", label: "Commissions", show: (auth) => saOrAcct(auth, "commission.view_all") },
  { id: "refunds", icon: "↩️", label: "Refunds", show: (auth) => saOrAcct(auth) },
  { id: "reconciliation", icon: "🧮", label: "Reconciliation", show: (auth) => saOrAcct(auth) },
  { id: "growth-funnel", icon: "🪜", label: "Growth funnel", show: saOnly },
  { id: "scheduled-exports", icon: "📆", label: "Scheduled exports", show: saOnly },
  { id: "sign-in-history", icon: "🕵️", label: "Sign-in history", show: saOnly },
  { id: "data-exports-log", icon: "📤", label: "Data exports log", show: saOnly },
  { id: "notification-center", icon: "🔔", label: "Notification center", show: saOnly },
  { id: "staff-announcements", icon: "📣", label: "Staff announcements", show: saOnly },
  { id: "approval-rules", icon: "⏱️", label: "Approval rules & timers", show: saOnly },
  { id: "money-rules", icon: "💰", label: "Money rules", show: saOnly },
  { id: "delivery-pricing", icon: "🛵", label: "Delivery pricing", show: saOnly },
  { id: "tax-tables", icon: "📑", label: "Tax tables", show: saOnly },
  { id: "integrations", icon: "🔌", label: "Integrations", show: saOnly },
  { id: "system-health", icon: "🩺", label: "System health", show: saOnly },
  // The marketplace opening time, delay and pre-opening test accounts. Super Admin's alone (opening.manage).
  { id: "opening", icon: "⏳", label: "Marketplace opening", show: (auth) => saOnly(auth) && auth.hasPermission("opening.manage") },
  // Accounting canvas screens (see acctOnly above).
  { id: "acct-journal", icon: "📒", label: "Journal", show: acctOnly },
  { id: "acct-chart", icon: "🗃️", label: "Chart of accounts", show: acctOnly },
  { id: "acct-trial-balance", icon: "⚖️", label: "Trial balance", show: acctOnly },
  { id: "acct-collections", icon: "📥", label: "Collections", show: acctOnly },
  { id: "acct-payout-runs", icon: "📤", label: "Payout runs", show: acctOnly },
  { id: "acct-settlements", icon: "🏪", label: "Seller settlements", show: acctOnly },
  { id: "acct-rider-payouts", icon: "🛵", label: "Rider payouts", show: acctOnly },
  { id: "acct-payroll", icon: "🧑‍💼", label: "Payroll", show: acctOnly },
  { id: "acct-pay-profiles", icon: "🪪", label: "Pay profiles", show: acctOnly },
  { id: "acct-paye", icon: "🧾", label: "PAYE", show: acctOnly },
  { id: "acct-ssnit", icon: "🛡️", label: "SSNIT & Tier 2", show: acctOnly },
  { id: "acct-wht", icon: "✂️", label: "Withholding tax", show: acctOnly },
  { id: "acct-vat", icon: "📑", label: "VAT, NHIL, GETFund", show: acctOnly },
  { id: "acct-tax-settings", icon: "⚙️", label: "Tax settings", show: acctOnly },
  { id: "acct-period-close", icon: "🔒", label: "Period close", show: acctOnly },
  { id: "acct-audit-chain", icon: "⛓️", label: "Audit chain", show: acctOnly },
  { id: "acct-alerts", icon: "🚨", label: "Alerts", show: acctOnly },
  { id: "acct-statements", icon: "📊", label: "Statements", show: acctOnly },
];

// [group id, group label, item ids]. The original (pre-1B) grouping, used for
// any session whose role has no menu below.
const DEFAULT_GROUPS = [
  ["moderation", "Moderation", ["kyc", "moderation", "hero", "events-moderation", "reviews", "fraud-cases"]],
  ["finance", "Finance", ["event-pricing", "subscription-plans", "subscription-plans-approval", "commission-policy", "escrow", "disputes", "transactions", "credit"]],
  ["users-roles", "Users & Roles", ["users", "staff", "sessions"]],
  ["field-ops", "Field Operations", ["scout-assignments", "field-verification", "visits", "targets", "commission", "leaderboard", "prospects", "register-business", "delivery-coordination", "my-deliveries", "portfolio", "all-portfolios", "at-risk", "subscriptions-due"]],
  ["content", "Content", ["categories-zones", "promotions", "site-settings"]],
  ["system", "System", ["delivery", "contact-messages", "messaging", "analytics"]],
  ["my-work", "My Work", ["approvals", "tasks", "calls", "reports", "team-reports", "activity", "my-team", "security"]],
];

// Per-role menus from the approved design canvases. A group label never
// repeats an item label (e.g. the canvas's "Approvals" group is "Decisions"
// here) so a label always names exactly one thing on screen.
const ROLE_MENUS = {
  // Super Admin, exactly as the two approved canvases draw it (Command center is the
  // pinned Overview). Screens the canvas leaves out (Staff Management's old name, Escrow,
  // Credit, Tasks, Call log, My reports, Messaging, ...) are not in this menu; their panels
  // and permissions are untouched (see EXHAUSTIVE_MENU_ROLES). Where a screen is not built
  // yet its id is a placeholder (NAV_ITEMS); where an older panel serves it, that panel's id.
  super_admin: [
    ["home", "Home", ["approvals"]],
    ["people", "People", ["staff", "teams-reporting", "invites", "roles-permissions", "sessions", "leave"]],
    ["teams", "Teams (step in)", ["step-in-operations", "step-in-support", "step-in-delivery", "step-in-marketing", "step-in-accounting"]],
    ["marketplace", "Marketplace", ["all-portfolios", "users", "moderation", "delivery", "events-moderation", "disputes"]],
    ["money", "Money", ["transactions", "payouts-payroll", "commissions", "refunds", "reconciliation"]],
    ["insights", "Insights", ["analytics", "growth-funnel", "team-reports", "scheduled-exports"]],
    ["security-audit", "Security & audit", ["activity", "sign-in-history", "fraud-cases", "data-exports-log", "security"]],
    ["communication", "Communication", ["notification-center", "staff-announcements"]],
    ["settings", "Settings", ["approval-rules", "money-rules", "commission-policy", "delivery-pricing", "subscription-plans-approval", "targets", "tax-tables", "categories-zones", "integrations", "system-health", "opening"]],
  ],
  // Operations, exactly as the approved canvas draws it (Overview is pinned
  // above the groups). Users, Scout Assignments, Register a business, Field
  // Verification and Delivery Management are not in this menu (Sign-in & Security is kept
  // so a lead can still manage their own sign-in); their panels and
  // permissions are untouched (see EXHAUSTIVE_MENU_ROLES).
  operations: [
    ["approvals", "Approvals", ["approvals"]],
    ["people", "People", ["ops-scouts", "support-team", "my-team", "targets", "leave"]],
    ["businesses", "Businesses", ["all-portfolios", "at-risk", "subscriptions-due"]],
    ["moderation", "Moderation", ["kyc", "moderation", "hero-events", "reviews"]],
    ["service", "Service", ["support-issues", "deliveries-returns", "fraud-cases"]],
    ["activity", "Activity", ["activity", "visit-map"]],
    ["reports", "Reports", ["reports", "team-reports"]],
    ["my-work", "My work", ["tasks", "calls", "security"]],
    ["settings", "Settings", ["zones", "site-settings", "contact-messages"]],
  ],
  // Accounting, exactly as the approved canvas draws it (Money desk is the pinned Overview).
  // Disputes, Transactions Report, Commission policy, Tasks, Activity and Sign-in & Security are
  // not in the canvas; they stay reachable under "More tools" (accountant is not an exhaustive
  // menu) because the Accountant resolves disputes and proposes commission policy.
  accountant: [
    ["decisions", "Decisions", ["approvals"]],
    ["ledger", "Ledger", ["acct-journal", "acct-chart", "acct-trial-balance"]],
    ["money-in", "Money in", ["acct-collections", "escrow"]],
    ["money-out", "Money out", ["acct-payout-runs", "acct-settlements", "acct-rider-payouts", "refunds"]],
    ["people", "People", ["acct-payroll", "commissions", "acct-pay-profiles"]],
    ["tax", "Tax", ["acct-paye", "acct-ssnit", "acct-wht", "acct-vat", "acct-tax-settings"]],
    ["controls", "Controls", ["reconciliation", "acct-period-close", "acct-audit-chain", "acct-alerts"]],
    ["plans-pricing", "Plans & pricing", ["subscription-plans", "event-pricing", "credit"]],
    ["reports", "Reports", ["acct-statements", "reports"]],
  ],
  // Marketing, exactly as the approved canvas draws it (Overview is pinned above the groups).
  // The canvas groups "Campaigns" and "Reports" hold items of the same name, which a menu may not
  // do (a group never repeats an item label), so those two groups read "Messages" and "Reporting".
  // Approvals, Tasks, Activity and Sign-in & Security are not in the canvas menu; their panels and
  // permissions are untouched (see EXHAUSTIVE_MENU_ROLES).
  marketing: [
    ["messages", "Messages", ["mk-campaigns", "mk-new-campaign", "mk-calendar", "mk-templates"]],
    ["audiences", "Audiences", ["mk-segments", "mk-consent"]],
    ["on-the-site", "On the site", ["mk-flash-sales", "mk-coupons", "mk-delivery-promos", "mk-banners", "mk-featured"]],
    ["moderation", "Moderation", ["hero", "events-moderation", "promotions"]],
    ["insights", "Insights", ["analytics", "mk-results"]],
    ["settings", "Settings", ["mk-senders", "mk-quiet-hours", "categories-zones"]],
    ["reporting", "Reporting", ["reports"]],
  ],
  // Support, exactly as the approved canvas draws it (7 groups, 18 items). Fraud cases, Approvals,
  // Activity, Security and the legacy Messaging / Delivery Management panels are not in this menu;
  // their panels and permissions are untouched (see EXHAUSTIVE_MENU_ROLES).
  support: [
    ["inbox", "Inbox", ["support-mine", "support-unassigned", "support-all-open", "support-past-limit", "support-snoozed", "support-resolved"]],
    ["calls", "Calls", ["calls", "support-log-call"]],
    ["queues", "Queues", ["contact-messages", "reviews", "disputes", "support-order-status"]],
    ["knowledge", "Knowledge", ["support-canned", "support-tags"]],
    ["people", "People", ["users"]],
    ["my-work", "My work", ["tasks"]],
    ["reports", "Reports", ["reports"]],
  ],
  scout: [
    ["pipeline", "Pipeline", ["prospects", "register-business"]],
    ["my-businesses", "My businesses", ["portfolio", "tasks", "approvals"]],
    ["activity", "Activity", ["calls", "visits", "field-verification"]],
    ["performance", "Performance", ["targets", "commission", "leaderboard"]],
    ["reports", "Reports", ["reports"]],
    ["account", "Account", ["security", "activity"]],
  ],
  delivery_manager: [
    ["live", "Live", ["dm-queue", "dm-active"]],
    ["issues", "Issues", ["dm-cases"]],
    ["fleet", "Fleet", ["dm-riders", "dm-documents", "dm-vehicles", "dm-invite", "my-team"]],
    ["planning", "Planning", ["dm-shifts", "dm-zones"]],
    ["cash", "Cash", ["dm-cash", "dm-payouts"]],
    ["settings", "Settings", ["dm-pricing", "dm-autoassign", "dm-limits"]],
    ["my-work", "My work", ["tasks", "approvals", "calls", "activity", "security"]],
    ["reports", "Reports", ["reports", "team-reports"]],
  ],
  dispatch: [
    ["work", "Work", ["dr-jobs", "dr-earnings", "dr-cash"]],
    ["you", "You", ["dr-menu", "dr-issue", "dr-documents"]],
    ["my-work", "My work", ["tasks", "approvals", "activity", "security"]],
    ["reports", "Reports", ["reports"]],
  ],
  // The external co-signer: requests above the co-sign limit, and their own sign-in. Nothing else.
  cosigner: [
    ["decisions", "Decisions", ["approvals"]],
    ["account", "Account", ["security"]],
  ],
};

// Roles whose menu is the whole menu: a screen the canvas leaves out is not
// offered under "More tools" either (its permission and panel stay).
const EXHAUSTIVE_MENU_ROLES = new Set(["operations", "super_admin", "cosigner", "support", "delivery_manager", "dispatch", "marketing"]);

// Nav ids whose screen is not built yet, per role; AdminCommandCenter renders the
// "being built" panel for them. A package that builds one swaps its panel in and
// drops the item's `placeholder` flag.
export const PLACEHOLDER_TABS = Object.fromEntries(
  Object.keys(ROLE_MENUS).map((role) => [role, new Set(NAV_ITEMS.filter((item) => item.placeholder === role).map((item) => item.id))]),
);

const ITEM_BY_ID = Object.fromEntries(NAV_ITEMS.map((item) => [item.id, item]));
// Labels a role reads differently (the item ids and NAV_ITEMS labels stay as they are).
// The scout's menu reads in the canvas's words; the Overview item (pinned, not
// in NAV_ITEMS) is "Today" for a scout (see overviewLabel).
const ROLE_LABELS = {
  scout: {
    tasks: "Follow-ups", calls: "Calls", approvals: "Sent for approval", reports: "Day, week & month",
    security: "Profile & sign out", activity: "My activity",
  },
  delivery_manager: { "team-reports": "Riders' reports", reports: "My reports" },
  dispatch: { reports: "End of day report", activity: "My activity", security: "Sign-in & security" },
  operations: {
    approvals: "Approvals inbox", "my-team": "Invite", kyc: "KYC queue", moderation: "Listings",
    activity: "Staff activity", reports: "My reports", "team-reports": "My team", calls: "Call log",
    "site-settings": "Site settings", "contact-messages": "Contact messages",
  },
  accountant: { escrow: "Escrow", credit: "Credit & lending", reports: "My reports" },
  support: {
    calls: "Call log", "contact-messages": "Contact form", disputes: "Dispute intake", users: "Customers & businesses",
    reports: "My reports",
  },
  marketing: {
    hero: "Hero approval", "events-moderation": "Events", reports: "Reports", "categories-zones": "Categories",
  },
  // Super Admin reads the canvas's words; the ids (and every other role's labels) stay.
  super_admin: {
    approvals: "My approvals", staff: "Staff directory", sessions: "Sessions & devices", leave: "Leave & holidays",
    "all-portfolios": "Businesses", users: "Customers", moderation: "Listings & services", delivery: "Orders & deliveries",
    "events-moderation": "Events & tickets", disputes: "Disputes & returns", transactions: "Revenue & sales",
    "team-reports": "Reports hub", activity: "Audit log", "fraud-cases": "Fraud & anomaly alerts", security: "Security settings",
    "subscription-plans-approval": "Plans & prices", targets: "Target limits", "categories-zones": "Categories & zones",
  },
};
// The pinned Overview: "Today" for a scout, the canvas's "Command center" for Super Admin, "Live operations" for the Delivery Manager.
export const overviewLabel = (role) => (role === "scout" ? "Today" : role === "super_admin" ? "Command center" : role === "delivery_manager" ? "Live operations" : role === "dispatch" ? "Shift" : "Overview");
const toNavItem = ({ id, icon, label }, role) => ({ id, icon, label: ROLE_LABELS[role]?.[id] || label });

export function buildNavGroups(auth) {
  const layout = ROLE_MENUS[auth.user?.role] || DEFAULT_GROUPS;
  const placed = new Set();
  const groups = layout.map(([id, label, itemIds]) => {
    const items = [];
    for (const itemId of itemIds) {
      const item = ITEM_BY_ID[itemId];
      if (!item || placed.has(itemId) || !item.show(auth)) continue;
      placed.add(itemId);
      items.push(toNavItem(item, auth.user?.role));
    }
    return { id, label, items };
  });
  const leftovers = EXHAUSTIVE_MENU_ROLES.has(auth.user?.role) ? [] : NAV_ITEMS.filter((item) => !placed.has(item.id) && item.show(auth)).map((item) => toNavItem(item, auth.user?.role));
  if (leftovers.length) groups.push({ id: "more", label: "More tools", items: leftovers });
  return groups.filter((group) => group.items.length > 0);
}

// Maps a nav item id → the key it reads from GET /api/notifications/
// staff-badges/ (item 10). Only tabs with genuine pending work appear here;
// a count > 0 renders a small badge next to that tab's label so staff see at
// a glance which tabs need attention. The badges query polls every 60s (see
// useStaffBadges) so newly-arrived work surfaces without a manual reload;
// live updates (lib/realtime.js) refresh it sooner when a socket is up.
export const BADGE_KEY_BY_TAB = {
  kyc: "kyc",
  approvals: "approvals_waiting",
  tasks: "tasks_due",
  moderation: "listings",
  hero: "hero",
  "events-moderation": "events",
  reviews: "reviews",
  "subscription-plans-approval": "plan_approvals",
  "contact-messages": "contact_messages",
  escrow: "escrow",
  // Operations canvas badges (open service issues; open disputes).
  "at-risk": "at_risk",
  "subscriptions-due": "subscriptions_due",
  "fraud-cases": "fraud_open",
  "team-reports": "team_reports_waiting",
  "support-issues": "support_issues",
  "deliveries-returns": "deliveries_open",
  // Delivery Manager canvas badges.
  "dm-queue": "delivery_queue",
  "dm-cases": "delivery_cases",
  "dm-documents": "delivery_documents",
  "dm-cash": "delivery_cash",
  "hero-events": ["hero", "events"],
  // Marketing canvas: promotions waiting for approval.
  promotions: "promotions_pending",
};

// Badge keys a role reads differently from BADGE_KEY_BY_TAB. Super Admin's canvas badges:
// open invites; open disputes (there is no returns model yet); submitted reports across every
// team (not just the caller's own reports). My approvals and Fraud & anomaly alerts use
// approvals_waiting and fraud_open from the table above.
export const BADGE_KEY_BY_ROLE_TAB = {
  // Support's canvas: Mine / Unassigned / Past time limit / Dispute intake are badges; All open and
  // Snoozed are plain counts (COUNT_ONLY_TABS). Reviews, Contact form and Tasks use the shared keys.
  support: {
    "support-mine": "support_mine", "support-unassigned": "support_unassigned", "support-all-open": "support_all_open",
    "support-past-limit": "support_past_limit", "support-snoozed": "support_snoozed", disputes: "disputes_intake",
  },
  super_admin: { invites: "invites_open", disputes: "disputes_open", "team-reports": "reports_hub" },
};

// Menu items that show a muted count instead of a red badge (the Support canvas's All open and Snoozed).
export const COUNT_ONLY_TABS = { support: new Set(["support-all-open", "support-snoozed"]) };

// Badge lookup for a tab id against the GET /api/notifications/staff-badges/
// payload — 0 for tabs with no badge key or no data yet.
export function makeBadgeFor(staffBadges, role) {
  return (tabId) => {
    const key = BADGE_KEY_BY_ROLE_TAB[role]?.[tabId] || BADGE_KEY_BY_TAB[tabId];
    if (!key) return 0;
    // A tab fed by two queues (Hero & events) shows their sum.
    return [].concat(key).reduce((total, k) => total + (staffBadges?.[k] || 0), 0);
  };
}

// Overview has no permission gate; every other tab must be one of the
// session's permitted nav items. Used to send unpermitted /staff/:panel URLs
// (or manifest shortcuts) back to Overview.
export function isPermittedTab(navGroups, tabId) {
  return tabId === "overview" || navGroups.some((group) => group.items.some((item) => item.id === tabId));
}

// Phone bottom-bar slots (spec §4.3): panels with pending work first, then
// the rest — both in nav order, never sorted by count, so icons only move
// when a queue empties or fills, not on every 60s badge poll.
export function pickBottomBarItems(navGroups, badgeFor, slots = 3) {
  const items = navGroups.flatMap((group) => group.items);
  const withWork = items.filter((item) => badgeFor(item.id) > 0);
  const rest = items.filter((item) => !(badgeFor(item.id) > 0));
  return [...withWork, ...rest].slice(0, slots);
}
