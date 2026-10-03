// Every `id`/`label`/permission-`show` check below is byte-for-byte identical
// to App.jsx's old inline NAV_ITEMS array — StaffDashboard.test.jsx depends on
// exact label text existing/not-existing per permission. Only the grouping is
// new structure.
export function buildNavGroups(auth) {
  return [
    {
      id: "moderation", label: "Moderation",
      items: [
        { id: "kyc", icon: "🪪", label: "KYC Queue", show: auth.hasPermission("kyc.approve") },
        { id: "moderation", icon: "📋", label: "Listings Moderation", show: auth.hasPermission("listings.moderate") },
        { id: "hero", icon: "🌟", label: "Hero Approval", show: auth.hasPermission("hero_media.approve") },
        { id: "events-moderation", icon: "🎉", label: "Events Moderation", show: auth.hasPermission("event.approve") },
        { id: "reviews", icon: "⭐", label: "Reviews", show: auth.hasPermission("reviews.moderate") },
      ],
    },
    {
      id: "finance", label: "Finance",
      items: [
        { id: "event-pricing", icon: "💵", label: "Event Pricing", show: auth.hasPermission("event_pricing.manage") || auth.hasPermission("event_pricing.approve") },
        { id: "subscription-plans", icon: "💳", label: "Subscription Plans", show: auth.hasPermission("subscription_plans.manage") },
        { id: "subscription-plans-approval", icon: "✅", label: "Plan Approvals", show: auth.hasPermission("subscription_plans.approve") },
        { id: "escrow", icon: "💰", label: "Escrow Ledger", show: auth.hasPermission("escrow.view") || auth.hasPermission("escrow.release") || auth.hasPermission("escrow.refund") },
        { id: "disputes", icon: "⚖️", label: "Disputes", show: auth.hasPermission("disputes.resolve_financial") || auth.hasPermission("disputes.flag") },
        { id: "transactions", icon: "📈", label: "Transactions Report", show: auth.hasPermission("transactions.report") },
        { id: "credit", icon: "💳", label: "Credit & Lending", show: auth.hasPermission("credit.manage") },
      ],
    },
    {
      id: "users-roles", label: "Users & Roles",
      items: [
        { id: "users", icon: "👥", label: "Users", show: auth.hasPermission("users.view") },
        { id: "staff", icon: "🛡️", label: "Staff Management", show: auth.hasPermission("staff.manage") },
      ],
    },
    {
      id: "field-ops", label: "Field Operations",
      items: [
        { id: "scout-assignments", icon: "🧭", label: "Scout Assignments", show: auth.hasPermission("scouts.assign") },
        { id: "field-verification", icon: "📋", label: "Field Verification", show: auth.hasPermission("scouts.verify") },
        { id: "delivery-coordination", icon: "🚚", label: "Delivery Coordination", show: auth.hasPermission("delivery.manage") },
        { id: "my-deliveries", icon: "📦", label: "My Deliveries", show: auth.hasPermission("delivery.dispatch") },
      ],
    },
    {
      id: "content", label: "Content",
      items: [
        { id: "categories-zones", icon: "🗂️", label: "Categories & Zones", show: auth.hasPermission("categories.manage") || auth.hasPermission("zones.manage") },
        { id: "promotions", icon: "🎯", label: "Promotions", show: auth.hasPermission("promotions.manage") },
        { id: "site-settings", icon: "🧭", label: "Site Settings", show: auth.hasPermission("site_settings.manage") },
      ],
    },
    {
      id: "system", label: "System",
      items: [
        { id: "delivery", icon: "🚚", label: "Delivery Management", show: auth.hasPermission("orders.manage_delivery") },
        { id: "contact-messages", icon: "✉️", label: "Contact Messages", show: auth.hasPermission("contact_messages.manage") },
        { id: "messaging", icon: "💬", label: "Messaging / Tickets", show: auth.hasPermission("messaging.manage") },
        { id: "analytics", icon: "📊", label: "Analytics", show: auth.hasPermission("analytics.view") },
      ],
    },
  ]
    .map(group => ({ ...group, items: group.items.filter(item => item.show) }))
    .filter(group => group.items.length > 0);
}

// Maps a nav item id → the key it reads from GET /api/notifications/
// staff-badges/ (item 10). Only tabs with genuine pending work appear here;
// a count > 0 renders a small badge next to that tab's label so staff see at
// a glance which tabs need attention. The badges query polls every 60s (see
// useStaffBadges) so newly-arrived work surfaces without a manual reload.
export const BADGE_KEY_BY_TAB = {
  kyc: "kyc",
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
