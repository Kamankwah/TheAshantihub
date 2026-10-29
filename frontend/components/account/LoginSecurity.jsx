import { useState } from "react";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { D, glassCard } from "../dashboard/theme.js";
import { C } from "../../theme.js";

const row = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: "0.82rem", padding: "10px 0", borderBottom: `1px solid ${D.divider}` };

// Login & security: the read-only identifiers, a password reset, then everything the old
// Profile and Settings tabs held (secondary email/phone verification, 2-step verification,
// trusted devices, language, notifications, sign-out), mounted through `render` because
// those pieces are App-owned. There is no passkey row: the backend has none.
export default function LoginSecurity({ user, auth, render }) {
  const [resetState, setResetState] = useState("idle"); // idle | busy | sent | failed
  const [resetError, setResetError] = useState("");
  const email = user?.email;

  async function resetByEmail() {
    if (!email || resetState === "busy") return;
    setResetState("busy");
    try {
      // The server answers the same for a registered and an unknown address, so a success says "if".
      await auth.requestPasswordReset(email);
      setResetState("sent");
    } catch (err) {
      // A real failure (throttled, offline, a server error) is not "sent".
      setResetError(apiErrorMessage(err, "We couldn't send the reset link. Please try again."));
      setResetState("failed");
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 560 }}>
      <div style={{ ...glassCard, padding: "6px 18px" }}>
        <div style={row}><span style={{ color: D.textDim }}>Name</span><span style={{ color: D.text, fontWeight: 700 }}>{user?.fullName || "Not set"}</span></div>
        <div style={row}><span style={{ color: D.textDim }}>Email</span><span style={{ color: D.text, fontWeight: 700 }}>{email || "Not set"}</span></div>
        <div style={row}><span style={{ color: D.textDim }}>Primary mobile number</span><span style={{ color: D.text, fontWeight: 700 }}>{user?.phone || "Not set"}</span></div>
        <div style={{ ...row, borderBottom: "none" }}>
          <span style={{ color: D.textDim }}>Password</span>
          {email ? (
            <button type="button" onClick={resetByEmail} disabled={resetState === "busy"} style={{ background: "none", border: `1px solid ${D.cardBorderStrong}`, color: D.text, borderRadius: 8, padding: "6px 12px", fontWeight: 700, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit" }}>Reset by email</button>
          ) : (
            <span style={{ color: D.textFaint }}>Add an email address to reset by email</span>
          )}
        </div>
        {resetState === "failed" && <div role="alert" style={{ color: C.errInk, fontSize: "0.78rem", padding: "0 0 12px" }}>{`We couldn't send the reset link. ${resetError}`}</div>}
        {resetState === "sent" && <div role="status" style={{ color: D.textDim, fontSize: "0.78rem", padding: "0 0 12px" }}>If that email is registered, we have sent a reset link.</div>}
      </div>
      {render.profile?.()}
      {render.settings?.()}
    </div>
  );
}
