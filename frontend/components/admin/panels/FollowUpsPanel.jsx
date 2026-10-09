import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useMyTasks } from "../../../hooks/useMyTasks.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { dateInputValue, followUpIso, shortDay } from "../../../lib/followUp.js";
import { D, glassCard } from "../theme.js";
import { button, dim, field } from "./panelStyles.js";
import { errorStyle, eyebrow } from "./portfolioParts.jsx";

// ─── 15 Follow-ups ───────────────────────────────────────────────────────────
// A scout's open tasks in three sections. They are added automatically from
// overdue subscriptions, delivery problems, returned approvals, call follow-up
// dates and prospect follow-up dates, plus a lead's follow-ups and your own.
const SOURCE = {
  subscription_overdue: ["Subscription overdue", "#FFF4E5", "#6B2E07"],
  delivery_problem: ["Delivery problem", "#FBF3DC", "#6A4A00"],
  returned_approval: ["Returned approval", "#FDE8E8", "#A30000"],
  call_follow_up: ["Call follow-up", "#E8EAF6", "#000060"],
  prospect_follow_up: ["Prospect follow-up", "#F1ECE4", "rgba(44,24,16,0.78)"],
  ops_follow_up: ["From your lead", "#E3F1E3", "#00500A"],
  manual: ["Your reminder", "#F1ECE4", "rgba(44,24,16,0.78)"],
};
const OVERDUE_COLOR = "#A33A00";
const figures = { fontVariantNumeric: "tabular-nums" };
const timeOf = (value) => new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// The due label, in the canvas's words. "Overdue · day N" (no "of 14") while the
// subscription pause is switched off: nothing is counted down to a hiding that
// isn't coming. "Day N of 14" appears only when the pause is on.
export function dueLabel(task, section) {
  if (task.kind === "subscription_overdue" && task.overdue?.day != null) {
    return task.overdue.pause_enabled ? `Day ${task.overdue.day} of ${task.overdue.grace_days}` : `Overdue · day ${task.overdue.day}`;
  }
  if ((task.kind === "returned_approval" || task.kind === "ops_follow_up") && task.created_by_name) return `From ${task.created_by_name}`;
  if (task.kind === "delivery_problem" && task.order_id) return `Order #${task.order_id}`;
  return section === "today" ? timeOf(task.due_at) : shortDay(task.due_at);
}

function TaskRow({ task, section, onOpenBusiness, onOpenProspects, onDone }) {
  const [label, bg, fg] = SOURCE[task.kind] || SOURCE.manual;
  const name = task.business?.name || task.prospect?.name || task.title;
  const urgent = section === "overdue" || (task.kind === "subscription_overdue" && task.overdue != null);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "9px 0", borderTop: `1px solid ${D.divider}` }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 8px", fontSize: "0.68rem", fontWeight: 800 }}>{label}</span>
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: urgent ? OVERDUE_COLOR : D.textDim, ...figures }}>{dueLabel(task, section)}</span>
        </span>
        {task.business ? (
          <button type="button" onClick={() => onOpenBusiness?.(task.business.id)}
            style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "0.88rem", color: D.text }}>{name}</button>
        ) : task.prospect ? (
          <button type="button" onClick={() => onOpenProspects?.()}
            style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "0.88rem", color: D.text }}>{name}</button>
        ) : null}
        <span style={{ fontSize: "0.75rem", lineHeight: 1.4, color: D.text }}>{task.title}</span>
        {task.notes && <span style={{ ...dim, lineHeight: 1.4 }}>{task.notes}</span>}
      </div>
      <button type="button" aria-label={`Mark done: ${name}`} onClick={() => onDone(task)}
        style={{ flex: "none", width: 44, height: 44, border: `1px solid ${D.cardBorderStrong}`, borderRadius: 999, background: D.panelBg2, color: D.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      </button>
    </div>
  );
}

