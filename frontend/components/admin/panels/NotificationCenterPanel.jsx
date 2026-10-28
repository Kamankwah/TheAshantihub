import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useNotificationCenter } from "../../../hooks/useStaffSecurity.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, chip, dim, pill } from "./panelStyles.js";
import { errorStyle, h2 } from "./portfolioParts.jsx";
import { page, section, sectionTitle } from "./insightsParts.jsx";

// ─── Super Admin 15 Notification center ──────────────────────────────────────
// Every notification sent to the signed-in person, with a filter by kind, mark as read and a
// link to the screen it is about. In-app is the only channel that exists: the bell and this
// page. Push, SMS and e-mail notices are not connected, and the page says so.
const KIND_WORDS = {
  approval_waiting: "Approval waiting", approval_applied_directly: "Applied directly", approval_decided: "Approval decided",
  approval_escalated: "Approval overdue", approval_reminder: "Approval reminder", fraud_flag_raised: "Fraud case",
  scheduled_export_ready: "Export ready", announcement: "Announcement", security_policy_changed: "Security change",
  report_submitted: "Report submitted", report_reminder: "Report reminder", kyc_needs_approval: "KYC waiting",
  listing_needs_moderation: "Listing waiting", event_needs_approval: "Event waiting", hero_needs_approval: "Hero waiting",
  contact_message: "Contact message", new_message: "Support message", support_reply: "Support reply", otp_sms_spend: "Text spend",
};
export const kindWords = (kind) => KIND_WORDS[kind] || (kind || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const stamp = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

export default function NotificationCenterPanel({ onNavigate, knownScreens }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState(null);
  const { data, isLoading, isError, refetch } = useNotificationCenter({ kind, unread: unreadOnly ? "1" : "" });
  const rows = data?.results || [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });
  const canOpen = (link) => Boolean(link) && Boolean(onNavigate) && (!knownScreens || knownScreens.has(link));

  const markAll = async () => {
    setError(null);
    try { await apiPost("/api/notifications/read-all/", {}); refresh(); }
    catch (err) { setError(apiErrorMessage(err, "Could not mark them as read.")); }
  };
  const open = async (n) => {
    setError(null);
    try { if (!n.is_read) await apiPost(`/api/notifications/${n.id}/read/`, {}); refresh(); }
    catch (err) { setError(apiErrorMessage(err, "Could not mark it as read.")); return; }
    if (canOpen(n.link)) onNavigate(n.link);
  };

  return (
    <div style={page}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <h2 style={{ ...h2, fontSize: "1.4rem" }}>Notification center</h2>
        <button type="button" disabled={!data?.unread_count} onClick={markAll} style={button(D.panelBg, D.text, !data?.unread_count)}>Mark all as read</button>
      </div>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <section aria-label="Notifications" style={section}>
        <div role="group" aria-label="Filter by kind" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" aria-pressed={kind === ""} onClick={() => setKind("")} style={pill(kind === "")}>All</button>
          {(data?.kinds || []).map((k) => (
            <button key={k.kind} type="button" aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)} style={pill(kind === k.kind)}>{`${kindWords(k.kind)} · ${k.total}`}</button>
          ))}
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: "0.78rem", color: D.text, marginLeft: 6 }}>
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only
          </label>
        </div>
        {isLoading && <div role="status" style={dim}>Loading…</div>}
        {isError && <div role="alert" style={errorStyle}>Could not load your notifications. <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button></div>}
        {data && rows.length === 0 && <div style={dim}>{kind || unreadOnly ? "Nothing matches that filter." : "No notifications yet."}</div>}
        <ul aria-label="Your notifications" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
          {rows.map((n) => (
            <li key={n.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderTop: `1px solid ${D.divider}`, opacity: n.is_read ? 0.75 : 1 }}>
              <span aria-hidden="true" style={{ fontSize: "1.1rem" }}>{n.icon || "🔔"}</span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={chip(D.textFaint)}>{kindWords(n.kind)}</span>
                  {!n.is_read && <span style={chip(D.gold)}>New</span>}
                  <span style={dim}>{stamp(n.created_at)}</span>
                </div>
                <div style={{ fontWeight: n.is_read ? 600 : 800, fontSize: "0.85rem", color: D.text }}>{n.title}</div>
                {n.body && <div style={{ fontSize: "0.78rem", color: D.text }}>{n.body}</div>}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {canOpen(n.link) && <button type="button" onClick={() => open(n)} style={button(D.panelBg, D.text)} aria-label={`Open: ${n.title}`}>Open</button>}
                {!n.is_read && <button type="button" onClick={() => open({ ...n, link: "" })} style={button(D.panelBg, D.text)} aria-label={`Mark as read: ${n.title}`}>Mark read</button>}
              </div>
            </li>
          ))}
        </ul>
        <div style={dim}>Shows your latest 200. The bell in the header shows the same notifications.</div>
      </section>
      <section aria-label="How you’re told" style={section}>
        <h3 style={sectionTitle}>How you’re told</h3>
        <div role="note" style={callout(D.amber)}>In-app only. Every notification appears in the bell and on this page, and cannot be turned off.</div>
        <div style={dim}>Push, SMS and e-mail notices are not connected, so there is nothing to choose per kind. Opening a notice takes you to the screen it is about; that screen checks again what you may see.</div>
      </section>
    </div>
  );
}
