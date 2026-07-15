import { C } from "../theme.js";

// ─── AccountPanel ──────────────────────────────────────────────────────────
// A customer's "My Account" view, opened from the Navbar's profile menu.
// Business owners have a real BusinessDashboard backed by billing/credit
// data; customers don't have an equivalent yet — the backend's Customer
// model and /api/accounts/me/ only expose full_name (no phone/email, no
// profile-update endpoint), so this is deliberately a lightweight, honest
// read-only panel (same overlay pattern as FavsDrawer/NotificationsPanel)
// rather than a settings form with nothing to save to.
export default function AccountPanel({ user, favourites, onClose, onOpenSaved, onOpenMyTickets, onOpenMessages }) {
  const itemStyle = {
    background: "#f6f6f6", border: "1px solid #e5e5e5", borderRadius: 12,
    padding: "10px 14px", fontSize: "0.82rem", fontWeight: 700, color: C.darkBrown,
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
    fontFamily: "inherit", width: "100%",
  };
  const countStyle = {
    background: C.gold, color: C.darkBrown, borderRadius: 20, padding: "1px 9px", fontSize: "0.7rem", fontWeight: 900,
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999 }} onClick={onClose}>
      <div style={{ position: "absolute", top: 65, right: 16, background: "white", borderRadius: 16, width: 300, boxShadow: "0 8px 40px rgba(0,0,0,0.2)", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ background: `linear-gradient(135deg,${C.darkBrown},${C.kente3})`, padding: "18px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: C.gold, color: C.darkBrown, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: "1.2rem", flexShrink: 0 }}>
            {user.fullName?.[0]?.toUpperCase() || "U"}
          </div>
          <div>
            <div style={{ color: "white", fontWeight: 800, fontSize: "0.92rem" }}>{user.fullName}</div>
            <div style={{ color: C.lightGold, fontSize: "0.68rem", opacity: 0.85 }}>Customer Account</div>
          </div>
        </div>
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={onOpenSaved} style={itemStyle}>
            <span>❤️ Saved Businesses</span>
            <span style={countStyle}>{favourites.length}</span>
          </button>
          <button onClick={onOpenMyTickets} style={itemStyle}>
            <span>🎟️ My Tickets</span>
          </button>
          <button onClick={onOpenMessages} style={itemStyle}>
            <span>💬 Messages</span>
          </button>
        </div>
        <div style={{ padding: "0 16px 16px", fontSize: "0.68rem", color: "#999", lineHeight: 1.5 }}>
          Full profile editing isn't available yet — check back soon.
        </div>
      </div>
    </div>
  );
}
