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
  { id: "scout-assignments", icon: "🧭", label: "Scout Assignments", show: (auth) => auth.hasPermission("scouts.assign") },
  { id: "field-verification", icon: "📋", label: "Field Verification", show: (auth) => auth.hasPermission("scouts.verify") },
  { id: "delivery-coordination", icon: "🚚", label: "Delivery Coordination", show: (auth) => auth.hasPermission("delivery.manage") },
  { id: "my-deliveries", icon: "📦", label: "My Deliveries", show: (auth) => auth.hasPermission("delivery.dispatch") },
  { id: "categories-zones", icon: "🗂️", label: "Categories & Zones", show: (auth) => auth.hasPermission("categories.manage") || auth.hasPermission("zones.manage") },
  { id: "promotions", icon: "🎯", label: "Promotions", show: (auth) => auth.hasPermission("promotions.manage") },
  { id: "site-settings", icon: "🧭", label: "Site Settings", show: (auth) => auth.hasPermission("site_settings.manage") },
  { id: "delivery", icon: "🚚", label: "Delivery Management", show: (auth) => auth.hasPermission("orders.manage_delivery") },
  { id: "contact-messages", icon: "✉️", label: "Contact Messages", show: (auth) => auth.hasPermission("contact_messages.manage") },
  { id: "messaging", icon: "💬", label: "Messaging / Tickets", show: (auth) => auth.hasPermission("messaging.manage") },
  { id: "analytics", icon: "📊", label: "Analytics", show: (auth) => auth.hasPermission("analytics.view") },
  { id: "tasks", icon: "✅", label: "Tasks", show: () => true },
  { id: "calls", icon: "📞", label: "Call Log", show: (auth) => auth.hasPermission("calls.log") },
  { id: "activity", icon: "🕘", label: "Activity", show: () => true },
  { id: "my-team", icon: "👥", label: "My Team", show: (auth) => auth.hasPermission("staff.invite_team") },
];

// [group id, group label, item ids]. The original (pre-1B) grouping, used for
// any session whose role has no menu below.
const DEFAULT_GROUPS = [
  ["moderation", "Moderation", ["kyc", "moderation", "hero", "events-moderation", "reviews"]],
  ["finance", "Finance", ["event-pricing", "subscription-plans", "subscription-plans-approval", "escrow", "disputes", "transactions", "credit"]],
  ["users-roles", "Users & Roles", ["users", "staff", "sessions"]],
  ["field-ops", "Field Operations", ["scout-assignments", "field-verification", "delivery-coordination", "my-deliveries"]],
  ["content", "Content", ["categories-zones", "promotions", "site-settings"]],
  ["system", "System", ["delivery", "contact-messages", "messaging", "analytics"]],
  ["my-work", "My Work", ["approvals", "tasks", "calls", "reports", "team-reports", "activity", "my-team", "security"]],
];

