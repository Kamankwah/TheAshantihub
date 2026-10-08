import { D, glassCard } from "./theme.js";

// "Renew by …": the clock sends an ISO date (YYYY-MM-DD). Read it as that
// calendar day, not as a UTC midnight a browser west of Greenwich would show
// as the day before.
function calendarDay(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// Staff phase 2A, S7: a lapsed subscription has 14 days of grace, then the
// business's listings are hidden (never deleted) until it pays. The banner
// shows only while that clock runs (overdue) or has paused the business —
// never for an active, trial or absent subscription. `subscription.clock`
// is billing.clock.subscription_state() from GET /api/billing/subscriptions/me/.
export default function RenewBanner({ subscription, onRenew }) {
  const clock = subscription?.clock;
  if (clock?.state !== "overdue" && clock?.state !== "paused") return null;
  const paused = clock.state === "paused";
  const color = paused ? D.red : D.amber;
  const message = paused
    ? "Your listings are hidden until you renew. Nothing has been deleted."
    : clock.renew_by
      ? `Your subscription has ended. Renew by ${calendarDay(clock.renew_by)} to keep your listings visible.`
      : "Your subscription has ended. Renew now to keep your listings visible.";
  return (
    <section aria-label="Renew your subscription" style={{
      ...glassCard, padding: "14px 16px", marginBottom: 16, borderLeft: `4px solid ${color}`,
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        {!paused && clock.overdue_day != null && (
          <span style={{ display: "inline-block", background: `${color}1f`, border: `1px solid ${color}55`, borderRadius: 999, padding: "2px 9px", fontSize: "0.66rem", fontWeight: 800, color: D.text, marginBottom: 6 }}>
            Day {clock.overdue_day} of 14
          </span>
        )}
        <div style={{ fontWeight: 800, color: D.text, fontSize: "0.88rem", lineHeight: 1.5 }}>{message}</div>
      </div>
      <button type="button" onClick={onRenew} style={{
        background: D.gold, color: D.text, border: "none", borderRadius: 20, padding: "10px 18px", minHeight: 44,
        fontWeight: 900, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
      }}>Renew now</button>
    </section>
  );
}
