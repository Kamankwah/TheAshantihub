import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useMyTasks, useTeamTaskSummary } from "../../../hooks/useMyTasks.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { toggleButton, toggleGroup } from "./opsPeopleParts.jsx";

const VIEWS = [["today", "Today"], ["overdue", "Overdue"], ["upcoming", "Upcoming"], ["open", "All open"], ["done", "Done"]];
const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: D.panelBg };
const pill = (active) => ({ background: active ? D.text : "transparent", color: active ? D.pageBg : D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "6px 12px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const dim = { color: D.textDim, fontSize: "0.72rem" };

// Open tasks fall into three groups: already late, due before midnight, later.
function bucket(task, now = new Date()) {
  const due = new Date(task.due_at);
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  if (due < now) return "overdue";
  return due < midnight ? "today" : "later";
}
const GROUPS = [["overdue", "Overdue", D.red], ["today", "Due today", D.text], ["later", "Coming up", D.text]];

// Tasks (23). A lead also gets "My team's": their direct reports' tasks, who has
// overdue ones, and a way to give a task to someone on the team.
export default function TasksPanel({ auth }) {
  const leadsTeam = auth?.hasPermission?.("staff.invite_team") ?? false;
  const [view, setView] = useState("today");
  const [scope, setScope] = useState("mine");
  const { data, isLoading, isError, refetch } = useMyTasks(view, scope);
  const summary = useTeamTaskSummary({ enabled: leadsTeam });
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [forWho, setForWho] = useState("");
  const [actionError, setActionError] = useState(null);
  const team = summary.data || [];
  const teamMode = scope === "team";

  const refresh = () => { refetch(); summary.refetch?.(); };
  const add = async (e) => {
    e.preventDefault();
    setActionError(null);
    if (!title.trim() || !due) { setActionError("Give the task a title and a due time."); return; }
    try {
      await apiPost("/api/tasks/", { title: title.trim(), due_at: new Date(due).toISOString(), ...(forWho ? { owner: Number(forWho) } : {}) });
      setTitle(""); setDue(""); setForWho(""); refresh();
    } catch (err) { setActionError(apiErrorMessage(err, "Could not add the task.")); }
  };
  const finish = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/tasks/${id}/done/`, {}); refresh(); }
    catch (err) { setActionError(apiErrorMessage(err, "Could not update the task.")); }
  };

  const tasks = data || [];
  const row = (t) => {
    const overdue = t.status === "open" && new Date(t.due_at) < new Date();
    return (
      <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 0", borderTop: `1px solid ${D.divider}` }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{t.title}</div>
          <div style={{ color: overdue ? D.red : D.textDim, fontSize: "0.72rem", fontWeight: overdue ? 700 : 400 }}>
            {t.status === "done" ? `Done ${t.done_at?.slice(0, 10)}` : `${overdue ? "Overdue · " : ""}Due ${new Date(t.due_at).toLocaleString("en-GH")}`}
            {teamMode && t.owner ? ` · ${t.owner.name}` : ""}
            {!teamMode && t.created_by_name ? ` · from ${t.created_by_name}` : ""}
            {t.business ? ` · about ${t.business.name}` : ""}
          </div>
        </div>
        {t.status === "open" && (
          <button type="button" aria-label={`Mark "${t.title}" done`} onClick={() => finish(t.id)} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "6px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Done</button>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: leadsTeam ? "repeat(auto-fit, minmax(300px, 1fr))" : "1fr", gap: 14, alignItems: "start" }}>
      <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Tasks</div>
          {leadsTeam && (
            <div role="group" aria-label="Whose tasks" style={toggleGroup}>
              <button type="button" aria-pressed={!teamMode} onClick={() => setScope("mine")} style={toggleButton(!teamMode)}>Mine</button>
              <button type="button" aria-pressed={teamMode} onClick={() => setScope("team")} style={toggleButton(teamMode)}>My team's</button>
            </div>
          )}
        </div>
        <form onSubmit={add} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text, flex: "1 1 220px" }}>New task
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={field} maxLength={200} />
          </label>
          {leadsTeam && team.length > 0 && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text }}>For
              <select value={forWho} onChange={(e) => setForWho(e.target.value)} style={field}>
                <option value="">Me</option>
                {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text }}>Due
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} style={field} />
          </label>
          <button type="submit" style={{ background: D.gold, color: D.darkBrown, border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>Add task</button>
        </form>
        <div role="group" aria-label="Which tasks" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {VIEWS.map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} style={pill(view === id)}>{label}</button>)}
        </div>
        {actionError && <div style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
        {isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
        {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>{teamMode ? "Could not load your team's tasks." : "Could not load your tasks."}</div>}
        {!isLoading && !isError && tasks.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>{teamMode ? "Nothing here. Your team has no tasks in this view." : "Nothing here."}</div>}
        {view === "done"
          ? tasks.map(row)
          : GROUPS.map(([id, label, color]) => {
            const group = tasks.filter((t) => bucket(t) === id);
            if (group.length === 0) return null;
            return (
              <section key={id} aria-label={label}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <h3 style={{ margin: 0, color, fontSize: "0.82rem", fontWeight: 800 }}>{label}</h3>
                  <span style={dim}>{group.length}</span>
                </div>
                {group.map(row)}
              </section>
            );
          })}
        <div style={{ ...dim, lineHeight: 1.45 }}>Tasks come from call follow-up dates, returned approvals and the overdue-subscription clock, or you add them yourself.</div>
      </div>

      {leadsTeam && (
        <section aria-labelledby="team-overdue" style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          <h3 id="team-overdue" style={{ margin: 0, color: D.text, fontSize: "0.95rem", fontWeight: 800 }}>Your team's overdue follow-ups</h3>
          {summary.isLoading && <div style={dim}>Loading…</div>}
          {summary.isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your team's follow-ups.</div>}
          {!summary.isLoading && !summary.isError && team.length === 0 && <div style={dim}>Nobody reports to you yet.</div>}
          {team.map((m) => (
            <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderTop: `1px solid ${D.divider}`, paddingTop: 6, fontSize: "0.8rem", color: D.text }}>
              <span>
                <span style={{ fontWeight: 700 }}>{m.name}</span>
                <span style={dim}>{` · ${m.state === "leave" ? "on leave" : m.overdue === 0 ? "all on time" : `oldest ${m.oldest_days === 0 ? "today" : `${m.oldest_days} day${m.oldest_days === 1 ? "" : "s"}`}`}`}</span>
              </span>
              <span style={{ fontWeight: 800, color: m.overdue ? D.red : D.text, fontVariantNumeric: "tabular-nums" }}>{m.overdue}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
