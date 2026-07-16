// ─── Admin Command Center — light "artisan" theme ─────────────────────────────
// The staff dashboard reuses the exact light cream/gold palette built for the
// Business Command Center (frontend/components/dashboard/theme.js) rather than
// duplicating it — `D`/`CHART`/`glassCard`/`sectionTitle` are re-exported
// straight from there so the two dashboards stay visually identical and in
// sync by construction (not by hand-copying values).
export { D, CHART, glassCard, sectionTitle, ghs } from "../dashboard/theme.js";

import { C } from "../../theme.js";
import { D } from "../dashboard/theme.js";

// Kente-themed accent per staff role, used for the role badge in the header
// and the active-nav-item highlight — moved here from App.jsx's old
// `ROLE_COLORS` (StaffDashboard was its only consumer).
export const ROLE_ACCENTS = {
  super_admin: C.gold,
  admin: C.kente3,
  accountant: C.kente1,
  marketing: C.kente2,
  support: C.ghGreen,
};

// Text color for the role badge, keyed by role — ROLE_ACCENTS' backgrounds
// range from light gold to dark navy/red/green/teal, so a single flat text
// color doesn't stay legible across all of them.
export const ROLE_BADGE_TEXT = {
  super_admin: "#1a1205",
  admin: "#fff",
  accountant: "#fff",
  marketing: "#fff",
  support: "#fff",
};

// ─── Per-panel status-label→color lookup maps ─────────────────────────────
// Moved out of App.jsx's old inline StaffDashboard section so every extracted
// panel imports these instead of redefining its own local copy.

export const REVIEW_STATUS_META = {
  published: { label: "Published", color: D.green },
  hidden: { label: "Hidden", color: D.red },
};

export const SUBSCRIPTION_PLAN_STATUS_META = {
  pending_approval: { label: "Pending Approval", color: D.amber },
  active: { label: "Active", color: D.green },
  rejected: { label: "Rejected", color: D.red },
};

export const CONTACT_STATUS_META = {
  new: { label: "New", color: D.blue },
  read: { label: "Read", color: D.amber },
  resolved: { label: "Resolved", color: D.green },
};

export const ESCROW_STATUS_META = {
  held: { label: "Held", color: D.amber },
  released: { label: "Released", color: D.green },
};

// Staff-roster invite status → color (StaffManagementPanel).
export const STAFF_STATUS_COLORS = {
  active: D.green,
  invited: D.amber,
  invite_expired: D.red,
};
