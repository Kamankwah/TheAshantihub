import { useEffect, useRef, useState } from "react";
import { apiPost, setStepUpHandler } from "../apiClient.js";
import { useSecurityOverview } from "../hooks/useOtpSecurity.js";
import { apiErrorMessage } from "../lib/apiErrorMessage.js";
import { bareCode } from "./admin/TwoFactorSetup.jsx";
import { button, codeField, linkButton } from "./admin/panels/panelStyles.js";
import { D } from "./dashboard/theme.js";

// The code dialog for sensitive actions (payout details, contact changes,
// authenticator changes, password changes, withdrawals). Mounted once in
// main.jsx; apiClient asks it on a 403 {code: "step_up_required", action} and
// retries the request once with the token it produces. Requests that need it
// at the same time share one prompt. Cancel, Escape or leaving the page
// resolves null, so the original refusal surfaces.
const ACTION_WORDS = {
  payout_destination: "Change where your money is paid",
  contact_change: "Add or change a phone number or email",
  authenticator_change: "Turn the authenticator app on or off",
  password_change: "Change your password",
  withdrawal: "Withdraw money",
  detail_change: "Ask to change your name, sign-in phone or email",
};
const OFF_TEXT = "Confirming changes with a code isn't switched on.";

const channelLabel = (c) => `${c.channel === "email" ? "Email to" : "Text to"} ${c.hint}`;
const otherWay = (channel) => (channel === "email" ? "text" : "email");
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export default function StepUpPrompt() {
  const pending = useRef(null);
  const returnFocus = useRef(null);
  const codeInput = useRef(null);
  const box = useRef(null);
  const run = useRef(0); // bumps on every open and close so late answers are ignored
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("");
  const [stage, setStage] = useState("loading"); // loading | choose | sending | code | expired | locked | failed | off
  const [channel, setChannel] = useState(null);
  const [hint, setHint] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const overview = useSecurityOverview(open);
  const channels = overview.data?.channels || [];

  useEffect(() => {
    const unregister = setStepUpHandler((requested) => {
      if (!pending.current) {
        let resolve;
        const promise = new Promise((done) => { resolve = done; });
        pending.current = { promise, resolve };
        returnFocus.current = document.activeElement;
        run.current += 1;
        setAction(requested || "");
        setStage("loading");
        setChannel(null);
        setHint("");
        setCode("");
        setError(null);
        setBusy(false);
        setResendAt(0);
        setOpen(true);
      }
      return pending.current.promise;
    });
    return () => {
      unregister();
      run.current += 1;
      pending.current?.resolve(null);
      pending.current = null;
    };
  }, []);

  const finish = (result) => {
    const current = pending.current;
    pending.current = null;
    run.current += 1;
    setOpen(false);
    setCode("");
    current?.resolve(result);
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back && back.isConnected && typeof back.focus === "function") setTimeout(() => back.focus(), 0);
  };

  // Send a code by the chosen way; the answer decides the next stage.
  const sendCode = async (way) => {
    const mine = run.current;
    setChannel(way);
    setStage("sending");
    setError(null);
    try {
      const sent = await apiPost("/api/otp/step-up/send/", { action, channel: way });
      if (run.current !== mine) return;
      const known = channels.find((c) => c.channel === way);
      setHint(known?.hint || sent?.hint || "");
      setResendAt(Date.now() + (sent?.resend_in || 0) * 1000);
      setNow(Date.now());
      setCode("");
      setStage("code");
    } catch (err) {
      if (run.current !== mine) return;
      const kind = err?.body?.code;
      if (err?.status === 409 && kind === "otp_off") { setStage("off"); return; }
      if (kind === "resend_cooldown") {
        const wait = Number(err.body.retry_after) || 0;
        setResendAt(Date.now() + wait * 1000);
        setNow(Date.now());
        setError(`Please wait ${wait} seconds before asking for another code.`);
        setStage("code");
        return;
      }
      setError(apiErrorMessage(err, "We couldn't send a code. Try again."));
      setStage(kind === "try_later" ? "locked" : "failed");
    }
  };

  // Decide the first stage once the person's ways of receiving a code are known.
  useEffect(() => {
    if (!open || stage !== "loading" || overview.isFetching) return;
    if (!overview.data) {
      setError("We couldn't check how to reach you. Close this and try again.");
      setStage("failed");
    } else if (channels.length === 0) {
      setError("There is no phone number or email on your account to send a code to. Contact AshantiHub Support.");
      setStage("failed");
    } else if (channels.length === 1) {
      sendCode(channels[0].channel);
    } else {
      setStage("choose");
    }
    // sendCode closes over the current action and channels, which are set before this runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage, overview.isFetching, overview.isError, overview.data]);

  // Countdown from Date.now() deltas; the interval lives only on the code stage.
  useEffect(() => {
    if (!open || stage !== "code") return undefined;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [open, stage]);

  // Move focus to the code field when it appears; otherwise to the first control.
  useEffect(() => {
    if (!open) return;
    if (stage === "code") codeInput.current?.focus();
    else box.current?.querySelector("button")?.focus();
  }, [open, stage]);

  const verify = async (e) => {
    e.preventDefault();
    const typed = bareCode(code);
    if (busy || typed.length < 6) return;
    const mine = run.current;
    setBusy(true);
    setError(null);
    setCode("");
    try {
      const done = await apiPost("/api/otp/step-up/verify/", { action, code: typed });
      if (run.current !== mine) return;
      setBusy(false);
      finish({ token: done.step_up_token, expiresIn: done.expires_in });
    } catch (err) {
      if (run.current !== mine) return;
      setBusy(false);
      const kind = err?.body?.code;
      if (err?.status === 409 && kind === "otp_off") { setStage("off"); return; }
      setError(apiErrorMessage(err, "That code didn't work. Try again."));
      if (kind === "code_expired") setStage("expired");
      else if (kind === "try_later") setStage("locked");
      else if (kind !== "wrong_code") setStage("failed");
      else codeInput.current?.focus();
    }
  };

  if (!open) return null;
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const other = channels.find((c) => c.channel !== channel);
  const cancel = <button type="button" onClick={() => finish(null)} style={button(D.panelBg, D.text)}>{stage === "off" ? "Close" : "Cancel"}</button>;
  const errorLine = error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem", lineHeight: 1.5 }}>{error}</div>;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(44,24,16,0.45)", zIndex: 4000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <form ref={box} role="dialog" aria-modal="true" aria-labelledby="stepup-title" onSubmit={verify}
        onKeyDown={(e) => { if (e.key === "Escape") finish(null); }}
        style={{ background: D.panelBg, borderRadius: 16, padding: 20, width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 12, boxShadow: D.shadow }}>
        <div id="stepup-title" style={{ color: D.text, fontWeight: 800, fontSize: "1rem" }}>{ACTION_WORDS[action] || "Confirm it's you"}</div>

        {(stage === "loading" || stage === "sending") && (
          <>
            <div role="status" style={{ color: D.textDim, fontSize: "0.8rem" }}>{stage === "sending" ? "Sending your code..." : "One moment..."}</div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>{cancel}</div>
          </>
        )}

        {stage === "choose" && (
          <>
            <div style={{ color: D.textDim, fontSize: "0.8rem", lineHeight: 1.5 }}>Choose where to send your code.</div>
            {channels.map((c) => (
              <button key={c.channel} type="button" onClick={() => sendCode(c.channel)} style={{ ...button(D.panelBg, D.text), textAlign: "left" }}>{channelLabel(c)}</button>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>{cancel}</div>
          </>
        )}

        {stage === "code" && (
          <>
            <div role="status" style={{ color: D.textDim, fontSize: "0.8rem", lineHeight: 1.5 }}>
              {hint ? `We sent a code to ${hint}.` : "We sent you a code."} Enter it to carry on.
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text }}>
              Your 6-digit code
              <input ref={codeInput} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} style={codeField} />
            </label>
            {errorLine}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button type="button" disabled={remaining > 0} onClick={() => sendCode(channel)} style={{ ...linkButton, opacity: remaining > 0 ? 0.6 : 1, cursor: remaining > 0 ? "not-allowed" : "pointer" }}>
                Send a new code{remaining > 0 && <span style={{ fontVariantNumeric: "tabular-nums" }}> in {clock(remaining)}</span>}
              </button>
              {other && (
                <button type="button" onClick={() => sendCode(other.channel)} style={linkButton}>Send by {otherWay(channel)} instead</button>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {cancel}
              <button type="submit" disabled={busy || bareCode(code).length < 6} style={button(D.gold, D.text, busy || bareCode(code).length < 6)}>Confirm</button>
            </div>
          </>
        )}

        {stage === "expired" && (
          <>
            {errorLine}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {cancel}
              <button type="button" onClick={() => sendCode(channel)} style={button(D.gold, D.text)}>Send a new code</button>
            </div>
          </>
        )}

        {stage === "locked" && (
          <>
            {errorLine}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>{cancel}</div>
          </>
        )}

        {stage === "failed" && (
          <>
            {errorLine}
            {other && channel && <button type="button" onClick={() => sendCode(other.channel)} style={{ ...button(D.panelBg, D.text), textAlign: "left" }}>{channelLabel(other)}</button>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {cancel}
              {channel && <button type="button" onClick={() => sendCode(channel)} style={button(D.gold, D.text)}>Try again</button>}
            </div>
          </>
        )}

        {stage === "off" && (
          <>
            <div role="status" style={{ color: D.textDim, fontSize: "0.8rem", lineHeight: 1.5 }}>{OFF_TEXT}</div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>{cancel}</div>
          </>
        )}
      </form>
    </div>
  );
}
