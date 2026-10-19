import { useEffect, useRef, useState } from "react";
import { C } from "../theme.js";

// The signed-in account dropdown shared by the public Navbar and the
// marketplace home's StorefrontHeader, so both offer the same entry points:
// Business Dashboard + Payments for a business owner, My Account for a
// customer, nothing customer-only for a staff session, and Sign Out for all.
// The trigger's look is the caller's (`triggerStyle` + children); the button
// is always labelled "Account menu". Closes on an outside click and after any
// action.
export default function AccountMenu({
  user, accountLabel, isBusiness, isStaff,
  onBizDash, onPayments, onAccount, onSignOut,
  triggerStyle, children,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const act = (fn) => () => { setOpen(false); fn(); };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-expanded={open} style={triggerStyle}>
        {children}
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "white", borderRadius: 14, boxShadow: "0 10px 40px rgba(0,0,0,0.25)", padding: 10, display: "flex", flexDirection: "column", gap: 6, minWidth: 210, zIndex: 200 }}>
          <div style={{ padding: "4px 8px 8px", borderBottom: "1px solid #f0f0f0", marginBottom: 2 }}>
            <div style={{ fontWeight: 800, color: C.darkBrown, fontSize: "0.82rem" }}>{user.fullName}</div>
            <div style={{ color: "#999", fontSize: "0.68rem" }}>{accountLabel}</div>
          </div>
          {isBusiness ? (
            <>
              <button onClick={act(onBizDash)} style={menuItemStyle}>🏪 Business Dashboard</button>
              <button onClick={act(onPayments)} style={menuItemStyle}>💳 Payments</button>
            </>
          ) : !isStaff ? (
            <button onClick={act(onAccount)} style={menuItemStyle}>👤 My Account</button>
          ) : null}
          <button onClick={act(onSignOut)} style={{ ...menuItemStyle, color: "#dc2626" }}>⏻ Sign Out</button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle = {
  background: "#f6f6f6",
  color: C.darkBrown,
  border: "1px solid #e5e5e5",
  borderRadius: 12,
  padding: "8px 12px",
  fontSize: "0.78rem",
  fontWeight: 700,
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
};