// Per-role menus from the approved design canvases. A group label never
// repeats an item label (e.g. the canvas's "Approvals" group is "Decisions"
// here) so a label always names exactly one thing on screen.
const ROLE_MENUS = {
  super_admin: [
    ["home", "Home", ["approvals"]],
    ["people", "People", ["staff", "my-team", "sessions"]],
    ["teams", "Teams (step in)", ["scout-assignments", "field-verification", "delivery-coordination", "my-deliveries"]],
    ["marketplace", "Marketplace", ["users", "kyc", "moderation", "hero", "events-moderation", "reviews", "delivery", "disputes", "messaging", "contact-messages"]],
    ["money", "Money", ["transactions", "escrow", "credit"]],
    ["insights", "Insights", ["analytics", "reports", "team-reports"]],
    ["security-audit", "Security & audit", ["activity"]],
    ["settings", "Settings", ["subscription-plans", "subscription-plans-approval", "event-pricing", "promotions", "categories-zones", "site-settings"]],
    ["my-work", "My work", ["tasks", "calls", "security"]],
  ],
  operations: [
    ["decisions", "Decisions", ["approvals"]],
    ["people", "People", ["my-team", "scout-assignments", "field-verification"]],
    ["moderation", "Moderation", ["kyc", "moderation", "hero", "events-moderation", "reviews"]],
    ["service", "Service", ["messaging", "disputes", "delivery"]],
    ["oversight", "Staff activity", ["activity"]],
    ["reports", "Reports", ["reports", "team-reports"]],
    ["my-work", "My work", ["tasks", "calls", "security"]],
    ["settings", "Settings", ["categories-zones", "site-settings", "contact-messages"]],
  ],
  accountant: [
    ["decisions", "Decisions", ["approvals"]],
    ["money-in", "Money in", ["escrow"]],
    ["controls", "Controls", ["disputes", "transactions"]],
    ["plans-pricing", "Plans & pricing", ["subscription-plans", "subscription-plans-approval", "event-pricing", "credit"]],
    ["reports", "Reports", ["reports", "team-reports"]],
    ["my-work", "My work", ["tasks", "activity", "security"]],
  ],
  marketing: [
    ["decisions", "Decisions", ["approvals"]],
    ["moderation", "Moderation", ["hero", "events-moderation", "promotions"]],
    ["insights", "Insights", ["analytics"]],
    ["settings", "Settings", ["categories-zones"]],
    ["reports", "Reports", ["reports"]],
    ["my-work", "My work", ["tasks", "activity", "security"]],
  ],
  support: [
    ["inbox", "Inbox", ["messaging"]],
    ["calls", "Calls", ["calls"]],
    ["queues", "Queues", ["contact-messages", "reviews", "disputes", "delivery"]],
    ["people", "People", ["users"]],
    ["my-work", "My work", ["approvals", "tasks", "activity", "security"]],
    ["reports", "Reports", ["reports"]],
  ],
  scout: [
    ["field", "Field", ["field-verification"]],
    ["calls", "Calls", ["calls"]],
    ["my-work", "My work", ["approvals", "tasks", "activity", "security"]],
    ["reports", "Reports", ["reports"]],
  ],
  delivery_manager: [
    ["live", "Live", ["delivery-coordination", "delivery"]],
    ["issues", "Issues", ["disputes"]],
    ["fleet", "Fleet", ["my-team"]],
    ["planning", "Planning", ["categories-zones"]],
    ["my-work", "My work", ["approvals", "tasks", "calls", "activity", "security"]],
    ["reports", "Reports", ["reports", "team-reports"]],
  ],
  dispatch: [
    ["jobs", "Jobs", ["my-deliveries"]],
    ["my-work", "My work", ["approvals", "tasks", "activity", "security"]],
    ["reports", "Reports", ["reports"]],
  ],
};

const ITEM_BY_ID = Object.fromEntries(NAV_ITEMS.map((item) => [item.id, item]));
const toNavItem = ({ id, icon, label }) => ({ id, icon, label });

export function buildNavGroups(auth) {
  const layout = ROLE_MENUS[auth.user?.role] || DEFAULT_GROUPS;
  const placed = new Set();
  const groups = layout.map(([id, label, itemIds]) => {
    const items = [];
    for (const itemId of itemIds) {
      const item = ITEM_BY_ID[itemId];
      if (!item || placed.has(itemId) || !item.show(auth)) continue;
      placed.add(itemId);
      items.push(toNavItem(item));
    }
    return { id, label, items };
  });
  const leftovers = NAV_ITEMS.filter((item) => !placed.has(item.id) && item.show(auth)).map(toNavItem);
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
  tasks: "tasks_overdue",
  moderation: "listings",
  hero: "hero",
  "events-moderation": "events",
  reviews: "reviews",
  "subscription-plans-approval": "plan_approvals",
  "contact-messages": "contact_messages",
  escrow: "escrow",
};

// Badge lookup for a tab id against the GET /api/notifications/staff-badges/
// payload — 0 for tabs with no badge key or no data yet.
export function makeBadgeFor(staffBadges) {
  return (tabId) => {
    const key = BADGE_KEY_BY_TAB[tabId];
    return key ? (staffBadges?.[key] || 0) : 0;
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