export default function FollowUpsPanel({ onOpenBusiness, onOpenProspects }) {
  const queryClient = useQueryClient();
  const overdue = useMyTasks("overdue");
  const today = useMyTasks("due_today");
  const upcoming = useMyTasks("upcoming");
  const [actionError, setActionError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(dateInputValue());
  const [busy, setBusy] = useState(false);

  const sections = [
    ["overdue", "Overdue", overdue, OVERDUE_COLOR, `${OVERDUE_COLOR}80`],
    ["today", "Today", today, D.text, D.cardBorder],
    ["upcoming", "Coming up", upcoming, D.text, D.cardBorder],
  ];
  const loading = sections.some(([, , query]) => query.isLoading);
  const failed = sections.some(([, , query]) => query.isError);
  const counts = sections.map(([, , query]) => (query.data || []).length);
  const none = !loading && !failed && counts.every((n) => n === 0);
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["my-tasks"] }); queryClient.invalidateQueries({ queryKey: ["staff-badges"] }); };

  const done = async (task) => {
    setActionError(null);
    try { await apiPost(`/api/tasks/${task.id}/done/`, {}); refresh(); }
    catch (err) { setActionError(apiErrorMessage(err, "Could not mark that done. Try again.")); }
  };
  const add = async (e) => {
    e.preventDefault();
    setActionError(null);
    if (!title.trim() || !day) { setActionError("Give the follow-up a title and a day."); return; }
    setBusy(true);
    try {
      await apiPost("/api/tasks/", { title: title.trim(), due_at: followUpIso(day) });
      setTitle(""); setDay(dateInputValue()); setAdding(false); refresh();
    } catch (err) { setActionError(apiErrorMessage(err, "Could not add the follow-up. Try again.")); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div>
        <div style={eyebrow}>My businesses</div>
        <h2 style={{ color: D.text, fontSize: "1.4rem", fontWeight: 800, margin: "2px 0 0" }}>Follow-ups</h2>
        {!loading && !failed && <div style={{ ...dim, fontSize: "0.85rem", ...figures }}>{`${counts[0]} overdue · ${counts[1]} today · ${counts[2]} coming up`}</div>}
      </div>

      {adding ? (
        <form onSubmit={add} aria-label="Add a follow-up" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text }}>What to follow up
            <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} style={{ ...field, minHeight: 44 }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text }}>Day
            <input type="date" value={day} min={dateInputValue()} onChange={(e) => setDay(e.target.value)} style={{ ...field, minHeight: 44 }} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={busy} style={{ ...button(D.gold, D.text, busy), minHeight: 44 }}>{busy ? "Adding…" : "Add"}</button>
            <button type="button" onClick={() => setAdding(false)} style={{ ...button(D.panelBg, D.text), minHeight: 44 }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} style={{ ...button(D.panelBg, D.text), minHeight: 44, alignSelf: "flex-start" }}>+ Add a follow-up</button>
      )}

      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {loading && <div style={dim}>Loading…</div>}
      {failed && (
        <div role="alert" style={errorStyle}>
          Couldn't load your follow-ups.{" "}
          <button type="button" onClick={() => sections.forEach(([, , query]) => query.refetch())} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button>
        </div>
      )}
      {none && <div style={{ ...glassCard, padding: 14, ...dim }}>Nothing to follow up right now. Tasks from overdue subscriptions, delivery problems, returned approvals and your follow-up dates land here.</div>}

      {sections.map(([id, heading, query, color, border]) => {
        const tasks = query.data || [];
        if (tasks.length === 0) return null;
        return (
          <section key={id} aria-label={heading} style={{ ...glassCard, border: `1px solid ${border}`, padding: "10px 14px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 4 }}>
              <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800, color }}>{heading}</h3>
              <span style={{ ...dim, fontWeight: 700, ...figures }}>{tasks.length}</span>
            </div>
            {tasks.map((task) => <TaskRow key={task.id} task={task} section={id} onOpenBusiness={onOpenBusiness} onOpenProspects={onOpenProspects} onDone={done} />)}
          </section>
        );
      })}

      <div style={{ ...dim, lineHeight: 1.45 }}>Added automatically from overdue subscriptions, delivery problems, approvals your lead returns, and follow-up dates you set.</div>
    </div>
  );
}
