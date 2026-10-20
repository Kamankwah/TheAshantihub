import { useState } from "react";
import { apiPost } from "../../apiClient.js";
import { useAuthenticatorStatus } from "../../hooks/useOtpSecurity.js";
import { D } from "../dashboard/theme.js";
import { button } from "../admin/panels/panelStyles.js";
import { RecoveryCodes, TwoFactorSetup } from "../admin/TwoFactorSetup.jsx";

const dim = { color: D.textDim, fontSize: "0.74rem", lineHeight: 1.5 };
// A cancelled step-up prompt rejects with the original 403: nothing new to show.
const cancelled = (err) => err?.status === 403 && err?.body?.code === "step_up_required";

// App-based 2-step sign-in. Secrets (setup key, QR link, recovery codes) live
// in this component's state only and are dropped on Done or unmount.
export default function AuthenticatorSettings() {
  const { data: status, isLoading, isError, refetch } = useAuthenticatorStatus();
  const [setup, setSetup] = useState(null); // { secret, otpauth_uri }
  const [codes, setCodes] = useState(null); // string[] shown once
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const attempt = async (work, fallback) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await work();
    } catch (err) {
      if (!cancelled(err)) setError(err?.body?.detail || fallback);
    } finally {
      setBusy(false);
    }
  };

  const start = () => attempt(async () => setSetup(await apiPost("/api/otp/authenticator/setup/", {})), "Could not start setup. Please try again.");
  const confirm = (code) => attempt(async () => {
    const answer = await apiPost("/api/otp/authenticator/setup/confirm/", { code });
    setSetup(null);
    setCodes(answer.recovery_codes);
  }, "Could not confirm the code. Please try again.");
  const newCodes = () => attempt(async () => {
    const answer = await apiPost("/api/otp/authenticator/recovery-codes/", {});
    setCodes(answer.recovery_codes);
  }, "Could not make new recovery codes. Please try again.");
  const turnOff = () => attempt(async () => {
    await apiPost("/api/otp/authenticator/disable/", {});
    setConfirmOff(false);
    setNotice("The authenticator app is off.");
    await refetch();
  }, "Could not turn it off. Please try again.");
  const done = async () => {
    setCodes(null);
    setNotice(null);
    await refetch();
  };

  let body;
  if (codes) {
    body = <RecoveryCodes codes={codes} onDone={done} />;
  } else if (setup) {
    body = <TwoFactorSetup secret={setup.secret} otpauthUri={setup.otpauth_uri} onConfirm={confirm} busy={busy} error={error} />;
  } else if (isLoading) {
    body = <div style={dim}>Loading…</div>;
  } else if (isError || !status) {
    body = <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>Could not load the authenticator app settings.</div>;
  } else if (status.enabled) {
    body = (
      <>
        <div style={{ color: D.text, fontSize: "0.78rem" }}>
          On{status.enabled_at ? ` since ${new Date(status.enabled_at).toLocaleString("en-GH")}` : ""}. <span style={{ fontVariantNumeric: "tabular-nums" }}>{status.recovery_codes_left}</span> recovery codes left.
        </div>
        <div style={dim}>Turning it on or off asks for a code first.</div>
        {!confirmOff ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={busy} onClick={newCodes} style={button(D.panelBg, D.text, busy)}>New recovery codes</button>
            <button type="button" onClick={() => setConfirmOff(true)} style={button(D.panelBg, D.text)}>Turn off</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", color: D.text, fontSize: "0.78rem" }}>
            <span>Are you sure?</span>
            <button type="button" disabled={busy} onClick={turnOff} style={button(D.red, D.cream, busy)}>Yes, turn off</button>
            <button type="button" onClick={() => setConfirmOff(false)} style={button(D.panelBg, D.text)}>Cancel</button>
          </div>
        )}
      </>
    );
  } else if (status.available) {
    body = (
      <>
        <div style={dim}>Use an authenticator app for a second step when you sign in. Turning it on or off asks for a code first.</div>
        <button type="button" disabled={busy} onClick={start} style={{ ...button(D.gold, D.text, busy), alignSelf: "flex-start" }}>Set up</button>
      </>
    );
  } else {
    body = <div style={dim}>The authenticator app isn't available for this account yet.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontWeight: 800, color: D.text, fontSize: "0.8rem" }}>Authenticator app</div>
      {body}
      {notice && <div role="status" style={{ color: D.text, fontSize: "0.78rem" }}>{notice}</div>}
      {error && !setup && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{error}</div>}
    </div>
  );
}
