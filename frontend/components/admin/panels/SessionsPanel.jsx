import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useActiveSessions } from "../../../hooks/useStaffSessions.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, ROLE_ACCENTS, ROLE_BADGE_TEXT, glassCard } from "../theme.js";
import { button, dim } from "./panelStyles.js";

const small = (disabled, color) => ({ ...button(D.panelBg, color, disabled), padding: "6px 12px", fontSize: "0.72rem" });
const time = (iso) => new Date(iso).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" });
const KEYS = [["active-sessions"], ["my-sessions"], ["staff-roster"]];

// Sessions & Devices (F9, staff.manage): everyone signed in now. Ending a
// session or signing someone out of every device takes effect at once — the
// next request is refused and any live connection is dropped. Your own
// current session has no End button: ending it is signing out.
export default function SessionsPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useActiveSessions();
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const sessions = data || [];
  const people = [];
  const byPerson = new Map();
  for (const s of sessions) {
    if (!byPerson.has(s.staff.id)) {
      byPerson.set(s.staff.id, { staff: s.staff, sessions: [] });
      people.push(byPerson.get(s.staff.id));
    }
    byPerson.get(s.staff.id).sessions.push(s);
  }
  // One action at a time; the lists refresh whether it worked or was refused.
  const run = async (fn, okText, failText) => {
    if (busy) return;
    setMessage(null);
    setActionError(null);
    setBusy(true);
    try { await fn(); setMessage(okText); }
    catch (err) { setActionError(apiErrorMessage(err, failText)); }
    finally {
      setBusy(false);
      KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    }
  };

  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Everyone signed in now</div>
      {!isLoading && !isError && sessions.length > 0 && <div style={{ color: D.text, fontSize: "0.82rem", fontVariantNumeric: "tabular-nums" }}>{sessions.length} sessions on {people.length} people's devices</div>}
      <div style={dim}>Ending a session signs that device out at once. Both actions are recorded.</div>
      {isLoading && <div role="status" style={dim}>Loading…</div>}
      {isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load sessions.</div>}
      {!isLoading && !isError && sessions.length === 0 && <div style={dim}>Nobody is signed in right now.</div>}
      {message && <div role="status" style={{ color: D.text, fontSize: "0.8rem" }}>{message}</div>}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      {people.map(({ staff, sessions: own }) => {
        const isMe = own.some((s) => s.is_current);
        return (
          <div key={staff.id} style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{staff.full_name}</span>
                <span style={{ background: ROLE_ACCENTS[staff.role] || D.textDim, color: ROLE_BADGE_TEXT[staff.role] || D.panelBg, borderRadius: 999, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 800 }}>{staff.role.replace("_", " ")}</span>
              </div>
              {!isMe && (
                <button type="button" aria-label={`Sign out all of ${staff.full_name}'s devices`} disabled={busy}
                  onClick={() => run(() => apiPost(`/api/accounts/staff/${staff.id}/sign-out-everywhere/`, {}), `${staff.full_name} is signed out of every device.`, "Could not sign them out.")}
                  style={small(busy, D.red)}>Sign out all devices</button>
              )}
            </div>
            {own.map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: "0.75rem", color: D.text }}>
                <span>{s.device_label}{s.is_current ? " · this device" : ""}{s.two_factor ? " · 2-step" : ""} · {s.ip || "no IP"} · signed in {time(s.created_at)} · last seen {time(s.last_seen_at)} · idle sign-out {time(s.idle_ends_at)} · ends {time(s.ends_at)}</span>
                {!s.is_current && (
                  <button type="button" aria-label={`End ${staff.full_name}'s session on ${s.device_label}`} disabled={busy}
                    onClick={() => run(() => apiPost(`/api/accounts/staff/sessions/${s.id}/end/`, {}), "Session ended.", "Could not end that session.")}
                    style={small(busy, D.text)}>End session</button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
