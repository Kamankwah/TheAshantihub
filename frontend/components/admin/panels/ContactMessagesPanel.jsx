import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useContactMessagesQueue } from "../../../hooks/useContactMessagesQueue.js";
import { D, glassCard, CONTACT_STATUS_META } from "../theme.js";

export default function ContactMessagesPanel() {
  // GET /api/core/contact-messages/ is paginated ({count, next, previous,
  // results}), same convention as ReviewsModerationPanel/
  // useReviewsModerationQueue — `items` reads data?.results, not data||[].
  // Resolved is a final state (no un-resolving), so "Mark read" is hidden
  // once a message is resolved.
  const { data, isLoading, isError, refetch } = useContactMessagesQueue();
  const [actionError, setActionError] = useState(null);

  const markRead = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/core/contact-messages/${id}/read/`, {}); refetch(); }
    catch (err) { setActionError("Could not mark this message as read."); }
  };
  const resolve = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/core/contact-messages/${id}/resolve/`, {}); refetch(); }
    catch (err) { setActionError("Could not resolve this message."); }
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the contact messages queue.</div>;
  const items = data?.results || [];

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>Contact Messages ({data?.count ?? items.length})</div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No contact messages yet.</div>}
      {items.map(m => {
        const statusMeta = CONTACT_STATUS_META[m.status] || { label: m.status, color: D.textDim };
        return (
          <div key={m.id} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>
                  {m.subject} <span style={{ color: D.textDim, fontWeight: 400 }}>({m.category})</span>
                  <span style={{ background: `${statusMeta.color}22`, color: statusMeta.color, borderRadius: 20, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 700, marginLeft: 6 }}>{statusMeta.label}</span>
                </div>
                {m.message && <div style={{ color: D.textDim, fontSize: "0.75rem", margin: "4px 0", maxWidth: 420 }}>"{m.message}"</div>}
                <div style={{ color: D.textDim, fontSize: "0.65rem" }}>{m.name} • {m.email}{m.phone ? ` • ${m.phone}` : ""} • {m.created_at?.slice(0, 10)}</div>
                {m.status === "resolved" && m.resolved_by_name && <div style={{ color: D.green, fontSize: "0.65rem", marginTop: 2 }}>Resolved by {m.resolved_by_name}{m.resolved_at ? ` on ${m.resolved_at.slice(0, 10)}` : ""}</div>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {m.status !== "resolved" && <button onClick={() => markRead(m.id)} style={{ background: "rgba(251,191,36,0.16)", color: D.amber, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>Mark read</button>}
                {m.status !== "resolved" && <button onClick={() => resolve(m.id)} style={{ background: D.green, color: "#04210f", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>Resolve</button>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
