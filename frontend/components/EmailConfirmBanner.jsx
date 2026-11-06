import { useState } from "react";
import { apiPost } from "../apiClient.js";
import { apiErrorMessage } from "../lib/apiErrorMessage.js";
import { D, tint } from "./dashboard/theme.js";

// ─── EmailConfirmBanner ─────────────────────────────────────────────────────
// Shown at the top of the owner's dashboard while the server's go-live rule still waits on the email address
// (`go_live.blockers` holds `email_unconfirmed` or `email_missing`). Resend asks the server to mail a fresh link
// (POST business-owners/me/email-confirmation/, five a day). A missing email shows an email field and "Send me a link"
// (POST business-owners/me/email/); an unconfirmed one keeps Resend and a quiet "Wrong address? Change it" toggle that
// reveals the same field. "Sent to <address>" names only an address the owner typed here (or the one this component
// was handed); it never reads one back from the server, and says only "Sent." without one. `onSaved` runs after the
// server accepted the address (also on the daily limit, which still saved it) so the caller can refresh the user and
// the blockers move on.

const RESEND_URL = "/api/accounts/business-owners/me/email-confirmation/";
const SET_EMAIL_URL = "/api/accounts/business-owners/me/email/";
const RESEND_FAILED = "We couldn't send the link. Check your connection and try again.";
const SET_FAILED = "We couldn't save that address. Check your connection and try again.";
const EMAIL_NEEDED = "Enter your email so we can send you a confirmation link.";
const EMAIL_LOOKS_RIGHT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const codeOf = (blocker) => (typeof blocker === "string" ? blocker : blocker?.code);

export default function EmailConfirmBanner({ goLive, email, onSaved }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);
  // The address the owner typed and the server accepted; the honest thing to name in "Sent to ...".
  const [accepted, setAccepted] = useState("");

  const blockers = Array.isArray(goLive?.blockers) ? goLive.blockers : [];
  const unconfirmed = blockers.find((b) => codeOf(b) === "email_unconfirmed");
  const missing = blockers.find((b) => codeOf(b) === "email_missing");
  // A rejected application is a different problem: the dashboard shows "needs changes", not an email prompt.
  const rejected = blockers.some((b) => codeOf(b) === "kyc_rejected");
  if (rejected || (!unconfirmed && !missing)) return null;

  const knownAddress = accepted || email || "";
  const showForm = (missing && !unconfirmed && !accepted) || changing;

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

  const saveEmail = async (e) => {
    e.preventDefault();
    const address = typed.trim();
    setError("");
    if (!EMAIL_LOOKS_RIGHT.test(address)) {
      setSent(false);
      setError(EMAIL_NEEDED);
      return;
    }
    setSaving(true);
    try {
      await apiPost(SET_EMAIL_URL, { email: address });
      setAccepted(address);
      setSent(true);
      setChanging(false);
      setTyped("");
      onSaved?.();
    } catch (err) {
      setSent(false);
      setError(apiErrorMessage(err, SET_FAILED));
      // The daily limit still saved the new address: refresh so Resend can take over.
      if (err?.status === 429 && err?.body?.code === "too_many_links") onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const serverLine = (missing && typeof missing === "object" ? missing.message : "") || "";
  const quietBtn = { background: "none", border: "none", padding: "6px 0", minHeight: 32, color: D.textDim, textDecoration: "underline", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

  return (
    <section aria-label="Confirm your email" style={{ background: D.panelBg, border: `1px solid ${tint(D.amber, "66")}`, borderLeft: `4px solid ${D.amber}`, borderRadius: 16, padding: "14px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: D.text, fontSize: "0.86rem" }}>Confirm your email to publish listings</div>
        {missing && !unconfirmed && serverLine && <div style={{ color: D.textDim, fontSize: "0.78rem", marginTop: 2 }}>{serverLine}</div>}
        {unconfirmed && <div style={{ color: D.textDim, fontSize: "0.78rem", marginTop: 2 }}>Open the link we emailed you. Can't find it? Send a new one.</div>}
        {showForm && (
          <form onSubmit={saveEmail} noValidate style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <input type="text" inputMode="email" autoComplete="email" aria-label="Email address" placeholder="you@example.com" value={typed} onChange={(ev) => setTyped(ev.target.value)} style={{ flex: "1 1 200px", minWidth: 0, minHeight: 40, boxSizing: "border-box", background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorderStrong}`, borderRadius: 12, padding: "8px 12px", fontSize: "0.82rem", fontFamily: "inherit" }} />
            <button type="submit" disabled={saving} style={{ background: D.gold, color: D.darkBrown, border: "none", borderRadius: 20, padding: "8px 16px", minHeight: 40, fontWeight: 800, fontSize: "0.76rem", cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1, fontFamily: "inherit" }}>
              {saving ? "Sending…" : "Send me a link"}
            </button>
          </form>
        )}
        {sent && <div role="status" style={{ color: D.text, fontSize: "0.78rem", fontWeight: 700, marginTop: 6 }}>{knownAddress ? `Sent to ${knownAddress}` : "Sent. Check your inbox (and your spam folder)."}</div>}
        {error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem", fontWeight: 700, marginTop: 6 }}>{error}</div>}
        {unconfirmed && !changing && <button type="button" onClick={() => { setChanging(true); setSent(false); setError(""); }} style={quietBtn}>Wrong address? Change it</button>}
      </div>
      {unconfirmed && (
        <button type="button" onClick={resend} disabled={sending} style={{ background: D.gold, color: D.darkBrown, border: "none", borderRadius: 20, padding: "8px 16px", minHeight: 40, fontWeight: 800, fontSize: "0.76rem", cursor: sending ? "default" : "pointer", opacity: sending ? 0.6 : 1, fontFamily: "inherit" }}>
          {sending ? "Sending…" : "Resend"}
        </button>
      )}
    </section>
  );
}
