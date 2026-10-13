import { useState } from "react";
import { useFunnel } from "../../../hooks/useInsights.js";
import { D } from "../theme.js";
import { dim } from "./panelStyles.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { errorStyle } from "./portfolioParts.jsx";
import { ExportBar, Select, ShareBar, Status, Title, isoDay, page, percent, section, sectionTitle, warn } from "./insightsParts.jsx";

// ─── Super Admin 07 Growth funnel ────────────────────────────────────────────
// Every place a scout first visited in the window, followed through registration,
// KYC, first live listing, first paid sale and three paid months. "Visited" is only
// what scouts logged as a done GPS check-in. The drop-off sentences are built from
// the counts and nothing else.
const WINDOWS = [["90", "The last 90 days"], ["180", "The last 6 months"], ["365", "The last year"]];
const STAGE_KEYS = ["visited", "registered", "kyc", "listing", "order", "paid3"];
const STAGE_HEADS = { visited: "Visited", registered: "Registered", kyc: "KYC approved", listing: "Listing live", order: "First paid sale", paid3: "3 months paid" };

function windowRange(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - Number(days));
  return { from: isoDay(from), to: isoDay(to) };
}

export default function GrowthFunnelPanel() {
  const [team, setTeam] = useState("");
  const [days, setDays] = useState("180");
  const [exportError, setExportError] = useState("");
  const range = windowRange(days);
  const params = { team, ...range };
  const { data, isLoading, isError } = useFunnel(params);
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  const top = data?.stages?.[0]?.count || 0;

  return (
    <div style={page}>
      <Title right={data && <ExportBar path={`/api/insights/funnel/?${qs}`} stem={`ashantihub-funnel-${range.from}-${range.to}`} onError={setExportError} />}>Growth funnel</Title>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Select label="Team" value={team} onChange={setTeam} options={data?.team_options || []} allLabel="All scouts" />
        <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>
          First visited
          <select value={days} onChange={(e) => setDays(e.target.value)} style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", background: D.panelBg, color: D.text }}>
            {WINDOWS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      </div>
      {exportError && <div role="alert" style={errorStyle}>{exportError}</div>}
      <div style={{ ...dim, lineHeight: 1.5 }}>Every place a scout first visited between {range.from} and {range.to}, followed through each stage. A place first visited recently cannot have three paid months yet, so the last stage is still filling.</div>
      <Status isLoading={isLoading} isError={isError}>
        {data && (top === 0 ? (
          <section style={section}><span style={dim}>No scout logged a done visit to a new place in this window{team ? " for this team" : ""}.</span></section>
        ) : (
          <>
            <section aria-labelledby="funnel" style={section}>
              <h3 id="funnel" style={sectionTitle}>Funnel · {data.scouts} scouts</h3>
              <div style={{ ...dim, fontWeight: 800 }}>Visit to 3 months paid: {percent(data.overall)}</div>
              {data.stages.map((s) => (
                <div key={s.key} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 1fr) 3fr minmax(150px, 1.4fr)", gap: 10, alignItems: "center", fontSize: "0.8rem", color: D.text }}>
                  <span style={{ fontWeight: 800 }}>{s.label}<div style={dim}>{s.note}</div></span>
                  <ShareBar share={top ? s.count / top : 0} label={`${s.label}: ${s.count}`} />
                  <span style={figures}>{s.count.toLocaleString("en-GB")}{s.share_of_previous !== null && <span style={dim}> · {s.share_of_previous}% of the stage before{s.median_days !== null ? ` · median ${s.median_days} day${s.median_days === 1 ? "" : "s"}` : ""}</span>}</span>
                </div>
              ))}
            </section>
            <section aria-labelledby="by-scout" style={section}>
              <h3 id="by-scout" style={sectionTitle}>By scout</h3>
              <div style={scroll}>
                <table style={table}>
                  <thead><tr><th scope="col" style={th}>Scout</th>{STAGE_KEYS.map((k) => <th key={k} scope="col" style={th}>{STAGE_HEADS[k]}</th>)}<th scope="col" style={th}>Visit → 3 months</th></tr></thead>
                  <tbody>
                    {data.by_scout.map((r) => (
                      <tr key={r.staff_id}>
                        <td style={{ ...td, fontWeight: 800 }}>{r.name}</td>
                        {STAGE_KEYS.map((k) => (
                          <td key={k} style={{ ...td, ...figures, color: k === "kyc" && r.below_team ? warn : undefined, fontWeight: k === "kyc" && r.below_team ? 800 : 400 }}>
                            {r.counts[k]}{k === "kyc" && r.kyc_share !== null ? ` · ${Math.round(r.kyc_share)}%` : ""}
                          </td>
                        ))}
                        <td style={{ ...td, ...figures }}>{percent(r.overall)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ ...td, fontWeight: 800 }}>Everyone shown</td>
                      {data.stages.map((s) => <td key={s.key} style={{ ...td, ...figures, fontWeight: 800 }}>{s.count}</td>)}
                      <td style={{ ...td, ...figures, fontWeight: 800 }}>{percent(data.overall)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <span style={dim}>KYC approved shows the count and the share of that scout's registrations. Orange marks a share well below the group's.</span>
            </section>
            <section aria-labelledby="by-zone" style={section}>
              <h3 id="by-zone" style={sectionTitle}>By zone</h3>
              <div style={scroll}>
                <table style={table}>
                  <thead><tr><th scope="col" style={th}>Zone</th>{STAGE_KEYS.map((k) => <th key={k} scope="col" style={th}>{STAGE_HEADS[k]}</th>)}</tr></thead>
                  <tbody>
                    {data.by_zone.map((z) => (
                      <tr key={z.zone_id ?? "none"}><td style={td}>{z.zone}</td>{STAGE_KEYS.map((k) => <td key={k} style={{ ...td, ...figures }}>{z.counts[k]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {data.notes.length > 0 && (
              <section aria-labelledby="drop" style={section}>
                <h3 id="drop" style={sectionTitle}>Where businesses drop out</h3>
                {data.notes.map((n) => (
                  <div key={n.title} style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 8 }}>
                    <div style={{ fontWeight: 800, fontSize: "0.85rem", color: D.text }}>{n.title}</div>
                    <div style={dim}>{n.body}</div>
                  </div>
                ))}
              </section>
            )}
          </>
        ))}
      </Status>
    </div>
  );
}
