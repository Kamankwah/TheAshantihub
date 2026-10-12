import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useServiceIssues } from "../../../hooks/useOpsPeople.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { dateInputValue, followUpIso } from "../../../lib/followUp.js";
import { formatDuration } from "../../../lib/timeAgo.js";
import { D, glassCard } from "../theme.js";
import LogCallSheet from "./LogCallSheet.jsx";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { button, callout, chip, dim, field, pill } from "./panelStyles.js";
import { card, errorStyle, h2, h3, labelStyle } from "./portfolioParts.jsx";

// ─── 16 Support issues ───────────────────────────────────────────────────────
// What waits on the team's businesses, read-only: contact messages matched to an
// owner by email or phone, disputes on orders holding their listings, and
// conversations where the business owner talks to AshantiHub Support. Reading
// this list (service_issues.view) does not let anyone reply as Support or decide
// a dispute. Open, create a task for the account manager, log a call, flag fraud.
// Everything comes from GET /api/operations/service-issues/.
const TYPES = [["all", "All types"], ["contact", "Contact form"], ["dispute", "Order dispute"], ["chat", "Owner chat"]];
const TYPE_COLOR = { contact: D.amber, dispute: D.red, chat: D.green };
const INTRO = "What this list can see today: contact messages from your businesses' owners, disputes on their orders, and conversations where the business owner is the one talking to AshantiHub Support. Customer conversations about a business only carry a “Re:” subject line for now, so they aren't linked here yet — that comes in a later phase.";
const MONEY = "The money side of any dispute is decided by Accounting, never here. Payments are simulated until Hubtel is connected, so no real payment can be traced yet.";

const age = (seconds) => (seconds < 60 ? "just now" : formatDuration(seconds * 1000));
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return dateInputValue(d); };

function TaskForm({ issue, onDone, onCancel }) {
  const [title, setTitle] = useState(`Follow up with ${issue.business}: ${issue.what.split(" · ")[0]}`.slice(0, 200));
  const [due, setDue] = useState(tomorrow());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !due) return;
    setBusy(true); setError(null);
    try {
      await apiPost("/api/tasks/", { title: title.trim(), due_at: followUpIso(due), owner: issue.account_manager_id, notes: `${issue.type_label} · ${issue.business}\n${issue.detail || issue.what}`.slice(0, 1000) });
      onDone(`Task given to ${issue.account_manager}.`);
    } catch (err) { setError(apiErrorMessage(err, "Could not create the task.")); } finally { setBusy(false); }
  };
  return (
    <form aria-label="Create task" onSubmit={submit} noValidate style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={labelStyle}>Task<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} style={field} /></label>
      <label style={labelStyle}>Due<input type="date" value={due} min={dateInputValue()} onChange={(e) => setDue(e.target.value)} style={field} /></label>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy || !title.trim() || !due} style={button(D.gold, D.text, busy)}>{`Give to ${issue.account_manager}`}</button>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
      </div>
    </form>
  );
}

function FraudForm({ issue, onDone, onCancel }) {
  const [title, setTitle] = useState(`${issue.type_label}: ${issue.what.split(" · ")[0]}`.slice(0, 200));
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true); setError(null);
    try {
      await apiPost("/api/fraud/flags/", { kind: "other", title: title.trim(), detail: detail.trim() || issue.detail || "", business_owner: issue.business_id });
      onDone("Fraud case raised. It is in Fraud cases.");
    } catch (err) { setError(apiErrorMessage(err, "Could not raise the case.")); } finally { setBusy(false); }
  };
  return (
    <form aria-label="Flag as fraud" onSubmit={submit} noValidate style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={labelStyle}>Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} style={field} /></label>
      <label style={labelStyle}>What you found<textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} maxLength={2000} style={field} /></label>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy || !title.trim()} style={button(D.red, D.panelBg, busy)}>Raise fraud case</button>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
      </div>
    </form>
  );
}

