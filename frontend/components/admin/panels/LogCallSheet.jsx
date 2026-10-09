import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPatch, apiPost } from "../../../apiClient.js";
import { useCallPurposes } from "../../../hooks/useCallPurposes.js";
import { useCallCounterparts } from "../../../hooks/useProspects.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { dateInputValue, followUpIso, longDay } from "../../../lib/followUp.js";
import { D } from "../theme.js";
import BottomSheet from "./BottomSheet.jsx";
import { button, dim, field } from "./panelStyles.js";
import { errorStyle } from "./portfolioParts.jsx";

// ─── Log a call (canvas 12) ──────────────────────────────────────────────────
// The scout's bottom sheet: direction, channel, who (one of my businesses or
// my prospects — the server fills in the name and phone from the record),
// purpose, outcome, how it went, notes and an optional follow-up day. The time
// is stamped by the server (now minus the minutes you give). With `call` it
// edits that call instead (PATCH, allowed for 24 hours).

export const OUTCOMES = [
  ["connected", "Connected"], ["no_answer", "No answer"], ["busy", "Busy"], ["voicemail", "Voicemail"],
  ["wrong_number", "Wrong number"], ["promised_to_pay", "Promised to pay"], ["callback_requested", "Callback requested"],
];
const FEELINGS = [["positive", "Good"], ["neutral", "Neutral"], ["negative", "Poor"]];
const CHANNELS = [["phone", "Phone"], ["whatsapp", "WhatsApp"], ["sms", "SMS"], ["visit", "In person"]];
const TITLE_ID = "log-call-title";

const labelStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.78rem", fontWeight: 800, color: D.text };
const input = { ...field, width: "100%", boxSizing: "border-box", minHeight: 44, fontSize: "1rem", resize: "none" };
const pillStyle = (on) => ({
  minHeight: 44, padding: "0 14px", borderRadius: 22, cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 700,
  background: on ? D.text : D.panelBg, color: on ? D.pageBg : D.text, border: `1px solid ${on ? D.text : D.cardBorder}`,
});

