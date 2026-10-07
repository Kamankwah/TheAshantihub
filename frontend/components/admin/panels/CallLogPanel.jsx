import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useCallLogs } from "../../../hooks/useCallLogs.js";
import { useCallPurposes } from "../../../hooks/useCallPurposes.js";
import { D, glassCard } from "../theme.js";

const OUTCOMES = [["connected", "Connected"], ["no_answer", "No answer"], ["busy", "Busy"], ["voicemail", "Voicemail"], ["wrong_number", "Wrong number"], ["promised_to_pay", "Promised to pay"], ["callback_requested", "Callback requested"]];
const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: "#fff" };
const labelStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text };
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const blank = () => ({ direction: "out", channel: "phone", counterpart_type: "business_owner", counterpart_name: "", counterpart_phone: "", purpose: "other", outcome: "connected", sentiment: "", notes: "", started_at: nowLocal(), duration_minutes: "", follow_up_at: "" });

export default function CallLogPanel() {
  const { data, isLoading, isError, refetch } = useCallLogs();
  const { data: purposes } = useCallPurposes();
  const [form, setForm] = useState(null);
  const [actionError, setActionError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setActionError(null);
    const { duration_minutes, follow_up_at, started_at, ...rest } = form;
    try {
      await apiPost("/api/calls/", {
        ...rest,
        started_at: new Date(started_at).toISOString(),
        duration_seconds: Math.round(Number(duration_minutes || 0) * 60),
        ...(follow_up_at ? { follow_up_at: new Date(follow_up_at).toISOString() } : {}),
      });
      setForm(null);
      refetch();
    } catch (err) { setActionError("Could not save the call. Check the times and try again."); }
  };

  const calls = data?.results || [];
  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Call Log</div>
        {!form && <button type="button" onClick={() => setForm(blank())} style={{ background: D.gold, color: D.text, border: "none", borderRadius: 10, padding: "8px 14px", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>Log a call</button>}
      </div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      {form && (
        <form onSubmit={save} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, padding: 12, background: D.pageBg, borderRadius: 12 }}>
          <label style={labelStyle}>Direction<select value={form.direction} onChange={set("direction")} style={field}><option value="out">Outbound</option><option value="in">Inbound</option></select></label>
          <label style={labelStyle}>Channel<select value={form.channel} onChange={set("channel")} style={field}><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="visit">Visit</option></select></label>
          <label style={labelStyle}>Who<input value={form.counterpart_name} onChange={set("counterpart_name")} style={field} maxLength={150} /></label>
          <label style={labelStyle}>Phone<input value={form.counterpart_phone} onChange={set("counterpart_phone")} style={field} maxLength={20} inputMode="tel" /></label>
          <label style={labelStyle}>They are<select value={form.counterpart_type} onChange={set("counterpart_type")} style={field}><option value="business_owner">Business owner</option><option value="customer">Customer</option><option value="guest">Guest</option><option value="other">Other</option></select></label>
          <label style={labelStyle}>Purpose<select value={form.purpose} onChange={set("purpose")} style={field}>{(purposes || []).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
          <label style={labelStyle}>Outcome<select value={form.outcome} onChange={set("outcome")} style={field}>{OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label style={labelStyle}>How it went<select value={form.sentiment} onChange={set("sentiment")} style={field}><option value="">Not set</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option></select></label>
          <label style={labelStyle}>Started<input type="datetime-local" value={form.started_at} onChange={set("started_at")} style={field} /></label>
          <label style={labelStyle}>Minutes<input type="number" min="0" step="1" value={form.duration_minutes} onChange={set("duration_minutes")} style={field} /></label>
          <label style={labelStyle}>Follow up on<input type="datetime-local" value={form.follow_up_at} onChange={set("follow_up_at")} style={field} /></label>
          <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Notes and feedback<textarea value={form.notes} onChange={set("notes")} rows={3} style={{ ...field, resize: "vertical" }} /></label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setForm(null)} style={{ background: "#fff", color: D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 14px", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <button type="submit" style={{ background: D.gold, color: D.text, border: "none", borderRadius: 10, padding: "8px 16px", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>Save call</button>
          </div>
        </form>
      )}
      {isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the call log.</div>}
      {!isLoading && !isError && calls.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No calls logged yet.</div>}
      {calls.map((c) => (
        <div key={c.id} style={{ padding: "10px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.8rem" }}>
          <div style={{ color: D.text, fontWeight: 700 }}>{c.direction === "out" ? "Outbound" : "Inbound"} · {c.counterpart_name || c.related_label || "Unknown"} {c.counterpart_phone && <span style={{ color: D.textDim, fontWeight: 400 }}>({c.counterpart_phone})</span>}</div>
          <div style={{ color: D.textDim }}>{new Date(c.started_at).toLocaleString("en-GH")} · {c.purpose.replace(/_/g, " ")} · {c.outcome.replace(/_/g, " ")}{c.staff_name ? ` · by ${c.staff_name}` : ""}</div>
          {c.notes && <div style={{ color: D.text, marginTop: 4 }}>{c.notes}</div>}
        </div>
      ))}
    </div>
  );
}
