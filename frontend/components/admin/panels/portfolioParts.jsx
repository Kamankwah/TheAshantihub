import { useEffect, useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { useMyTeam } from "../../../hooks/useMyTeam.js";
import { useReassignableScouts } from "../../../hooks/usePortfolio.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";

// Shared pieces of the portfolio screens (PortfolioPanel, BusinessPage, the
// scout's change forms, Subscriptions due and Fraud cases). Colours come
// from D only; numbers are always the server's, never made up here.

export const card = { ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 12 };
export const h2 = { color: D.text, fontSize: "1.05rem", fontWeight: 800, margin: 0 };
export const h3 = { color: D.text, fontSize: "0.88rem", fontWeight: 800, margin: 0 };
export const eyebrow = { color: D.textFaint, fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" };
export const labelStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text };
export const errorStyle = { color: D.red, fontSize: "0.8rem", fontWeight: 700 };

export const HEALTH = {
  at_risk: { label: "At risk", color: D.red },
  needs_attention: { label: "Needs attention", color: D.amber },
  new: { label: "New · KYC waiting", color: D.blue },
  healthy: { label: "Healthy", color: D.green },
};

export function HealthChip({ rating }) {
  const meta = HEALTH[rating] || { label: "Not rated yet", color: D.textFaint };
  return <span style={chip(meta.color)}>{meta.label}</span>;
}

// "2026-10-18" (a date) is that local day; anything else is an instant.
export function toDate(value) {
  if (!value) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const date = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDay(value) {
  const date = toDate(value);
  return date ? date.toLocaleDateString("en-GH", { weekday: "short", day: "numeric", month: "short" }) : "";
}

export function formatDateTime(value) {
  const date = toDate(value);
  return date ? date.toLocaleString("en-GH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

export const money = (value) => `GH₵ ${Number(value || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const firstName = (name) => (name || "").trim().split(/\s+/)[0] || "The owner";

// One line for a billing.clock.subscription_state() dict. With the pause
// switched off (pause_enabled false) there is no 14-day countdown to show.
export function subscriptionText(sub, kycStatus) {
  const s = sub || {};
  switch (s.state) {
    case "overdue":
      if (s.pause_enabled === false) return s.overdue_since ? `Overdue since ${formatDay(s.overdue_since)}` : "Overdue";
      return s.overdue_day != null ? `Overdue · day ${s.overdue_day} of 14` : "Overdue";
    case "paused": return "Paused — listings hidden";
    case "trial": return "Active · trial";
    case "active": return s.current_period_end ? `Active · renews ${formatDay(s.current_period_end)}` : "Active";
    default: return kycStatus && kycStatus !== "verified" ? "Starts after KYC" : "No plan yet";
  }
}

export function listingsLiveText(business) {
  const live = business.listings_live ?? 0;
  const total = business.listings_total ?? live;
  const base = total > live ? `${live} of ${total}` : String(live);
  return business.listings_waiting ? `${base} · ${business.listings_waiting} waiting` : base;
}

export function lastContactText(contact) {
  if (!contact?.at) return "None yet";
  return `${contact.kind === "call" ? "Call" : "Contact"} · ${formatDay(contact.at)}`;
}

// The list item may carry a count or the cases themselves.
export const flagCount = (value) => (Array.isArray(value) ? value.length : Number(value || 0));

// The server's errors are top-level ({detail} or {field: [message]}).
export const errorText = apiErrorMessage;

// Haversine distance in metres.
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const [a1, o1, a2, o2] = [lat1, lng1, lat2, lng2].map(Number);
  const rad = (deg) => (deg * Math.PI) / 180;
  const h = Math.sin(rad(a2 - a1) / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(rad(o2 - o1) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function useDebounced(value, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

// What a scout sees after sending a request. The proposal endpoints answer
// {approval_id, approver_name, status}: "approved" means a Super Admin's own
// proposal was applied at once; otherwise it is waiting for the approver.
export function SentNotice({ approverName, status, ownerName, onBack, backLabel }) {
  const applied = status === "approved";
  return (
    <div role="status" style={{ ...callout(D.green), display: "flex", flexDirection: "column", gap: 8 }}>
      <div>{applied ? `Applied — ${firstName(ownerName)} can undo it for 7 days.` : `Sent to ${approverName || "Operations"}`}</div>
      {!applied && <div style={{ fontWeight: 400 }}>They have 24 hours, then any Operations lead can decide. The owner is told once it's approved and can undo it for 7 days.</div>}
      <button type="button" onClick={onBack} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>{backLabel}</button>
    </div>
  );
}

// Moves one or more businesses to another scout (POST businesses/<id>/
// reassign/ each). onDone({moved, failedIds, scoutName}).
export function ReassignForm({ businesses, auth, onDone, onCancel }) {
  const { scouts, isLoading } = useReassignableScouts(auth);
  const [scout, setScout] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const ready = Boolean(scout) && reason.trim().length > 0 && businesses.length > 0 && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setActionError(null);
    const failedIds = [];
    const messages = [];
    for (const business of businesses) {
      try {
        await apiPost(`/api/portfolio/businesses/${business.id}/reassign/`, { scout: Number(scout), reason: reason.trim() });
      } catch (err) {
        failedIds.push(business.id);
        messages.push(`${business.business_name}: ${errorText(err, "Could not reassign it.")}`);
      }
    }
    setBusy(false);
    if (messages.length) setActionError(messages.join(" "));
    else setReason("");
    const scoutName = scouts.find((s) => String(s.id) === scout)?.full_name || "the scout";
    onDone?.({ moved: businesses.length - failedIds.length, failedIds, scoutName });
  };

  return (
    <form onSubmit={submit} noValidate style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label style={{ ...labelStyle, flex: "1 1 180px" }}>Reassign to
        <select value={scout} onChange={(e) => setScout(e.target.value)} style={field}>
          <option value="">{isLoading ? "Loading scouts…" : "Choose a scout"}</option>
          {scouts.map((s) => <option key={s.id} value={String(s.id)}>{s.full_name}</option>)}
        </select>
      </label>
      <label style={{ ...labelStyle, flex: "2 1 240px" }}>Reason (kept on the record)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} style={field} />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        {onCancel && <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>}
        <button type="submit" disabled={!ready} style={button(D.gold, D.text, !ready)}>Reassign</button>
      </div>
      {!isLoading && scouts.length === 0 && <div style={{ ...dim, flexBasis: "100%" }}>There are no scouts on your team to move it to.</div>}
      {actionError && <div role="alert" style={{ ...errorStyle, flexBasis: "100%" }}>{actionError}</div>}
      <div style={{ ...dim, flexBasis: "100%" }}>Reassigning records who, when and why, and tells the new scout.</div>
    </form>
  );
}

// A follow-up task about a business for its account manager or for me
// (POST businesses/<id>/follow-up/). onDone(message).
export function FollowUpForm({ business, auth, onDone, onCancel }) {
  // The server accepts only the caller or one of their direct reports, so the
  // account manager is offered only when they are on the caller's team.
  const { data: team } = useMyTeam();
  const me = auth?.user;
  const manager = business.account_manager;
  const onMyTeam = Boolean(manager && manager.id !== me?.id && (Array.isArray(team) ? team : []).some((member) => member.id === manager.id));
  const options = [
    ...(onMyTeam ? [[manager.id, manager.full_name]] : []),
    ...(me ? [[me.id, `Me (${me.full_name})`]] : []),
  ];
  const [chosen, setChosen] = useState("");
  const owner = chosen && options.some(([id]) => String(id) === chosen) ? chosen : String(options[0]?.[0] ?? "");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setActionError(null);
    if (!owner || !title.trim() || !due) { setActionError("Give the task a title and a due time."); return; }
    setBusy(true);
    try {
      await apiPost(`/api/portfolio/businesses/${business.id}/follow-up/`, {
        owner: Number(owner), title: title.trim(), due_at: new Date(due).toISOString(), notes: notes.trim(),
      });
      const name = options.find(([id]) => String(id) === owner)?.[1] || "";
      onDone?.(`Task created for ${name.startsWith("Me (") ? "you" : name}.`);
    } catch (err) {
      setActionError(errorText(err, "Could not create the task."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 10, padding: 12, background: D.panelBg2, borderRadius: 12 }}>
      <label style={labelStyle}>For
        <select value={owner} onChange={(e) => setChosen(e.target.value)} style={field}>
          {options.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
        </select>
      </label>
      <label style={labelStyle}>Task<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} style={field} /></label>
      <label style={labelStyle}>Due<input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} style={field} /></label>
      <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={field} /></label>
      {actionError && <div role="alert" style={{ ...errorStyle, gridColumn: "1 / -1" }}>{actionError}</div>}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {onCancel && <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>}
        <button type="submit" disabled={busy} style={button(D.gold, D.text, busy)}>Create task</button>
      </div>
    </form>
  );
}
