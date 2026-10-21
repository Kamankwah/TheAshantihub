import { useQueryClient } from "@tanstack/react-query";
import { useWalletReconciliation } from "../../../hooks/useWalletReconciliation.js";
import { walletMessage } from "../../wallet/walletErrors.js";
import { formatGhs } from "../../wallet/walletMoney.js";
import { walletStyles } from "../../wallet/walletStyles.js";
import { D, glassCard } from "../theme.js";
import { button, chip, dim } from "./panelStyles.js";
import { Title, page } from "./insightsParts.jsx";

// ─── Wallet reconciliation (staff, read-only) ────────────────────────────────
// The last 30 daily runs, newest first: what the ledger holds against what the
// provider's statement shows. statement_source is always printed so a simulated
// source is never mistaken for a bank statement; checks that could not run are
// listed as "Not checked", never hidden; differences are shown as the server
// sent them. While the ledger is off, `fallback` (the older stub) renders.
// useWalletReconciliation is NOT paginated: {results}.
const amount = { fontVariantNumeric: "tabular-nums", color: D.price, fontWeight: 700, whiteSpace: "nowrap" };
const has = (v) => v !== undefined && v !== null && v !== "";

function Pair({ label, ledger, statement }) {
  return (
    <div>
      <div style={{ ...dim, fontSize: "0.7rem" }}>{label}</div>
      <div style={amount}>Ledger {has(ledger) ? formatGhs(ledger) : "—"}</div>
      <div style={amount}>Statement {has(statement) ? formatGhs(statement) : "—"}</div>
    </div>
  );
}

const show = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : String(v));

function Differences({ value }) {
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i + 1), v]) : value && typeof value === "object" ? Object.entries(value) : [];
  if (!entries.length) return null;
  return (
    <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px", fontSize: "0.78rem" }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt style={{ color: D.textDim, fontWeight: 700 }}>{k}</dt>
          <dd style={{ margin: 0, color: D.text, fontVariantNumeric: "tabular-nums" }}>{show(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Run({ run }) {
  return (
    <li style={{ listStyle: "none", padding: "12px 0", borderBottom: `1px solid ${D.divider}`, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: D.text, fontWeight: 800 }}>{run.day}</span>
        <span style={chip(D.textDim)}>{run.status_label || run.status}</span>
        {run.provider && <span style={dim}>{run.provider}</span>}
        {has(run.fraud_case_id) && <span style={chip(D.red)}>Fraud case #{run.fraud_case_id}</span>}
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Pair label="Ledger in / statement in" ledger={run.ledger_in} statement={run.statement_in} />
        <Pair label="Ledger out / statement out" ledger={run.ledger_out} statement={run.statement_out} />
        {has(run.in_transit) && (
          <div>
            <div style={{ ...dim, fontSize: "0.7rem" }}>In transit</div>
            <div style={amount}>{formatGhs(run.in_transit)}</div>
            {run.in_transit_note && <div style={dim}>{run.in_transit_note}</div>}
          </div>
        )}
      </div>
      <Differences value={run.differences} />
      {run.unavailable_checks?.length > 0 && <div style={dim}>Not checked: {run.unavailable_checks.join(", ")}</div>}
      {run.statement_source && <div style={dim}>Statement source: {run.statement_source}</div>}
    </li>
  );
}

export default function WalletReconciliationPanel({ fallback = null }) {
  const queryClient = useQueryClient();
  const s = walletStyles("dashboard");
  const query = useWalletReconciliation();
  const failure = query.error ? walletMessage(query.error) : null;
  if (failure?.kind === "off") return fallback;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["wallet-reconciliation"] });
  const runs = query.data?.results;
  return (
    <div style={page}>
      <Title right={<button type="button" onClick={refresh} style={button(D.panelBg, D.text, false)}>Refresh</button>}>Reconciliation</Title>
      <section aria-label="Reconciliation runs" style={{ ...glassCard, padding: 16 }}>
        {failure ? <div role="alert" style={s.error}>{failure.text}</div>
          : !runs ? <div role="status" style={dim}>Loading…</div>
          : !runs.length ? <div style={dim}>No reconciliation runs yet.</div>
          : <ul style={{ margin: 0, padding: 0 }}>{runs.map((r) => <Run key={`${r.day}-${r.provider}`} run={r} />)}</ul>}
      </section>
    </div>
  );
}
