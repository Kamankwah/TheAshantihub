import { useEffect, useState } from "react";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { button, codeField, field, linkButton } from "./panels/panelStyles.js";
import { RecoveryCodes, TwoFactorSetup, bareCode } from "./TwoFactorSetup.jsx";
import { D } from "./theme.js";

const title = { color: D.text, fontWeight: 800, fontSize: "0.95rem" };
const text = { color: D.text, fontSize: "0.8rem", lineHeight: 1.5 };
const primary = (disabled) => ({ ...button(D.gold, D.text, disabled), borderRadius: 20, padding: "12px", fontWeight: 900, fontSize: "0.85rem" });

// The second step of a staff sign-in (F9), shown by AuthModal (and the
// invite-activation page) when the password step answers with a challenge
// instead of a token:
//   two_factor_required        → the 6-digit code, or a recovery code
//   two_factor_setup_required  → a Super Admin without 2-step sets it up now
export default function StaffTwoStepSignIn({ challenge, auth, onSuccess, onCancel }) {
  if (challenge.two_factor_setup_required) return <Enrol challenge={challenge} auth={auth} onSuccess={onSuccess} onCancel={onCancel} />;
  return <Verify challenge={challenge} auth={auth} onSuccess={onSuccess} onCancel={onCancel} />;
}

function Verify({ challenge, auth, onSuccess, onCancel }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const bare = bareCode(value);
    setBusy(true);
    setError(null);
    try {
      const result = await auth.verifyTwoFactor(challenge.mfa_token, useRecovery ? { recoveryCode: bare } : { code: bare });
      onSuccess(result);
    } catch (err) {
      setError(apiErrorMessage(err, "That code isn't right."));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={title}>2-step sign-in</div>
      <div style={text}>{useRecovery ? "Type one of your recovery codes. Each one works once." : "Open your authenticator app and type the 6-digit code for AshantiHub."}</div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text }}>
        {useRecovery ? "Recovery code" : "6-digit code"}
        <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" maxLength={useRecovery ? 16 : 7} style={useRecovery ? { ...field, resize: "none", padding: "10px 12px", fontSize: "0.9rem" } : { ...codeField, padding: "10px 12px" }} />
      </label>
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{error}</div>}
      <button type="submit" disabled={busy || !bareCode(value)} style={primary(busy || !bareCode(value))}>{busy ? "Checking…" : "Sign in"}</button>
      <button type="button" disabled={busy} onClick={() => { setUseRecovery(!useRecovery); setValue(""); setError(null); }} style={linkButton}>
        {useRecovery ? "Use the authenticator app instead" : "Lost your phone? Use a recovery code"}
      </button>
      <button type="button" onClick={onCancel} style={linkButton}>Start again</button>
    </form>
  );
}

function Enrol({ challenge, auth, onSuccess, onCancel }) {
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [login, setLogin] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    let live = true;
    auth.startTwoFactorEnrolment(challenge.mfa_token)
      .then((data) => { if (live) setSetup(data); })
      .catch((err) => { if (live) setError(apiErrorMessage(err, "Could not start setting up 2-step sign-in.")); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge.mfa_token]);

  const confirm = async (code) => {
    setBusy(true);
    setError(null);
    try {
      const result = await auth.confirmTwoFactorEnrolment(challenge.mfa_token, code);
      setCodes(result.recoveryCodes);
      setLogin(result.login);
    } catch (err) {
      setError(apiErrorMessage(err, "That code isn't right."));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      onSuccess(await auth.completeSignIn(login));
    } catch (err) {
      setError(apiErrorMessage(err, "Could not finish signing in."));
      setFinishing(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={title}>Set up 2-step sign-in</div>
      {!codes && <div style={text}>Super Admins must use 2-step sign-in. It takes a minute; after that, each sign-in also asks for a code from your phone.</div>}
      {codes ? (
        <>
          <RecoveryCodes codes={codes} doneLabel={finishing ? "Signing in…" : "Continue to the dashboard"} onDone={finish} />
          {error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{error}</div>}
        </>
      ) : setup ? (
        <TwoFactorSetup secret={setup.secret} otpauthUri={setup.otpauth_uri} onConfirm={confirm} busy={busy} error={error} />
      ) : error ? (
        <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{error}</div>
      ) : (
        <div role="status" style={text}>Preparing…</div>
      )}
      {!codes && <button type="button" onClick={onCancel} style={linkButton}>Start again</button>}
    </div>
  );
}
