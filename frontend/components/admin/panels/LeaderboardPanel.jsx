import { useLeaderboard } from "../../../hooks/useLeaderboard.js";
import { D, glassCard } from "../theme.js";
import { button, dim } from "./panelStyles.js";
import { errorStyle, eyebrow, h3 } from "./portfolioParts.jsx";

// ─── 18 Leaderboard ──────────────────────────────────────────────────────────
// The scout's team ranked by activations: a business they registered, with KYC
// approved and its first listing live. Counts only, from the server. Leave days
// are shown beside a name and never subtracted; no one's money appears here.
const figures = { fontVariantNumeric: "tabular-nums" };
const local = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T12:00:00`) : new Date(value));
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDay = (value) => { const d = local(value); return `${d.getDate()} ${LONG[d.getMonth()]}`; };
const monthName = (month) => LONG[local(`${month}-01`).getMonth()];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const firstName = (name) => String(name).split(" ")[0];

export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

export function headline(data) {
  const joint = data.rows.filter((r) => r.rank === data.my_rank).length > 1;
  return `You're ${joint ? "joint " : ""}${ordinal(data.my_rank)} so far`;
}

export function summary(data) {
  const n = data.my_count;
  const parts = [n === 0 ? "No activations yet this month." : `${plural(n, "activation", "activations")} so far.`];
  if (data.gap) parts.push(`${data.gap.count} more puts you level with ${data.gap.name}.`);
  else if (data.rows.length > 1 && n > 0) parts.push("You're at the top of the team.");
  return parts.join(" ");
}

export function rowLine(row) {
  const parts = [];
  if (row.areas?.length) parts.push(row.areas.join(" & "));
  if (row.leave_days) parts.push(plural(row.leave_days, "leave day", "leave days"));
  const text = parts.join(" · ");
  return { text, tag: row.most_improved ? "Most improved" : "" };
}

export default function LeaderboardPanel() {
  const { data, isLoading, isError, refetch } = useLeaderboard();
  const top = data ? Math.max(1, ...data.rows.map((r) => r.activations)) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div>
        <div style={eyebrow}>Performance</div>
        <h2 style={{ color: D.text, fontSize: "1.4rem", fontWeight: 800, margin: "2px 0 0" }}>Leaderboard</h2>
        {data && <div style={dim}>{`${data.lead ? `${data.lead.name}'s team` : "Your team"} · ${monthName(data.month)}`}</div>}
      </div>

      {isLoading && <div style={dim}>Loading…</div>}
      {isError && (
        <div role="alert" style={errorStyle}>
          Couldn't load the leaderboard.{" "}
          <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button>
        </div>
      )}

      {data && (
        <>
          <section aria-labelledby="lb-me" style={{ ...glassCard, border: `2px solid ${D.gold}`, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
            <h3 id="lb-me" style={{ margin: 0, fontSize: "1.3rem", fontWeight: 800, color: D.text }}>{headline(data)}</h3>
            <div style={{ fontSize: "0.88rem", lineHeight: 1.45, color: D.text, ...figures }}>{summary(data)}</div>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: D.textDim, marginTop: 4, ...figures }}>
              {`Team total: ${plural(data.team_total, "activation", "activations")} by ${longDay(data.as_of)}`}
            </div>
          </section>

          <section aria-labelledby="lb-rank" style={{ ...glassCard, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
            <h3 id="lb-rank" style={{ ...h3, fontSize: "0.95rem", marginBottom: 6 }}>Activations this month</h3>
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
              {data.rows.map((row) => {
                const { text, tag } = rowLine(row);
                return (
                  <li key={row.name} aria-current={row.is_me ? "true" : undefined}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 8px", margin: "0 -8px", borderRadius: 10, background: row.is_me ? "#F5ECD8" : "transparent", borderTop: `1px solid ${D.divider}` }}>
                    <span aria-label={`Rank ${row.rank}`} style={{ width: 26, height: 26, flex: "none", borderRadius: 999, background: "#F5ECD8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 800, color: D.text, ...figures }}>{row.rank}</span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                        <span style={{ fontSize: "0.88rem", fontWeight: row.is_me ? 800 : 700, color: D.text }}>{row.is_me ? `${row.name} (you)` : row.name}</span>
                        <span style={{ fontSize: "0.95rem", fontWeight: 800, color: D.text, ...figures }}>{row.activations}</span>
                      </span>
                      <span role="progressbar" aria-label={`${row.name} activations`} aria-valuemin={0} aria-valuemax={top} aria-valuenow={row.activations}
                        style={{ height: 6, borderRadius: 999, background: "#EADFC6", overflow: "hidden", display: "block" }}>
                        <span style={{ display: "block", height: 6, width: `${Math.round((row.activations / top) * 100)}%`, background: D.text, borderRadius: 999 }} />
                      </span>
                      {(text || tag) && (
                        <span style={{ fontSize: "0.75rem", color: D.textDim }}>
                          {text}
                          {tag && <span style={{ fontWeight: 800, color: "#00500A" }}>{text ? ` · ${tag}` : tag}</span>}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>

          {data.most_improved && (
            <section aria-labelledby="lb-mi" style={{ background: "#E3F1E3", borderRadius: 16, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 2, color: "#00400A" }}>
              <h3 id="lb-mi" style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800 }}>{`Most improved: ${data.most_improved.name}`}</h3>
              <span style={{ fontSize: "0.82rem", lineHeight: 1.45 }}>
                {`${plural(data.most_improved.now, "activation", "activations")} by ${longDay(data.most_improved.as_of)}, up from ${data.most_improved.then} at the same point in ${monthName(data.most_improved.then_month)}. Well done, ${firstName(data.most_improved.name)}.`}
              </span>
            </section>
          )}

          <div style={{ fontSize: "0.75rem", lineHeight: 1.45, color: D.textDim }}>
            An activation is a business you registered with KYC approved and its first listing live. Leave days and holidays never count against anyone.
          </div>
        </>
      )}
    </div>
  );
}
