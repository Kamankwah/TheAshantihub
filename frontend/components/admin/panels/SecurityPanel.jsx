import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useMySessions } from "../../../hooks/useStaffSessions.js";
import { useTwoFactorStatus } from "../../../hooks/useTwoFactorStatus.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { RecoveryCodes, TwoFactorSetup } from "../TwoFactorSetup.jsx";
import { D, glassCard } from "../theme.js";
import { button, chip, dim } from "./panelStyles.js";
import { SignInHistory, when } from "./sessionParts.jsx";

const heading = { color: D.text, fontWeight: 800, fontSize: "0.95rem", margin: 0 };
const at = when;
const KEYS = [["my-sessions"], ["active-sessions"], ["two-factor"]];

// Sign-in & Security (F9) for every staffer: their own sessions and their
// 2-step sign-in. Sensitive steps ask for the password through SudoPrompt.
export default function SecurityPanel() {
  const queryClient = useQueryClient();
  const { data: sessions, isLoading, isError } = useMySessions();
  const { data: twoFactor, isLoading: twoFactorLoading, isError: twoFactorError } = useTwoFactorStatus();
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  // One action at a time; the lists are refreshed whether it worked or was
  // refused, so the screen never keeps showing a stale state.
  const run = async (fn, okText, failText) => {
    if (busy) return;
    setMessage(null);
    setActionError(null);
    setBusy(true);
    try {
      await fn();
      if (okText) setMessage(okText);
    } catch (err) {
      setActionError(apiErrorMessage(err, failText));
    } finally {
      setBusy(false);
      KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    }
  };
  const startSetup = () => run(async () => setSetup(await apiPost("/api/accounts/staff/two-factor/setup/", {})), null, "Could not start setting up 2-step sign-in.");
  const confirmSetup = (code) => run(async () => {
    const result = await apiPost("/api/accounts/staff/two-factor/setup/confirm/", { code });
    setSetup(null);
    setCodes(result.recovery_codes);
  }, null, "That code isn't right. Check the app shows AshantiHub and try again.");

  const active = (sessions || []).filter((s) => s.is_active);
  const others = active.filter((s) => !s.is_current);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section aria-labelledby="sessions-heading" style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 id="sessions-heading" style={heading}>Your sessions</h2>
        <div style={dim}>A session ends after 30 minutes without activity, and after 12 hours at the latest.</div>
        {isLoading && <div role="status" style={dim}>Loading…</div>}
        {isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your sessions.</div>}
        {active.map((s) => (
          <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${D.divider}`, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {s.device_label}{s.is_current && <span style={chip(D.green)}>This device</span>}{s.two_factor && <span style={chip(D.blue)}>2-step</span>}
              </div>
              <div style={dim}>Signed in {at(s.created_at)} · last active {at(s.last_seen_at)}{s.ip ? ` · ${s.ip}` : ""} · ends by {at(s.ends_at)}</div>
            </div>
            {!s.is_current && (
              <button type="button" aria-label={`End the session on ${s.device_label}`} disabled={busy}
                onClick={() => run(() => apiPost(`/api/accounts/staff/sessions/${s.id}/end/`, {}), "Session ended.", "Could not end that session.")}
                style={button(D.panelBg, D.red, busy)}>End session</button>
            )}
          </div>
        ))}
        {others.length > 0 && (
          <button type="button" disabled={busy} onClick={() => run(() => apiPost("/api/accounts/staff/sessions/end-others/", {}), "Signed out of your other devices.", "Could not sign out your other devices.")} style={{ ...button(D.panelBg, D.text, busy), alignSelf: "flex-start" }}>Sign out other devices</button>
        )}
        {!isLoading && !isError && others.length === 0 && <div style={dim}>No other devices are signed in.</div>}
      </section>

      <section aria-labelledby="recent-heading" style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 id="recent-heading" style={heading}>Recent sign-ins</h2>
        <div style={dim}>Your most recent sign-ins (up to 50), including ones that have ended. If one isn't yours, change your password.</div>
        {!isLoading && !isError && <SignInHistory sessions={sessions} label="Recent sign-ins" />}
      </section>

      <section aria-labelledby="two-step-heading" style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 id="two-step-heading" style={heading}>2-step sign-in</h2>
        {codes ? (
          <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
        ) : setup ? (
          <>
            <TwoFactorSetup secret={setup.secret} otpauthUri={setup.otpauth_uri} onConfirm={confirmSetup} busy={busy} error={actionError} />
            <button type="button" disabled={busy} onClick={() => { setSetup(null); setActionError(null); }} style={{ ...button(D.panelBg, D.text, busy), alignSelf: "flex-start" }}>Cancel</button>
          </>
        ) : twoFactorLoading ? (
          <div role="status" style={dim}>Loading…</div>
        ) : twoFactorError ? (
          <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your 2-step sign-in status.</div>
        ) : twoFactor?.enabled ? (
          <>
            <div style={{ color: D.text, fontSize: "0.82rem" }}>On{twoFactor.enabled_at ? ` since ${new Date(twoFactor.enabled_at).toLocaleDateString("en-GH")}` : ""}. Recovery codes left: {twoFactor.recovery_codes_left} of 10.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" disabled={busy} onClick={startSetup} style={button(D.panelBg, D.text, busy)}>Move to a new phone</button>
              <button type="button" disabled={busy} onClick={() => run(async () => setCodes((await apiPost("/api/accounts/staff/two-factor/recovery-codes/", {})).recovery_codes), null, "Could not make new codes.")} style={button(D.panelBg, D.text, busy)}>Make new recovery codes</button>
              {!twoFactor.required && <button type="button" disabled={busy} onClick={() => run(() => apiPost("/api/accounts/staff/two-factor/disable/", {}), "2-step sign-in is off.", "Could not turn it off.")} style={button(D.panelBg, D.red, busy)}>Turn off</button>}
            </div>
            {twoFactor.required && <div style={dim}>2-step sign-in can't be turned off for a Super Admin.</div>}
            <div style={dim}>Making new codes cancels the old ones.</div>
          </>
        ) : (
          <>
            <div style={{ color: D.text, fontSize: "0.82rem" }}>Off. With 2-step sign-in, signing in also asks for a 6-digit code from an app on your phone, so a stolen password isn't enough.</div>
            <button type="button" disabled={busy} onClick={startSetup} style={{ ...button(D.gold, D.text, busy), alignSelf: "flex-start" }}>Set up 2-step sign-in</button>
          </>
        )}
        {message && <div role="status" style={{ color: D.text, fontSize: "0.8rem" }}>{message}</div>}
        {actionError && !setup && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      </section>
    </div>
  );
}
