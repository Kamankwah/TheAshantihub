import { useQueryClient } from "@tanstack/react-query";
import { useWalletReconciliation } from "../../../hooks/useWalletReconciliation.js";
import { walletMessage } from "../../wallet/walletErrors.js";
import { formatGhs, pesewasToGhs } from "../../wallet/walletMoney.js";
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

const isDiffRow = (v) => v && typeof v === "object" && !Array.isArray(v) && "reference" in v && "kind" in v && "problem" in v;
const pesewas = (v) => (v === null || v === undefined ? "—" : pesewasToGhs(v));

// The server sends a list of {reference, kind, problem, ledger, statement} with ledger and statement in
// whole pesewas (or null). Rows of that shape are shown in GH₵; anything else is shown as sent.
function Differences({ value }) {
  const list = Array.isArray(value) ? value : [];
  const rows = list.filter(isDiffRow);
  const other = Array.isArray(value) ? list.filter((v) => !isDiffRow(v)).map((v, i) => [String(i + 1), v]) : value && typeof value === "object" ? Object.entries(value) : [];
  if (!rows.length && !other.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem" }}>
      {rows.map((d, i) => (
        <div key={`${d.reference}-${i}`} style={{ display: "flex", gap: 12, flexWrap: "wrap", color: D.text }}>
          <span style={{ fontWeight: 700 }}>{d.reference}</span>
          <span>{d.kind}</span>
          <span>{d.problem}</span>
          <span style={amount}>Ledger {pesewas(d.ledger)}</span>
          <span style={amount}>Statement {pesewas(d.statement)}</span>
        </div>
      ))}
      {other.length > 0 && (
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px" }}>
          {other.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt style={{ color: D.textDim, fontWeight: 700 }}>{k}</dt>
              <dd style={{ margin: 0, color: D.text, fontVariantNumeric: "tabular-nums" }}>{show(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Run({ run, onNavigate }) {
  return (
    <li style={{ listStyle: "none", padding: "12px 0", borderBottom: `1px solid ${D.divider}`, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: D.text, fontWeight: 800 }}>{run.day}</span>
        <span style={chip(D.textDim)}>{run.status_label || run.status}</span>
        {run.provider && <span style={dim}>{run.provider}</span>}
        {has(run.fraud_case_id) && (onNavigate
          ? <button type="button" onClick={() => onNavigate("fraud-cases")} style={{ ...chip(D.red), cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>Fraud alert #{run.fraud_case_id}</button>
          : <span style={chip(D.red)}>Fraud alert #{run.fraud_case_id}</span>)}
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

export default function WalletReconciliationPanel({ fallback = null, onNavigate }) {
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
          : <ul style={{ margin: 0, padding: 0 }}>{runs.map((r) => <Run key={`${r.day}-${r.provider}`} run={r} onNavigate={onNavigate} />)}</ul>}
      </section>
    </div>
  );
}
