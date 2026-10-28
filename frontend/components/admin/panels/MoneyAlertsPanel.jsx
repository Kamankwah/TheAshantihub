import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useMoneyAlerts } from "../../../hooks/useInsights.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, chip, dim, field } from "./panelStyles.js";
import { errorStyle } from "./portfolioParts.jsx";
import { Status, Title, page, section, sectionTitle } from "./insightsParts.jsx";

// ─── Accounting 26 Alerts ────────────────────────────────────────────────────
// Alerts are worked out when the screen loads, from refunds and fraud cases. A
// rule that needs a ledger, payout or reconciliation record is listed as "not
// available yet" rather than drawn as an alert. Resolving takes a note and is
// written to the staff activity log; fraud cases are decided under Fraud cases.
const when = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Alert({ alert, onResolved }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resolve = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/insights/money-alerts/", { key: alert.key, note: note.trim() });
      queryClient.invalidateQueries({ queryKey: ["insights", "money-alerts"] });
      setOpen(false);
      onResolved?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not resolve this alert."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li style={{ listStyle: "none", padding: "10px 0", borderBottom: `1px solid ${D.divider}`, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ color: D.text, fontSize: "0.85rem" }}>{alert.title}</strong>
        <span style={chip(alert.resolved ? D.green : alert.resolvable ? D.amber : D.textFaint)}>{alert.resolved ? "Resolved" : alert.resolvable ? "Needs review" : "For information"}</span>
      </div>
      <span style={dim}>{alert.detail} · {when(alert.at)}</span>
      {alert.resolved && <span style={dim}>Resolved by {alert.resolved.by}, {when(alert.resolved.at)}: {alert.resolved.note}</span>}
      {!alert.resolved && alert.resolvable && !open && <button type="button" onClick={() => setOpen(true)} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Resolve with a note</button>}
      {open && (
        <form onSubmit={resolve} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input aria-label={`Note for ${alert.title}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked (required)" maxLength={280} style={{ ...field, flex: 1, minWidth: 220 }} />
          <button type="submit" disabled={note.trim().length < 5 || busy} style={button(D.text, D.pageBg, note.trim().length < 5 || busy)}>Resolve</button>
          <button type="button" onClick={() => setOpen(false)} style={button(D.panelBg, D.text)}>Cancel</button>
        </form>
      )}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
    </li>
  );
}

export default function MoneyAlertsPanel() {
  const { data, isLoading, isError } = useMoneyAlerts();
  return (
    <div style={page}>
      <Title>Alerts</Title>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <section aria-labelledby="ma-list" style={section}>
              <h3 id="ma-list" style={sectionTitle}>Alerts ({data.open} need review)</h3>
              {data.alerts.length === 0
                ? <span style={dim}>No alert is raised by the rules that can run today.</span>
                : <ul style={{ margin: 0, padding: 0 }}>{data.alerts.map((a) => <Alert key={a.key} alert={a} />)}</ul>}
            </section>
            <section aria-labelledby="ma-rules" style={section}>
              <h3 id="ma-rules" style={sectionTitle}>Rules</h3>
              <span style={dim}>Only rules with records behind them can run. The others are listed so nothing looks watched that is not.</span>
              <ul style={{ margin: 0, padding: 0 }}>
                {data.rules.map((r) => (
                  <li key={r.key} style={{ listStyle: "none", padding: "8px 0", borderBottom: `1px solid ${D.divider}`, display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <strong style={{ color: D.text, fontSize: "0.82rem" }}>{r.name}</strong>
                      <span style={chip(r.live ? D.green : D.textFaint)}>{r.live ? "Running" : "Not available yet"}</span>
                    </div>
                    <span style={dim}>{r.what}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </Status>
    </div>
  );
}
