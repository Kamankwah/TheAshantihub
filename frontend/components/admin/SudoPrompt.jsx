import { useEffect, useRef, useState } from "react";
import { apiPost, setSudoHandler } from "../../apiClient.js";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { button, field } from "./panels/panelStyles.js";
import { D } from "./theme.js";

// The password prompt for sensitive staff actions (F9: suspending staff,
// changing permissions or managers, exporting other people's reports, 2-step
// changes). Mounted once in the staff shell; apiClient calls it on a 403
// {code: "sudo_required"} and retries the request after a correct password.
// Requests that need it at the same time share one prompt. Cancelling (or
// leaving the shell) resolves false, so nothing is retried.
export default function SudoPrompt() {
  const pending = useRef(null);
  const returnFocus = useRef(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unregister = setSudoHandler(() => {
      if (!pending.current) {
        let resolve;
        const promise = new Promise((done) => { resolve = done; });
        pending.current = { promise, resolve };
        returnFocus.current = document.activeElement;
        setPassword("");
        setError(null);
        setOpen(true);
      }
      return pending.current.promise;
    });
    // Signing out (unmount) unregisters and cancels a prompt still open.
    return () => {
      unregister();
      pending.current?.resolve(false);
      pending.current = null;
    };
  }, []);

  const finish = (ok) => {
    const current = pending.current;
    pending.current = null;
    setOpen(false);
    setPassword("");
    current?.resolve(ok);
    // Put focus back where it was before the prompt opened.
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back && typeof back.focus === "function") setTimeout(() => back.focus(), 0);
  };

  const confirm = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/accounts/staff/reauth/", { password });
      setBusy(false);
      finish(true);
    } catch (err) {
      setBusy(false);
      setError(apiErrorMessage(err, "That password isn't right."));
    }
  };

  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(44,24,16,0.45)", zIndex: 4000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <form role="dialog" aria-modal="true" aria-labelledby="sudo-title" onSubmit={confirm}
        onKeyDown={(e) => { if (e.key === "Escape") finish(false); }}
        style={{ background: D.panelBg, borderRadius: 16, padding: 20, width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 12, boxShadow: D.shadow }}>
        <div id="sudo-title" style={{ color: D.text, fontWeight: 800, fontSize: "1rem" }}>Confirm it's you</div>
        <div style={{ color: D.textDim, fontSize: "0.8rem", lineHeight: 1.5 }}>Enter your password to carry on. It unlocks sensitive actions on this device for 10 minutes.</div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text }}>
          Password
          <input ref={(el) => el?.focus()} type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...field, resize: "none" }} />
        </label>
        {error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={() => finish(false)} style={button(D.panelBg, D.text)}>Cancel</button>
          <button type="submit" disabled={busy || !password} style={button(D.gold, D.text, busy || !password)}>Confirm</button>
        </div>
      </form>
    </div>
  );
}
