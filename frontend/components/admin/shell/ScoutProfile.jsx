import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useMySessions } from "../../../hooks/useStaffSessions.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { RoleChip } from "./StaffHeader.jsx";
import { D } from "../theme.js";
import { chip, dim } from "../panels/panelStyles.js";
import { when } from "../panels/sessionParts.jsx";

// The scout's profile in the drawer (canvas 20): who they are and who they
// report to, taken from GET /api/accounts/me/; and the devices signed in,
// reusing the phase 1B sessions endpoints. No place names: sessions carry none.
const ROLE_NAMES = { super_admin: "Super Admin", operations: "Operations", accountant: "Accountant", marketing: "Marketing", support: "Support", scout: "Scout", delivery_manager: "Delivery Manager", dispatch: "Dispatch" };
const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");

export function ScoutProfileBlock({ user, roleColor }) {
  const areas = Array.isArray(user?.areas) ? user.areas.join(" & ") : "";
  const count = user?.portfolio_count;
  const placeLine = [areas, count != null ? `${count} ${count === 1 ? "business" : "businesses"}` : null].filter(Boolean).join(" · ");
  const manager = user?.manager;
  return (
    <div style={{ padding: "14px 14px 12px", borderBottom: `1px solid ${D.divider}`, display: "flex", gap: 12, alignItems: "center" }}>
      <div aria-hidden="true" style={{ width: 48, height: 48, borderRadius: "50%", background: D.text, color: "#FDF6E3", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, flexShrink: 0 }}>{initials(user?.full_name)}</div>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>{user?.full_name}</span>
          <RoleChip role="scout" roleColor={roleColor} />
        </div>
        {placeLine && <div style={dim}>{placeLine}</div>}
        {manager && <div style={dim}>{`Reports to ${manager.full_name} (${ROLE_NAMES[manager.role] || manager.role})`}</div>}
      </div>
    </div>
  );
}

const pillButton = { minHeight: 44, background: "transparent", border: `1px solid ${D.divider}`, color: D.text, borderRadius: 20, padding: "0 16px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

export function ScoutDevices() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useMySessions();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = (data || []).filter((s) => s.is_active);
  const others = active.filter((s) => !s.is_current);

  const run = async (path, failText) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try { await apiPost(path, {}); }
    catch (err) { setError(apiErrorMessage(err, failText)); }
    finally {
      setBusy(false);
      queryClient.invalidateQueries({ queryKey: ["my-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["active-sessions"] });
    }
  };

  return (
    <section aria-label="Signed in on" style={{ padding: "12px 14px", borderTop: `1px solid ${D.divider}`, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Signed in on</div>
      {isLoading && <div role="status" style={dim}>Loading…</div>}
      {isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your devices.</div>}
      {active.map((s) => (
        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {s.device_label}{s.is_current && <span style={chip(D.green)}>This device</span>}
            </div>
            <div style={dim}>{s.is_current ? `Since ${when(s.created_at)}` : `Last used ${when(s.last_seen_at)}`}</div>
          </div>
          {!s.is_current && (
            <button type="button" aria-label={`Sign out ${s.device_label}`} disabled={busy} onClick={() => run(`/api/accounts/staff/sessions/${s.id}/end/`, "Could not sign that device out.")}
              style={{ ...pillButton, opacity: busy ? 0.5 : 1 }}>Sign out</button>
          )}
        </div>
      ))}
      {others.length > 0 && (
        <button type="button" disabled={busy} onClick={() => run("/api/accounts/staff/sessions/end-others/", "Could not sign out your other devices.")}
          style={{ ...pillButton, alignSelf: "flex-start", opacity: busy ? 0.5 : 1 }}>Sign out all other devices</button>
      )}
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
      <div style={{ ...dim, lineHeight: 1.45 }}>For safety you're signed out after 30 minutes without use, and after 12 hours.</div>
    </section>
  );
}
