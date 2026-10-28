import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, dim } from "./panelStyles.js";
import { confirmationLine } from "./confirmationLine.js";
import { errorStyle } from "./portfolioParts.jsx";

// "Ask the owner to confirm again": a fresh texted link for the business registration when the last one lapsed, did
// not go out (failed, simulated, no number) or was declined. Shown only when the server says it would accept it
// (`confirmation.can_ask_again`), so a live, delivered link is never offered for replacement. The result line comes from
// the server's masked state; no token, link or whole number ever reaches this screen.
const WHY = {
  lapsed: "The owner's link has expired.",
  declined: "The owner declined the registration.",
  not_sent: "The owner's text has not gone out.",
};

export default function AskOwnerAgain({ businessId, confirmation, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  if (!confirmation?.can_ask_again && !result) return null;

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(confirmationLine(await apiPost(`/api/portfolio/businesses/${businessId}/confirmation/registration/`, {})));
      await onDone?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not ask the owner again. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {WHY[confirmation?.state] && !result && <div style={dim}>{`${WHY[confirmation.state]} Until the owner confirms, KYC cannot be approved.`}</div>}
      {confirmation?.can_ask_again && (
        <button type="button" disabled={busy} onClick={ask} style={{ ...button(D.panelBg, D.text, busy), minHeight: 44, alignSelf: "flex-start" }}>
          {busy ? "Asking…" : "Ask the owner to confirm again"}
        </button>
      )}
      {result && <div role="status" style={callout(D.green)}>{result}</div>}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
    </div>
  );
}
