import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useContactMessagesQueue } from "../../../hooks/useContactMessagesQueue.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard, CONTACT_STATUS_META } from "../theme.js";
import LogCallSheet from "./LogCallSheet.jsx";
import { button, callout, chip, dim, field, pill } from "./panelStyles.js";
import { formatDateTime, labelStyle } from "./portfolioParts.jsx";

// Contact messages (canvas 27): what the public Contact page received. Not
// resolved / New / Resolved, a category filter, and for each message the
// business its sender is matched to by email or phone (the same match Support
// issues uses). Whoever acts is recorded: "Mark read" and "Resolve" are the
// existing endpoints. Replies go out from AshantiHub's own email, never a
// business's.
const TABS = [["open", "Not resolved"], ["new", "New"], ["resolved", "Resolved"]];
const CATEGORIES = [["", "All"], ["general", "General"], ["support", "Support"], ["account", "Account"], ["sales", "Sales"]];
const FOOTER = "Replies go out from AshantiHub's own email, never a business's. A message from a business owner is matched to their business by the owner's email or phone, so it also shows in Support issues.";

export default function ContactMessagesPanel({ auth }) {
  const [tab, setTab] = useState("open");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useContactMessagesQueue({ status: tab, category, page });
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [call, setCall] = useState(null);
  const queryClient = useQueryClient();
  const canCall = auth ? Boolean(auth.hasPermission?.("calls.log")) : false;

  const act = async (id, verb, errText) => {
    setActionError(null); setNotice(null);
    try {
      await apiPost(`/api/core/contact-messages/${id}/${verb}/`, {});
      refetch();
      queryClient.invalidateQueries({ queryKey: ["staff-badges"] });
      queryClient.invalidateQueries({ queryKey: ["service-issues"] });
    } catch (err) { setActionError(apiErrorMessage(err, errText)); }
  };
  const choose = (setter) => (value) => { setter(value); setPage(1); };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the contact messages queue.</div>;
  const items = data?.results || [];
  const pages = Math.max(1, Math.ceil((data?.count ?? items.length) / 20));

  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "1.05rem" }}>Contact messages</div>
      <div style={dim}>Messages sent through the public Contact page. Support works this queue too; whoever acts is recorded.</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div role="group" aria-label="Which messages" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TABS.map(([id, text]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => choose(setTab)(id)} style={pill(tab === id)}>{tab === id ? `${text} · ${data?.count ?? items.length}` : text}</button>
          ))}
        </div>
        <label style={labelStyle}>Category
          <select value={category} onChange={(e) => choose(setCategory)(e.target.value)} style={field}>
            {CATEGORIES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
          </select>
        </label>
      </div>
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>{tab === "open" && !category ? "No contact messages waiting." : "No contact messages here."}</div>}
      {items.map((m) => {
        const statusMeta = CONTACT_STATUS_META[m.status] || { label: m.status, color: D.textDim };
        const match = m.match;
        return (
          <div key={m.id} style={{ padding: "12px 0", borderTop: `1px solid ${D.divider}`, opacity: m.status === "resolved" ? 0.85 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: "1 1 320px" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={chip(statusMeta.color)}>{statusMeta.label}</span>
                  <span style={chip(D.textFaint)}>{m.category}</span>
                  <span style={dim}>{formatDateTime(m.created_at)}</span>
                </div>
                <div style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem", marginTop: 4 }}>{m.subject}</div>
                {m.message && <div style={{ color: D.text, fontSize: "0.78rem", margin: "4px 0", maxWidth: 560 }}>{`"${m.message}"`}</div>}
                <div style={dim}>{[m.name, m.email, m.phone || null].filter(Boolean).join(" · ")}</div>
                {match && <div style={{ color: D.text, fontSize: "0.75rem", fontWeight: 700, marginTop: 2 }}>{`Matched: ${match.business}${match.kyc_status === "pending" ? " (KYC waiting)" : ""}${match.account_manager ? ` · ${match.account_manager}` : ""}`}</div>}
                {m.status === "resolved" && m.resolved_by_name && <div style={dim}>{`Resolved by ${m.resolved_by_name}${m.resolved_at ? ` · ${formatDateTime(m.resolved_at)}` : ""}`}</div>}
              </div>
              {m.status !== "resolved" && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {m.status === "new" && <button type="button" onClick={() => act(m.id, "read", "Could not mark this message as read.")} style={button(D.panelBg, D.text)}>Mark read</button>}
                  {canCall && match && <button type="button" onClick={() => setCall(match)} style={button(D.panelBg, D.text)}>Log a call</button>}
                  <button type="button" onClick={() => act(m.id, "resolve", "Could not resolve this message.")} style={button(D.green, "#fff")}>Resolve</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {pages > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} style={button(D.panelBg, D.text, page <= 1)}>Previous</button>
          <span style={dim}>{`Page ${page} of ${pages}`}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} style={button(D.panelBg, D.text, page >= pages)}>Next</button>
        </div>
      )}
      <div style={dim}>{FOOTER}</div>
      {call && <LogCallSheet preset={{ type: "business_owner", id: call.business_id, label: call.business }} onClose={() => setCall(null)} onSaved={() => { setCall(null); setNotice("Call saved."); }} />}
    </div>
  );
}
