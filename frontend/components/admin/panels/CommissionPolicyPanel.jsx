import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiDownload, apiPost } from "../../../apiClient.js";
import { useCommissionAccruals, useCommissionPolicies } from "../../../hooks/useCommission.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { dateInputValue } from "../../../lib/followUp.js";
import { D, glassCard } from "../theme.js";
import { button, dim, field } from "./panelStyles.js";
import { errorStyle, eyebrow, h3, labelStyle } from "./portfolioParts.jsx";

// ─── Commission policy (Accounting proposes, Super Admin approves) ───────────
// The amounts scouts earn come only from here: nothing is hard-coded, and with
// no approved amount nothing accrues (a later approval never backfills). A
// proposal is a maker-checker request, not a change; cancelling a scout's
// earlier lines is not possible from here.
const KINDS = [["registration", "Registration"], ["three_paid_months_bonus", "3-paid-months bonus"]];
const figures = { fontVariantNumeric: "tabular-nums" };
const local = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T12:00:00`) : new Date(value));
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (value) => { const d = local(value); return `${d.getDate()} ${SHORT[d.getMonth()]} ${d.getFullYear()}`; };

export default function CommissionPolicyPanel({ canPropose = false }) {
  const queryClient = useQueryClient();
  const policies = useCommissionPolicies();
  const accruals = useCommissionAccruals();
  const [form, setForm] = useState({ kind: "registration", amount: "", effective_from: dateInputValue(new Date()), note: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [exportError, setExportError] = useState("");
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const propose = async (event) => {
    event.preventDefault();
    setSending(true);
    setError("");
    setDone("");
    try {
      const result = await apiPost("/api/commission/policies/", form);
      setDone(result.status === "approved" ? "Applied. Super Admin changes take effect straight away." : "Sent to Super Admin for approval. Nothing changes until they approve it.");
      setForm((f) => ({ ...f, amount: "", note: "" }));
      queryClient.invalidateQueries({ queryKey: ["commission-policies"] });
    } catch (err) {
      setError(apiErrorMessage(err, "Could not send the proposal. Check the amount and the date."));
    } finally {
      setSending(false);
    }
  };

  const exportCsv = async () => {
    setExportError("");
    try {
      await apiDownload("/api/commission/accruals/?format=csv", "commission.csv");
    } catch (err) {
      setExportError(apiErrorMessage(err, "Could not export. Try again."));
    }
  };

  const current = policies.data?.current;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div>
        <div style={eyebrow}>Commission</div>
        <h2 style={{ color: D.text, fontSize: "1.4rem", fontWeight: 800, margin: "2px 0 0" }}>Commission policy</h2>
        <div style={dim}>What scouts earn for a registration and for the 3-paid-months bonus. Each line is held 90 days; payout batches aren't built yet.</div>
      </div>

      {policies.isLoading && <div style={dim}>Loading…</div>}
      {policies.isError && <div role="alert" style={errorStyle}>Couldn't load the commission policy.</div>}

      {current && (
        <section aria-label="Amounts in force" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          {KINDS.map(([kind, label]) => (
            <div key={kind} style={{ ...glassCard, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, color: D.textDim }}>{label}</span>
              {current[kind]
                ? <><span style={{ fontSize: "1.1rem", fontWeight: 800, color: D.text, ...figures }}>{`GH₵ ${current[kind].amount}`}</span><span style={dim}>{`Since ${shortDate(current[kind].effective_from)}`}</span></>
                : <span style={{ fontSize: "0.85rem", fontWeight: 700, color: D.text }}>No amount approved yet — nothing accrues</span>}
            </div>
          ))}
        </section>
      )}

      {policies.data?.pending.length > 0 && (
        <section aria-labelledby="cp-pending" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          <h3 id="cp-pending" style={{ ...h3, fontSize: "0.95rem" }}>Waiting for Super Admin</h3>
          {policies.data.pending.map((p) => (
            <div key={p.id} style={{ fontSize: "0.82rem", color: D.text, ...figures }}>
              {`${KINDS.find(([k]) => k === p.kind)?.[1] || p.kind}: GH₵ ${p.amount} from ${shortDate(p.effective_from)} · proposed by ${p.maker}`}
            </div>
          ))}
        </section>
      )}

      {canPropose && (
        <form onSubmit={propose} aria-label="Propose a new amount" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <h3 style={{ ...h3, fontSize: "0.95rem" }}>Propose new amount</h3>
          <label style={labelStyle}>Commission
            <select value={form.kind} onChange={set("kind")} style={field}>{KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
          </label>
          <label style={labelStyle}>Amount (GH₵)
            <input value={form.amount} onChange={set("amount")} inputMode="decimal" placeholder="50.00" style={field} />
          </label>
          <label style={labelStyle}>Effective from
            <input type="date" value={form.effective_from} onChange={set("effective_from")} min={dateInputValue(new Date())} style={field} />
          </label>
          <label style={labelStyle}>Note
            <textarea value={form.note} onChange={set("note")} rows={2} maxLength={500} style={field} />
          </label>
          <div style={dim}>A new amount applies from its date onward. Lines already earned keep the amount they were earned at.</div>
          {error && <div role="alert" style={errorStyle}>{error}</div>}
          {done && <div role="status" style={{ ...dim, color: D.green, fontWeight: 700 }}>{done}</div>}
          <button type="submit" disabled={sending || !form.amount.trim()} style={{ ...button(D.gold, D.text, sending || !form.amount.trim()), alignSelf: "flex-start" }}>
            {sending ? "Sending…" : "Send for approval"}
          </button>
        </form>
      )}

      <section aria-labelledby="cp-lines" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h3 id="cp-lines" style={{ ...h3, fontSize: "0.95rem" }}>Commission lines</h3>
          {accruals.data && <button type="button" onClick={exportCsv} style={button(D.panelBg, D.text)}>Export CSV</button>}
        </div>
        {exportError && <div role="alert" style={errorStyle}>{exportError}</div>}
        {accruals.isError && <div role="alert" style={errorStyle}>Couldn't load the lines.</div>}
        {accruals.data && accruals.data.results.length === 0 && <div style={dim}>No commission has been earned yet.</div>}
        {accruals.data?.results.slice(0, 10).map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.8rem", color: D.text, borderTop: `1px solid ${D.divider}`, paddingTop: 6 }}>
            <span>{`${a.staff} · ${a.business} · ${a.kind_label} · ${a.status_label}`}</span>
            <span style={{ fontWeight: 800, whiteSpace: "nowrap", ...figures }}>{`GH₵ ${a.amount}`}</span>
          </div>
        ))}
        {accruals.data && accruals.data.count > 10 && <div style={dim}>{`Showing 10 of ${accruals.data.count}. Export for all of them.`}</div>}
      </section>

      {policies.data?.history.length > 0 && (
        <section aria-labelledby="cp-history" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 id="cp-history" style={{ ...h3, fontSize: "0.95rem" }}>History</h3>
          {policies.data.history.map((p, i) => (
            <div key={i} style={{ fontSize: "0.78rem", color: D.textDim, ...figures }}>
              {`${p.kind_label}: GH₵ ${p.amount} from ${shortDate(p.effective_from)} · proposed by ${p.proposed_by}, approved by ${p.approved_by}`}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
