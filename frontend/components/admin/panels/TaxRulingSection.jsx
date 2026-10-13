import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useTaxRuling } from "../../../hooks/useSettingsScreens.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { dateInputValue } from "../../../lib/followUp.js";
import { D, glassCard } from "../theme.js";
import { button, callout, dim, field } from "./panelStyles.js";
import { errorStyle, h3, labelStyle } from "./portfolioParts.jsx";

// ─── Scouts' tax status (Commission policy) ──────────────────────────────────
// Whether scouts are employees (PAYE) or independent agents (10% withholding
// tax) is for an accountant or GRA to rule. Super Admin records that ruling
// here (date, reference, note; needs the password and is audited). AshantiHub
// calculates no tax. Until a ruling is recorded the first payout batch is blocked.
const day = (value) => new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function TaxRulingSection() {
  const queryClient = useQueryClient();
  const query = useTaxRuling();
  const [form, setForm] = useState({ status: "", ruled_on: dateInputValue(new Date()), reference: "", note: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const data = query.data;
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  if (query.isLoading) return <div style={dim}>Loading…</div>;
  if (query.isError || !data) return <div role="alert" style={errorStyle}>Couldn't load the scouts' tax status.</div>;

  const submit = async (event) => {
    event.preventDefault();
    setSending(true);
    setError("");
    setDone("");
    try {
      await apiPost("/api/commission/tax-ruling/", form);
      setDone("Recorded. The first payout batch is no longer blocked by this.");
      setForm((f) => ({ ...f, status: "", reference: "", note: "" }));
      queryClient.invalidateQueries({ queryKey: ["commission-tax-ruling"] });
      queryClient.invalidateQueries({ queryKey: ["payouts-overview"] });
      queryClient.invalidateQueries({ queryKey: ["insights"] });
    } catch (err) {
      setError(apiErrorMessage(err, "Could not record the ruling."));
    } finally {
      setSending(false);
    }
  };

  const ready = form.status && form.reference.trim();
  return (
    <section aria-labelledby="tax-ruling" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 id="tax-ruling" style={{ ...h3, fontSize: "0.95rem" }}>Scouts' tax status</h3>
      {data.current ? (
        <div style={{ color: D.text, fontSize: "0.85rem" }}>
          <strong>{data.current.status_label}</strong>
          <div style={dim}>{`Ruling of ${day(data.current.ruled_on)} · ${data.current.reference} · recorded by ${data.current.recorded_by}`}</div>
          {data.current.note && <div style={dim}>{data.current.note}</div>}
        </div>
      ) : (
        <div role="alert" style={callout(D.amber)}>{data.blocked_message}</div>
      )}
      <div style={dim}>AshantiHub only records the ruling. It calculates no tax, and a ruling does not change commission already earned.</div>
      {data.can_record && (
        <form onSubmit={submit} aria-label="Record the tax ruling" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={labelStyle}>Scouts are
            <select value={form.status} onChange={set("status")} style={field}>
              <option value="">Choose…</option>
              {data.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label style={labelStyle}>Date of the ruling
            <input type="date" value={form.ruled_on} max={dateInputValue(new Date())} onChange={set("ruled_on")} style={field} />
          </label>
          <label style={labelStyle}>Reference
            <input value={form.reference} onChange={set("reference")} maxLength={120} placeholder="Letter number or the accountant's name" style={field} />
          </label>
          <label style={labelStyle}>Note
            <textarea value={form.note} onChange={set("note")} rows={2} maxLength={500} style={field} />
          </label>
          <div style={dim}>Recording asks for your password again and goes into the audit log.</div>
          {error && <div role="alert" style={errorStyle}>{error}</div>}
          {done && <div role="status" style={{ ...dim, color: D.green, fontWeight: 700 }}>{done}</div>}
          <button type="submit" disabled={sending || !ready} style={{ ...button(D.gold, D.text, sending || !ready), alignSelf: "flex-start" }}>{sending ? "Recording…" : data.current ? "Record a new ruling" : "Record the ruling"}</button>
        </form>
      )}
      {data.history.length > 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ ...dim, fontWeight: 800 }}>Earlier rulings</span>
          {data.history.slice(1).map((r, i) => <span key={i} style={dim}>{`${r.status_label} · ${day(r.ruled_on)} · ${r.reference}`}</span>)}
        </div>
      )}
    </section>
  );
}
