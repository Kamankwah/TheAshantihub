import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useCallLogs } from "../../../hooks/useCallLogs.js";
import { useCallPurposes } from "../../../hooks/useCallPurposes.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import LogCallSheet from "./LogCallSheet.jsx";
import { button, dim, pill } from "./panelStyles.js";
import { errorStyle, eyebrow } from "./portfolioParts.jsx";

const OUTCOMES = [["connected", "Connected"], ["no_answer", "No answer"], ["busy", "Busy"], ["voicemail", "Voicemail"], ["wrong_number", "Wrong number"], ["promised_to_pay", "Promised to pay"], ["callback_requested", "Callback requested"]];
const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: "#fff" };
const labelStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text };
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const blank = () => ({ direction: "out", channel: "phone", counterpart_type: "business_owner", counterpart_name: "", counterpart_phone: "", purpose: "other", outcome: "connected", sentiment: "", notes: "", started_at: nowLocal(), duration_minutes: "", follow_up_at: "" });

// Scouts get the phone-first calls screen (canvas 12); every other role keeps
// the desk form below.
export default function CallLogPanel({ auth }) {
  return auth?.user?.role === "scout" ? <ScoutCalls /> : <DeskCallLog />;
}

function DeskCallLog() {
  const { data, isLoading, isError, refetch } = useCallLogs();
  const { data: purposes } = useCallPurposes();
  const [form, setForm] = useState(null);
  const [actionError, setActionError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setActionError(null);
    const { duration_minutes, follow_up_at, started_at, ...rest } = form;
    if (!started_at) { setActionError("Add when the call started."); return; }
    if (follow_up_at && new Date(follow_up_at) <= new Date()) { setActionError("Pick a follow-up time in the future."); return; }
    try {
      await apiPost("/api/calls/", {
        ...rest,
        started_at: new Date(started_at).toISOString(),
        duration_seconds: Math.round(Number(duration_minutes || 0) * 60),
        ...(follow_up_at ? { follow_up_at: new Date(follow_up_at).toISOString() } : {}),
      });
      setForm(null);
      refetch();
    } catch (err) { setActionError(apiErrorMessage(err, "Could not save the call. Check the times and try again.")); }
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
        <form onSubmit={save} noValidate style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, padding: 12, background: D.pageBg, borderRadius: 12 }}>
          <label style={labelStyle}>Direction<select value={form.direction} onChange={set("direction")} style={field}><option value="out">Outbound</option><option value="in">Inbound</option></select></label>
          <label style={labelStyle}>Channel<select value={form.channel} onChange={set("channel")} style={field}><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="visit">Visit</option></select></label>
          <label style={labelStyle}>Who<input value={form.counterpart_name} onChange={set("counterpart_name")} style={field} maxLength={150} /></label>
          <label style={labelStyle}>Phone<input value={form.counterpart_phone} onChange={set("counterpart_phone")} style={field} maxLength={20} inputMode="tel" /></label>
          <label style={labelStyle}>They are<select value={form.counterpart_type} onChange={set("counterpart_type")} style={field}><option value="business_owner">Business owner</option><option value="customer">Customer</option><option value="guest">Guest</option><option value="other">Other</option></select></label>
          <label style={labelStyle}>Purpose<select value={form.purpose} onChange={set("purpose")} style={field}>{(purposes || []).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
          <label style={labelStyle}>Outcome<select value={form.outcome} onChange={set("outcome")} style={field}>{OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label style={labelStyle}>How it went<select value={form.sentiment} onChange={set("sentiment")} style={field}><option value="">Not set</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option></select></label>
          <label style={labelStyle}>Started<input type="datetime-local" required value={form.started_at} onChange={set("started_at")} style={field} /></label>
          <label style={labelStyle}>Minutes<input type="number" min="0" step="1" value={form.duration_minutes} onChange={set("duration_minutes")} style={field} /></label>
          <label style={labelStyle}>Follow up on<input type="datetime-local" min={nowLocal()} value={form.follow_up_at} onChange={set("follow_up_at")} style={field} /></label>
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

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const OUTCOME_CHIP = {
  connected: ["Connected", "#E3F1E3", "#00500A"], callback_requested: ["Callback requested", "#FBF3DC", "#6A4A00"],
  promised_to_pay: ["Promised to pay", "#FBF3DC", "#6A4A00"], no_answer: ["No answer", "#F1ECE4", "rgba(44,24,16,0.78)"],
  busy: ["Busy", "#F1ECE4", "rgba(44,24,16,0.78)"], voicemail: ["Voicemail", "#F1ECE4", "rgba(44,24,16,0.78)"],
  wrong_number: ["Wrong number", "#F1ECE4", "rgba(44,24,16,0.78)"],
};
const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const whoOf = (call) => call.related_label || call.counterpart_name || "Unknown";
const when = (call) => {
  const minutes = Math.round((call.duration_seconds || 0) / 60);
  return `${call.direction === "in" ? "In" : "Out"} · ${clock(call.started_at)}${minutes > 0 ? ` · ${minutes} min` : ""}`;
};
const canEdit = (call) => Date.now() - new Date(call.created_at).getTime() < EDIT_WINDOW_MS;

function CallRow({ call, onEdit, showDay }) {
  const [label, bg, fg] = OUTCOME_CHIP[call.outcome] || [call.outcome, "#F1ECE4", D.text];
  const editable = canEdit(call);
  const body = (
    <>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, textAlign: "left" }}>
        <span style={{ fontWeight: 700, fontSize: "0.88rem", color: D.text, overflowWrap: "anywhere" }}>{whoOf(call)}</span>
        <span style={{ ...dim, fontVariantNumeric: "tabular-nums" }}>
          {showDay ? `${new Date(call.started_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ` : ""}{when(call)}
        </span>
      </span>
      <span style={{ background: bg, color: fg, borderRadius: 999, padding: "3px 10px", fontSize: "0.7rem", fontWeight: 800, whiteSpace: "nowrap" }}>{label}</span>
    </>
  );
  const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${D.divider}`, width: "100%" };
  return editable
    ? <button type="button" onClick={() => onEdit(call)} aria-label={`Edit call with ${whoOf(call)}`} style={{ ...rowStyle, background: "none", border: "none", borderTop: `1px solid ${D.divider}`, cursor: "pointer", fontFamily: "inherit", minHeight: 52 }}>{body}</button>
    : <div style={rowStyle}>{body}</div>;
}

// 12 Calls — a scout's day of calls, with the Log a call sheet.
function ScoutCalls() {
  const today = useCallLogs({ day: "today" });
  const [earlier, setEarlier] = useState(false);
  const all = useCallLogs({ enabled: earlier });
  const [sheet, setSheet] = useState(null); // null | {call: null | call}
  const [notice, setNotice] = useState(null);
  const calls = today.data?.results || [];
  const summary = today.data?.summary || { logged: calls.length, connected: calls.filter((c) => c.outcome === "connected").length };
  const todayIds = new Set(calls.map((c) => c.id));
  const before = (all.data?.results || []).filter((c) => !todayIds.has(c.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div>
        <div style={eyebrow}>Activity</div>
        <h2 style={{ color: D.text, fontSize: "1.4rem", fontWeight: 800, margin: "2px 0 0" }}>Calls</h2>
        <div style={{ ...dim, fontVariantNumeric: "tabular-nums" }}>{`Today · ${summary.logged} logged · ${summary.connected} connected`}</div>
      </div>
      <button type="button" onClick={() => { setNotice(null); setSheet({ call: null }); }} style={{ ...button(D.gold, D.text), minHeight: 48, fontSize: "0.9rem" }}>Log a call</button>
      {notice && <div role="status" style={{ ...dim, color: D.text, fontWeight: 700 }}>{notice}</div>}

      {today.isLoading && <div style={dim}>Loading…</div>}
      {today.isError && (
        <div role="alert" style={errorStyle}>
          Couldn't load your calls.{" "}
          <button type="button" onClick={() => today.refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button>
        </div>
      )}
      {!today.isLoading && !today.isError && calls.length === 0 && <div style={{ ...glassCard, padding: 14, ...dim }}>No calls logged today.</div>}
      {calls.length > 0 && (
        <section aria-label="Today's calls" style={{ ...glassCard, padding: "4px 14px 8px" }}>
          {calls.map((call) => <CallRow key={call.id} call={call} onEdit={(c) => setSheet({ call: c })} />)}
        </section>
      )}

      {!earlier
        ? <button type="button" onClick={() => setEarlier(true)} style={{ ...pill(false), minHeight: 44, alignSelf: "flex-start" }}>Show earlier calls</button>
        : (
          <section aria-label="Earlier calls" style={{ ...glassCard, padding: "10px 14px 8px" }}>
            <div style={{ fontWeight: 800, fontSize: "0.88rem", color: D.text }}>Earlier</div>
            {all.isLoading && <div style={dim}>Loading…</div>}
            {all.isError && <div role="alert" style={errorStyle}>Couldn't load earlier calls.</div>}
            {!all.isLoading && !all.isError && before.length === 0 && <div style={dim}>No earlier calls.</div>}
            {before.map((call) => <CallRow key={call.id} call={call} showDay onEdit={(c) => setSheet({ call: c })} />)}
          </section>
        )}

      <div style={{ ...dim, textAlign: "center", lineHeight: 1.45 }}>Tap a call you logged in the last 24 hours to edit it.</div>
      {sheet && <LogCallSheet call={sheet.call} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); setNotice(sheet.call ? "Call updated." : "Call saved."); }} />}
    </div>
  );
}
