import { useEffect, useId, useRef, useState } from "react";
import { apiPost } from "../apiClient.js";
import { apiErrorMessage } from "../lib/apiErrorMessage.js";
import { withoutStaleSignIn } from "../lib/withoutStaleSignIn.js";
import { C } from "../theme.js";
import { BUSINESS_TERMS_COPY, BUSINESS_TERMS_VERSION } from "./businessTerms.js";

// ─── Owner claim form ─────────────────────────────────────────────────────────
// A business owner whose business a scout registered sets their own password
// here — on the scout's phone (OwnerHandover) or from the emailed link
// (BusinessClaimPage). POST /api/accounts/business-owners/claim/. The
// password lives only in this component's state: it is cleared as soon as
// the claim succeeds, never passed up (onClaimed gets the server's reply,
// which carries no password or token), and the inputs are blanked when the
// form goes away.

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const labelStyle = { fontSize: "0.78rem", fontWeight: 800, color: C.darkBrown };
const hintStyle = { fontSize: "0.72rem", color: C.darkBrown, opacity: 0.72, lineHeight: 1.45 };
const inputStyle = {
  width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 12px", borderRadius: 10,
  border: `1.5px solid ${C.darkBrown}33`, background: C.white, color: C.darkBrown, fontSize: "1rem", fontFamily: "inherit",
};
const primaryStyle = {
  minHeight: 48, width: "100%", background: C.gold, color: C.darkBrown, border: "none", borderRadius: 24,
  padding: "12px 18px", fontWeight: 900, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit",
};
const toggleStyle = {
  alignSelf: "flex-start", minHeight: 44, background: "none", border: "none", padding: 0, color: C.darkBrown,
  textDecoration: "underline", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit",
};
const problemStyle = {
  background: `${C.kente1}12`, border: `1px solid ${C.kente1}`, color: C.darkBrown, borderRadius: 10,
  padding: "10px 12px", fontSize: "0.82rem", fontWeight: 700,
};

// What was registered for the owner, from the claim preview.
export function ClaimSummary({ preview }) {
  const rows = [
    ["Owner", preview.owner_name],
    ["Sign-in phone", preview.login_phone],
    ["Address", [preview.area, preview.gps_address].filter(Boolean).join(" · ")],
    ["Registered by", [preview.registered_by_name, when(preview.registered_at)].filter(Boolean).join(" · ")],
  ].filter(([, value]) => value);
  return (
    <section aria-label="Your business" style={{ background: C.white, border: `1px solid ${C.gold}55`, borderRadius: 16, padding: 16 }}>
      <div style={{ fontWeight: 900, fontSize: "1rem", color: C.darkBrown }}>{preview.business_name}</div>
      <dl style={{ margin: "8px 0 0", display: "grid", gridTemplateColumns: "minmax(96px, auto) 1fr", gap: "4px 12px", fontSize: "0.82rem" }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <dt style={{ color: C.darkBrown, opacity: 0.7 }}>{label}</dt>
            <dd style={{ margin: 0, color: C.darkBrown, fontWeight: 700, overflowWrap: "anywhere" }}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function OwnerClaimForm({ preview, token, onClaimed, submitLabel = "Save my login", handover = false }) {
  const passwordId = useId();
  const confirmId = useId();
  const emailId = useId();
  const hintId = useId();
  const [accept, setAccept] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const passwordRef = useRef(null);
  const confirmRef = useRef(null);

  // A shared phone: when the form goes away, blank the password inputs
  // themselves too (React state goes with the component).
  useEffect(() => {
    const fields = [passwordRef.current, confirmRef.current];
    return () => { for (const el of fields) if (el) el.value = ""; };
  }, []);

  const matches = password.length > 0 && password === confirm;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!accept) { setError("Accept the Business Agreement to continue."); return; }
    if (password.length < 8) { setError("Use at least 8 characters for your password."); return; }
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setSubmitting(true);
    const post = () => apiPost("/api/accounts/business-owners/claim/", {
      token, password, password_confirm: confirm, email: email.trim(), accept_terms: true,
    });
    try {
      // The emailed link is public; a hand-over must carry the scout's session.
      const result = handover ? await post() : await withoutStaleSignIn(post);
      setPassword("");
      setConfirm("");
      setShow(false);
      onClaimed?.(result);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save your login. Try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate style={{ display: "flex", flexDirection: "column", gap: 12, color: C.darkBrown }}>
      <div style={{ fontWeight: 900, fontSize: "1rem" }}>Set up your login</div>
      {preview?.login_phone && <div style={hintStyle}>You'll sign in with your phone number ending {preview.login_phone.slice(-3)} and the password you set here.</div>}
      <details style={{ background: C.white, borderRadius: 10, padding: "10px 12px", border: `1px solid ${C.darkBrown}1f` }}>
        <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: "0.8rem" }}>Read the AshantiHub Business Agreement</summary>
        <div style={{ whiteSpace: "pre-line", fontSize: "0.76rem", lineHeight: 1.6, marginTop: 8, maxHeight: 260, overflowY: "auto" }}>{BUSINESS_TERMS_COPY}</div>
      </details>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: "0.82rem", fontWeight: 700 }}>
        <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} style={{ width: 22, height: 22, flexShrink: 0, accentColor: C.gold }} />
        <span>I have read and accept the AshantiHub Business Agreement (version {BUSINESS_TERMS_VERSION}).</span>
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor={passwordId} style={labelStyle}>Set your password</label>
        <input id={passwordId} ref={passwordRef} type={show ? "text" : "password"} value={password}
          onChange={(e) => setPassword(e.target.value)} autoComplete={handover ? "off" : "new-password"} aria-describedby={hintId} style={inputStyle} />
        <div id={hintId} style={hintStyle}>At least 8 characters.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor={confirmId} style={labelStyle}>Type it again</label>
        <input id={confirmId} ref={confirmRef} type={show ? "text" : "password"} value={confirm}
          onChange={(e) => setConfirm(e.target.value)} autoComplete={handover ? "off" : "new-password"} style={inputStyle} />
        {confirm.length > 0 && (matches
          ? <div style={{ ...hintStyle, opacity: 1, color: C.kente2, fontWeight: 800 }}><span aria-hidden="true">✓ </span>Passwords match</div>
          : <div style={hintStyle}>Passwords don't match yet</div>)}
      </div>
      <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} style={toggleStyle}>{show ? "Hide password" : "Show password"}</button>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {/* The email on file (masked) may be one the scout typed: resets go there until the owner changes it. */}
        {preview?.email_on_file && <div style={hintStyle}>Password resets go to {preview.email_on_file}. If that isn't your email, enter yours below.</div>}
        <label htmlFor={emailId} style={labelStyle}>Email (optional)</label>
        <input id={emailId} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete={handover ? "off" : "email"} placeholder="For receipts and password resets" style={inputStyle} />
      </div>
      {error && <div role="alert" style={problemStyle}>{error}</div>}
      <button type="submit" disabled={submitting} style={{ ...primaryStyle, opacity: submitting ? 0.6 : 1 }}>{submitting ? "Saving…" : submitLabel}</button>
    </form>
  );
}
