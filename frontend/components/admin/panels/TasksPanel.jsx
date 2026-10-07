import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useMyTasks } from "../../../hooks/useMyTasks.js";
import { D, glassCard } from "../theme.js";

const VIEWS = [["today", "Today"], ["overdue", "Overdue"], ["upcoming", "Upcoming"], ["open", "All open"], ["done", "Done"]];
const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: "#fff" };
const pill = (active) => ({ background: active ? D.text : "transparent", color: active ? "#fff" : D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "6px 12px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });

export default function TasksPanel() {
  const [view, setView] = useState("today");
  const { data, isLoading, isError, refetch } = useMyTasks(view);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [actionError, setActionError] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    setActionError(null);
    if (!title.trim() || !due) { setActionError("Give the task a title and a due time."); return; }
    try {
      await apiPost("/api/tasks/", { title: title.trim(), due_at: new Date(due).toISOString() });
      setTitle(""); setDue(""); refetch();
    } catch (err) { setActionError("Could not add the task."); }
  };
  const finish = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/tasks/${id}/done/`, {}); refetch(); }
    catch (err) { setActionError("Could not update the task."); }
  };

  const tasks = data || [];
  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Tasks</div>
      <form onSubmit={add} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text, flex: "1 1 220px" }}>New task
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={field} maxLength={200} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text }}>Due
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} style={field} />
        </label>
        <button type="submit" style={{ background: D.gold, color: D.text, border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>Add task</button>
      </form>
      <div role="group" aria-label="Which tasks" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {VIEWS.map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} style={pill(view === id)}>{label}</button>)}
      </div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      {isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your tasks.</div>}
      {!isLoading && !isError && tasks.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Nothing here.</div>}
      {tasks.map((t) => {
        const overdue = t.status === "open" && new Date(t.due_at) < new Date();
        return (
          <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 0", borderTop: `1px solid ${D.divider}` }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{t.title}</div>
              <div style={{ color: overdue ? D.red : D.textDim, fontSize: "0.72rem", fontWeight: overdue ? 700 : 400 }}>
                {t.status === "done" ? `Done ${t.done_at?.slice(0, 10)}` : `${overdue ? "Overdue · " : ""}Due ${new Date(t.due_at).toLocaleString("en-GH")}`}
              </div>
            </div>
            {t.status === "open" && (
              <button type="button" aria-label={`Mark "${t.title}" done`} onClick={() => finish(t.id)} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "6px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Done</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
