import { useState } from "react";
import { apiFetch, apiPost } from "../../../apiClient.js";
import { useStaffMessagingQueue } from "../../../hooks/useStaffMessagingQueue.js";
import { D, glassCard } from "../theme.js";

const SENDER_LABEL = { customer: "Customer", business_owner: "Business Owner", staff: "Staff" };

// Staff support-ticket view (messaging app, messaging.manage permission).
// The list (useStaffMessagingQueue, paginated — data?.results, same gotcha
// as EscrowLedgerPanel/ContactMessagesPanel) shows every conversation with a
// needs_reply indicator; clicking one fetches its full thread
// (GET /api/messaging/staff/{id}/ — a plain apiFetch call, not a dedicated
// hook, since it's only ever needed once a row is expanded) and reveals a
// reply box (POST /api/messaging/staff/{id}/reply/, then refetch() both the
// thread and the list so the needs_reply badge updates without a page
// reload).
export default function MessagingPanel() {
  const { data, isLoading, isError, refetch } = useStaffMessagingQueue();
  const [expandedId, setExpandedId] = useState(null);
  const [thread, setThread] = useState(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [actionError, setActionError] = useState(null);
  const [sending, setSending] = useState(false);

  const openThread = async (id) => {
    if (expandedId === id) { setExpandedId(null); setThread(null); return; }
    setExpandedId(id);
    setThread(null);
    setActionError(null);
    setThreadLoading(true);
    try {
      const full = await apiFetch(`/api/messaging/staff/${id}/`);
      setThread(full);
    } catch (err) {
      setActionError("Could not load this conversation.");
    } finally {
      setThreadLoading(false);
    }
  };

  const sendReply = async (id) => {
    if (!replyBody.trim()) return;
    setActionError(null);
    setSending(true);
    try {
      await apiPost(`/api/messaging/staff/${id}/reply/`, { body: replyBody });
      const full = await apiFetch(`/api/messaging/staff/${id}/`);
      setThread(full);
      setReplyBody("");
      refetch();
    } catch (err) {
      setActionError("Could not send this reply.");
    } finally {
      setSending(false);
    }
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the messaging queue.</div>;
  const items = data?.results || [];

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>Messaging / Tickets ({data?.count ?? items.length})</div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No conversations yet.</div>}
      {items.map(conv => (
        <div key={conv.id} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
          <div onClick={() => openThread(conv.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", cursor: "pointer" }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>
                {conv.starter_name} <span style={{ color: D.textDim, fontWeight: 400 }}>({conv.subject || "No subject"})</span>
                {conv.needs_reply && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: D.red, marginLeft: 8, verticalAlign: "middle" }} title="Needs reply" />}
                <span style={{ background: conv.status === "open" ? "rgba(96,165,250,0.16)" : "rgba(148,164,191,0.16)", color: conv.status === "open" ? D.blue : D.textDim, borderRadius: 20, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 700, marginLeft: 6 }}>{conv.status}</span>
              </div>
              <div style={{ color: D.textDim, fontSize: "0.65rem", marginTop: 2 }}>
                {conv.customer ? "Customer" : "Business Owner"} • Last activity {conv.last_message_at?.slice(0, 10)}
              </div>
            </div>
          </div>
          {expandedId === conv.id && (
            <div style={{ marginTop: 10, background: D.panelBg2, borderRadius: 12, padding: 12 }}>
              {threadLoading && <div style={{ color: D.textDim, fontSize: "0.75rem" }}>Loading thread…</div>}
              {thread && (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                    {thread.messages?.map(msg => (
                      <div key={msg.id} style={{ fontSize: "0.75rem" }}>
                        <span style={{ fontWeight: 700, color: msg.sender_type === "staff" ? D.gold : D.text }}>{SENDER_LABEL[msg.sender_type] || msg.sender_type}:</span>{" "}
                        <span style={{ color: D.textDim }}>{msg.body}</span>
                        <span style={{ color: D.textFaint, fontSize: "0.62rem", marginLeft: 6 }}>{msg.created_at?.slice(0, 16).replace("T", " ")}</span>
                      </div>
                    ))}
                    {thread.messages?.length === 0 && <div style={{ color: D.textFaint, fontSize: "0.72rem" }}>No messages.</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={replyBody} onChange={e => setReplyBody(e.target.value)} placeholder="Reply as AshantiHub Support…" style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelSolid, color: D.text }} />
                    <button onClick={() => sendReply(conv.id)} disabled={!replyBody.trim() || sending} style={{ background: D.gold, color: "#1a1205", border: "none", borderRadius: 20, padding: "6px 14px", fontSize: "0.72rem", fontWeight: 800, cursor: replyBody.trim() && !sending ? "pointer" : "default", opacity: replyBody.trim() && !sending ? 1 : 0.6 }}>Reply</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