function Detail({ issue, auth, onOpenBusiness, onNotice }) {
  const [mode, setMode] = useState(null); // task | fraud | call
  const queryClient = useQueryClient();
  const can = (perm) => Boolean(auth?.hasPermission?.(perm));
  const done = (text) => { setMode(null); onNotice(text); queryClient.invalidateQueries({ queryKey: ["service-issues"] }); };
  return (
    <aside aria-label={`${issue.business}: ${issue.what}`} style={card}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={chip(TYPE_COLOR[issue.type])}>{issue.type_label}</span>
        <span style={dim}>{`${issue.business} · open for ${age(issue.open_seconds)}`}</span>
      </div>
      <h3 style={h3}>{issue.what}</h3>
      {issue.detail && <blockquote style={{ margin: 0, padding: "6px 12px", borderLeft: `3px solid ${D.cardBorder}`, color: D.text, fontSize: "0.82rem", whiteSpace: "pre-wrap" }}>{issue.detail}</blockquote>}
      {issue.from && <div style={dim}>{`From ${issue.from}`}</div>}
      <div style={dim}>{`Being handled by: ${issue.handled_by}`}</div>
      {issue.type === "chat" && <div style={dim}>The conversation is between the owner and AshantiHub Support; Support replies to it.</div>}
      <div style={dim}>{MONEY}</div>
      {mode === "task" && <TaskForm issue={issue} onDone={done} onCancel={() => setMode(null)} />}
      {mode === "fraud" && <FraudForm issue={issue} onDone={done} onCancel={() => setMode(null)} />}
      {!mode && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onOpenBusiness && issue.business_id && can("portfolio.manage") && <button type="button" onClick={() => onOpenBusiness(issue.business_id)} style={button(D.panelBg, D.text)}>{`Open ${issue.business}`}</button>}
          {issue.account_manager_id && can("staff.invite_team") && <button type="button" onClick={() => setMode("task")} style={button(D.gold, D.text)}>{`Create task for ${issue.account_manager}`}</button>}
          {issue.business_id && can("calls.log") && <button type="button" onClick={() => setMode("call")} style={button(D.panelBg, D.text)}>Log a call with the owner</button>}
          {issue.business_id && (can("fraud.flag") || can("fraud.manage")) && <button type="button" onClick={() => setMode("fraud")} style={button(D.panelBg, D.red)}>Flag as fraud</button>}
        </div>
      )}
      {mode === "call" && <LogCallSheet preset={{ type: "business_owner", id: issue.business_id, label: issue.business }} onClose={() => setMode(null)} onSaved={() => done("Call saved.")} />}
    </aside>
  );
}

export default function ServiceIssuesPanel({ auth, onOpenBusiness }) {
  const [type, setType] = useState("all");
  const [manager, setManager] = useState("");
  const [status, setStatus] = useState("open");
  const [picked, setPicked] = useState(null);
  const [notice, setNotice] = useState(null);
  const { data, isLoading, isError, refetch } = useServiceIssues({ type, manager, status });
  const issues = data?.issues || [];
  const selected = issues.find((i) => i.key === picked) || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <h2 style={h2}>Support issues</h2>
        <div style={dim}>{INTRO}</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={labelStyle}>Type
            <select value={type} onChange={(e) => setType(e.target.value)} style={field}>
              {TYPES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
            </select>
          </label>
          <label style={labelStyle}>Account manager
            <select value={manager} onChange={(e) => setManager(e.target.value)} style={field}>
              <option value="">Any scout</option>
              {(data?.managers || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <div role="group" aria-label="Status" style={{ display: "flex", gap: 6 }}>
            <button type="button" aria-pressed={status === "open"} onClick={() => setStatus("open")} style={pill(status === "open")}>{data ? `Open · ${data.open_total}` : "Open"}</button>
            <button type="button" aria-pressed={status === "resolved"} onClick={() => setStatus("resolved")} style={pill(status === "resolved")}>Resolved this week</button>
          </div>
        </div>
      </div>

      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && (
        <div role="alert" style={{ ...card, ...errorStyle }}>Could not load the support issues.
          <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Try again</button>
        </div>
      )}
      {data && (
        <section aria-label="Issues" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {issues.length === 0 ? (
            <div style={dim}>{status === "open" ? "Nothing open on your team's businesses." : "Nothing was resolved in the last 7 days."}</div>
          ) : (
            <div style={scroll}>
              <table style={table}>
                <thead><tr>{["Type", "Business · what happened", "Account manager", "Being handled by", status === "open" ? "Open for" : "Opened"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {issues.map((i) => (
                    <tr key={i.key} style={{ background: picked === i.key ? D.panelBg2 : "transparent" }}>
                      <td style={td}><span style={chip(TYPE_COLOR[i.type])}>{i.type_label}</span></td>
                      <td style={td}>
                        <button type="button" aria-pressed={picked === i.key} onClick={() => setPicked(picked === i.key ? null : i.key)} style={{ background: "none", border: 0, padding: 0, textAlign: "left", font: "inherit", color: D.text, cursor: "pointer" }}>
                          <span style={{ fontWeight: 800 }}>{i.business}</span><br /><span style={dim}>{i.what}</span>
                        </button>
                      </td>
                      <td style={td}>{i.account_manager || "—"}</td>
                      <td style={td}>{i.handled_by}</td>
                      <td style={{ ...td, ...figures }}>{age(i.open_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={dim}>{`Resolved this week: ${data.resolved_this_week} · the money side of any dispute is decided by Accounting, never here.`}</div>
        </section>
      )}
      {selected && <Detail key={selected.key} issue={selected} auth={auth} onOpenBusiness={onOpenBusiness} onNotice={setNotice} />}
    </div>
  );
}
