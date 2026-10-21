import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useStaffWithdrawals } from "../../../hooks/useStaffWithdrawals.js";
import { walletMessage } from "../../wallet/walletErrors.js";
import { formatGhs } from "../../wallet/walletMoney.js";
import { walletStyles } from "../../wallet/walletStyles.js";
import { usePagedRows } from "../../wallet/usePagedRows.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field, pill } from "./panelStyles.js";
import { Title, page } from "./insightsParts.jsx";

// ─── Withdrawals (staff queue) ───────────────────────────────────────────────
// Every withdrawal with its holder and masked destination, Open by default. A
// stuck one can be sent for resolution by someone with wallets.manage: this
// only ASKS. The server contacts the provider, then files a request that a
// second person approves in Approvals; there is no Approve and no direct Fail
// here. Password re-entry (sudo_required) is handled by apiClient's SudoPrompt.
// The server decides what is allowed (e.g. a payout the provider still shows as
// processing can only be settled as paid) and its refusal is shown verbatim.
// No realtime key exists: the list refetches on window focus and on Refresh.
// useStaffWithdrawals returns a DRF envelope: read data.results.
const STATUSES = [["open", "Open"], ["succeeded", "Paid"], ["failed", "Failed"], ["cancelled", "Cancelled"], ["all", "All"]];
const MIN_EVIDENCE = 10;
const td = { padding: "8px 8px", borderBottom: `1px solid ${D.divider}`, verticalAlign: "top", fontSize: "0.8rem", color: D.text };
const th = { ...dim, textAlign: "left", fontWeight: 700, padding: "6px 8px" };
const money = { fontVariantNumeric: "tabular-nums", color: D.price, fontWeight: 700, whiteSpace: "nowrap" };
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" }) : "—");

function ResolveSheet({ row, onClose, onSent }) {
  const s = walletStyles("dashboard");
  const [outcome, setOutcome] = useState("failed");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const length = evidence.trim().length;
  const ready = length >= MIN_EVIDENCE;
  const send = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const done = await apiPost(`/api/wallet/staff/withdrawals/${row.id}/resolve/`, { outcome, evidence: evidence.trim() });
      onSent(done);
    } catch (e) {
      setError(walletMessage(e).text);
      setBusy(false);
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={`Resolve withdrawal ${row.reference}`} style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10, border: `1px solid ${D.cardBorder}` }}>
      <div style={{ color: D.text, fontWeight: 800 }}>Resolve {row.reference} ({formatGhs(row.amount)}, {row.holder_name || `holder ${row.holder_id}`})</div>
      <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", gap: 14 }}>
        <legend style={{ ...dim, marginBottom: 4 }}>Outcome</legend>
        {[["failed", "Failed"], ["paid", "Paid"]].map(([id, label]) => (
          <label key={id} style={{ color: D.text, fontSize: "0.82rem", display: "flex", gap: 6, alignItems: "center" }}>
            <input type="radio" name="outcome" value={id} checked={outcome === id} onChange={() => setOutcome(id)} />{label}
          </label>
        ))}
      </fieldset>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, color: D.text, fontSize: "0.8rem", fontWeight: 700 }}>
        Evidence (required, 10+ characters, counted)
        <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={3} style={field} />
        <span style={dim}>{length} / {MIN_EVIDENCE}</span>
      </label>
      <div style={callout(D.amber)}>
        Failed returns {formatGhs(row.amount)} to the holder's balance. Paid records it as paid. A second approver must confirm; nothing changes until then.
      </div>
      {error && <div role="alert" style={s.error}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={send} disabled={!ready || busy} style={button(D.gold, D.text, !ready || busy)}>Send for approval</button>
        <button type="button" onClick={onClose} style={button(D.panelBg, D.text, false)}>Cancel</button>
      </div>
    </div>
  );
}

function Rows({ status, canManage, onResolve }) {
  const s = walletStyles("dashboard");
  const { query, loaded, rows, hasMore, loadMore, loadError } = usePagedRows((pageNo) => useStaffWithdrawals({ status, page: pageNo }));
  const failure = query.error ? walletMessage(query.error) : null;
  if (failure?.kind === "off" && !loaded.length) return <div role="status" style={dim}>{failure.text}</div>;
  if (failure && !loaded.length) return <div role="alert" style={s.error}>{failure.text}</div>;
  if (!loaded.length) return <div role="status" style={dim}>Loading…</div>;
  if (!rows.length) return <div style={dim}>No withdrawals here.</div>;
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>{["Reference", "Holder", "Amount", "Charge", "Status", "Destination", "Submitted", ""].map((h) => <th key={h || "action"} style={th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{r.reference}</td>
                <td style={td}>{r.holder_name || `Holder ${r.holder_id}`}<div style={dim}>{r.holder_type}</div></td>
                <td style={{ ...td, ...money }}>{formatGhs(r.amount)}</td>
                <td style={{ ...td, ...money }}>{formatGhs(r.charge)}</td>
                <td style={td}>{r.status_label}{r.stuck && <> <span style={chip(D.amber)}>Stuck</span></>}</td>
                <td style={td}>{r.destination?.account_number_masked || "—"}</td>
                <td style={td}>{r.submitted_at ? when(r.submitted_at) : "Not sent"}</td>
                <td style={td}>{r.stuck && canManage && <button type="button" onClick={() => onResolve(r)} style={button(D.panelBg, D.text, false)}>Resolve…</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loadError && <div role="alert" style={s.error}>{loadError.text}</div>}
      {hasMore && <button type="button" onClick={loadMore} disabled={query.isFetching} style={button(D.panelBg, D.text, query.isFetching)}>Load more</button>}
    </>
  );
}

export default function WithdrawalsPanel({ auth }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("open");
  const [round, setRound] = useState(0);
  const [resolving, setResolving] = useState(null);
  const [sent, setSent] = useState("");
  const canManage = Boolean(auth?.hasPermission?.("wallets.manage"));
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["staff-withdrawals"] });
    setRound((n) => n + 1);
  };
  const onSent = (done) => {
    setResolving(null);
    setSent(`Sent for approval (request A-${done.approval_id}). A second person must approve it in Approvals.`);
    refresh();
  };
  return (
    <div style={page}>
      <Title right={<button type="button" onClick={refresh} style={button(D.panelBg, D.text, false)}>Refresh</button>}>Withdrawals</Title>
      <div role="group" aria-label="Withdrawal status" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {STATUSES.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={status === id} onClick={() => setStatus(id)} style={pill(status === id)}>{label}</button>
        ))}
      </div>
      {sent && <div role="status" style={callout(D.green)}>{sent}</div>}
      {resolving && <ResolveSheet row={resolving} onClose={() => setResolving(null)} onSent={onSent} />}
      <section aria-label="Withdrawals list" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <Rows key={`${status}-${round}`} status={status} canManage={canManage} onResolve={(r) => { setSent(""); setResolving(r); }} />
      </section>
    </div>
  );
}
