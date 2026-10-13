import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useContactMessagesQueue } from "../../../hooks/useContactMessagesQueue.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import LogCallSheet from "./LogCallSheet.jsx";
import { button, callout, chip, dim, field, pill } from "./panelStyles.js";
import { formatDateTime, labelStyle } from "./portfolioParts.jsx";

// 08 Contact form (Support). Messages sent from the public Contact page, often by someone with no account.
// The only way to answer is email, sent from AshantiHub's own address (the server decides which); nothing
// here opens a conversation, because the sender has no account to open one. Someone who left only a phone
// number gets a call, logged so the queue shows it was handled. Emails and phones arrive masked.
const TABS = [["new", "Unread"], ["read", "Read"], ["resolved", "Resolved"], ["", "All"]];
export const TOPICS = [["", "All topics"], ["sales", "Wants to sell on AshantiHub"], ["support", "Order, delivery or help"], ["account", "Account help"], ["general", "General"]];
const TOPIC_LABEL = Object.fromEntries(TOPICS);
const STATUS_CHIP = { new: ["Unread", D.amber], read: ["Read", D.blue], resolved: ["Resolved", D.green] };

export default function SupportContactPanel({ auth, onNavigate }) {
  const [tab, setTab] = useState("new");
  const [topic, setTopic] = useState("");
  const [page, setPage] = useState(1);
  const list = useContactMessagesQueue({ status: tab, category: topic, page });
  const unread = useContactMessagesQueue({ status: "new" });
  const [selectedId, setSelectedId] = useState(null);
  const [body, setBody] = useState("");
  const [passing, setPassing] = useState(false);
  const [passNote, setPassNote] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [call, setCall] = useState(null);
  const queryClient = useQueryClient();
  const canCall = auth ? Boolean(auth.hasPermission?.("calls.log")) : false;

  const items = list.data?.results || [];
  const selected = items.find((m) => m.id === selectedId) || items[0] || null;
  useEffect(() => { setBody(""); setPassing(false); setPassNote(""); }, [selected?.id]);

  const refresh = () => {
    list.refetch(); unread.refetch();
    queryClient.invalidateQueries({ queryKey: ["staff-badges"] });
  };
  const act = async (path, payload, failure, done) => {
    setError(null); setNotice(null);
    try { await apiPost(path, payload); if (done) setNotice(done); refresh(); return true; }
    catch (err) { setError(apiErrorMessage(err, failure)); return false; }
  };
  const base = selected ? `/api/core/contact-messages/${selected.id}` : "";
  const send = async () => { if (await act(`${base}/reply/`, { body }, "Could not send the email.", "Email sent.")) setBody(""); };
  const pass = async () => {
    if (await act(`${base}/pass-to-operations/`, { note: passNote }, "Could not pass this to Operations.", "Passed to Operations. The lead has a task with the message.")) { setPassing(false); setPassNote(""); }
  };
  const choose = (setter) => (value) => { setter(value); setPage(1); setSelectedId(null); };
  const pages = Math.max(1, Math.ceil((list.data?.count ?? items.length) / 20));

  if (list.isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (list.isError) return <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the contact form messages.</div>;

  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "1.05rem" }}>Contact form</div>
        <div style={dim}>Messages sent from the public Contact page, often before the person has an account.</div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div role="group" aria-label="Which messages" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TABS.map(([id, text]) => {
            const label = id === "new" && unread.data ? `${text} · ${unread.data.count}` : text;
            return <button key={text} type="button" aria-pressed={tab === id} onClick={() => choose(setTab)(id)} style={pill(tab === id)}>{label}</button>;
          })}
        </div>
        <label style={labelStyle}>Topic
          <select value={topic} onChange={(e) => choose(setTopic)(e.target.value)} style={field}>
            {TOPICS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
          </select>
        </label>
      </div>
      {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.85rem" }}>{tab === "new" && !topic ? "No unread messages. Nothing is waiting." : "No messages here."}</div>}
      {items.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
          <div role="list" aria-label="Messages" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {items.map((m) => {
              const [statusText, statusColor] = STATUS_CHIP[m.status] || [m.status, D.textDim];
              const on = selected && m.id === selected.id;
              return (
                <button key={m.id} type="button" role="listitem" aria-current={on ? "true" : undefined} onClick={() => setSelectedId(m.id)}
                  style={{ textAlign: "left", background: on ? D.panelBg2 : D.panelBg, border: `1px solid ${on ? D.deepGold : D.cardBorder}`, borderRadius: 12, padding: "10px 12px", cursor: "pointer", fontFamily: "inherit" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ color: D.text, fontWeight: m.status === "new" ? 800 : 600, fontSize: "0.82rem" }}>{m.name}</span>
                    <span style={dim}>{formatDateTime(m.created_at)}</span>
                  </div>
                  <div style={{ color: D.text, fontSize: "0.8rem", fontWeight: 700 }}>{m.subject}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                    <span style={chip(statusColor)}>{statusText}</span>
                    <span style={chip(D.textFaint)}>{TOPIC_LABEL[m.category] || m.category}</span>
                    {!m.has_email && <span style={chip(D.amber)}>Phone only</span>}
                  </div>
                </button>
              );
            })}
            {pages > 1 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} style={button(D.panelBg, D.text, page <= 1)}>Previous</button>
                <span style={dim}>{`Page ${page} of ${pages}`}</span>
                <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} style={button(D.panelBg, D.text, page >= pages)}>Next</button>
              </div>
            )}
          </div>
          {selected && (
            <article aria-label="Message" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={{ color: D.text, fontWeight: 800, fontSize: "0.98rem" }}>{selected.subject}</div>
                <div style={dim}>{[selected.name, selected.email || null, selected.phone || null, `received ${formatDateTime(selected.created_at)}`].filter(Boolean).join(" · ")}</div>
              </div>
              <div style={{ color: D.text, fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>{selected.message}</div>
              <div style={{ ...dim, color: D.text }}>
                <strong>Account: </strong>
                {selected.account ? `${selected.account.name} (${[selected.account.email, selected.account.phone].filter(Boolean).join(" · ")})` : "No account with this email or phone"}
                {selected.match && <div>{`Business: ${selected.match.business}${selected.match.account_manager ? ` · account manager ${selected.match.account_manager}` : ""}`}</div>}
              </div>
              {selected.replies?.length > 0 && (
                <div role="list" aria-label="Replies sent" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {selected.replies.map((r) => (
                    <div key={r.id} role="listitem" style={{ background: D.panelBg2, borderRadius: 10, padding: "8px 10px" }}>
                      <div style={dim}>{`${r.staff_name || "Support"} · ${formatDateTime(r.sent_at)} · ${r.email_sent ? "email sent" : "email not sent"}`}</div>
                      <div style={{ color: D.text, fontSize: "0.82rem", whiteSpace: "pre-wrap" }}>{r.body}</div>
                    </div>
                  ))}
                </div>
              )}
              {selected.passed_to_operations_at && <div style={callout(D.blue)}>{`Passed to Operations by ${selected.passed_by_name || "Support"} · ${formatDateTime(selected.passed_to_operations_at)}`}</div>}
              {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
              {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
              {selected.status !== "resolved" && (selected.has_email ? (
                <>
                  <label style={labelStyle}>Reply by email
                    <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} style={field} />
                  </label>
                  <div style={dim}>Sent from AshantiHub's own address, to the address they wrote from.</div>
                </>
              ) : (
                <div role="alert" style={callout(D.amber)}>This message has no email address. Call them, then log the call.</div>
              ))}
              {passing && (
                <label style={labelStyle}>Note for the Operations lead (optional)
                  <textarea value={passNote} onChange={(e) => setPassNote(e.target.value)} rows={2} style={field} />
                </label>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {selected.status !== "resolved" && selected.has_email && <button type="button" disabled={!body.trim()} onClick={send} style={button(D.green, "#fff", !body.trim())}>Send email</button>}
                {selected.status === "read" && <button type="button" onClick={() => act(`${base}/mark-unread/`, {}, "Could not mark this unread.")} style={button(D.panelBg, D.text)}>Mark unread</button>}
                {selected.status === "new" && <button type="button" onClick={() => act(`${base}/read/`, {}, "Could not mark this read.")} style={button(D.panelBg, D.text)}>Mark read</button>}
                {!selected.passed_to_operations_at && selected.status !== "resolved" && (passing
                  ? <button type="button" onClick={pass} style={button(D.text, D.panelBg)}>Pass it on</button>
                  : <button type="button" onClick={() => setPassing(true)} style={button(D.panelBg, D.text)}>Pass to Operations as a lead</button>)}
                {canCall && selected.match && <button type="button" onClick={() => setCall(selected.match)} style={button(D.panelBg, D.text)}>Log a call</button>}
                {canCall && !selected.match && onNavigate && <button type="button" onClick={() => onNavigate("support-log-call")} style={button(D.panelBg, D.text)}>Log a call</button>}
                {selected.status !== "resolved" && <button type="button" onClick={() => act(`${base}/resolve/`, {}, "Could not resolve this message.")} style={button(D.panelBg, D.text)}>Resolve</button>}
              </div>
            </article>
          )}
        </div>
      )}
      <div style={dim}>Replies go by email only. SMS is not connected, so someone who left only a phone number gets a call from you instead; log it so the queue shows it was handled.</div>
      {call && <LogCallSheet preset={{ type: "business_owner", id: call.business_id, label: call.business }} onClose={() => setCall(null)} onSaved={() => { setCall(null); setNotice("Call saved."); }} />}
    </div>
  );
}
