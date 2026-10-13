import { useState } from "react";
import { useSignInHistory } from "../../../hooks/useStaffSecurity.js";
import { D, ROLE_ACCENTS, ROLE_BADGE_TEXT, glassCard } from "../theme.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { errorStyle, h2, labelStyle } from "./portfolioParts.jsx";
import { Kpi, kpiGrid, page, section, sectionTitle } from "./insightsParts.jsx";

// ─── Super Admin 11 Sign-in history ──────────────────────────────────────────
// Staff sign-ins, sign-outs, 2-step results, refusals, timeouts and password
// re-entries, with device and address. It is written from the day this shipped, so
// nothing older exists and the screen says so. A refused attempt keeps only a masked
// form of the address typed, never the password, and reads the same whether or not
// the address belongs to anyone.
const WHAT = [
  ["", "Everything"], ["signed_in", "Signed in"], ["signed_out", "Signed out"], ["timed_out", "Timed out"],
  ["sign_in_failed", "Sign-in refused"], ["two_step_failed", "2-step failed"], ["password_reentered,password_reentry_failed", "Password re-entered"],
];
const TONE = { signed_in: D.green, signed_out: D.textFaint, timed_out: D.amber, sign_in_failed: D.red, two_step_failed: D.red, password_reentered: D.blue, password_reentry_failed: D.red };
const at = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};
const filterField = { ...field, minHeight: 38 };

export default function SignInHistoryPanel() {
  const [kind, setKind] = useState("");
  const [person, setPerson] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const { data, isLoading, isError, refetch } = useSignInHistory({ kind, staff: person, since, until, page: pageNo > 1 ? pageNo : "" });
  const choose = (setter) => (e) => { setter(e.target.value); setPageNo(1); };
  const rows = data?.results || [];
  const summary = data?.summary;

  return (
    <div style={page}>
      <h2 style={{ ...h2, fontSize: "1.4rem" }}>Sign-in history</h2>
      {data && (
        <div role="note" style={callout(D.amber)}>
          {data.history_starts
            ? `History starts at ${new Date(data.history_starts).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}, when this began to be recorded. Earlier sign-ins are not here.`
            : "Nothing has been recorded yet. History starts with the next sign-in; earlier sign-ins were not recorded."}
        </div>
      )}
      {summary && (
        <div style={kpiGrid}>
          <Kpi label="Signed in, last 24 hours" value={summary.signed_in_24h} />
          <Kpi label="Signed in now" value={summary.signed_in_now} sub="people with a live session" />
          <Kpi label="Refused, last 24 hours" value={summary.refused_24h} sub="wrong password, unknown address or suspended" />
          <Kpi label="2-step code wrong, last 24 hours" value={summary.two_step_failed_24h} />
        </div>
      )}

      <section aria-label="Sign-ins and sign-outs" style={section}>
        <h3 style={sectionTitle}>Sign-ins and sign-outs</h3>
        <div role="group" aria-label="Filters" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <label style={labelStyle}>Person
            <select value={person} onChange={choose(setPerson)} style={filterField}>
              <option value="">Anyone</option>
              {(data?.people || []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </label>
          <label style={labelStyle}>What happened
            <select value={kind} onChange={choose(setKind)} style={filterField}>{WHAT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label style={labelStyle}>From<input type="date" value={since} max={until || undefined} onChange={choose(setSince)} style={filterField} /></label>
          <label style={labelStyle}>To<input type="date" value={until} min={since || undefined} onChange={choose(setUntil)} style={filterField} /></label>
        </div>
        {isLoading && <div role="status" style={dim}>Loading…</div>}
        {isError && <div role="alert" style={errorStyle}>Could not load the sign-in history. <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button></div>}
        {data && rows.length === 0 && <div style={dim}>Nothing matches those filters.</div>}
        {rows.length > 0 && (
          <div style={scroll}>
            <table style={table}>
              <thead><tr>{["When", "Who", "What happened", "Device", "Address", "2-step"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, whiteSpace: "nowrap", ...figures }}>{at(r.at)}</td>
                    <td style={td}>
                      {r.who ? (
                        <>
                          <span style={{ background: ROLE_ACCENTS[r.who.role] || D.textDim, color: ROLE_BADGE_TEXT[r.who.role] || "#fff", borderRadius: 20, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 800, marginRight: 6, textTransform: "capitalize" }}>{r.who.role.replace("_", " ")}</span>
                          <span style={{ fontWeight: 700 }}>{r.who.name}</span>
                        </>
                      ) : <span style={dim}>{r.identifier ? `${r.identifier} (no account)` : "Unknown"}</span>}
                    </td>
                    <td style={td}><span style={chip(TONE[r.kind] || D.textFaint)}>{r.kind_label}</span>{r.note ? <div style={dim}>{r.note}</div> : null}</td>
                    <td style={td}>{r.device || "Not recorded"}</td>
                    <td style={{ ...td, ...figures }}>{r.ip || "Not recorded"}</td>
                    <td style={td}>{r.kind === "signed_in" ? (r.two_factor ? "Used" : "Not used") : r.kind === "two_step_failed" ? "Wrong code" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" disabled={pageNo <= 1} onClick={() => setPageNo((n) => n - 1)} style={button(D.panelBg, D.text, pageNo <= 1)}>Newer</button>
          <button type="button" disabled={!data?.has_next} onClick={() => setPageNo((n) => n + 1)} style={button(D.panelBg, D.text, !data?.has_next)}>Older</button>
          {data && <span style={{ ...dim, ...figures }}>{data.count} lines</span>}
        </div>
        <div style={dim}>An address that matched no account is shown masked. The wrong password itself is never kept, and the person who typed it is told nothing about whether the address exists.</div>
      </section>

      {data?.failed_recent?.length > 0 && (
        <section aria-label="Failed attempts, last 24 hours" style={section}>
          <h3 style={sectionTitle}>Failed attempts · last 24 hours</h3>
          {data.failed_recent.map((f) => (
            <div key={`${f.kind}-${f.identifier}-${f.who}`} style={{ fontSize: "0.8rem", color: D.text }}>
              <strong>{f.attempts} {f.kind === "two_step_failed" ? "wrong 2-step codes" : "refused sign-ins"}</strong> for {f.who || `${f.identifier || "an unknown address"} (no account)`}
            </div>
          ))}
          <div style={dim}>Nothing here tells you to act; the sign-in screen already limits how fast anyone can try.</div>
        </section>
      )}

      <section aria-label="How sessions end" style={section}>
        <h3 style={sectionTitle}>How sessions end</h3>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8rem", color: D.text, display: "flex", flexDirection: "column", gap: 3 }}>
          <li>After 30 minutes with no activity, or 12 hours after signing in, whichever comes first. A timeout is written when the session is next used or swept.</li>
          <li>When the person signs out, or when you sign them out of all devices in People › Sessions &amp; devices.</li>
          <li>When their account is suspended: the next request is refused.</li>
        </ul>
      </section>
    </div>
  );
}
