import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useClaimPreview } from "../hooks/useClaimPreview.js";
import { apiErrorMessage } from "../lib/apiErrorMessage.js";
import { C } from "../theme.js";
import OwnerClaimForm, { ClaimSummary } from "./OwnerClaimForm.jsx";

// ─── /business/claim?token=… ──────────────────────────────────────────────────
// The link a scout (or Operations) emails a business owner who wasn't there
// when the business was registered (staff phase 2A, S2). Public: the owner
// has no session yet. Shows what was registered, then the same terms +
// password form as the hand-over. It never signs the owner in — on success
// they sign in normally (onSignIn opens the sign-in form). A used, replaced
// or expired link shows the server's message and no form.

const when = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const pageStyle = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, ${C.kente1}, ${C.kente3})`, padding: 16, boxSizing: "border-box" };
const sheetStyle = { background: C.white, borderRadius: 22, width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden" };
const bodyStyle = { padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14, color: C.darkBrown };
const primaryStyle = { minHeight: 48, width: "100%", background: C.gold, color: C.darkBrown, border: "none", borderRadius: 24, padding: "12px 18px", fontWeight: 900, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit" };
const noticeStyle = (color) => ({ background: `${color}12`, border: `1px solid ${color}`, color: C.darkBrown, borderRadius: 10, padding: "10px 12px", fontSize: "0.85rem", fontWeight: 700, lineHeight: 1.5 });
const mutedStyle = { fontSize: "0.76rem", opacity: 0.75, lineHeight: 1.5 };

export default function BusinessClaimPage({ onSignIn }) {
  const location = useLocation();
  const token = new URLSearchParams(location.search).get("token") || "";
  const preview = useClaimPreview(token);
  const [claimed, setClaimed] = useState(null);
  const refusal = preview.isError ? preview.error : null;
  const linkUsed = refusal?.body?.code === "used";

  return (
    <div style={pageStyle}>
      <div style={sheetStyle}>
        <div style={{ background: `linear-gradient(135deg, ${C.kente1}, ${C.kente3})`, padding: "20px 24px" }}>
          <div style={{ color: C.gold, fontWeight: 900, fontSize: "1.1rem" }}>Set up your AshantiHub login</div>
        </div>
        <div style={bodyStyle}>
          {claimed ? (
            <>
              <div role="status" style={noticeStyle(C.kente2)}>You're all set — sign in with {claimed.login_phone} and your new password.</div>
              <button type="button" onClick={onSignIn} style={primaryStyle}>Sign in</button>
            </>
          ) : !token ? (
            <div role="alert" style={noticeStyle(C.kente1)}>This link is missing its token. Ask your account manager to send a new one.</div>
          ) : refusal ? (
            <>
              <div role="alert" style={noticeStyle(C.kente1)}>{apiErrorMessage(refusal, "This link can't be used. Ask your account manager to send a new one.")}</div>
              {linkUsed && <button type="button" onClick={onSignIn} style={primaryStyle}>Sign in</button>}
            </>
          ) : !preview.data ? (
            <div role="status" style={mutedStyle}>Checking your link…</div>
          ) : (
            <>
              <ClaimSummary preview={preview.data} />
              <OwnerClaimForm preview={preview.data} token={token} onClaimed={setClaimed} submitLabel="Save my login" />
              <div style={mutedStyle}>This link works once, until {when(preview.data.expires_at)}. Your password goes straight to AshantiHub.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
