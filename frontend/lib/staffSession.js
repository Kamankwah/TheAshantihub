// A staff session browses the marketplace view-only: staff can look at
// listings, events and business pages, but never buy, sell, book or create
// anything there (the backend 403s staff on all of those — see
// backend/accounts/tests/test_staff_marketplace_lockout.py). Every
// marketplace action gates on this one check and shows this one message, via
// hooks/useStaffGate.js + components/StaffGateNotice.jsx, so the wording
// never drifts between surfaces.

export const STAFF_GATE_MESSAGE = "Staff accounts can't shop or sell. Sign out first.";

// Accepts both user shapes in circulation: App.jsx's camelCase `user`
// ({accountType}) and useAuth()'s raw `auth.user` ({account_type}).
export function isStaffSession(user) {
  return user?.accountType === "staff" || user?.account_type === "staff";
}
