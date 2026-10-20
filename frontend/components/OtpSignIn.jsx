import { useEffect, useRef, useState } from "react";
import { apiErrorMessage } from "../lib/apiErrorMessage.js";
import { isOtpChallenge, otpCode } from "../lib/otp.js";
import { bareCode } from "./admin/TwoFactorSetup.jsx";
import { button, codeField, field, linkButton } from "./admin/panels/panelStyles.js";
import { D } from "./dashboard/theme.js";

const title = { color: D.text, fontWeight: 800, fontSize: "0.95rem" };
const text = { color: D.text, fontSize: "0.8rem", lineHeight: 1.5 };
const labelStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text };
const primary = (disabled) => ({ ...button(D.gold, D.text, disabled), borderRadius: 20, padding: "12px", fontWeight: 900, fontSize: "0.85rem" });

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const wayName = (channel) => (channel === "email" ? "email" : "text");
// The server's hint reads "Text a code to 0•• ••• 1234"; once the code is sent
// it reads as past tense. Anything unexpected falls back to a plain line.
const sentLine = (hint) => {
  const m = /^(?:Text|Email) a code to (.+)$/.exec(hint || "");
  return m ? `We sent a code to ${m[1]}.` : "We sent you a code.";
};

// The code step of a customer / business-owner sign-in or sign-up, shown by
// AuthModal and BusinessRegistrationFlow when the password (or registration)
// step answers with a challenge instead of a token:
//   otp_required        -> choose where to send the code, then type it
//   two_factor_required -> the authenticator app code, or a recovery code
// Nothing is stored here: only the final verify (in useAuth) stores a session.
export default function OtpSignIn({ challenge, accountType, purpose, auth, onSuccess, onCancel }) {
  const channels = challenge.channels || [];
  const [stage, setStage] = useState(challenge.two_factor_required ? "auth" : "choose"); // choose | code | auth
  const [ticket, setTicket] = useState(challenge.mfa_token);
  const [channel, setChannel] = useState(null);
  const [hint, setHint] = useState("");
  const [value, setValue] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState(null);
  const [locked, setLocked] = useState(false);
  const [suggestOther, setSuggestOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const codeInput = useRef(null);
  const firstChannel = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // The countdown reads Date.now() deltas, so a backgrounded tab catches up.
  useEffect(() => {
    if (stage !== "code") return undefined;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [stage]);

  // Focus the code field when a code stage appears, the first way to receive
  // a code on the choose stage.
  useEffect(() => {
    if (stage === "choose") firstChannel.current?.focus();
    else codeInput.current?.focus();
  }, [stage, useRecovery]);

  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const other = channels.find((c) => c.channel !== channel);
  const isCustomer = accountType === "customer";
  const supportNote = " Ask AshantiHub Support to help you sign in.";

  const startCountdown = (seconds) => {
    setNow(Date.now());
    setResendAt(Date.now() + (Number(seconds) || 0) * 1000);
  };

  const send = async (way) => {
    if (busy || locked) return;
    setBusy(true);
    setError(null);
    setSuggestOther(false);
    try {
      const sent = await auth.sendOtpCode(ticket, way);
      if (!alive.current) return;
      setChannel(way);
      setHint(sent?.hint || channels.find((c) => c.channel === way)?.hint || "");
      startCountdown(sent?.resend_in);
      setValue("");
      setStage("code");
    } catch (err) {
      if (!alive.current) return;
      const kind = otpCode(err);
      if (kind === "challenge_expired") { onCancel(apiErrorMessage(err, "Your sign-in timed out. Enter your password again.")); return; }
      if (kind === "resend_cooldown") {
        // A code was just sent: show the code field and wait out the cooldown.
        const wait = Number(err.body.retry_after) || 0;
        // Nothing was sent on `way`: adopt it only on the first send; a switch keeps the channel the code really went by.
        if (!channel) {
          setChannel(way);
          setHint(channels.find((c) => c.channel === way)?.hint || "");
        }
        startCountdown(wait);
        setError(apiErrorMessage(err, `Please wait ${wait} seconds before asking for another code.`));
        setStage("code");
      } else if (kind === "try_later") {
        setLocked(true);
        setError(apiErrorMessage(err, "Too many tries. Try again later."));
      } else {
        // channel_unavailable, send_failed and anything else: point at the other way.
        setSuggestOther(Boolean(channels.find((c) => c.channel !== way)));
        setError(apiErrorMessage(err, "We couldn't send a code. Try again."));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const typed = bareCode(value);
    if (busy || locked || !typed) return;
    setBusy(true);
    setError(null);
    setValue("");
    try {
      const result = await auth.verifyOtp(ticket, {
        ...(useRecovery ? { recoveryCode: typed } : { code: typed }),
        trustDevice: isCustomer && trust,
        registration: purpose === "sign_up" ? accountType : undefined,
      });
      if (!alive.current) return;
      if (isOtpChallenge(result)) {
        // Correct sign-up code, but an authenticator is still owed: new ticket, same trust choice.
        setTicket(result.mfa_token);
        setUseRecovery(false);
        setStage("auth");
        setBusy(false);
        return;
      }
      onSuccess(result);
    } catch (err) {
      if (!alive.current) return;
      const kind = otpCode(err);
      if (kind === "challenge_expired") { onCancel(apiErrorMessage(err, "Your sign-in timed out. Enter your password again.")); return; }
      if (kind === "code_expired") {
        setResendAt(0);
        setError(apiErrorMessage(err, "That code has expired. Send a new one."));
      } else if (kind === "try_later") {
        setLocked(true);
        setError(apiErrorMessage(err, "Too many tries. Try again later."));
      } else if (kind === "authenticator_unreadable") {
        setError(`${apiErrorMessage(err, "We couldn't read your authenticator app setup.")}${supportNote}`);
      } else {
        setError(apiErrorMessage(err, "That code isn't right."));
      }
      setBusy(false);
      codeInput.current?.focus();
    }
  };

  const errorLine = error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem", lineHeight: 1.5 }}>{error}</div>;
  const startAgain = <button type="button" disabled={busy} onClick={() => onCancel()} style={linkButton}>Start again</button>;

  if (stage === "choose") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={title}>{purpose === "sign_up" ? "Confirm it's you" : "Check it's you"}</div>
        <div style={text}>We will send a 6-digit code. Choose where to send it.</div>
        {channels.map((c, i) => (
          <button key={c.channel} ref={i === 0 ? firstChannel : undefined} type="button" disabled={busy || locked} onClick={() => send(c.channel)} style={{ ...button(D.panelBg, D.text, busy || locked), textAlign: "left", padding: "12px" }}>{c.hint}</button>
        ))}
        {errorLine}
        {startAgain}
      </div>
    );
  }

  const authStage = stage === "auth";
  const blocked = busy || locked || !bareCode(value);
  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={title}>{authStage ? "2-step sign-in" : "Enter your code"}</div>
      {authStage ? (
        <div role="status" style={text}>{useRecovery ? "Type one of your recovery codes. Each one works once." : "Open your authenticator app and type the 6-digit code for AshantiHub."}</div>
      ) : (
        <div role="status" style={text}>{sentLine(hint)}</div>
      )}
      <label style={labelStyle}>
        {useRecovery ? "Recovery code" : "6-digit code"}
        <input ref={codeInput} value={value} onChange={(e) => setValue(e.target.value)} inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" maxLength={useRecovery ? 16 : 7} style={useRecovery ? { ...field, resize: "none", padding: "10px 12px", fontSize: "0.9rem" } : { ...codeField, padding: "10px 12px" }} />
      </label>
      {isCustomer && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.78rem", color: D.text, lineHeight: 1.4 }}>
          <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} style={{ marginTop: 2 }} />
          Trust this device. It will skip the code for a while.
        </label>
      )}
      {errorLine}
      <button type="submit" disabled={blocked} style={primary(blocked)}>
        {busy ? "Checking…" : purpose === "sign_up" && !authStage ? "Confirm" : "Sign in"}
      </button>
      {authStage ? (
        <button type="button" disabled={busy} onClick={() => { setUseRecovery(!useRecovery); setValue(""); setError(null); }} style={linkButton}>
          {useRecovery ? "Use the authenticator app instead" : "Lost your phone? Use a recovery code"}
        </button>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button type="button" disabled={busy || locked || remaining > 0} onClick={() => send(channel)} style={{ ...linkButton, opacity: busy || locked || remaining > 0 ? 0.6 : 1, cursor: busy || locked || remaining > 0 ? "not-allowed" : "pointer" }}>
            Send a new code{remaining > 0 && <span style={{ fontVariantNumeric: "tabular-nums" }}> in {clock(remaining)}</span>}
          </button>
          {other && (
            <button type="button" data-suggested={suggestOther ? "true" : undefined} disabled={busy || locked} onClick={() => send(other.channel)} style={suggestOther ? { ...button(D.gold, D.text, busy || locked), borderRadius: 20 } : linkButton}>
              Send by {wayName(other.channel)} instead
            </button>
          )}
        </div>
      )}
      {startAgain}
    </form>
  );
}
