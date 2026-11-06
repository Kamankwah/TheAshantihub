import { useState } from "react";
import { apiPost } from "../apiClient.js";
import { apiErrorMessage } from "../lib/apiErrorMessage.js";
import { D, tint } from "./dashboard/theme.js";

// ─── EmailConfirmBanner ─────────────────────────────────────────────────────
// Shown at the top of the owner's dashboard while the server's go-live rule still waits on the email address
// (`go_live.blockers` holds `email_unconfirmed` or `email_missing`). Resend asks the server to mail a fresh link
// (POST business-owners/me/email-confirmation/, five a day). "Sent to <address>" names only an address this component
// was handed (the one the owner typed); it never reads one back from the server, and says only "Sent." without it. A
// missing email has nothing to send to, so it shows the server's own sentence and no Resend.

const RESEND_URL = "/api/accounts/business-owners/me/email-confirmation/";
const RESEND_FAILED = "We couldn't send the link. Check your connection and try again.";

const codeOf = (blocker) => (typeof blocker === "string" ? blocker : blocker?.code);

export default function EmailConfirmBanner({ goLive, email }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const blockers = Array.isArray(goLive?.blockers) ? goLive.blockers : [];
  const unconfirmed = blockers.find((b) => codeOf(b) === "email_unconfirmed");
  const missing = blockers.find((b) => codeOf(b) === "email_missing");
  if (!unconfirmed && !missing) return null;

  const resend = async () => {
    setSending(true);
    setError("");
    try {
      await apiPost(RESEND_URL, {});
      setSent(true);
    } catch (err) {
      setSent(false);
      setError(apiErrorMessage(err, RESEND_FAILED));
    } finally {
      setSending(false);
    }
  };

  const serverLine = (missing && typeof missing === "object" ? missing.message : "") || "";

  return (
    <section aria-label="Confirm your email" style={{ background: D.panelBg, border: `1px solid ${tint(D.amber, "66")}`, borderLeft: `4px solid ${D.amber}`, borderRadius: 16, padding: "14px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: D.text, fontSize: "0.86rem" }}>Confirm your email to publish listings</div>
        {missing && !unconfirmed && serverLine && <div style={{ color: D.textDim, fontSize: "0.78rem", marginTop: 2 }}>{serverLine}</div>}
        {unconfirmed && <div style={{ color: D.textDim, fontSize: "0.78rem", marginTop: 2 }}>Open the link we emailed you. Can't find it? Send a new one.</div>}
        {sent && <div role="status" style={{ color: D.text, fontSize: "0.78rem", fontWeight: 700, marginTop: 6 }}>{email ? `Sent to ${email}` : "Sent. Check your inbox (and your spam folder)."}</div>}
        {error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem", fontWeight: 700, marginTop: 6 }}>{error}</div>}
      </div>
      {unconfirmed && (
        <button type="button" onClick={resend} disabled={sending} style={{ background: D.gold, color: D.darkBrown, border: "none", borderRadius: 20, padding: "8px 16px", minHeight: 40, fontWeight: 800, fontSize: "0.76rem", cursor: sending ? "default" : "pointer", opacity: sending ? 0.6 : 1, fontFamily: "inherit" }}>
          {sending ? "Sending…" : "Resend"}
        </button>
      )}
    </section>
  );
}