function Pills({ label, value, options, onChange, allowClear = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <div role="group" aria-label={label} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map(([id, text]) => (
          <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(allowClear && value === id ? "" : id)} style={pillStyle(value === id)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

const localDate = (iso) => (iso ? dateInputValue(new Date(iso)) : "");

// preset: {type: "business_owner" | "prospect", id, label?, ownerName?} picks the "Who" up front.
export default function LogCallSheet({ preset = null, call = null, onClose, onSaved }) {
  const editing = Boolean(call);
  const queryClient = useQueryClient();
  const { data: purposes } = useCallPurposes();
  const { data: who, isLoading: whoLoading, isError: whoError } = useCallCounterparts({ enabled: !editing });
  const [form, setForm] = useState(() => ({
    direction: call?.direction || "out", channel: call?.channel || "phone",
    who: call ? "" : preset ? `${preset.type}:${preset.id}` : "",
    purpose: call?.purpose || "", outcome: call?.outcome || "connected", sentiment: call?.sentiment || "",
    duration_minutes: call?.duration_seconds ? String(Math.round(call.duration_seconds / 60)) : "", notes: call?.notes || "",
    follow_up: localDate(call?.follow_up_at),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const onField = (key) => (e) => set(key)(e.target.value);

  const listed = who?.businesses || [];
  // A business page opened by Operations may be one the caller doesn't manage:
  // it still has to be pickable, with just the names the page already shows.
  const businesses = preset?.type === "business_owner" && preset.label && !listed.some((b) => b.id === preset.id)
    ? [...listed, { id: preset.id, business_name: preset.label, owner_name: preset.ownerName || "owner", phone_masked: "" }]
    : listed;
  const prospects = who?.prospects || [];
  const [kind, id] = form.who.split(":");
  const chosen = kind === "business_owner" ? businesses.find((b) => String(b.id) === id) : kind === "prospect" ? prospects.find((p) => String(p.id) === id) : null;
  const purposeOptions = purposes || [{ value: "other", label: "Other" }];
  const purpose = form.purpose || (kind === "prospect" && purposeOptions.some((p) => p.value === "prospecting") ? "prospecting" : purposeOptions[0]?.value) || "other";
  const today = dateInputValue();

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    if (!editing && !chosen) { setError("Choose who you spoke to."); return; }
    if (form.follow_up && form.follow_up < today) { setError("Pick a follow-up day from today on."); return; }
    const minutes = Number(form.duration_minutes || 0);
    if (!Number.isFinite(minutes) || minutes < 0) { setError("Minutes can't be negative."); return; }
    const common = {
      direction: form.direction, channel: form.channel, purpose, outcome: form.outcome, sentiment: form.sentiment,
      notes: form.notes, duration_seconds: Math.round(minutes * 60),
    };
    setBusy(true);
    try {
      if (editing) {
        const body = { ...common };
        if (form.follow_up !== localDate(call.follow_up_at)) body.follow_up_at = form.follow_up ? followUpIso(form.follow_up) : null;
        await apiPatch(`/api/calls/${call.id}/`, body);
      } else {
        await apiPost("/api/calls/", {
          ...common, counterpart_type: kind, counterpart_id: Number(id),
          ...(form.follow_up ? { follow_up_at: followUpIso(form.follow_up) } : {}),
        });
      }
      for (const key of ["call-logs", "portfolio", "portfolio-business", "my-tasks", "staff-badges", "prospects"]) queryClient.invalidateQueries({ queryKey: [key] });
      onSaved?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the call. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  const whoName = call ? (call.related_label || call.counterpart_name || "Unknown") : "";
  return (
    <BottomSheet title={editing ? "Edit call" : "Log a call"} titleId={TITLE_ID} onClose={onClose}>
      <form onSubmit={save} noValidate style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "end" }}>
          <Pills label="Direction" value={form.direction} options={[["out", "Out"], ["in", "In"]]} onChange={set("direction")} />
          <label style={labelStyle}>Channel
            <select value={form.channel} onChange={onField("channel")} style={input}>{CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>

        <div style={labelStyle}>
          <label htmlFor="log-call-who">Who</label>
          {editing ? (
            <select id="log-call-who" aria-describedby="log-call-who-hint" value="" disabled style={input}><option value="">{whoName}</option></select>
          ) : (
            <select id="log-call-who" aria-describedby="log-call-who-hint" value={form.who} onChange={onField("who")} style={input}>
              <option value="">{whoLoading ? "Loading…" : "Choose who you spoke to"}</option>
              {businesses.length > 0 && (
                <optgroup label="My businesses">
                  {businesses.map((b) => <option key={`b${b.id}`} value={`business_owner:${b.id}`}>{`${b.business_name} · ${b.owner_name} (owner)`}</option>)}
                </optgroup>
              )}
              {prospects.length > 0 && (
                <optgroup label="My prospects">
                  {prospects.map((p) => <option key={`p${p.id}`} value={`prospect:${p.id}`}>{`${p.name} (prospect)`}</option>)}
                </optgroup>
              )}
            </select>
          )}
          <span id="log-call-who-hint" style={{ ...dim, fontWeight: 500 }}>
            {chosen?.phone_masked ? `Phone ${chosen.phone_masked} · from the ${kind === "prospect" ? "prospect list" : "business record"}` : ""}
            {editing ? "Who the call was with can't be changed. Log a new call if it was someone else." : ""}
          </span>
        </div>
        {whoError && <div role="alert" style={errorStyle}>Couldn't load your businesses and prospects. Close this and try again.</div>}
        {!editing && !whoLoading && !whoError && businesses.length + prospects.length === 0 && (
          <div style={dim}>You have no businesses or prospects to log a call about yet.</div>
        )}

        <label style={labelStyle}>Purpose
          <select value={purpose} onChange={onField("purpose")} style={input}>{purposeOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
        </label>
        <Pills label="Outcome" value={form.outcome} options={OUTCOMES} onChange={set("outcome")} />
        <Pills label="How it went" value={form.sentiment} options={FEELINGS} onChange={set("sentiment")} allowClear />

        <label style={labelStyle}>How long (minutes, optional)
          <input type="number" inputMode="numeric" min="0" step="1" value={form.duration_minutes} onChange={onField("duration_minutes")} style={input} />
        </label>
        <label style={labelStyle}>Notes
          <textarea rows={2} value={form.notes} onChange={onField("notes")} style={{ ...input, minHeight: 64 }} />
        </label>
        <div style={labelStyle}>
          <label htmlFor="log-call-follow-up">Follow-up date</label>
          <input id="log-call-follow-up" type="date" min={today} value={form.follow_up} onChange={onField("follow_up")} style={input} aria-describedby="log-call-follow-up-hint" />
          <span id="log-call-follow-up-hint" style={{ ...dim, fontWeight: 500 }}>{form.follow_up ? `Creates a follow-up task for ${longDay(form.follow_up)}` : ""}</span>
        </div>

        {error && <div role="alert" style={errorStyle}>{error}</div>}
        <button type="submit" disabled={busy} style={{ ...button(D.gold, D.text, busy), minHeight: 48, fontSize: "0.95rem" }}>{busy ? "Saving…" : "Save call"}</button>
        <div style={{ ...dim, textAlign: "center", lineHeight: 1.45 }}>Time is stamped by the server. You can edit this call for 24 hours.</div>
      </form>
    </BottomSheet>
  );
}
