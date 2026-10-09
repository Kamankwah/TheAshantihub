import { D } from "../theme.js";
import { dim } from "./panelStyles.js";

// Plain-words reasons for StaffSession.revoked_reason (backend REASON_CHOICES).
// An unknown value is shown as the server sent it, never hidden or guessed.
const REASONS = {
  signed_out: "Signed out",
  ended: "Ended from another device",
  signed_out_everywhere: "Signed out of every device by a Super Admin",
  suspended: "Account suspended",
  deactivated: "Account deactivated",
  password_reset: "Password reset",
  idle: "30 minutes without activity",
  expired: "12-hour limit reached",
};
export const reasonWords = (reason) => REASONS[reason] || reason;

const sameDay = (a, b) => a.toDateString() === b.toDateString();

// "09:40" for today; "7 Oct, 09:40" for any other day.
export function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return sameDay(d, new Date()) ? time : `${d.toLocaleDateString("en-GH", { day: "numeric", month: "short" })}, ${time}`;
}

// The most recent sign-ins the server lists (up to 50, from the 90 days it
// keeps): device, IP, started, last seen and, for an ended one, why it ended.
// Read-only: no End buttons here.
export function SignInHistory({ sessions, label, isLoading, isError }) {
  if (isLoading) return <div role="status" style={dim}>Loading…</div>;
  if (isError) return <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the sign-in history.</div>;
  if (!sessions || sessions.length === 0) return <div style={dim}>No sign-ins in the last 90 days.</div>;
  const ordered = [...sessions].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return (
    <ul aria-label={label} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {ordered.map((s) => (
        <li key={s.id} style={{ color: D.text, fontSize: "0.75rem", lineHeight: 1.5 }}>
          <span style={{ fontWeight: 700 }}>{s.device_label}</span>
          {s.two_factor ? " · 2-step" : ""}{s.ip ? ` · ${s.ip}` : ""} · started {when(s.created_at)} · last seen {when(s.last_seen_at)}
          {s.revoked_at ? <span style={{ color: D.textDim }}> · Ended: {reasonWords(s.revoked_reason) || "ended"}</span> : s.is_active ? " · still signed in" : ""}
        </li>
      ))}
    </ul>
  );
}

// A roster row's last sign-in (StaffListSerializer.last_sign_in_at, from the
// sessions the server keeps for 90 days). null means none in that time —
// never "Never"; a payload without the field shows nothing rather than a guess.
export function LastSignIn({ staff, style }) {
  if (!staff || !("last_sign_in_at" in staff)) return null;
  return (
    <div style={{ color: D.textDim, fontSize: "0.66rem", ...style }}>
      {staff.last_sign_in_at ? `Last sign-in ${when(staff.last_sign_in_at)}` : "No sign-in in the last 90 days"}
    </div>
  );
}
