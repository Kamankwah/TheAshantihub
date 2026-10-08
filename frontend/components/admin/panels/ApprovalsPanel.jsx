import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useApproval, useApprovalCounts, useApprovals } from "../../../hooks/useApprovals.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { describeWait, timeAgo } from "../../../lib/timeAgo.js";
import { D, glassCard } from "../theme.js";
import { button, chip, dim, field, pill } from "./panelStyles.js";

const BOXES = [
  ["mine", "Waiting for me"],
  ["made", "Made by me"],
  ["team", "My team's"],
  ["decided", "Decided by me"],
  ["all", "Everything"],
];
const EMPTY = {
  mine: "Nothing is waiting for your decision.",
  made: "You haven't asked for any approvals.",
  team: "Nobody in your team has asked for an approval.",
  decided: "You haven't decided any requests yet.",
  all: "There are no approval requests yet.",
};
const STATUS = {
  pending: ["Waiting", D.amber],
  approved: ["Approved", D.green],
  rejected: ["Returned", D.red],
  cancelled: ["Cancelled", D.textFaint],
  expired: ["Expired", D.textFaint],
};
const show = (value) => (value === null || value === undefined || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value));
const roleName = (role) => (role || "").replace("_", " ");

function stageText(a) {
  if (a.stage === "manager") return `With ${a.assigned_to?.full_name || "their manager"}`;
  if (a.stage === "pool") return "With anyone who can approve this";
  return "With a Super Admin";
}

// /staff/approvals (inbox) and /staff/approvals/<id> (one request).
export default function ApprovalsPanel({ detailId, onOpenDetail }) {
  if (detailId != null) return <ApprovalRequest id={detailId} onBack={() => onOpenDetail(null)} />;
  return <ApprovalsInbox onOpen={(id) => onOpenDetail(id)} />;
}

function ApprovalsInbox({ onOpen }) {
  const [box, setBox] = useState("mine");
  const { data: counts } = useApprovalCounts();
  const { data, isLoading, isError } = useApprovals(box);
  const rows = data?.results || [];
  const label = (id, text) => (counts?.[id] ? `${text} · ${counts[id]}` : text);
  const boxes = BOXES.filter(([id]) => id !== "all" || counts?.can_view_all);
  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Approvals</div>
      <div role="group" aria-label="Which requests" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {boxes.map(([id, text]) => (
          <button key={id} type="button" aria-pressed={box === id} onClick={() => setBox(id)} style={pill(box === id)}>{label(id, text)}</button>
        ))}
      </div>
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load approvals.</div>}
      {!isLoading && !isError && rows.length === 0 && (
        <div style={dim}>{EMPTY[box]} Requests appear here when a change needs someone else's approval.</div>
      )}
      {rows.map((a) => (
        <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 0", borderTop: `1px solid ${D.divider}`, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 260px" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={chip(D.blue)}>{a.kind_label}</span>
              <span style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{a.title}</span>
            </div>
            <div style={{ ...dim, marginTop: 2 }}>
              {a.maker.full_name} · {roleName(a.maker.role)} · {timeAgo(a.created_at)} ago · {a.status === "pending" ? describeWait(a.due_at) : (STATUS[a.status]?.[0] || a.status)}
            </div>
          </div>
          <button type="button" aria-label={`Open ${a.title}`} onClick={() => onOpen(a.id)} style={button(D.panelBg, D.text)}>Open</button>
        </div>
      ))}
    </div>
  );
}

function ApprovalRequest({ id, onBack }) {
  const { data: a, isLoading, isError, error, refetch } = useApproval(id);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  // A decision changes the inbox, its box counts, the sidebar badge and the
  // maker's notifications, so refresh them all.
  const refreshRelated = () => ['approvals', 'approval-counts', 'staff-badges', 'notifications'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

  const act = async (action, body) => {
    setActionError(null);
    setBusy(true);
    try {
      await apiPost(`/api/approvals/${id}/${action}/`, body);
      setNote("");
      refetch();
      refreshRelated();
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not save the decision."));
      // The record may have changed or been decided meanwhile.
      refetch();
      refreshRelated();
    } finally {
      setBusy(false);
    }
  };

  const back = <button type="button" onClick={onBack} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>← Approvals</button>;
  const card = { ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 };
  if (isLoading) return <div style={card}>{back}<div style={dim}>Loading…</div></div>;
  if (isError && error?.status !== 404) return <div style={card}>{back}<div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Couldn't load this request. Try again.</div><button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Try again</button></div>;
  if (isError || !a) return <div style={card}>{back}<div style={{ color: D.red, fontSize: "0.8rem" }}>This request doesn't exist, or isn't one you can see.</div></div>;

  const [statusLabel, statusColor] = STATUS[a.status] || [a.status, D.textDim];
  return (
    <div style={card}>
      {back}
      <div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={chip(D.blue)}>{a.kind_label}</span>
          <span style={chip(statusColor)}>{statusLabel}</span>
        </div>
        <h2 style={{ color: D.text, fontSize: "1.05rem", margin: "8px 0 4px" }}>{a.title}</h2>
        <div style={dim}>Made by {a.maker.full_name} · {roleName(a.maker.role)} · {new Date(a.created_at).toLocaleString("en-GH")} ({timeAgo(a.created_at)} ago)</div>
        {a.status === "pending" && <div style={dim}>{stageText(a)} · {describeWait(a.due_at)}</div>}
        {a.target.label && <div style={dim}>About: {a.target.label}</div>}
      </div>
      {a.maker_note && <div style={{ background: D.panelBg2, borderRadius: 10, padding: "8px 12px", color: D.text, fontSize: "0.8rem" }}>“{a.maker_note}”</div>}
      <table aria-label="What would change" style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem", fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr style={{ color: D.textDim, textAlign: "left" }}>
            <th style={{ padding: "6px 8px" }}>Field</th><th style={{ padding: "6px 8px" }}>Now</th><th style={{ padding: "6px 8px" }}>After approval</th>
          </tr>
        </thead>
        <tbody>
          {a.diff.map((row) => (
            <tr key={row.field || "value"} style={{ borderTop: `1px solid ${D.divider}`, color: D.text }}>
              <td style={{ padding: "6px 8px", fontWeight: 700 }}>{String(row.field || "").replace(/_/g, " ")}</td>
              <td style={{ padding: "6px 8px" }}>{show(row.before)}</td>
              <td style={{ padding: "6px 8px" }}>{show(row.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {a.stale && <div role="alert" style={{ color: D.red, fontWeight: 700, fontSize: "0.8rem" }}>This changed since it was requested — ask for a fresh request.</div>}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      {a.can_decide && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text }}>
            Note to {a.maker.full_name} (required to return)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={field} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={busy || a.stale} onClick={() => act("approve", { note })} style={button(D.green, D.panelBg, busy || a.stale)}>Approve</button>
            <button type="button" disabled={busy || !note.trim()} onClick={() => act("reject", { note })} style={button(D.panelBg, D.red, busy || !note.trim())}>Return with note</button>
          </div>
        </div>
      )}
      {a.status === "pending" && a.can_cancel && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={dim}>You made this request. You can cancel it while it's waiting.</span>
          <button type="button" disabled={busy} onClick={() => act("cancel", {})} style={button(D.panelBg, D.text, busy)}>Cancel request</button>
        </div>
      )}
      {a.status !== "pending" && a.decided_by && (
        <div style={dim}>{statusLabel} by {a.decided_by.full_name} on {new Date(a.decided_at).toLocaleString("en-GH")}{a.decision_note ? `: “${a.decision_note}”` : ""}</div>
      )}
    </div>
  );
}
